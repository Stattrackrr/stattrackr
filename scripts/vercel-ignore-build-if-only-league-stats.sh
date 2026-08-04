#!/usr/bin/env bash
# Vercel "Ignore Build Step": run this in Project Settings → Git → Ignored Build Step.
# Exit 0 = skip build, exit 1 = run build.
#
# Always build if app/ or lib/ (or other non-data) changed.
# Skip when the ONLY changed files are generated data refreshes (league stats,
# AFL model outputs, DFS maps, etc.) — those used to trigger full clones and
# (historically) Git LFS downloads on every daily/nightly push.

set -e
CHANGED=$(git diff --name-only "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" "${VERCEL_GIT_COMMIT_SHA:-HEAD}" 2>/dev/null || true)
if [ -z "$CHANGED" ]; then
  exit 1
fi

# Never skip if any app or lib file changed
if echo "$CHANGED" | grep -qE '^app/|^lib/'; then
  exit 1
fi

# Skip only when every changed path is a known generated-data prefix.
while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    data/afl-league-player-stats-*.json) ;;
    data/afl-model/*) ;;
    data/afl-dfs-usage-*.json) ;;
    data/afl-dfs-role-map-*.json) ;;
    data/afl-weather-upcoming.json) ;;
    data/afl-top-picks*) ;;
    data/nbl-model/*) ;;
    data/nbl-league-player-stats-*.json) ;;
    data/nbl-player-game-logs-*.json) ;;
    data/nbl-roster*.json) ;;
    data/nbl-rosters-by-team-*.json) ;;
    data/nbl-schedule-*.json) ;;
    data/nbl-ladder-*.json) ;;
    data/nbl-team-stats-*.json) ;;
    data/nbl-next-matches*.json) ;;
    *)
      exit 1
      ;;
  esac
done <<< "$CHANGED"

exit 0
