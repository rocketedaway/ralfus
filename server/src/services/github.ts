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
 * Creates a new git branch locally.
 * The branch is pushed to origin on the first commit via commitAndPush.
 */
export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  const env = getGhEnv();
  await execFileAsync("git", ["-C", repoPath, "checkout", "-b", branchName], { env });
  console.log(`Branch "${branchName}" created locally`);
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

  // Resolve the default branch (base) from the remote
  const { stdout: defaultBranchOut } = await execFileAsync(
    "git",
    ["-C", repoPath, "remote", "show", "origin"],
    { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }
  );
  const baseMatch = defaultBranchOut.match(/HEAD branch:\s*(\S+)/);
  const base = baseMatch ? baseMatch[1] : "main";

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
