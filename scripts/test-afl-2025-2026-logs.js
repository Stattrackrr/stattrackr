#!/usr/bin/env node

/**
 * Test 2025 vs 2026 player game logs and merged result (dashboard / props flow).
 * Run with dev server: npm run dev, then node scripts/test-afl-2025-2026-logs.js
 *
 * Single player (default: Nick Daicos):
 *   node scripts/test-afl-2025-2026-logs.js
 *   node scripts/test-afl-2025-2026-logs.js --player "Nick Daicos" --team "Collingwood Magpies"
 *
 * Everyone (from data/afl-league-player-stats-*.json):
 *   node scripts/test-afl-2025-2026-logs.js --all
 *   node scripts/test-afl-2025-2026-logs.js --all --limit=50
 *
 *   BASE_URL=http://localhost:3000 node scripts/test-afl-2025-2026-logs.js --all
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const baseUrl = (process.env.BASE_URL || process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const withEquals = process.argv.find((a) => a.startsWith(pref));
  if (withEquals) return withEquals.slice(pref.length).replace(/^["']|["']$/g, '');
  const flagIndex = process.argv.indexOf(`--${name}`);
  if (flagIndex >= 0 && flagIndex + 1 < process.argv.length) {
    return process.argv[flagIndex + 1].replace(/^["']|["']$/g, '');
  }
  return fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const playerName = getArg('player', 'Nick Daicos');
const team = getArg('team', 'Collingwood Magpies');
const runAll = hasFlag('all') || hasFlag('everyone');
const limitAll = Math.max(0, parseInt(getArg('limit', '0'), 10) || 0);
const concurrency = Math.max(1, parseInt(process.env.AFL_TEST_CONCURRENCY || '75', 10));

function gameSeason(g) {
  const s = g?.season;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
}

function gameRound(g) {
  return g?.round ?? g?.game_number ?? '?';
}

async function fetchLogs(season, name, teamName) {
  const params = new URLSearchParams({
    season: String(season),
    player_name: name,
    team: teamName,
    include_both: '1',
    force_fetch: '1',
  });
  const url = `${baseUrl}/api/afl/player-game-logs?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  const source = res.headers.get('x-afl-player-logs-source') || res.headers.get('X-AFL-Player-Logs-Source') || '';
  const fallback = res.headers.get('x-afl-season-fallback') || res.headers.get('X-AFL-Season-Fallback') || '';
  const games = Array.isArray(data?.games) ? data.games : [];
  const payloadSeason = data?.season ?? null;
  return { ok: res.ok, status: res.status, source, fallback, payloadSeason, games, data };
}

function loadAllPlayers() {
  // Resolve data dir from repo root (script lives in scripts/, so ../data). __dirname = scripts/
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    console.warn('  [loadAllPlayers] data dir not found:', dataDir);
    return [];
  }
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /^afl-league-player-stats-\d+\.json$/i.test(f))
    .sort()
    .reverse();
  const byKey = new Map();
  for (const file of files) {
    try {
      const fullPath = path.join(dataDir, file);
      const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const players = Array.isArray(json?.players) ? json.players : [];
      let added = 0;
      for (const p of players) {
        const name = String(p?.name || '').trim();
        const team = String(p?.team || '').trim();
        if (!name || !team) continue;
        const key = `${name.toLowerCase()}|${team.toLowerCase()}`;
        if (!byKey.has(key)) {
          byKey.set(key, { name, team });
          added++;
        }
      }
      if (runAll && added > 0) console.log('  [loadAllPlayers]', file, '→', players.length, 'rows,', added, 'new unique');
    } catch (err) {
      console.warn('  [loadAllPlayers] Skip', file, err instanceof Error ? err.message : String(err));
    }
  }
  if (runAll && byKey.size > 0) console.log('  [loadAllPlayers] total unique:', byKey.size, 'from', dataDir, '\n');
  return Array.from(byKey.values());
}

async function testOnePlayer(name, teamName, verbose) {
  const [r2026, r2025] = await Promise.all([
    fetchLogs(2026, name, teamName),
    fetchLogs(2025, name, teamName),
  ]);
  const unique2026 = [...new Set(r2026.games.map(gameSeason).filter(Boolean))];
  const has2026 = r2026.games.length > 0 && (unique2026.includes(2026) || r2026.payloadSeason === 2026);
  const has2025 = r2025.games.length > 0;
  const merged = [...r2026.games, ...r2025.games];
  if (verbose) {
    console.log('  [2026]', r2026.status, r2026.source || '(none)', '| games:', r2026.games.length, '| season:', r2026.payloadSeason);
    console.log('  [2025]', r2025.status, r2025.source || '(none)', '| games:', r2025.games.length);
    console.log('  Merged:', merged.length, '| has2026:', has2026, '| has2025:', has2025);
  }
  return { name, team: teamName, has2026, has2025, count2026: r2026.games.length, count2025: r2025.games.length, merged: merged.length };
}

async function runAllPlayers() {
  const players = loadAllPlayers();
  if (!players.length) {
    console.error('No players found. Run: npm run fetch:footywire-league-player-stats (or ensure data/afl-league-player-stats-*.json exists)');
    process.exit(1);
  }
  const list = limitAll > 0 ? players.slice(0, limitAll) : players;
  console.log('Testing', list.length, 'players (concurrency', concurrency, ')...\n');

  const results = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((p) => testOnePlayer(p.name, p.team, false)));
    results.push(...batchResults);
    const done = Math.min(i + concurrency, list.length);
    if (done % 20 === 0 || done >= list.length) {
      console.log('  Progress:', done, '/', list.length);
    }
  }

  const with2026 = results.filter((r) => r.has2026);
  const only2025 = results.filter((r) => !r.has2026 && r.has2025);
  const both = results.filter((r) => r.has2026 && r.has2025);
  const none = results.filter((r) => !r.has2026 && !r.has2025);

  console.log('\n--- Summary (everyone) ---');
  console.log('  Total players:', results.length);
  console.log('  With 2026 data:', with2026.length);
  console.log('  With both 2026 + 2025:', both.length);
  console.log('  Only 2025 (no 2026):', only2025.length);
  console.log('  No games either season:', none.length);
  if (only2025.length > 0 && only2025.length <= 15) {
    console.log('\n  Only 2025 (sample):', only2025.slice(0, 15).map((r) => r.name).join(', '));
  } else if (only2025.length > 15) {
    console.log('\n  Only 2025 (first 10):', only2025.slice(0, 10).map((r) => r.name).join(', '));
  }
  if (with2026.length > 0 && with2026.length <= 15) {
    console.log('\n  With 2026 (sample):', with2026.slice(0, 15).map((r) => r.name).join(', '));
  }
  console.log('');
}

async function main() {
  console.log('=== AFL 2025 + 2026 game logs test ===\n');
  console.log('  BASE_URL:', baseUrl);
  if (runAll) {
    await runAllPlayers();
    return;
  }

  console.log('  Player:', playerName);
  console.log('  Team:', team);
  console.log('');

  const r2026 = await fetchLogs(2026, playerName, team);
  const seasons2026 = r2026.games.map(gameSeason).filter(Boolean);
  const unique2026 = [...new Set(seasons2026)];
  console.log('--- Season 2026 ---');
  console.log('  Status:', r2026.status, '| Source:', r2026.source || '(none)', r2026.fallback ? `| Fallback: ${r2026.fallback}` : '');
  console.log('  Response season:', r2026.payloadSeason);
  console.log('  Games count:', r2026.games.length);
  if (r2026.games.length > 0) {
    console.log('  Game seasons in response:', unique2026.join(', ') || '(none)');
    console.log('  First 3 games (round, season, disposals):', r2026.games.slice(0, 3).map((g) => ({ round: gameRound(g), season: gameSeason(g), disposals: g?.disposals })));
  }
  console.log('');

  const r2025 = await fetchLogs(2025, playerName, team);
  const unique2025 = [...new Set(r2025.games.map(gameSeason).filter(Boolean))];
  console.log('--- Season 2025 ---');
  console.log('  Status:', r2025.status, '| Source:', r2025.source || '(none)', r2025.fallback ? `| Fallback: ${r2025.fallback}` : '');
  console.log('  Response season:', r2025.payloadSeason);
  console.log('  Games count:', r2025.games.length);
  if (r2025.games.length > 0) {
    console.log('  Game seasons in response:', unique2025.join(', ') || '(none)');
    console.log('  First 3 games (round, season, disposals):', r2025.games.slice(0, 3).map((g) => ({ round: gameRound(g), season: gameSeason(g), disposals: g?.disposals })));
  }
  console.log('');

  const merged = [...r2026.games, ...r2025.games];
  const mergedUnique = [...new Set(merged.map(gameSeason).filter(Boolean))];
  console.log('--- Merged (2026 then 2025, as on dashboard) ---');
  console.log('  Total games:', merged.length);
  console.log('  Seasons in merged:', mergedUnique.join(', ') || '(none)');
  if (merged.length > 0) {
    console.log('  First 3 (most recent):', merged.slice(0, 3).map((g) => ({ round: gameRound(g), season: gameSeason(g), disposals: g?.disposals })));
    console.log('  Last 3 (oldest):', merged.slice(-3).map((g) => ({ round: gameRound(g), season: gameSeason(g), disposals: g?.disposals })));
  }
  console.log('');

  const has2026 = r2026.games.length > 0 && (unique2026.includes(2026) || r2026.payloadSeason === 2026);
  const has2025 = r2025.games.length > 0;
  if (has2026 && has2025) {
    console.log('  PASS: Both 2026 and 2025 have games. Dashboard merge would show', merged.length, 'games.');
  } else if (has2026) {
    console.log('  INFO: Only 2026 has games (no 2025). Dashboard would show', r2026.games.length, 'games.');
  } else if (has2025) {
    console.log('  WARN: Only 2025 has games. 2026 returned', r2026.games.length, 'games.');
    console.log('        Stale 2025-in-2026-cache is now bypassed by API; restart dev server and run again.');
  } else {
    console.log('  FAIL: No games for either season. Check BASE_URL and player/team.');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
