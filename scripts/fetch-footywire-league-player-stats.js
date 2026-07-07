#!/usr/bin/env node

/**
 * Fetch AFL league player stats (season averages) from FootyWire Player Rankings.
 * Source: footywire.com/afl/footy/ft_player_rankings — URL changes per stat (year, rt=LA, st=DI|KI|HB|MA|GO|...).
 * Merges all stat pages into one dataset. Caches to data/afl-league-player-stats-{year}.json (used by Compare tab).
 *
 *   node scripts/fetch-footywire-league-player-stats.js
 *   node scripts/fetch-footywire-league-player-stats.js --season=2025
 */

try {
  require('dotenv').config({ path: '.env.local' });
} catch {
  // Optional locally; production injects env vars directly.
}

const fs = require('fs');
const path = require('path');
const { buildLeaguePlayerStatsPayload, leagueStatsFilePath } = require('../lib/afl/footywireLeaguePlayerStats');

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

async function main() {
  const year = new Date().getFullYear();
  const allowStale = process.argv.includes('--allow-stale');
  const skipStaleProbe = process.argv.includes('--skip-stale-probe');
  const jsonStdout = process.argv.includes('--json-stdout');
  const debugHtml = process.argv.includes('--debug-html');
  const season = parseInt(getArg('season', String(year)), 10) || year;
  const requestedSeason = season;

  const result = await buildLeaguePlayerStatsPayload(requestedSeason, {
    allowStale,
    skipStaleProbe: jsonStdout || skipStaleProbe,
    debugHtml,
  });
  if (result.stale) {
    if (jsonStdout) {
      console.error(result.reason);
      process.exit(1);
    }
    console.warn(`${result.reason}; keeping existing ${leagueStatsFilePath(requestedSeason)}`);
    return;
  }

  const out = result.payload;
  if (jsonStdout) {
    process.stdout.write(JSON.stringify(out));
    return;
  }

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filePath = leagueStatsFilePath(requestedSeason);
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${filePath} (${out.playerCount} players)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildLeaguePlayerStatsPayload, leagueStatsFilePath };
