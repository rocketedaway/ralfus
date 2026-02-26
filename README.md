# Ralfus

A [Linear Agent](https://linear.app/developers/agents) server built with Node.js and Express, deployed on [fly.io](https://fly.io).

## Overview

Ralfus is a Linear Agent that can be mentioned in issues, delegated tasks, and respond to user prompts directly inside Linear. It uses Linear's OAuth 2.0 app installation flow and webhook-driven Agent Session model.

## Project Structure

```
ralfus/
└── server/               # Express server
    ├── src/
    │   ├── index.ts      # App entry point
    │   └── routes/
    │       ├── index.ts
    │       ├── oauth.ts  # /oauth/authorize, /oauth/callback
    │       └── webhook.ts # /webhook
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

```bash
cd server
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in the values in `.env`:

| Variable | Description |
|---|---|
| `LINEAR_CLIENT_ID` | OAuth app client ID from Linear |
| `LINEAR_CLIENT_SECRET` | OAuth app client secret from Linear |
| `LINEAR_REDIRECT_URI` | Full URL of your `/oauth/callback` endpoint |
| `LINEAR_WEBHOOK_SECRET` | Webhook signing secret from your Linear app settings |
| `LINEAR_ACCESS_TOKEN` | Workspace access token obtained after OAuth installation |
| `PORT` | Port to listen on (default: `3000`) |

### 3. Run the development server

```bash
npm run dev
```

The server will start on `http://localhost:3000`.

## Linear App Configuration

1. Go to [linear.app/settings/api/applications/new](https://linear.app/settings/api/applications/new)
2. Set the **Redirect URI** to your `/oauth/callback` URL
3. Enable **Webhooks** and select the **Agent session events** category
4. Note your **Client ID**, **Client Secret**, and **Webhook Secret**

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth/authorize` | Redirects to Linear's OAuth authorization page |
| `GET` | `/oauth/callback` | Handles the OAuth redirect and exchanges the code for an access token |
| `POST` | `/webhook` | Receives Linear webhook events (signature-verified) |
| `GET` | `/health` | Health check endpoint |

## Installing the Agent into a Workspace

Navigate to `/oauth/authorize` in your browser. This will redirect to Linear where a workspace admin can approve the installation. After approval, the `/oauth/callback` handler exchanges the authorization code for an access token that should be stored securely (e.g. in a database) keyed by workspace ID.

## Deployment

### Deploy to fly.io

```bash
cd server

# First deploy — creates the app from fly.toml
fly launch

# Set secrets
fly secrets set \
  LINEAR_CLIENT_ID=your_client_id \
  LINEAR_CLIENT_SECRET=your_client_secret \
  LINEAR_REDIRECT_URI=https://your-app.fly.dev/oauth/callback \
  LINEAR_WEBHOOK_SECRET=your_webhook_secret \
  LINEAR_ACCESS_TOKEN=your_access_token

# Subsequent deploys
fly deploy
```

> **Note:** In production, `LINEAR_ACCESS_TOKEN` should be stored per-workspace in a database. The single env var is a placeholder for getting started.
