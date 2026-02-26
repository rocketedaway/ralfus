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
      created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS issues (
      id               TEXT PRIMARY KEY,
      organization_id  TEXT NOT NULL,
      state            TEXT NOT NULL DEFAULT 'planning',
      repo_path        TEXT,
      updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  console.log("Database initialized");
}

export type IssueState = "planning" | "awaiting_clarification" | "confirmed" | "in_progress";

export type IssueRecord = {
  id: string;
  organizationId: string;
  state: IssueState;
  repoPath: string | null;
};

export async function upsertIssue(
  id: string,
  organizationId: string,
  state: IssueState,
  repoPath?: string | null
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO issues (id, organization_id, state, repo_path, updated_at)
      VALUES (:id, :organizationId, :state, :repoPath, unixepoch())
      ON CONFLICT (id) DO UPDATE SET
        state      = excluded.state,
        repo_path  = COALESCE(excluded.repo_path, issues.repo_path),
        updated_at = excluded.updated_at
    `,
    args: { id, organizationId, state, repoPath: repoPath ?? null },
  });
}

export async function getIssue(id: string): Promise<IssueRecord | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT id, organization_id, state, repo_path FROM issues WHERE id = :id",
    args: { id },
  });

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    state: row.state as IssueState,
    repoPath: row.repo_path as string | null,
  };
}

export async function upsertWorkspace(
  organizationId: string,
  accessToken: string
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `
      INSERT INTO workspaces (organization_id, access_token, updated_at)
      VALUES (:organizationId, :accessToken, unixepoch())
      ON CONFLICT (organization_id) DO UPDATE SET
        access_token = excluded.access_token,
        updated_at   = excluded.updated_at
    `,
    args: { organizationId, accessToken },
  });
}

export async function getAccessToken(organizationId: string): Promise<string | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT access_token FROM workspaces WHERE organization_id = :organizationId",
    args: { organizationId },
  });

  const row = result.rows[0];
  return row ? (row.access_token as string) : null;
}
