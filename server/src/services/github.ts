import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

function getWorkDir(): string {
  return process.env.WORK_DIR ?? "/tmp/ralfus-work";
}

function getRepoUrl(): string {
  const url = process.env.GITHUB_REPO_URL;
  if (!url) throw new Error("GITHUB_REPO_URL env var is not set");
  return toHttpsUrl(url);
}

/**
 * Returns the HTTPS web URL for the configured repo (without .git suffix).
 * e.g. https://github.com/owner/repo
 */
export function getRepoWebUrl(): string {
  const url = process.env.GITHUB_REPO_URL;
  if (!url) throw new Error("GITHUB_REPO_URL env var is not set");
  return toHttpsUrl(url).replace(/\.git$/, "");
}

/**
 * Converts an SSH GitHub URL (git@github.com:owner/repo.git) to HTTPS format.
 * HTTPS URLs are returned unchanged.
 */
function toHttpsUrl(url: string): string {
  const sshMatch = url.match(/^git@github\.com:(.+)$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }
  return url;
}

function getGithubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is not set");
  return token;
}

function getGhEnv(): NodeJS.ProcessEnv {
  const token = getGithubToken();
  return { ...process.env, GH_TOKEN: token };
}

/**
 * Embeds the GitHub token into an HTTPS URL for credential-free git operations.
 * e.g. https://github.com/owner/repo.git → https://x-token-auth:<token>@github.com/owner/repo.git
 */
function toAuthenticatedUrl(httpsUrl: string): string {
  const token = getGithubToken();
  return httpsUrl.replace("https://", `https://x-token-auth:${token}@`);
}

/**
 * Returns the local path to the repo checkout for a given issue.
 * Clones the repo if it hasn't been checked out yet, otherwise reuses the existing checkout.
 */
export async function ensureRepoCheckedOut(issueId: string): Promise<string> {
  const workDir = getWorkDir();
  const repoPath = path.join(workDir, issueId);

  if (fs.existsSync(path.join(repoPath, ".git"))) {
    console.log(`Repo already checked out at ${repoPath}, reusing`);
    const env = { ...getGhEnv(), GIT_TERMINAL_PROMPT: "0" };
    // Ensure the remote URL always has a fresh token embedded so pull doesn't
    // hit an auth prompt or stale credential.
    const authenticatedUrl = toAuthenticatedUrl(getRepoUrl());
    await execFileAsync(
      "git",
      ["-C", repoPath, "remote", "set-url", "origin", authenticatedUrl],
      { env }
    ).catch((err) => {
      console.warn(`git remote set-url failed (non-fatal): ${err.message}`);
    });
    await execFileAsync("git", ["-C", repoPath, "pull", "--ff-only"], {
      env,
    }).catch((err) => {
      console.warn(`git pull failed (non-fatal): ${err.message}`);
    });
    return repoPath;
  }

  const repoUrl = getRepoUrl();
  console.log(`Cloning ${repoUrl} into ${repoPath}`);

  fs.mkdirSync(workDir, { recursive: true });

  await execFileAsync("git", ["clone", toAuthenticatedUrl(repoUrl), repoPath], {
    env: getGhEnv(),
  });

  console.log(`Repo cloned to ${repoPath}`);
  return repoPath;
}

/**
 * Switches to the given branch if it already exists (locally or on remote),
 * otherwise creates it. Returns true if the branch was freshly created.
 * The branch is pushed to origin on the first commit via commitAndPush.
 */
export async function createBranch(repoPath: string, branchName: string): Promise<boolean> {
  const env = getGhEnv();

  // 1. Try switching to an existing local branch
  try {
    await execFileAsync("git", ["-C", repoPath, "checkout", branchName], { env });
    console.log(`Branch "${branchName}" already exists locally — switched to it`);
    return false;
  } catch {
    // not a local branch — fall through
  }

  // 2. Try fetching + tracking the branch from the remote
  try {
    await execFileAsync("git", ["-C", repoPath, "fetch", "origin", branchName], { env });
    await execFileAsync(
      "git",
      ["-C", repoPath, "checkout", "--track", `origin/${branchName}`],
      { env }
    );
    console.log(`Branch "${branchName}" fetched from remote and checked out`);
    return false;
  } catch {
    // not on remote either — fall through
  }

  // 3. Create a fresh branch
  await execFileAsync("git", ["-C", repoPath, "checkout", "-b", branchName], { env });
  console.log(`Branch "${branchName}" created locally`);
  return true;
}

/**
 * Stages all changes, commits with the given message, and pushes to origin.
 * Uses --set-upstream so it works even when the branch hasn't been pushed yet
 * (e.g. freshly created branch on an empty or uninitialized remote repo).
 * Throws if there are no changes to commit.
 */
export async function commitAndPush(repoPath: string, message: string): Promise<void> {
  const env = getGhEnv();
  await execFileAsync("git", ["-C", repoPath, "add", "-A"], { env });

  // Check if there is anything staged before committing
  const { stdout: statusOut } = await execFileAsync(
    "git", ["-C", repoPath, "status", "--porcelain"], { env }
  );
  if (!statusOut.trim()) {
    console.log(`commitAndPush: nothing to commit for "${message}" — skipping`);
    return;
  }

  await execFileAsync("git", [
    "-C", repoPath,
    "-c", "user.email=ralfus@ralfus.app",
    "-c", "user.name=Ralfus",
    "commit",
    "-m", message,
  ], { env });
  await execFileAsync("git", ["-C", repoPath, "push", "--set-upstream", "origin", "HEAD"], { env });
  console.log(`Committed and pushed: "${message}"`);
}

/**
 * Creates a pull request using the GitHub REST API and returns the PR URL.
 */
export async function createPullRequest(
  repoPath: string,
  title: string,
  body: string
): Promise<string> {
  const token = getGithubToken();

  // Resolve the current branch name
  const { stdout: branchOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
    { env: process.env }
  );
  const head = branchOut.trim();

  // Extract owner/repo from the remote URL
  const { stdout: remoteUrlOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "remote", "get-url", "origin"],
    { env: process.env }
  );
  const remoteUrl = remoteUrlOut.trim();
  const repoMatch = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!repoMatch) throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${remoteUrl}`);
  const [, owner, repo] = repoMatch;

  // Fetch remote branches to find the best base (exclude the feature branch itself)
  await execFileAsync("git", ["-C", repoPath, "fetch", "--prune", "origin"], { env: process.env });
  const { stdout: branchListOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "branch", "-r", "--format=%(refname:short)"],
    { env: process.env }
  );
  const remoteBranches = branchListOut
    .split("\n")
    .map((b) => b.trim().replace(/^origin\//, ""))
    .filter((b) => b && b !== "HEAD" && b !== head);

  if (remoteBranches.length === 0) {
    throw new Error(
      `Cannot create PR: "${head}" is the only branch on the remote. ` +
        `Push a base branch (e.g. "main") to the repository first, then re-trigger.`
    );
  }

  // Prefer common integration branch names, then fall back to the first available
  const preferredBases = ["main", "master"];
  const base =
    preferredBases.find((b) => remoteBranches.includes(b)) ?? remoteBranches[0];

  console.log(`[createPullRequest] Remote branches: [${remoteBranches.join(", ")}] → using base: "${base}"`);

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error creating PR (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { html_url: string };
  const prUrl = data.html_url;
  console.log(`Pull request created: ${prUrl}`);
  return prUrl;
}

/**
 * Returns the full git diff between the current branch HEAD and the best
 * available base branch (main > master > first remote branch).
 * Fetches from origin first to ensure refs are up to date.
 */
export async function getGitDiff(repoPath: string): Promise<string> {
  const env = { ...getGhEnv(), GIT_TERMINAL_PROMPT: "0" };

  const { stdout: headOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
    { env }
  );
  const head = headOut.trim();

  await execFileAsync("git", ["-C", repoPath, "fetch", "--prune", "origin"], { env }).catch(
    (err) => console.warn(`git fetch failed (non-fatal): ${err.message}`)
  );

  const { stdout: branchListOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "branch", "-r", "--format=%(refname:short)"],
    { env }
  );
  const remoteBranches = branchListOut
    .split("\n")
    .map((b) => b.trim().replace(/^origin\//, ""))
    .filter((b) => b && b !== "HEAD" && b !== head);

  const preferredBases = ["main", "master"];
  const base =
    preferredBases.find((b) => remoteBranches.includes(b)) ?? remoteBranches[0] ?? "main";

  const { stdout: diff } = await execFileAsync(
    "git",
    ["-C", repoPath, "diff", `origin/${base}...HEAD`],
    { env }
  );
  return diff;
}

/**
 * Removes the local repo checkout for a given issue (optional cleanup).
 */
export async function removeRepoCheckout(issueId: string): Promise<void> {
  const workDir = getWorkDir();
  const repoPath = path.join(workDir, issueId);

  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
    console.log(`Removed repo checkout at ${repoPath}`);
  }
}
