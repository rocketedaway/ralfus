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

echo ""
echo "Installing server dependencies..."
cd "$ROOT_DIR/server"
npm install

echo ""
echo "Done. Run 'npm run dev' from the server/ directory to start the development server."
