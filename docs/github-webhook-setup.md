# GitHub Webhook Setup

This guide explains how to configure a GitHub webhook so that Ralfus can respond to `@ralfus <instruction>` comments on pull requests.

## How it works

When a new comment is posted on a GitHub pull request that starts with `@ralfus`, Ralfus will:

1. Check out the PR's head branch
2. Run Cursor's agent with the instruction as the prompt
3. Commit and push any resulting changes back to the branch

---

## Prerequisites

- Your Ralfus server must be publicly accessible (e.g. deployed on fly.io at `https://ralfus.fly.dev`)
- You need admin access to the GitHub repository

---

## 1. Generate a webhook secret

Generate a strong random string to use as the webhook secret. This is used to verify that incoming requests are genuinely from GitHub.

```bash
openssl rand -hex 32
```

Save this value — you'll need it both when creating the webhook and when setting the server secret.

---

## 2. Set the secret on your server

### fly.io

```bash
fly secrets set GITHUB_WEBHOOK_SECRET=your_generated_secret
```

### Local development

Add it to your `server/.env`:

```
GITHUB_WEBHOOK_SECRET=your_generated_secret
```

---

## 3. Create the webhook on GitHub

1. Go to your repository on GitHub
2. Navigate to **Settings → Webhooks → Add webhook**
3. Fill in the form:

| Field | Value |
|---|---|
| **Payload URL** | `https://ralfus.fly.dev/webhook/github` |
| **Content type** | `application/json` |
| **Secret** | The secret you generated in step 1 |
| **Which events would you like to trigger this webhook?** | Select **Let me select individual events**, then check **Issue comments** only |
| **Active** | Checked |

4. Click **Add webhook**

GitHub will immediately send a `ping` event. You can verify it was received by checking **Recent Deliveries** in the webhook settings, or by tailing your server logs:

```bash
fly logs
```

---

## 4. Verify signature verification is active

The server verifies the `X-Hub-Signature-256` header on every incoming request. If `GITHUB_WEBHOOK_SECRET` is set (it should always be set in production), requests with an invalid or missing signature will receive a `401` response and be ignored.

> [!WARNING]
> If `GITHUB_WEBHOOK_SECRET` is not set, the server will accept all incoming requests without verification. Always set this secret in production.

---

## Usage

Once the webhook is configured, comment on any pull request in the repository:

```
@ralfus Fix the failing test in auth.test.ts
```

```
@ralfus Refactor this function to use async/await instead of callbacks
```

Ralfus will acknowledge the comment by posting a reply, make the requested changes, and push them to the PR branch. If a job for that PR is already in flight, the new comment will be skipped.

---

## Troubleshooting

**Webhook deliveries are failing with a non-200 status**

Check `fly logs` for errors. Common causes:
- `GITHUB_WEBHOOK_SECRET` mismatch between GitHub and the server
- The comment was not on a pull request (plain issue comments are ignored)
- The comment did not start with `@ralfus`

**Ralfus is not pushing any changes**

- Ensure `GITHUB_TOKEN` has `repo` write access to the repository
- Ensure `GITHUB_REPO_URL` matches the repository where the PR was opened
- Check `fly logs` for detailed error output from the job
