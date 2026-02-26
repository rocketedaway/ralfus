# Deploying to fly.io

This guide covers the initial setup and deployment of the Ralfus server on fly.io.

## Prerequisites

Install the fly.io CLI:

```bash
brew install flyctl
```

Log in:

```bash
fly auth login
```

---

## 1. Create the app

Run the following from the `server/` directory. The `--no-deploy` flag prevents an immediate deploy so you can configure secrets and volumes first:

```bash
cd server
fly launch --no-deploy
```

fly will detect the existing `fly.toml` and `Dockerfile`. When prompted, you can keep the app name (`ralfus`) or choose a new one. Skip adding a Postgres database — the app uses libSQL.

---

## 2. Create a persistent volume

The app stores its libSQL database file at `/app/data`. A fly volume is required to persist this across deploys and restarts:

```bash
fly volumes create ralfus_data --size 1 --region iad
```

Then add the mount to `fly.toml`:

```toml
[mounts]
  source = "ralfus_data"
  destination = "/app/data"
```

---

## 3. Set secrets

```bash
fly secrets set \
  LINEAR_CLIENT_ID=your_client_id \
  LINEAR_CLIENT_SECRET=your_client_secret \
  LINEAR_REDIRECT_URI=https://ralfus.fly.dev/oauth/callback \
  LINEAR_WEBHOOK_SECRET=your_webhook_secret \
  GITHUB_TOKEN=your_github_pat \
  GITHUB_REPO_URL=https://github.com/your-org/your-repo \
  CURSOR_API_KEY=your_cursor_api_key
```

| Secret | Where to get it |
|---|---|
| `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | [linear.app/settings/api/applications](https://linear.app/settings/api/applications) |
| `LINEAR_WEBHOOK_SECRET` | Linear OAuth app settings |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) — classic token with `repo` scope |
| `GITHUB_REPO_URL` | HTTPS URL of the repo to work in, e.g. `https://github.com/org/repo` |
| `CURSOR_API_KEY` | Cursor account settings |

Confirm they were saved:

```bash
fly secrets list
```

> If you switch to a hosted Turso database later, also set `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN` here.

Non-sensitive config (`WORK_DIR`, `AGENT_CONCURRENCY`) can be set as plain env vars in `fly.toml` under `[env]` instead:

```toml
[env]
  WORK_DIR = "/tmp/ralfus-work"
  AGENT_CONCURRENCY = "2"
```

---

## 4. Deploy

```bash
fly deploy
```

Monitor the logs to confirm a successful start:

```bash
fly logs
```

You should see:

```
Database initialized
Server running on port 3000
```

---

## 5. Configure your Linear app

Go to your Linear OAuth app at [linear.app/settings/api/applications](https://linear.app/settings/api/applications) and update:

| Field | Value |
|---|---|
| Redirect URI | `https://ralfus.fly.dev/oauth/callback` |
| Webhook URL | `https://ralfus.fly.dev/webhook` |

Make sure the **Agent session events** webhook category is enabled.

---

## 6. Install the agent

Navigate to `https://ralfus.fly.dev/oauth/authorize` in your browser. A Linear workspace admin approves the installation and the access token is automatically stored in the database.

---

## Subsequent deploys

```bash
fly deploy
```

fly performs a rolling restart while the volume (and database) remains intact.
