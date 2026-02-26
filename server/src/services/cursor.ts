import { spawn } from "child_process";

export type PlanResult = {
  /** Full raw output from the Cursor agent */
  raw: string;
  /** True if the plan output contains unanswered clarifying questions */
  needsClarification: boolean;
};

/**
 * Determines whether the Cursor CLI output contains clarifying questions
 * that should be sent back to the user before proceeding.
 */
function detectClarificationNeeded(output: string): boolean {
  // Look for common markers that indicate the agent wants more information
  const patterns = [
    /^#{1,3}\s*(clarif|question|need more|before i|can you confirm)/im,
    /\?\s*$/m,
    /\bclarif(y|ication|ying)\b/i,
    /\bneed(s)? (more )?information\b/i,
    /\bplease (clarify|confirm|provide)\b/i,
  ];
  return patterns.some((re) => re.test(output));
}

/**
 * Runs the Cursor Agent CLI in plan mode with the given prompt.
 * The prompt is written to stdin; stdout + stderr are captured as the plan.
 *
 * @param prompt  The full prompt describing the issue and any prior conversation context.
 * @param repoPath  Absolute path to the local repo checkout (used as cwd).
 */
export async function runPlanMode(
  prompt: string,
  repoPath: string
): Promise<PlanResult> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY env var is not set");

  return new Promise((resolve, reject) => {
    // cursor-agent is installed at ~/.local/bin/cursor-agent (or `agent`)
    const bin =
      process.env.CURSOR_AGENT_BIN ??
      `${process.env.HOME}/.local/bin/cursor-agent`;

    console.log(`[cursor] Spawning cursor-agent: ${bin} --print --plan --workspace ${repoPath}`);

    const child = spawn(
      bin,
      [
        "--print",
        "--plan",
        "--trust",
        "--approve-mcps",
        "--workspace", repoPath,
        prompt,
      ],
      {
        env: {
          ...process.env,
          CURSOR_API_KEY: apiKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[cursor:stdout] ${text}`);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stdout.write(`[cursor:stderr] ${text}`);
    });

    child.on("close", (code) => {
      console.log(`[cursor] cursor-agent exited with code ${code}`);
      if (code !== 0) {
        const detail = [
          stderr.trim() ? `stderr: ${stderr.trim()}` : "",
          stdout.trim() ? `stdout: ${stdout.trim()}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
        reject(
          new Error(
            `cursor-agent exited with code ${code}${detail ? `. ${detail}` : " (no output)"}`
          )
        );
        return;
      }

      const raw = stdout || stderr;
      resolve({
        raw: raw.trim(),
        needsClarification: detectClarificationNeeded(raw),
      });
    });

    child.on("error", (err) => {
      console.error(`[cursor] Failed to spawn cursor-agent: ${err.message}`);
      reject(new Error(`Failed to spawn cursor-agent: ${err.message}`));
    });
  });
}

/**
 * Runs the Cursor Agent CLI in agent mode (no --plan flag) to implement code.
 * The agent makes actual file edits in the repo.
 *
 * @param prompt   The full prompt describing the task to implement.
 * @param repoPath Absolute path to the local repo checkout (used as cwd).
 * @returns Raw output from the agent.
 */
export async function runAgentMode(
  prompt: string,
  repoPath: string
): Promise<string> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY env var is not set");

  return new Promise((resolve, reject) => {
    const bin =
      process.env.CURSOR_AGENT_BIN ??
      `${process.env.HOME}/.local/bin/cursor-agent`;

    console.log(`[cursor] Spawning cursor-agent (agent mode): ${bin} --print --workspace ${repoPath}`);

    const child = spawn(
      bin,
      [
        "--print",
        "--trust",
        "--approve-mcps",
        "--workspace", repoPath,
        prompt,
      ],
      {
        env: {
          ...process.env,
          CURSOR_API_KEY: apiKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[cursor:stdout] ${text}`);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stdout.write(`[cursor:stderr] ${text}`);
    });

    child.on("close", (code) => {
      console.log(`[cursor] cursor-agent (agent mode) exited with code ${code}`);
      if (code !== 0) {
        const detail = [
          stderr.trim() ? `stderr: ${stderr.trim()}` : "",
          stdout.trim() ? `stdout: ${stdout.trim()}` : "",
        ]
          .filter(Boolean)
          .join(" | ");
        reject(
          new Error(
            `cursor-agent exited with code ${code}${detail ? `. ${detail}` : " (no output)"}`
          )
        );
        return;
      }

      resolve((stdout || stderr).trim());
    });

    child.on("error", (err) => {
      console.error(`[cursor] Failed to spawn cursor-agent: ${err.message}`);
      reject(new Error(`Failed to spawn cursor-agent: ${err.message}`));
    });
  });
}
