#!/bin/bash

# Bash script to refresh all player shot charts and play type analysis locally
# This script calls the Node.js script which can reach NBA API from your local machine
#
# Usage:
#   bash scripts/refresh-all-player-caches-local.sh
#   OR
#   chmod +x scripts/refresh-all-player-caches-local.sh
#   ./scripts/refresh-all-player-caches-local.sh

echo "========================================"
echo "Refresh All Player Shot Charts & Play Types"
echo "========================================"
echo ""

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "⚠️  Warning: .env.local not found. Make sure environment variables are set."
    echo ""
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"
echo ""
echo "🔄 Starting player cache refresh..."
echo "This will fetch all active players and refresh their shot charts."
echo "This may take 20-30 minutes for all players."
echo ""

# Run the Node.js script
node scripts/refresh-all-player-caches.js

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Refresh complete!"
else
    echo ""
    echo "❌ Refresh failed with exit code: $EXIT_CODE"
    exit $EXIT_CODE
fi

