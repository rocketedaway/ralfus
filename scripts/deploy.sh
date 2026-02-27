#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Verify flyctl is available
if ! command -v fly &>/dev/null; then
  echo "flyctl is not installed. Run scripts/install.sh first."
  exit 1
fi

# Verify the user is authenticated
if ! fly auth whoami &>/dev/null; then
  echo "Not logged in to fly.io. Run: fly auth login"
  exit 1
fi

echo "Deploying ralfus to fly.io..."
echo ""

cd "$ROOT_DIR/server"
fly deploy
