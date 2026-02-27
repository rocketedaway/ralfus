import "dotenv/config";
import express from "express";
import { oauthRouter, linearWebhookRouter, githubWebhookRouter } from "./routes";
import { initDb } from "./db";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  linearWebhookRouter
);

app.use(
  "/webhook/github",
  express.raw({ type: "application/json" }),
  githubWebhookRouter
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/oauth", oauthRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

export default app;
