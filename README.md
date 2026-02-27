> [!WARNING]
> This is a prototype / proof-of-concept project. It is not production-ready and is intended for experimentation and exploration only.

# Ralfus

A [Linear Agent](https://linear.app/developers/agents) server built with Node.js, Express, and TypeScript, deployed on [fly.io](https://fly.io).

## Overview

Ralfus is a Linear Agent that can be mentioned in issues, delegated tasks, and respond to user prompts directly inside Linear. It uses Linear's OAuth 2.0 app installation flow and a webhook-driven Agent Session model.

When assigned a Linear issue, Ralfus will:

1. **Plan** — Use Cursor's agent API to produce an implementation plan and post it as a comment. If the ticket is ambiguous, it asks clarifying questions and waits for responses before finalizing the plan.
2. **Implement** — Once the plan is approved, check out the repository, create a feature branch, and run Cursor's agent step-by-step through the plan.
3. **Review** — After implementation, run a self-review pass and push any fixes, then open a GitHub pull request.

Ralfus also listens on a **GitHub webhook** for `@ralfus <instruction>` comments on pull requests. When triggered, it checks out the PR branch, runs Cursor's agent with the instruction, and pushes any resulting changes back to the branch.

Access tokens are persisted per-workspace in a [libSQL](https://turso.tech/libsql) database.

## Project Structure

```
ralfus/
├── docs/
│   ├── fly-setup.md              # fly.io deployment guide
│   └── github-webhook-setup.md  # GitHub webhook configuration guide
├── scripts/
│   └── install.sh                # Install all dependencies
└── server/                       # Express server
    ├── src/
    │   ├── index.ts               # App entry point
    │   ├── db.ts                  # libSQL client and helpers
    │   ├── routes/
    │   │   ├── index.ts
    │   │   ├── oauth.ts           # /oauth/authorize, /oauth/callback
    │   │   ├── webhook.ts         # /webhook (Linear events)
    │   │   └── github.ts          # /webhook/github (GitHub events)
    │   ├── services/
    │   │   ├── linear.ts          # Linear API helpers
    │   │   ├── github.ts          # git/gh CLI helpers
    │   │   └── cursor.ts          # Cursor agent CLI wrapper
    │   └── jobs/
    │       ├── queue.ts           # p-queue concurrency wrapper
    │       ├── messages.ts        # Shared message templates
    │       ├── planningJob.ts     # Initial plan + clarification loop
    │       ├── implementationJob.ts # Branch, implement, push steps
    │       ├── codeReviewJob.ts   # Self-review and PR creation
    │       └── prCommentJob.ts    # Handle @ralfus PR comments
    ├── Dockerfile
    ├── fly.toml
    └── .env.example
```

## Prerequisites

- [Node.js](https://nodejs.org) v22+
- A [Linear](https://linear.app) workspace with admin access
- A Linear OAuth application (create one at [linear.app/settings/api/applications](https://linear.app/settings/api/applications))
- A GitHub account with a personal access token (classic, `repo` scope)
- A [Cursor](https://cursor.com) account with an API key
- [fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/) (for deployment)

## Local Setup

### 1. Install dependencies

From the repo root:

```bash
./scripts/install.sh
```

Or manually:

```bash
cd server && npm install
```

### 2. Configure environment variables

```bash
cd server
cp .env.example .env
```

Fill in the values in `.env`:

| Variable | Description |
|---|---|
| `LINEAR_CLIENT_ID` | OAuth app client ID from Linear |
| `LINEAR_CLIENT_SECRET` | OAuth app client secret from Linear |
| `LINEAR_REDIRECT_URI` | Full URL of your `/oauth/callback` endpoint |
| `LINEAR_WEBHOOK_SECRET` | Webhook signing secret from your Linear app settings |
| `LIBSQL_URL` | Database URL — `file:data/ralfus.db` for local, `libsql://...` for Turso |
| `LIBSQL_AUTH_TOKEN` | Auth token for Turso (omit for local file database) |
| `GITHUB_TOKEN` | GitHub personal access token with `repo` scope |
| `GITHUB_REPO_URL` | HTTPS URL of the repo to work in, e.g. `https://github.com/org/repo` |
| `GITHUB_WEBHOOK_SECRET` | Secret used to verify GitHub webhook payloads |
| `CURSOR_API_KEY` | API key for Cursor's agent CLI |
| `WORK_DIR` | Local directory for per-ticket repo checkouts (default: `/tmp/ralfus-work`) |
| `AGENT_CONCURRENCY` | Max concurrent planning/implementation jobs (default: `2`) |
| `PORT` | Port to listen on (default: `3000`) |

### 3. Run the development server

```bash
cd server && npm run dev
```

The server will start on `http://localhost:3000`.

## Linear App Configuration

1. Go to [linear.app/settings/api/applications/new](https://linear.app/settings/api/applications/new)
2. Set the **Redirect URI** to your `/oauth/callback` URL
3. Set the **Webhook URL** to your `/webhook` URL
4. Enable **Webhooks** and select the **Agent session events** category
5. Note your **Client ID**, **Client Secret**, and **Webhook Secret**

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth/authorize` | Redirects to Linear's OAuth authorization page |
| `GET` | `/oauth/callback` | Exchanges the authorization code for an access token and stores it |
| `POST` | `/webhook` | Receives Linear webhook events (HMAC signature-verified) |
| `POST` | `/webhook/github` | Receives GitHub webhook events — handles `@ralfus` PR comments |
| `GET` | `/health` | Health check endpoint |

## Installing the Agent into a Workspace

Navigate to `/oauth/authorize` in your browser. Linear will prompt a workspace admin to approve the installation. After approval, the access token is automatically stored in the database keyed by organization ID, and the agent is ready to receive webhooks.

## GitHub Webhook

To enable `@ralfus` comments on pull requests, configure a webhook on your GitHub repository pointing to `/webhook/github`. See [docs/github-webhook-setup.md](docs/github-webhook-setup.md) for the full setup guide.

## Deployment

See [docs/fly-setup.md](docs/fly-setup.md) for the full fly.io deployment guide.
