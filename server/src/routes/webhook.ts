import { Router, Request, Response } from "express";
import crypto from "crypto";
import { LinearClient } from "@linear/sdk";
import { getAccessToken, upsertIssue } from "../db";
import { getQueue } from "../jobs/queue";
import { runInitialPlanningJob, runClarificationJob } from "../jobs/planningJob";

export const webhookRouter = Router();

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
webhookRouter.post("/", async (req: Request, res: Response) => {
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
    console.error("Error handling webhook:", err);
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
  console.log(`Webhook received: type=${type} action=${action}`);

  if (type === "AgentSessionEvent") {
    await handleAgentSession(payload);
    return;
  }

  if (type === "Issue" && action === "update") {
    await handleIssueUpdate(payload);
    return;
  }
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
  if (!assigneeChanged) return;

  const accessToken = await getAccessToken(payload.organizationId);
  if (!accessToken) {
    console.error(`No access token found for organization ${payload.organizationId}`);
    return;
  }

  const linear = new LinearClient({ accessToken });
  const viewer = await linear.viewer;

  if (data.assigneeId !== viewer.id) return;

  console.log(`Agent assigned to issue: ${data.id} — "${data.title}"`);

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
    };
    agentActivity?: { body: string };
  };

  const accessToken = await getAccessToken(payload.organizationId);
  if (!accessToken) {
    console.error(`No access token found for organization ${payload.organizationId}`);
    return;
  }

  const linear = new LinearClient({ accessToken });

  if (action === "created") {
    await linear.createAgentActivity({
      agentSessionId: agentSession.id,
      content: {
        type: "response",
        body: "🌵🏄 Gnarly wave, dude — I'm dropping in on this one. Give me a sec to wax the board and I'll be shredding through it shortly. Cowabunga!",
      },
    });

    console.log("Agent session created:", agentSession.id);
    console.log("Prompt context:", agentSession.promptContext);

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
    // Linear may surface the user's message in either agentSession.comment.body
    // or agentActivity.body depending on the event shape — try both.
    const userMessage = agentSession.comment?.body || payload.agentActivity?.body || "";
    const issueId = agentSession.issue?.id;

    console.log("User follow-up prompt:", userMessage);

    await linear.createAgentActivity({
      agentSessionId: agentSession.id,
      content: {
        type: "thought",
        body: "🌵🏄 Gnarly — catching that wave of context! Shredding through your answers and reworking the plan. Hang loose!",
      },
    });

    if (issueId) {
      getQueue().add(async () => {
        try {
          await runClarificationJob(issueId, payload.organizationId, accessToken, userMessage);
        } catch (err) {
          console.error(`[queue] Clarification job failed for issue ${issueId}:`, err);
        }
      });
    }
  }
}
