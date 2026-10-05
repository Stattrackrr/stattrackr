#!/usr/bin/env bash
# Hourly NBL live odds ingest. Hits production Redis only — does not run
# the nightly Rosetta / shot-chart / process-stats pipeline.
#
# Usage:
#   PROD_URL=... CRON_SECRET=... bash scripts/ingest-nbl-odds.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/scripts/ci-curl-prod-cron.sh" /api/cron/refresh-nbl-odds 280
