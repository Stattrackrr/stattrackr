#!/usr/bin/env bash
# Hit a production cron route with CRON_SECRET. Follows host redirects.
#
# Usage:
#   PROD_URL=... CRON_SECRET=... ./scripts/ci-curl-prod-cron.sh /api/cron/refresh-nbl-odds 280
#
# Exit 0 only when HTTP 200 and JSON success === true.

set -euo pipefail

PATH_AND_QUERY="${1:?cron path required, e.g. /api/cron/refresh-nbl-odds}"
TIMEOUT="${2:-280}"

if [ -z "${PROD_URL:-}" ] || [ -z "${CRON_SECRET:-}" ]; then
  echo "PROD_URL or CRON_SECRET not set; skipping prod cron"
  exit 0
fi

PROD="${PROD_URL%/}"
case "$PROD" in
  http://*) PROD="https://${PROD#http://}" ;;
esac

EFFECTIVE=$(curl -sS -o /dev/null -w "%{url_effective}" -L --max-time 20 "${PROD}/" || true)
ORIGIN=$(printf '%s' "$EFFECTIVE" | sed -E 's#(https?://[^/]+).*#\1#')
case "$ORIGIN" in
  http://*|https://*) ;;
  *) ORIGIN="$PROD" ;;
esac

case "$PATH_AND_QUERY" in
  /*) TARGET_PATH="$PATH_AND_QUERY" ;;
  *) TARGET_PATH="/${PATH_AND_QUERY}" ;;
esac
URL="${ORIGIN}${TARGET_PATH}"
echo "Canonical cron URL: $URL"

call_cron() {
  local target="$1"
  local timeout="$2"
  local hdr body
  hdr=$(mktemp)
  body=$(mktemp)
  HTTP_STATUS=$(curl -sS -D "$hdr" -o "$body" --max-time "$timeout" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    -H "X-Cron-Secret: ${CRON_SECRET}" \
    -H "Accept: application/json" \
    -w "%{http_code}" \
    "$target" || true)
  HTTP_STATUS="${HTTP_STATUS:-000}"
  BODY=$(cat "$body")
  LOCATION=$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/^[^:]+:[[:space:]]*/,""); print}' "$hdr" | tr -d '\r' | tail -1)
  rm -f "$hdr" "$body"
}

call_cron "$URL" "$TIMEOUT"
if [ "$HTTP_STATUS" = "301" ] || [ "$HTTP_STATUS" = "302" ] || [ "$HTTP_STATUS" = "307" ] || [ "$HTTP_STATUS" = "308" ]; then
  echo "Edge redirect $HTTP_STATUS -> $LOCATION"
  case "$LOCATION" in
    http://*|https://*) TARGET="$LOCATION" ;;
    /*) TARGET="${ORIGIN}${LOCATION}" ;;
    *) TARGET="${ORIGIN}/${LOCATION}" ;;
  esac
  call_cron "$TARGET" "$TIMEOUT"
fi

echo "Response ($HTTP_STATUS): $BODY"
OK=$(node -e "try { const j = JSON.parse(process.argv[1]); process.stdout.write(j.success === true ? 'true' : 'false'); } catch { process.stdout.write('false'); }" "$BODY")
if [ "$HTTP_STATUS" != "200" ] || [ "$OK" != "true" ]; then
  echo "Prod cron failed (HTTP ${HTTP_STATUS:-unknown})"
  exit 1
fi
echo "Prod cron ok"
