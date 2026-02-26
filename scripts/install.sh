#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Install flyctl if not already present
if ! command -v fly &>/dev/null; then
  echo "Installing flyctl..."
  brew install flyctl
else
  echo "flyctl already installed: $(fly version)"
fi

# Install GitHub CLI if not already present
if ! command -v gh &>/dev/null; then
  echo "Installing GitHub CLI..."
  brew install gh
else
  echo "GitHub CLI already installed: $(gh --version | head -1)"
fi

# Install Cursor Agent CLI if not already present
if ! command -v cursor-agent &>/dev/null && ! command -v agent &>/dev/null; then
  echo "Installing Cursor Agent CLI..."
  curl -fsSL https://cursor.com/install | bash
else
  echo "Cursor Agent CLI already installed"
fi

echo ""
echo "Installing server dependencies..."
cd "$ROOT_DIR/server"
npm install

echo ""
echo "Setup complete. Next steps:"
echo "  1. Copy server/.env.example to server/.env and fill in the required values:"
echo "       LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, LINEAR_WEBHOOK_SECRET"
echo "       GITHUB_TOKEN, GITHUB_REPO_URL"
echo "       CURSOR_API_KEY"
echo "  2. Run 'npm run dev' from the server/ directory to start the development server."
