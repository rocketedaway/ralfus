import { createClient, Client } from "@libsql/client";

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;

  const url = process.env.LIBSQL_URL ?? "file:data/ralfus.db";
  const authToken = process.env.LIBSQL_AUTH_TOKEN;

  _client = createClient(authToken ? { url, authToken } : { url });
  return _client;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      organization_id  TEXT PRIMARY KEY,
      access_token     TEXT NOT NULL,
      refresh_token    TEXT,
      expires_at       INTEGER,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Migrate existing tables that predate refresh token columns
  for (const col of ["refresh_token TEXT", "expires_at INTEGER"]) {
    try {
      await db.execute(`ALTER TABLE workspaces ADD COLUMN ${col}`);
    } catch {
      // Column already exists — ignore
    }
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS issues (
      id                TEXT PRIMARY KEY,
      organization_id   TEXT NOT NULL,
      state             TEXT NOT NULL DEFAULT 'planning',
      repo_path         TEXT,
      agent_session_id  TEXT,
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Migrate existing tables that predate the agent_session_id column
  try {
    await db.execute("ALTER TABLE issues ADD COLUMN agent_session_id TEXT");
  } catch {
    // Column already exists — ignore
  }

  // Migrate existing tables that predate the plan_comment_id column
  try {
    await db.execute("ALTER TABLE issues ADD COLUMN plan_comment_id TEXT");
  } catch {
    // Column already exists — ignore
  }

  // Migrate existing tables that predate the pr_url column
  try {
    await db.execute("ALTER TABLE issues ADD COLUMN pr_url TEXT");
  } catch {
    // Column already exists — ignore
  }

  console.log("Database initialized");
}

export type IssueState = "planning" | "awaiting_clarification" | "awaiting_approval" | "in_progress" | "reviewing" | "implemented";

export type IssueRecord = {
  id: string;
  organizationId: string;
  state: IssueState;
  repoPath: string | null;
  agentSessionId: string | null;
  planCommentId: string | null;
  prUrl: string | null;
};

export async function upsertIssue(
  id: string,
  organizationId: string,
  state: IssueState,
  repoPath?: string | null,
  agentSessionId?: string | null,
  planCommentId?: string | null,
  prUrl?: string | null
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO issues (id, organization_id, state, repo_path, agent_session_id, plan_comment_id, pr_url, updated_at)
      VALUES (:id, :organizationId, :state, :repoPath, :agentSessionId, :planCommentId, :prUrl, unixepoch())
      ON CONFLICT (id) DO UPDATE SET
        state             = excluded.state,
        repo_path         = COALESCE(excluded.repo_path, issues.repo_path),
        agent_session_id  = COALESCE(excluded.agent_session_id, issues.agent_session_id),
        plan_comment_id   = COALESCE(excluded.plan_comment_id, issues.plan_comment_id),
        pr_url            = COALESCE(excluded.pr_url, issues.pr_url),
        updated_at        = excluded.updated_at
    `,
    args: {
      id,
      organizationId,
      state,
      repoPath: repoPath ?? null,
      agentSessionId: agentSessionId ?? null,
      planCommentId: planCommentId ?? null,
      prUrl: prUrl ?? null,
    },
  });
}

export async function getIssue(id: string): Promise<IssueRecord | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT id, organization_id, state, repo_path, agent_session_id, plan_comment_id, pr_url FROM issues WHERE id = :id",
    args: { id },
  });

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    state: row.state as IssueState,
    repoPath: row.repo_path as string | null,
    agentSessionId: row.agent_session_id as string | null,
    planCommentId: row.plan_comment_id as string | null,
    prUrl: row.pr_url as string | null,
  };
}

export async function upsertWorkspace(
  organizationId: string,
  accessToken: string,
  refreshToken?: string | null,
  expiresAt?: number | null
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO workspaces (organization_id, access_token, refresh_token, expires_at, updated_at)
      VALUES (:organizationId, :accessToken, :refreshToken, :expiresAt, unixepoch())
      ON CONFLICT (organization_id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, workspaces.refresh_token),
        expires_at    = COALESCE(excluded.expires_at, workspaces.expires_at),
        updated_at    = excluded.updated_at
    `,
    args: {
      organizationId,
      accessToken,
      refreshToken: refreshToken ?? null,
      expiresAt: expiresAt ?? null,
    },
  });
}

type WorkspaceTokenRow = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

async function getWorkspaceTokens(organizationId: string): Promise<WorkspaceTokenRow | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT access_token, refresh_token, expires_at FROM workspaces WHERE organization_id = :organizationId",
    args: { organizationId },
  });

  const row = result.rows[0];
  if (!row) return null;
  return {
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string | null,
    expiresAt: row.expires_at as number | null,
  };
}

/**
 * Returns a valid access token for the given organization, automatically
 * refreshing it if it has expired (or expires within the next 5 minutes).
 * Falls back to the stored token if no refresh token is available.
 */
export async function getValidAccessToken(organizationId: string): Promise<string | null> {
  const tokens = await getWorkspaceTokens(organizationId);
  if (!tokens) return null;

  const { accessToken, refreshToken, expiresAt } = tokens;

  // If no expiry or refresh token, return what we have (legacy long-lived token)
  if (!expiresAt || !refreshToken) return accessToken;

  // Refresh if the token expires within the next 5 minutes
  const nowSecs = Math.floor(Date.now() / 1000);
  if (expiresAt - nowSecs > 300) return accessToken;

  console.log(`[auth] Access token for org ${organizationId} is expiring — refreshing...`);
  try {
    const newTokens = await refreshLinearToken(refreshToken);
    const newExpiresAt = Math.floor(Date.now() / 1000) + newTokens.expiresIn;
    await upsertWorkspace(organizationId, newTokens.accessToken, newTokens.refreshToken, newExpiresAt);
    console.log(`[auth] Token refreshed for org ${organizationId}`);
    return newTokens.accessToken;
  } catch (err) {
    console.error(`[auth] Token refresh failed for org ${organizationId}: ${err} — using existing token`);
    return accessToken;
  }
}

async function refreshLinearToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("LINEAR_CLIENT_ID or LINEAR_CLIENT_SECRET env var is not set");
  }

  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear token refresh failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/** @deprecated Use getValidAccessToken instead */
export async function getAccessToken(organizationId: string): Promise<string | null> {
  return getValidAccessToken(organizationId);
}
