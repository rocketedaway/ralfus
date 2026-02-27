import { execFile } from "child_process";
import { promisify } from "util";
import { LinearClient } from "@linear/sdk";
import { getIssue, upsertIssue } from "../db";
import {
  fetchIssueWithComments,
  fetchComment,
  postAgentActivity,
  postComment,
  updateIssueStatus,
  makeLinearClient,
} from "../services/linear";
import { getGitDiff, commitAndPush } from "../services/github";
import { runAgentMode } from "../services/cursor";
import { msgReviewStarting, msgReviewHadFixes, msgReviewClean, msgPrAnnounce } from "./messages";

const execFileAsync = promisify(execFile);

export async function runCodeReviewJob(
  issueId: string,
  orgId: string,
  accessToken: string
): Promise<void> {
  console.log(`[codeReviewJob] Starting self-review for issue ${issueId}`);

  const linear: LinearClient = makeLinearClient(accessToken);

  const record = await getIssue(issueId);
  if (!record) throw new Error(`[codeReviewJob] No DB record for issue ${issueId}`);

  const { agentSessionId, repoPath, planCommentId, prUrl } = record;
  if (!agentSessionId) throw new Error(`[codeReviewJob] No agentSessionId for issue ${issueId}`);
  if (!repoPath) throw new Error(`[codeReviewJob] No repoPath for issue ${issueId}`);
  if (!prUrl) throw new Error(`[codeReviewJob] No prUrl for issue ${issueId}`);

  // 1. Announce the review has started
  await postAgentActivity(linear, agentSessionId, msgReviewStarting());

  // 2. Gather context: issue details, approved plan, and git diff
  const issue = await fetchIssueWithComments(linear, issueId);

  let approvedPlan = "";
  if (planCommentId) {
    try {
      approvedPlan = await fetchComment(linear, planCommentId);
    } catch {
      console.warn(`[codeReviewJob] Could not fetch plan comment ${planCommentId} — proceeding without it`);
    }
  }

  const diff = await getGitDiff(repoPath);

  // 3. Build the review prompt
  const reviewPrompt = [
    "You are a senior software engineer performing a self-review of code you just implemented.",
    "Your job is to read the issue description, the approved implementation plan, and the diff,",
    "then fix any issues you find: bugs, logic errors, edge cases, code style inconsistencies,",
    "missing error handling, or anything that diverges from the plan.",
    "Do NOT add unnecessary changes — only fix real problems.",
    "",
    "## Issue",
    `**Title:** ${issue.title}`,
    issue.description ? `**Description:**\n${issue.description}` : "",
    "",
    approvedPlan ? `## Approved Implementation Plan\n${approvedPlan}\n` : "",
    "## Code Diff (changes to review)",
    "```diff",
    diff || "(no diff — branch may be up to date with base)",
    "```",
    "",
    "Review the diff carefully against the issue and plan.",
    "If you find problems, fix them now. If everything looks good, make no changes.",
  ]
    .filter(Boolean)
    .join("\n");

  // 4. Capture HEAD SHA before review so we can detect if any fixes were made
  const { stdout: beforeShaOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "rev-parse", "HEAD"],
    { env: process.env }
  );
  const beforeSha = beforeShaOut.trim();

  // 5. Run the cursor agent to apply any fixes
  await runAgentMode(reviewPrompt, repoPath);
  console.log(`[codeReviewJob] Self-review agent pass complete for issue ${issueId}`);

  // 6. Commit and push any fixes (no-op if nothing changed)
  await commitAndPush(repoPath, "Code review fixes");

  // 7. Compare HEAD SHA to detect whether fixes were committed
  const { stdout: afterShaOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "rev-parse", "HEAD"],
    { env: process.env }
  );
  const hadFixes = afterShaOut.trim() !== beforeSha;

  await postAgentActivity(linear, agentSessionId, hadFixes ? msgReviewHadFixes() : msgReviewClean());

  // 8. Transition Linear ticket to In Review
  await updateIssueStatus(linear, issueId, orgId, "In Review");
  console.log(`[codeReviewJob] Issue ${issueId} transitioned to "In Review"`);

  // 9. Announce the PR in the agent session and post a comment on the ticket
  const reviewer = issue.creatorName ? `@${issue.creatorName}` : "the team";
  await postAgentActivity(linear, agentSessionId, msgPrAnnounce(prUrl, reviewer));
  await postComment(linear, issueId, `🌊 PR is up and ready for review: [View PR](${prUrl})`);

  // 10. Mark as implemented in the DB
  await upsertIssue(issueId, orgId, "implemented", repoPath, null, null, prUrl);
  console.log(`[codeReviewJob] Issue ${issueId} marked as implemented — PR: ${prUrl}`);
}
