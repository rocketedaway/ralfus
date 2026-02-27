import "dotenv/config";
import express from "express";
import { LinearClient } from "@linear/sdk";
import { oauthRouter, webhookRouter } from "./routes";
import { initDb, getDb } from "./db";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  webhookRouter
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/oauth", oauthRouter);

/**
 * Checks every stored workspace token against the Linear API.
 * Returns a list of results — one per organization.
 */
async function checkLinearTokens(): Promise<{ organizationId: string; valid: boolean; orgName?: string; error?: string }[]> {
  const db = getDb();
  const result = await db.execute("SELECT organization_id, access_token FROM workspaces");

  return Promise.all(
    result.rows.map(async (row) => {
      const organizationId = row.organization_id as string;
      const accessToken = row.access_token as string;
      try {
        const linear = new LinearClient({ accessToken });
        const org = await linear.organization;
        return { organizationId, valid: true, orgName: org.name };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { organizationId, valid: false, error: message };
      }
    })
  );
}

app.get("/health", async (_req, res) => {
  try {
    const tokenResults = await checkLinearTokens();
    const allValid = tokenResults.every((r) => r.valid);
    res.status(allValid ? 200 : 503).json({
      status: allValid ? "ok" : "degraded",
      linear: tokenResults,
      reauthorizeUrl: allValid ? undefined : "/oauth/authorize",
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: String(err) });
  }
});

async function validateTokensOnStartup(): Promise<void> {
  try {
    const results = await checkLinearTokens();
    if (results.length === 0) {
      console.warn("[startup] No Linear workspaces authorized yet — visit /oauth/authorize to install the app");
      return;
    }
    for (const r of results) {
      if (r.valid) {
        console.log(`[startup] Linear token OK for org ${r.organizationId} (${r.orgName})`);
      } else {
        console.error(
          `[startup] Linear token INVALID for org ${r.organizationId}: ${r.error} — ` +
          `re-authorize at /oauth/authorize`
        );
      }
    }
  } catch (err) {
    console.error("[startup] Token validation check failed:", err);
  }
}

initDb()
  .then(async () => {
    await validateTokensOnStartup();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

export default app;
