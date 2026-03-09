#!/usr/bin/env bash
# Vercel "Ignore Build Step": run this in Project Settings → Git → Ignored Build Step.
# Exit 0 = skip build, exit 1 = run build.
# Always build if app/ or lib/ changed. Skip only when the ONLY changed files are data/afl-league-player-stats-*.json.

set -e
CHANGED=$(git diff --name-only "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" "${VERCEL_GIT_COMMIT_SHA:-HEAD}" 2>/dev/null || true)
if [ -z "$CHANGED" ]; then
  exit 1
fi
# Never skip if any app or lib file changed
if echo "$CHANGED" | grep -qE '^app/|^lib/'; then
  exit 1
fi
if echo "$CHANGED" | grep -qv '^data/afl-league-player-stats-[0-9][0-9]*\.json$'; then
  exit 1
fi
exit 0
