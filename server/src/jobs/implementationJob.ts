import { LinearClient } from "@linear/sdk";
import { getIssue, upsertIssue } from "../db";
import {
  fetchIssueWithComments,
  postAgentActivity,
  fetchComment,
  updateComment,
  updateIssueStatus,
  makeLinearClient,
} from "../services/linear";
import {
  ensureRepoCheckedOut,
  createBranch,
  commitAndPush,
  createPullRequest,
  getRepoWebUrl,
} from "../services/github";
import { runAgentMode } from "../services/cursor";

type PlanStep = { stepNumber: number; text: string };

/**
 * Extracts unchecked steps from the plan comment body.
 * Matches lines like: `- [ ] Step 1: Description`
 */
export function parsePlanSteps(commentBody: string): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const line of commentBody.split("\n")) {
    const match = line.match(/^- \[ \] Step (\d+): (.+)$/);
    if (match) {
      steps.push({ stepNumber: parseInt(match[1], 10), text: match[2].trim() });
    }
  }
  return steps;
}

export async function runImplementationJob(
  issueId: string,
  orgId: string,
  accessToken: string
): Promise<void> {
  console.log(`[implementationJob] Starting implementation for issue ${issueId}`);

  const linear: LinearClient = makeLinearClient(accessToken);

  // 1. Load DB record and validate required fields
  const record = await getIssue(issueId);
  if (!record) throw new Error(`[implementationJob] No DB record for issue ${issueId}`);

  const agentSessionId = record.agentSessionId;
  if (!agentSessionId) throw new Error(`[implementationJob] No agentSessionId for issue ${issueId}`);

  const planCommentId = record.planCommentId;
  if (!planCommentId) throw new Error(`[implementationJob] No planCommentId for issue ${issueId}`);

  // 2. Fetch issue details and plan comment from Linear
  console.log(`[implementationJob] Fetching issue details for ${issueId}`);
  const issue = await fetchIssueWithComments(linear, issueId);
  console.log(`[implementationJob] Issue: "${issue.title}" (${issue.identifier})`);

  console.log(`[implementationJob] Fetching plan comment ${planCommentId}`);
  let currentCommentBody = await fetchComment(linear, planCommentId);
  const steps = parsePlanSteps(currentCommentBody);

  if (steps.length === 0) {
    console.warn(`[implementationJob] No unchecked steps found in plan comment for issue ${issueId}`);
    await postAgentActivity(
      linear,
      agentSessionId,
      "⚠️ No unchecked plan steps found in the Linear comment. Implementation cancelled."
    );
    return;
  }

  console.log(`[implementationJob] Found ${steps.length} step(s) to implement: ${steps.map((s) => `Step ${s.stepNumber}`).join(", ")}`);

  // 3. Ensure repo is checked out
  console.log(`[implementationJob] Ensuring repo is checked out for issue ${issueId}`);
  const repoPath = await ensureRepoCheckedOut(issueId);
  console.log(`[implementationJob] Repo ready at ${repoPath}`);

  // 4. Create the feature branch
  const branchName = `ralfus/${issue.identifier.toLowerCase()}`;
  console.log(`[implementationJob] Creating branch "${branchName}"`);
  await createBranch(repoPath, branchName);
  console.log(`[implementationJob] Branch "${branchName}" created and pushed`);

  // 5. Transition Linear ticket to In Progress and announce the branch
  await updateIssueStatus(linear, issueId, orgId, "In Progress");
  const branchUrl = `${getRepoWebUrl()}/tree/${branchName}`;
  await postAgentActivity(
    linear,
    agentSessionId,
    `🌿 Branch created: [${branchName}](${branchUrl}) — starting implementation now!`
  );

  // 6. Implement each step, committing after each one
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepLabel = `Step ${step.stepNumber}: ${step.text}`;
    console.log(`[implementationJob] [${i + 1}/${steps.length}] Running cursor-agent for: ${stepLabel}`);

    const prompt = [
      "You are a software engineer implementing a feature step by step.",
      "",
      "## Full Implementation Plan",
      currentCommentBody,
      "",
      `## Current Task`,
      `Please implement the following step completely, making all necessary code changes:`,
      "",
      stepLabel,
    ].join("\n");

    await runAgentMode(prompt, repoPath);
    console.log(`[implementationJob] [${i + 1}/${steps.length}] cursor-agent finished for: ${stepLabel}`);

    try {
      await commitAndPush(repoPath, stepLabel);
      console.log(`[implementationJob] [${i + 1}/${steps.length}] Committed and pushed: ${stepLabel}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("nothing to commit") || msg.includes("nothing added to commit")) {
        console.log(`[implementationJob] [${i + 1}/${steps.length}] No changes for ${stepLabel} — skipping commit`);
      } else {
        throw err;
      }
    }

    // Check off the completed step in the Linear plan comment
    currentCommentBody = currentCommentBody.replace(
      `- [ ] Step ${step.stepNumber}:`,
      `- [x] Step ${step.stepNumber}:`
    );
    await updateComment(linear, planCommentId, currentCommentBody);
    console.log(`[implementationJob] [${i + 1}/${steps.length}] Checked off step ${step.stepNumber} in Linear`);

    await postAgentActivity(
      linear,
      agentSessionId,
      `✅ Committed step ${step.stepNumber}/${steps.length}: ${step.text}`
    );
  }

  // 7. Create the pull request
  console.log(`[implementationJob] All steps done — creating pull request for issue ${issueId}`);
  const implementationSummary = steps.map((s) => `- ${s.text}`).join("\n");
  const prBody = [
    `Resolves [${issue.identifier}](${issue.url})`,
    "",
    "## Description",
    issue.description ?? "See Linear ticket.",
    "",
    "## Implementation Summary",
    implementationSummary,
    "",
    "## Test Plan",
    "- Run existing tests to verify nothing is broken",
    "- Manually verify the implemented functionality against the Linear ticket",
  ].join("\n");

  const prUrl = await createPullRequest(repoPath, issue.title, prBody);
  console.log(`[implementationJob] Pull request created: ${prUrl}`);

  // 8. Transition Linear ticket to In Review
  await updateIssueStatus(linear, issueId, orgId, "In Review");
  console.log(`[implementationJob] Issue ${issueId} transitioned to "In Review"`);

  // 9. Announce the PR and ping the reviewer
  const reviewer = issue.creatorName ? `@${issue.creatorName}` : "the team";
  await postAgentActivity(
    linear,
    agentSessionId,
    `🎉 All steps implemented! PR ready for review: [View PR](${prUrl}) — ${reviewer}, please take a look!`
  );

  // 10. Mark as done in the DB
  await upsertIssue(issueId, orgId, "implemented", repoPath);
  console.log(`[implementationJob] Issue ${issueId} marked as implemented — PR: ${prUrl}`);
}
