import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getQueue } from "../jobs/queue";
import { runPrCommentJob } from "../jobs/prCommentJob";

export const githubWebhookRouter = Router();

function verifyGithubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

type IssueCommentPayload = {
  action: string;
  issue: {
    number: number;
    title: string;
    pull_request?: { url: string };
  };
  comment: {
    id: number;
    body: string;
    user: { login: string };
  };
  repository: {
    name: string;
    owner: { login: string };
  };
};

type PullRequestReviewCommentPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
  };
  comment: {
    id: number;
    body: string;
    user: { login: string };
  };
  repository: {
    name: string;
    owner: { login: string };
  };
};

const TRIGGER_REGEX = /@ralfus(?:-bot)?\s+(.+)/is;

githubWebhookRouter.post("/", async (req: Request, res: Response) => {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (webhookSecret) {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!verifyGithubSignature(rawBody, signature, webhookSecret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // Respond quickly — GitHub expects a reply within 10 seconds
  res.status(200).json({ ok: true });

  const event = req.headers["x-github-event"] as string | undefined;

  if (event === "pull_request_review_comment") {
    let payload: PullRequestReviewCommentPayload;
    try {
      payload = JSON.parse((req.body as Buffer).toString("utf-8")) as PullRequestReviewCommentPayload;
    } catch (err) {
      console.error("[github webhook] Failed to parse payload:", err);
      return;
    }

    if (payload.action !== "created") return;

    const commentBody = payload.comment.body?.trim() ?? "";
    const reviewMatch = TRIGGER_REGEX.exec(commentBody);
    if (!reviewMatch) {
      console.log(
        `[github webhook] review comment on ${payload.repository.owner.login}/${payload.repository.name}#${payload.pull_request.number} by @${payload.comment.user.login} does not mention @ralfus — ignoring`
      );
      return;
    }

    const instruction = reviewMatch[1].trim();
    if (!instruction) {
      console.log("[github webhook] @ralfus review comment had no instruction — ignoring");
      return;
    }

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const prNumber = payload.pull_request.number;

    console.log(
      `[github webhook] Enqueuing prCommentJob (review comment) — ${owner}/${repo}#${prNumber} by @${payload.comment.user.login}: "${instruction.slice(0, 80)}"`
    );

    getQueue().add(async () => {
      try {
        await runPrCommentJob(owner, repo, prNumber, instruction);
      } catch (err) {
        console.error(
          `[queue] prCommentJob failed for ${owner}/${repo}#${prNumber}:`,
          err
        );
      }
    });
    return;
  }

  if (event !== "issue_comment") return;

  let payload: IssueCommentPayload;
  try {
    payload = JSON.parse((req.body as Buffer).toString("utf-8")) as IssueCommentPayload;
  } catch (err) {
    console.error("[github webhook] Failed to parse payload:", err);
    return;
  }

  // Only handle newly created comments
  if (payload.action !== "created") return;

  // Only handle comments on PRs (not plain issues)
  if (!payload.issue.pull_request) return;

  const commentBody = payload.comment.body?.trim() ?? "";
  const issueMatch = TRIGGER_REGEX.exec(commentBody);
  if (!issueMatch) {
    console.log(
      `[github webhook] issue_comment on ${payload.repository.owner.login}/${payload.repository.name}#${payload.issue.number} by @${payload.comment.user.login} does not mention @ralfus — ignoring`
    );
    return;
  }

  const instruction = issueMatch[1].trim();
  if (!instruction) {
    console.log("[github webhook] @ralfus comment had no instruction — ignoring");
    return;
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.issue.number;

  console.log(
    `[github webhook] Enqueuing prCommentJob — ${owner}/${repo}#${prNumber} by @${payload.comment.user.login}: "${instruction.slice(0, 80)}"`
  );

  getQueue().add(async () => {
    try {
      await runPrCommentJob(owner, repo, prNumber, instruction);
    } catch (err) {
      console.error(
        `[queue] prCommentJob failed for ${owner}/${repo}#${prNumber}:`,
        err
      );
    }
  });
});
