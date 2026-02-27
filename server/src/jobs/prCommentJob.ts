import { execFile } from "child_process";
import { promisify } from "util";
import {
  ensureRepoCheckedOut,
  createBranch,
  commitAndPush,
  getGitDiff,
  getPrBranch,
  postPrComment,
} from "../services/github";
import { runAgentMode } from "../services/cursor";
import { msgPrCommentStarted, msgPrCommentDone } from "./messages";

const execFileAsync = promisify(execFile);

/**
 * Tracks PRs that currently have a job in flight to prevent concurrent runs
 * on the same PR. Keyed by "owner/repo#prNumber".
 */
const activePrs = new Set<string>();

function prKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}/${repo}#${prNumber}`;
}

/**
 * Handles a /ralfus comment on a GitHub PR:
 *  1. Checks out the PR's head branch
 *  2. Runs Cursor agent with the instruction as the prompt
 *  3. Commits and pushes any changes
 *  4. Replies on the PR with a summary
 */
export async function runPrCommentJob(
  owner: string,
  repo: string,
  prNumber: number,
  instruction: string
): Promise<void> {
  const key = prKey(owner, repo, prNumber);

  if (activePrs.has(key)) {
    console.log(`[prCommentJob] Already processing ${key} — posting busy reply`);
    await postPrComment(
      owner,
      repo,
      prNumber,
      "🌊 Hang loose — I'm still shredding through the previous request on this PR. Try again once that wave has rolled in! 🌵"
    ).catch((err) =>
      console.error(`[prCommentJob] Failed to post busy reply on ${key}:`, err)
    );
    return;
  }

  activePrs.add(key);
  console.log(`[prCommentJob] Starting for ${key}: "${instruction.slice(0, 80)}"`);

  try {
    // 1. Acknowledge the comment immediately
    await postPrComment(owner, repo, prNumber, msgPrCommentStarted()).catch(
      (err) => console.warn(`[prCommentJob] Failed to post started comment on ${key}:`, err)
    );

    // 2. Resolve the PR's head branch
    const headBranch = await getPrBranch(owner, repo, prNumber);
    console.log(`[prCommentJob] PR branch: "${headBranch}"`);

    // 3. Ensure the repo is checked out (keyed by PR, not Linear issue)
    const checkoutKey = `pr-${owner}-${repo}-${prNumber}`;
    const repoPath = await ensureRepoCheckedOut(checkoutKey);

    // 4. Switch to the PR's head branch
    await createBranch(repoPath, headBranch);

    // 5. Pull latest changes on this branch so we're up to date
    await execFileAsync("git", ["-C", repoPath, "pull", "--ff-only"], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).catch((err) =>
      console.warn(`[prCommentJob] git pull failed (non-fatal): ${err.message}`)
    );

    // 6. Gather current diff for context
    const diff = await getGitDiff(repoPath);

    // 7. Build the prompt
    const prompt = [
      "You are a software engineer working on an open pull request.",
      "A code reviewer has left a comment requesting a specific change.",
      "Please implement the requested change exactly. Do NOT make unrelated modifications.",
      "",
      "## Reviewer Instruction",
      instruction,
      "",
      diff
        ? "## Current PR Diff (for context)\n```diff\n" + diff + "\n```"
        : "(no diff available — branch may be up to date with base)",
    ].join("\n");

    // 8. Run Cursor agent
    await runAgentMode(prompt, repoPath);
    console.log(`[prCommentJob] Cursor agent pass complete for ${key}`);

    // 9. Capture SHA before commit attempt to detect whether changes were made
    const { stdout: beforeShaOut } = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "HEAD"],
      { env: process.env }
    );
    const beforeSha = beforeShaOut.trim();

    // 10. Commit and push (no-op if nothing changed)
    await commitAndPush(
      repoPath,
      `pr comment: ${instruction.slice(0, 72)}`
    );

    const { stdout: afterShaOut } = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "HEAD"],
      { env: process.env }
    );
    const hadChanges = afterShaOut.trim() !== beforeSha;

    // 11. Reply on the PR
    await postPrComment(owner, repo, prNumber, msgPrCommentDone(hadChanges));
    console.log(`[prCommentJob] Done for ${key} (hadChanges=${hadChanges})`);
  } catch (err) {
    console.error(`[prCommentJob] Error processing ${key}:`, err);
    await postPrComment(
      owner,
      repo,
      prNumber,
      `🌵 Wiped out on that one! Hit an error while processing your request. Check the server logs for the full damage report.\n\n\`\`\`\n${err}\n\`\`\``
    ).catch((postErr) =>
      console.error(`[prCommentJob] Failed to post error reply on ${key}:`, postErr)
    );
  } finally {
    activePrs.delete(key);
  }
}
