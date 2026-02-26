import { Router, Request, Response } from "express";
import crypto from "crypto";
import { LinearClient } from "@linear/sdk";
import { getAccessToken } from "../db";

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

  if (type === "AgentSession") {
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

  await linear.createComment({
    issueId: data.id,
    body: "🌵🏄 Gnarly wave, dude — I'm dropping in on this one. Give me a sec to wax the board and I'll be shredding through it shortly. Cowabunga!",
  });

  // TODO: Kick off your agent loop here.
  // data.id          — issue ID
  // data.title       — issue title
  // data.description — issue description (if set)
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
    // Acknowledge within 10 seconds by emitting a thought activity
    await linear.createAgentActivity({
      agentSessionId: agentSession.id,
      content: {
        type: "thought",
        body: "Session received. Processing…",
      },
    });

    // TODO: Use agentSession.promptContext or agentSession.issue to build
    //       your agent prompt and begin the agent loop.
    console.log("Agent session created:", agentSession.id);
    console.log("Prompt context:", agentSession.promptContext);
  } else if (action === "prompted") {
    const userMessage = payload.agentActivity?.body ?? "";
    console.log("User follow-up prompt:", userMessage);

    // TODO: Insert userMessage into your conversation history and continue the loop.

    await linear.createAgentActivity({
      agentSessionId: agentSession.id,
      content: {
        type: "thought",
        body: "Received your follow-up. Processing…",
      },
    });
  }
}
