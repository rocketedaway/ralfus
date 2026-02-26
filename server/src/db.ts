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

  console.log("Database initialized");
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
