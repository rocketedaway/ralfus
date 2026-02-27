import { Router, Request, Response } from "express";
import axios from "axios";
import { LinearClient } from "@linear/sdk";
import { upsertWorkspace } from "../db";

export const oauthRouter = Router();

const LINEAR_OAUTH_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

/**
 * GET /oauth/authorize
 *
 * Redirects the user to Linear's OAuth authorization page.
 * Linear will redirect back to /oauth/callback after the user grants access.
 *
 * Required env vars:
 *   LINEAR_CLIENT_ID
 *   LINEAR_REDIRECT_URI  (e.g. https://your-app.fly.dev/oauth/callback)
 */
oauthRouter.get("/authorize", (_req: Request, res: Response) => {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const redirectUri = process.env.LINEAR_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).json({ error: "Missing LINEAR_CLIENT_ID or LINEAR_REDIRECT_URI" });
    return;
  }

  const scopes = [
    "read",
    "write",
    "issues:create",
    "comments:create",
    "app:assignable",
    "app:mentionable",
  ].join(",");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    actor: "app",
  });

  res.redirect(`${LINEAR_OAUTH_URL}?${params.toString()}`);
});

/**
 * GET /oauth/callback
 *
 * Handles the redirect from Linear after the user grants access.
 * Exchanges the authorization code for an access token.
 *
 * Required env vars:
 *   LINEAR_CLIENT_ID
 *   LINEAR_CLIENT_SECRET
 *   LINEAR_REDIRECT_URI
 */
oauthRouter.get("/callback", async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    res.status(400).json({ error });
    return;
  }

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  const redirectUri = process.env.LINEAR_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).json({ error: "Missing OAuth environment variables" });
    return;
  }

  try {
    const tokenResponse = await axios.post(
      LINEAR_TOKEN_URL,
      new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = expires_in != null
      ? Math.floor(Date.now() / 1000) + expires_in
      : null;

    const linear = new LinearClient({ accessToken: access_token });
    const org = await linear.organization;
    const organizationId = org.id;

    await upsertWorkspace(organizationId, access_token, refresh_token ?? null, expiresAt);
    console.log(
      `[oauth] Workspace ${organizationId} installed` +
      (refresh_token ? " (refresh token stored)" : " (no refresh token — long-lived token)")
    );

    res.json({ success: true });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        `[oauth] Token exchange failed: ${err.response?.status} ${err.response?.statusText} — ${JSON.stringify(err.response?.data)}`
      );
    } else {
      console.error("[oauth] Token exchange failed:", err);
    }
    res.status(500).json({ error: "Token exchange failed" });
  }
});
