# Ralfus

A [Linear Agent](https://linear.app/developers/agents) server built with Node.js, Express, and TypeScript, deployed on [fly.io](https://fly.io).

## Overview

Ralfus is a Linear Agent that can be mentioned in issues, delegated tasks, and respond to user prompts directly inside Linear. It uses Linear's OAuth 2.0 app installation flow and a webhook-driven Agent Session model. Access tokens are persisted per-workspace in a [libSQL](https://turso.tech/libsql) database.

## Project Structure

```
ralfus/
├── docs/
│   └── fly-setup.md          # fly.io deployment guide
├── scripts/
│   └── install.sh            # Install all dependencies
└── server/                   # Express server
    ├── src/
    │   ├── index.ts           # App entry point
    │   ├── db.ts              # libSQL client and helpers
    │   └── routes/
    │       ├── index.ts
    │       ├── oauth.ts       # /oauth/authorize, /oauth/callback
    │       └── webhook.ts     # /webhook
    ├── Dockerfile
    ├── fly.toml
    └── .env.example
```

## Prerequisites

- [Node.js](https://nodejs.org) v22+
- A [Linear](https://linear.app) workspace with admin access
- A Linear OAuth application (create one at [linear.app/settings/api/applications](https://linear.app/settings/api/applications))
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
| `GET` | `/health` | Health check endpoint |

## Installing the Agent into a Workspace

Navigate to `/oauth/authorize` in your browser. Linear will prompt a workspace admin to approve the installation. After approval, the access token is automatically stored in the database keyed by organization ID, and the agent is ready to receive webhooks.

## Deployment

See [docs/fly-setup.md](docs/fly-setup.md) for the full fly.io deployment guide.
