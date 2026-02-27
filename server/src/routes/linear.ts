import { Router, Request, Response } from "express";
import crypto from "crypto";
import { LinearClient } from "@linear/sdk";
import { getAccessToken, upsertIssue } from "../db";
import { getQueue } from "../jobs/queue";
import { runInitialPlanningJob, runClarificationJob } from "../jobs/planningJob";

export const linearWebhookRouter = Router();

function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * POST /webhook
 *
 * Receives Linear webhook events.
 * Verifies the request signature using the LINEAR_WEBHOOK_SECRET env var.
 *
 * Required env vars:
 *   LINEAR_WEBHOOK_SECRET  (found in your Linear OAuth app settings)
 *   LINEAR_ACCESS_TOKEN    (the workspace access token obtained via OAuth)
 */
linearWebhookRouter.post("/", async (req: Request, res: Response) => {
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;

  if (webhookSecret) {
    const signature = req.headers["linear-signature"] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!verifySignature(rawBody, signature, webhookSecret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // Must respond within 5 seconds
  res.status(200).json({ ok: true });

  const payload = JSON.parse((req.body as Buffer).toString("utf-8")) as WebhookPayload;

  try {
    await handleWebhook(payload);
  } catch (err) {
    console.error("[linear webhook] Error handling webhook:", err);
  }
});

type WebhookPayload = {
  type: string;
  action: string;
  organizationId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

async function handleWebhook(payload: WebhookPayload): Promise<void> {
  const { type, action } = payload;
  console.log(`[linear webhook] Received type=${type} action=${action}`);

  if (type === "AgentSessionEvent") {
    await handleAgentSession(payload);
    return;
  }

  if (type === "Issue" && action === "update") {
    await handleIssueUpdate(payload);
    return;
  }

  console.log(`[linear webhook] Unhandled event type="${type}" action="${action}" — ignoring`);
}

type IssueUpdatePayload = WebhookPayload & {
  data: {
    id: string;
    title: string;
    description?: string;
    assigneeId?: string;
  };
  updatedFrom: {
    assigneeId?: string;
  };
};

async function handleIssueUpdate(payload: WebhookPayload): Promise<void> {
  const { data, updatedFrom } = payload as IssueUpdatePayload;

  const assigneeChanged = updatedFrom?.assigneeId !== data?.assigneeId && data?.assigneeId;
  if (!assigneeChanged) {
    console.log(`[linear webhook] Issue update for ${data?.id} — assignee unchanged, ignoring`);
    return;
  }

  const accessToken = await getAccessToken(payload.organizationId);
  if (!accessToken) {
    console.error(`[linear webhook] No access token found for organization ${payload.organizationId}`);
    return;
  }

  const linear = new LinearClient({ accessToken });
  const viewer = await linear.viewer;

  if (data.assigneeId !== viewer.id) {
    console.log(`[linear webhook] Issue ${data.id} assigned to someone else (${data.assigneeId}) — ignoring`);
    return;
  }

  console.log(`[linear webhook] Agent assigned to issue: ${data.id} — "${data.title}"`);

  // Enqueue the initial planning job
  getQueue().add(async () => {
    try {
      await runInitialPlanningJob(data.id, payload.organizationId, accessToken);
    } catch (err) {
      console.error(`[queue] Initial planning job failed for issue ${data.id}:`, err);
    }
  });
}

async function handleAgentSession(payload: WebhookPayload): Promise<void> {
  const { action, agentSession } = payload as unknown as {
    action: "created" | "prompted";
    organizationId: string;
    agentSession: {
      id: string;
      issue?: { id: string; title: string; description?: string };
      comment?: { body: string };
      promptContext?: string;
      // Some Linear webhook shapes put the user's new reply here
      prompt?: string;
    };
    agentActivity?: {
      body?: string;
      content?: { type: string; body: string };
    };
    // Top-level comment field present on some prompted payloads
    data?: { comment?: { body: string }; body?: string };
  };

  const accessToken = await getAccessToken(payload.organizationId);
  if (!accessToken) {
    console.error(`[linear webhook] No access token found for organization ${payload.organizationId}`);
    return;
  }

  const linear = new LinearClient({ accessToken });

  if (action !== "created" && action !== "prompted") {
    console.log(`[linear webhook] Unhandled AgentSessionEvent action="${action}" for session ${agentSession.id} — ignoring`);
    return;
  }

  if (action === "created") {
    try {
      await linear.createAgentActivity({
        agentSessionId: agentSession.id,
        content: {
          type: "response",
          body: "🌵🏄 Gnarly wave, dude — I'm dropping in on this one. Give me a sec to wax the board and I'll be shredding through it shortly. Cowabunga!",
        },
      });
    } catch (err) {
      const isAuthError = err instanceof Error && (
        err.message.includes("Authentication") ||
        err.message.includes("not authenticated") ||
        ("type" in err && (err as { type?: string }).type === "AuthenticationError")
      );
      if (isAuthError) {
        console.error(
          `[linear webhook] 401 posting greeting activity for session ${agentSession.id} — ` +
          `the Linear OAuth token may be stale. Re-authorize at /oauth/authorize to refresh it.`
        );
      } else {
        console.error(`[linear webhook] Failed to post greeting activity for session ${agentSession.id}:`, err);
      }
    }

    console.log(`[linear webhook] Agent session created: ${agentSession.id}`);
    console.log(`[linear webhook] Prompt context: ${agentSession.promptContext}`);

    if (agentSession.issue?.id) {
      // Persist the agentSessionId so planning jobs can post back to this thread
      await upsertIssue(agentSession.issue.id, payload.organizationId, "planning", null, agentSession.id);

      getQueue().add(async () => {
        try {
          await runInitialPlanningJob(agentSession.issue!.id, payload.organizationId, accessToken);
        } catch (err) {
          console.error(`[queue] Initial planning job failed for issue ${agentSession.issue!.id}:`, err);
        }
      });
    }
  } else if (action === "prompted") {
    // Log the full payload (keys only, values truncated) to diagnose which field
    // carries the actual user reply — the shape varies across Linear webhook versions.
    const payloadDebug = JSON.stringify(payload, (_k, v) =>
      typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v
    );
    console.log(`[linear webhook] prompted raw payload: ${payloadDebug}`);

    // Try every known location where Linear puts the user's reply text.
    // agentSession.prompt         — newer Linear webhook shape
    // agentSession.promptContext  — alternate field name seen in some versions
    // payload.data?.comment?.body — top-level data envelope
    // payload.data?.body          — bare body variant
    // agentActivity.body          — activity envelope
    // agentSession.comment?.body  — falls back to thread description (avoid if possible)
    const SYSTEM_THREAD_MSG = "This thread is for an agent session with";
    const candidates = [
      agentSession.prompt,
      agentSession.promptContext,
      // The user's reply lives here in the Linear webhook shape we observe
      payload.agentActivity?.content?.body,
      (payload as unknown as { data?: { comment?: { body?: string }; body?: string } }).data?.comment?.body,
      (payload as unknown as { data?: { body?: string } }).data?.body,
      payload.agentActivity?.body,
      agentSession.comment?.body,
    ];
    const userMessage = candidates.find(
      (c): c is string => typeof c === "string" && c.trim().length > 0 && !c.startsWith(SYSTEM_THREAD_MSG)
    ) ?? "";

    const issueId = agentSession.issue?.id;

    console.log(`[linear webhook] prompted — issueId=${issueId ?? "none"} sessionId=${agentSession.id} userMessage="${userMessage.slice(0, 120)}"`);

    try {
      await linear.createAgentActivity({
        agentSessionId: agentSession.id,
        content: {
          type: "thought",
          body: "🌵🏄 Gnarly — catching that wave of context! Shredding through your answers and reworking the plan. Hang loose!",
        },
      });
    } catch (err) {
      const isAuthError = err instanceof Error && (
        err.message.includes("Authentication") ||
        err.message.includes("not authenticated") ||
        ("type" in err && (err as { type?: string }).type === "AuthenticationError")
      );
      if (isAuthError) {
        console.error(
          `[linear webhook] 401 posting thought activity for session ${agentSession.id} — ` +
          `the Linear OAuth token may be stale. Re-authorize at /oauth/authorize to refresh it.`
        );
      } else {
        console.error(`[linear webhook] Failed to post thought activity for session ${agentSession.id}:`, err);
      }
      // Don't bail — continue to enqueue the clarification job even if the thought fails
    }

    if (issueId) {
      console.log(`[linear webhook] Enqueuing clarification job for issue ${issueId}`);
      getQueue().add(async () => {
        console.log(`[queue] Dequeuing clarification job for issue ${issueId}`);
        try {
          await runClarificationJob(issueId, payload.organizationId, accessToken, userMessage);
        } catch (err) {
          console.error(`[queue] Clarification job failed for issue ${issueId}:`, err);
        }
      });
    } else {
      console.warn(`[linear webhook] prompted event has no issueId — cannot enqueue clarification`);
    }
  }
}
