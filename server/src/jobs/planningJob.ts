import { LinearClient } from "@linear/sdk";
import { getIssue, upsertIssue } from "../db";
import {
  fetchIssueWithComments,
  postComment,
  updateIssueStatus,
  IssueComment,
} from "../services/linear";
import { ensureRepoCheckedOut } from "../services/github";
import { runPlanMode } from "../services/cursor";

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildInitialPrompt(
  title: string,
  description: string | null
): string {
  const descSection = description?.trim()
    ? `\n\n## Description\n${description.trim()}`
    : "";

  return `You are a software engineer planning work on a Linear ticket.\n\nPlease produce a concise implementation plan for the following ticket. If you need any clarifications before you can create a solid plan, list them at the end under a "## Clarifying Questions" heading.\n\n## Ticket Title\n${title}${descSection}\n\nOutput format:\n1. A numbered implementation plan.\n2. (Optional) A "## Clarifying Questions" section if you need more details.`;
}

function buildClarificationPrompt(
  title: string,
  description: string | null,
  comments: IssueComment[]
): string {
  const conversation = comments
    .map((c) => `[Comment]\n${c.body}`)
    .join("\n\n---\n\n");

  const descSection = description?.trim()
    ? `\n\n## Description\n${description.trim()}`
    : "";

  return `You are a software engineer planning work on a Linear ticket.\n\nThe following is the ticket details and the conversation so far. A user has responded to your previous clarifying questions. Please update your implementation plan based on their answers. If you still need more information, list remaining questions under "## Clarifying Questions".\n\n## Ticket Title\n${title}${descSection}\n\n## Conversation\n${conversation}\n\nOutput format:\n1. An updated numbered implementation plan.\n2. (Optional) A "## Clarifying Questions" section if you still need more details.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isApproval(text: string): boolean {
  return /\b(approved?|lgtm|looks?\s*good|go\s*ahead|proceed|start(\s+work)?|yes|ok(ay)?|confirm(ed)?|ship\s*it|sounds?\s*good)\b/i.test(
    text.trim()
  );
}

async function postPlanAndAwaitApproval(
  linear: LinearClient,
  issueId: string,
  organizationId: string,
  planText: string,
  repoPath: string
): Promise<void> {
  const body = `## Implementation Plan\n\n${planText}\n\n---\n_Reply **approved** to start work, or share any feedback and I'll update the plan._`;
  await postComment(linear, issueId, body);
  await upsertIssue(issueId, organizationId, "awaiting_approval", repoPath);
}

// ---------------------------------------------------------------------------
// Job: initial planning when an issue is first assigned
// ---------------------------------------------------------------------------

export async function runInitialPlanningJob(
  issueId: string,
  organizationId: string,
  accessToken: string
): Promise<void> {
  console.log(`[planningJob] Starting initial planning for issue ${issueId}`);

  const linear = new LinearClient({ accessToken });

  // Bail out if we've already processed this assignment (idempotency)
  const existing = await getIssue(issueId);
  if (existing && existing.state !== "planning") {
    console.log(
      `[planningJob] Issue ${issueId} already in state "${existing.state}", skipping initial planning`
    );
    return;
  }

  await upsertIssue(issueId, organizationId, "planning");

  // 1. Fetch full issue details from Linear
  const issue = await fetchIssueWithComments(linear, issueId);

  // 2. Ensure the repo is checked out
  let repoPath: string;
  try {
    repoPath = await ensureRepoCheckedOut(issueId);
  } catch (err) {
    console.error(`[planningJob] Failed to checkout repo: ${err}`);
    await postComment(
      linear,
      issueId,
      `⚠️ I was unable to check out the repository. Please ensure \`GITHUB_REPO_URL\` and \`GITHUB_TOKEN\` are configured correctly.\n\n\`\`\`\n${err}\n\`\`\``
    );
    return;
  }

  await upsertIssue(issueId, organizationId, "planning", repoPath);

  // 3. Build the prompt and run Cursor in plan mode
  const prompt = buildInitialPrompt(issue.title, issue.description);

  let planResult;
  try {
    planResult = await runPlanMode(prompt, repoPath);
  } catch (err) {
    console.error(`[planningJob] Cursor CLI failed: ${err}`);
    await postComment(
      linear,
      issueId,
      `⚠️ I encountered an error while generating the plan. Please check the server logs.\n\n\`\`\`\n${err}\n\`\`\``
    );
    return;
  }

  // 4. Post the plan to Linear and always wait for user confirmation
  if (planResult.needsClarification) {
    const body = `## Implementation Plan (Draft)\n\nI've started thinking through this ticket, but I have a few questions before I can finalize the plan.\n\n${planResult.raw}\n\n---\n_Please reply with your answers and I'll update the plan._`;
    await postComment(linear, issueId, body);
    await upsertIssue(issueId, organizationId, "awaiting_clarification", repoPath);
    console.log(`[planningJob] Plan posted with clarifying questions for issue ${issueId}`);
  } else {
    await postPlanAndAwaitApproval(linear, issueId, organizationId, planResult.raw, repoPath);
    console.log(`[planningJob] Plan posted for approval for issue ${issueId}`);
  }
}

// ---------------------------------------------------------------------------
// Job: handle a follow-up clarification from the user
// ---------------------------------------------------------------------------

export async function runClarificationJob(
  issueId: string,
  organizationId: string,
  accessToken: string
): Promise<void> {
  console.log(`[planningJob] Processing clarification for issue ${issueId}`);

  const linear = new LinearClient({ accessToken });

  const record = await getIssue(issueId);
  if (!record) {
    console.warn(
      `[planningJob] No DB record for issue ${issueId}, ignoring clarification`
    );
    return;
  }

  if (record.state !== "awaiting_clarification" && record.state !== "awaiting_approval") {
    console.log(
      `[planningJob] Issue ${issueId} is in state "${record.state}", not awaiting input — ignoring`
    );
    return;
  }

  // 1. Fetch updated issue + full comment thread from Linear
  const issue = await fetchIssueWithComments(linear, issueId);

  const repoPath = record.repoPath ?? (await ensureRepoCheckedOut(issueId));

  // 2. If awaiting approval, check if the latest comment is an approval
  if (record.state === "awaiting_approval") {
    const latestComment = issue.comments[issue.comments.length - 1];
    if (latestComment && isApproval(latestComment.body)) {
      await postComment(linear, issueId, `✅ Plan approved — starting work now!`);
      await updateIssueStatus(linear, issueId, organizationId, "In Progress");
      await upsertIssue(issueId, organizationId, "in_progress", repoPath);
      console.log(`[planningJob] Issue ${issueId} approved and now In Progress`);
      return;
    }
    // Not an approval — treat as feedback and re-run the agent
  }

  await upsertIssue(issueId, organizationId, "awaiting_clarification", repoPath);

  // 3. Re-run Cursor with the full conversation context
  const prompt = buildClarificationPrompt(
    issue.title,
    issue.description,
    issue.comments
  );

  let planResult;
  try {
    planResult = await runPlanMode(prompt, repoPath);
  } catch (err) {
    console.error(`[planningJob] Cursor CLI failed on clarification: ${err}`);
    await postComment(
      linear,
      issueId,
      `⚠️ I encountered an error while updating the plan. Please check the server logs.\n\n\`\`\`\n${err}\n\`\`\``
    );
    return;
  }

  // 4. Post updated plan — always require approval again
  if (planResult.needsClarification) {
    const body = `## Updated Implementation Plan\n\nThank you for the details! I still have a couple of follow-up questions:\n\n${planResult.raw}\n\n---\n_Please reply and I'll finalize the plan._`;
    await postComment(linear, issueId, body);
    await upsertIssue(issueId, organizationId, "awaiting_clarification", repoPath);
    console.log(`[planningJob] Updated plan with remaining questions for issue ${issueId}`);
  } else {
    await postPlanAndAwaitApproval(linear, issueId, organizationId, planResult.raw, repoPath);
    console.log(`[planningJob] Updated plan posted for approval for issue ${issueId}`);
  }
}

