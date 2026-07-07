#!/usr/bin/env node

/**
 * Pull league player stats JSON from production (FootyWire scrape on Vercel)
 * and write data/afl-league-player-stats-{season}.json — used when CI IPs get 503.
 *
 * Requires PROD_URL and CRON_SECRET in env.
 */

try {
  require('dotenv').config({ path: '.env.local' });
} catch {
  // Optional locally; production injects env vars directly.
}

const fs = require('fs');
const path = require('path');

const prodUrl = (process.env.PROD_URL || '').trim().replace(/\/+$/, '');
const cronSecret = (process.env.CRON_SECRET || '').trim();

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

async function main() {
  if (!prodUrl || !cronSecret) {
    console.error('Missing PROD_URL or CRON_SECRET');
    process.exit(1);
  }
  const season = parseInt(getArg('season', String(new Date().getFullYear())), 10);
  const mode = getArg('mode', 'minimal');
  const url = `${prodUrl}/api/afl/cron/league-player-stats?season=${season}&mode=${encodeURIComponent(mode)}`;
  console.log(`[pull-league-stats] GET ${url}`);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${cronSecret}`,
      'X-Cron-Secret': cronSecret,
    },
    signal: AbortSignal.timeout(90_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    console.error('[pull-league-stats] failed:', res.status, json?.error || json);
    process.exit(1);
  }
  if (json.fromBundledSnapshot) {
    console.error('[pull-league-stats] prod FootyWire scrape failed; only bundled snapshot returned');
    process.exit(1);
  }
  const { success: _success, error: _error, fromBundledSnapshot: _bundled, ...payload } = json;
  const outPath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  const maxGames = Math.max(...(payload.players || []).map((p) => Number(p.games) || 0), 0);
  console.log(
    `[pull-league-stats] Wrote ${outPath} (${json.playerCount ?? json.players?.length ?? '?'} players, maxGames ${maxGames}, mode ${payload.refreshMode || mode})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
