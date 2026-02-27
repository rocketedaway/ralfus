import { LinearClient } from "@linear/sdk";
import { getIssue, upsertIssue } from "../db";
import {
  fetchIssueWithComments,
  postAgentActivity,
  postPlanComment,
  IssueComment,
} from "../services/linear";
import { ensureRepoCheckedOut } from "../services/github";
import { runPlanMode } from "../services/cursor";
import { getQueue } from "./queue";
import { runImplementationJob } from "./implementationJob";

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

/**
 * Converts a numbered plan (from Cursor output) into checkbox markdown format
 * suitable for posting as a Linear comment.
 *
 * "1. Add auth middleware" → "- [ ] Step 1: Add auth middleware"
 */
function planTextToCheckboxes(planText: string): string {
  // Strip any clarifying questions section if present
  const planOnly = planText.split(/^##\s+Clarif/im)[0].trim();

  return planOnly
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\d+)\.\s+(.+)/);
      if (match) return `- [ ] Step ${match[1]}: ${match[2].trim()}`;
      return line;
    })
    .join("\n")
    .trim();
}

async function postPlanAndAwaitApproval(
  linear: LinearClient,
  agentSessionId: string,
  issueId: string,
  organizationId: string,
  planText: string,
  repoPath: string
): Promise<void> {
  // Post the plan as a comment on the ticket (checkbox format) so Linear is the source of truth
  const checkboxPlan = planTextToCheckboxes(planText);
  const commentBody = `## Implementation Plan\n\n${checkboxPlan}`;
  const commentId = await postPlanComment(linear, issueId, commentBody);

  // Store the comment ID so the implementation job can reference and update it
  await upsertIssue(issueId, organizationId, "awaiting_approval", repoPath, null, commentId);

  // Notify the agent session thread
  await postAgentActivity(
    linear,
    agentSessionId,
    `## Implementation Plan\n\n${checkboxPlan}\n\n---\n_Reply **approved** to start work, or share any feedback and I'll update the plan._`
  );
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
  // agentSessionId was stored by the webhook handler before this job was enqueued
  const record = await getIssue(issueId);
  if (record && record.state !== "planning") {
    console.log(
      `[planningJob] Issue ${issueId} already in state "${record.state}", skipping initial planning`
    );
    return;
  }

  const agentSessionId = record?.agentSessionId ?? null;

  if (!agentSessionId) {
    console.error(`[planningJob] No agentSessionId for issue ${issueId} — cannot post to agent thread`);
    return;
  }

  // 1. Fetch full issue details from Linear
  const issue = await fetchIssueWithComments(linear, issueId);

  // 2. Ensure the repo is checked out
  let repoPath: string;
  try {
    repoPath = await ensureRepoCheckedOut(issueId);
  } catch (err) {
    console.error(`[planningJob] Failed to checkout repo: ${err}`);
    await postAgentActivity(
      linear,
      agentSessionId,
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
    await postAgentActivity(
      linear,
      agentSessionId,
      `⚠️ I encountered an error while generating the plan. Please check the server logs.\n\n\`\`\`\n${err}\n\`\`\``
    );
    return;
  }

  // 4. Post the plan and always wait for user confirmation
  if (planResult.needsClarification) {
    const body = `## Implementation Plan (Draft)\n\nI've started thinking through this ticket, but I have a few questions before I can finalize the plan.\n\n${planResult.raw}\n\n---\n_Please reply with your answers and I'll update the plan._`;
    await postAgentActivity(linear, agentSessionId, body);
    await upsertIssue(issueId, organizationId, "awaiting_clarification", repoPath);
    console.log(`[planningJob] Plan posted with clarifying questions for issue ${issueId}`);
  } else {
    await postPlanAndAwaitApproval(linear, agentSessionId, issueId, organizationId, planResult.raw, repoPath);
    console.log(`[planningJob] Plan posted for approval for issue ${issueId}`);
  }
}

// ---------------------------------------------------------------------------
// Job: handle a follow-up clarification from the user
// ---------------------------------------------------------------------------

export async function runClarificationJob(
  issueId: string,
  organizationId: string,
  accessToken: string,
  userMessage?: string
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

  const agentSessionId = record.agentSessionId;
  if (!agentSessionId) {
    console.error(`[planningJob] No agentSessionId for issue ${issueId} — cannot post to agent thread`);
    return;
  }

  // 1. Fetch updated issue + full comment thread from Linear
  const issue = await fetchIssueWithComments(linear, issueId);

  // Always call ensureRepoCheckedOut — it reuses an existing checkout if .git is present,
  // but re-clones if /tmp was cleared after a machine restart.
  const repoPath = await ensureRepoCheckedOut(issueId);

  // 2. Check if the incoming message is an approval — applies to both awaiting_approval
  //    and awaiting_clarification states so that repeated "approved" replies always work.
  //    Use || (not ??) so that an empty string falls through to the last comment body.
  const messageToCheck =
    userMessage?.trim() ||
    issue.comments[issue.comments.length - 1]?.body ||
    "";

  if (isApproval(messageToCheck)) {
    await postAgentActivity(linear, agentSessionId, `✅ Plan approved — starting work now!`);
    await upsertIssue(issueId, organizationId, "in_progress", repoPath);
    console.log(`[planningJob] Issue ${issueId} approved — enqueuing implementation job`);
    getQueue().add(async () => {
      try {
        await runImplementationJob(issueId, organizationId, accessToken);
      } catch (err) {
        console.error(`[queue] Implementation job failed for issue ${issueId}:`, err);
      }
    });
    return;
  }

  await upsertIssue(issueId, organizationId, "awaiting_clarification", repoPath);

  // Build context: use the userMessage from the webhook if available,
  // otherwise fall back to the issue comment thread
  const contextComments: IssueComment[] = userMessage
    ? [...issue.comments, { id: "latest", body: userMessage, createdAt: new Date(), userId: null }]
    : issue.comments;

  // 3. Re-run Cursor with the full conversation context
  const prompt = buildClarificationPrompt(
    issue.title,
    issue.description,
    contextComments
  );

  let planResult;
  try {
    planResult = await runPlanMode(prompt, repoPath);
  } catch (err) {
    console.error(`[planningJob] Cursor CLI failed on clarification: ${err}`);
    await postAgentActivity(
      linear,
      agentSessionId,
      `⚠️ I encountered an error while updating the plan. Please check the server logs.\n\n\`\`\`\n${err}\n\`\`\``
    );
    return;
  }

  // 4. Post updated plan — always require approval again
  if (planResult.needsClarification) {
    const body = `## Updated Implementation Plan\n\nThank you for the details! I still have a couple of follow-up questions:\n\n${planResult.raw}\n\n---\n_Please reply and I'll finalize the plan._`;
    await postAgentActivity(linear, agentSessionId, body);
    await upsertIssue(issueId, organizationId, "awaiting_clarification", repoPath);
    console.log(`[planningJob] Updated plan with remaining questions for issue ${issueId}`);
  } else {
    await postPlanAndAwaitApproval(linear, agentSessionId, issueId, organizationId, planResult.raw, repoPath);
    console.log(`[planningJob] Updated plan posted for approval for issue ${issueId}`);
  }
}

