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

function getGhEnv(): NodeJS.ProcessEnv {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is not set");
  return { ...process.env, GH_TOKEN: token };
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
    // Pull latest changes to keep the checkout fresh
    await execFileAsync("git", ["-C", repoPath, "pull", "--ff-only"], {
      env: getGhEnv(),
    }).catch((err) => {
      console.warn(`git pull failed (non-fatal): ${err.message}`);
    });
    return repoPath;
  }

  const repoUrl = getRepoUrl();
  console.log(`Cloning ${repoUrl} into ${repoPath}`);

  fs.mkdirSync(workDir, { recursive: true });

  await execFileAsync("gh", ["repo", "clone", repoUrl, repoPath], {
    env: getGhEnv(),
  });

  console.log(`Repo cloned to ${repoPath}`);
  return repoPath;
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
