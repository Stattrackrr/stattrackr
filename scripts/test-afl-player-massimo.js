#!/usr/bin/env node

/**
 * Test script for Massimo D'Ambrosio (apostrophe in name).
 * When this works, the same slug/2025-fallback logic works for all players with symbols.
 *
 *   npm run test:afl:massimo
 *   node scripts/test-afl-player-massimo.js --debug   (or AFL_DEBUG=1) to see parse debug from API
 */

const baseUrl = (process.env.BASE_URL || process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
// Use name WITHOUT apostrophe to match what the frontend sends (API normalizes to D'Ambrosio)
const playerName = 'Massimo D Ambrosio';
const team = 'Hawthorn Hawks';

function disposalsAvg(games) {
  if (!Array.isArray(games) || games.length === 0) return null;
  const sum = games.reduce((s, g) => s + (g.disposals ?? 0), 0);
  return (sum / games.length).toFixed(1);
}

async function main() {
  console.log('[Test] Massimo D Ambrosio (same as frontend) — if disposals avg is 10+, stats are correct.\n');
  console.log('  BASE_URL:', baseUrl);
  console.log('  Player:', playerName);
  console.log('  Team:', team);
  console.log('');

  const forceFetch = '1'; // So server hits FootyWire even when cache is enabled (cache-only would otherwise return 0 games).
  const debug = process.argv.includes('--debug') || (process.env.AFL_DEBUG || '').toLowerCase() === '1';

  if (debug) {
    const params = new URLSearchParams({ season: '2025', player_name: playerName, team, include_both: '1', debug: '1' });
    const url = `${baseUrl}/api/afl/player-game-logs?${params.toString()}`;
    console.log('  [DEBUG] GET', url);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    console.log('  [DEBUG]', JSON.stringify(json._debug || json, null, 2));
    console.log('');
    return;
  }

  for (const season of [2026, 2025]) {
    const params = new URLSearchParams({
      season: String(season),
      player_name: playerName,
      team,
      include_both: '1',
      force_fetch: forceFetch,
    });
    const url = `${baseUrl}/api/afl/player-game-logs?${params.toString()}`;
    console.log(`  [${season}] GET ${url}`);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const source = res.headers.get('x-afl-player-logs-source') || res.headers.get('X-AFL-Player-Logs-Source') || '';
      const fallback = res.headers.get('x-afl-season-fallback') || res.headers.get('X-AFL-Season-Fallback') || '';
      const json = await res.json().catch(() => ({}));
      const games = Array.isArray(json?.games) ? json.games : [];
      const count = Number(json?.game_count ?? games.length);
      const avg = disposalsAvg(games);
      const hasAdvanced = games.some((g) => g.percent_played != null || g.contested_possessions != null || g.meters_gained != null);
      console.log(`         → ${res.status} | source=${source || '(none)'} | games=${count} | disposals avg=${avg ?? 'n/a'} | advanced=${hasAdvanced ? 'yes' : 'no'}${fallback ? ` | fallback=${fallback}` : ''}`);
      if (!res.ok) {
        console.log(`         → ERROR: ${json?.error || json?.message || res.statusText}`);
      }
      if (count > 0 && avg != null) {
        const ok = parseFloat(avg) >= 5;
        console.log(`         → ${ok ? 'OK' : 'WRONG DATA'} ${ok ? 'Disposals look correct.' : 'Disposals avg should be ~10+, not ' + avg + '.'}`);
      } else if (count === 0) {
        console.log(`         → No games (2026 may be empty; 2025 should have data).`);
      }
      console.log('');
    } catch (err) {
      console.log(`         → FAIL: ${err instanceof Error ? err.message : String(err)}`);
      console.log('');
    }
  }

  // Single request that should return 2025 data (either directly or via 2026→2025 fallback)
  const params = new URLSearchParams({ season: '2026', player_name: playerName, team, include_both: '1', force_fetch: forceFetch });
  const url = `${baseUrl}/api/afl/player-game-logs?${params.toString()}`;
  console.log('  [2026 request] Should return 2025 data when 2026 has no games.');
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    const games = Array.isArray(json?.games) ? json.games : [];
    const count = Number(json?.game_count ?? games.length);
    const avg = disposalsAvg(games);
    const payloadSeason = json?.season ?? '(none)';
    if (count > 0 && avg != null && parseFloat(avg) >= 5) {
      console.log(`  SUCCESS: 2026 request returned ${count} games, disposals avg=${avg} (season: ${payloadSeason}).`);
      console.log('  Massimo test passed — same logic works for everyone.\n');
      process.exit(0);
    }
    if (count > 0 && avg != null && parseFloat(avg) < 5) {
      console.log(`  FAIL: Got ${count} games but disposals avg=${avg} (wrong table). Restart server and clear caches.\n`);
      process.exit(1);
    }
    console.log(`  FAIL: 2026 request returned 0 games (payload season: ${payloadSeason}).`);
    console.log('  Ensure dev server is running and slug/2025-fallback are deployed.\n');
    process.exit(1);
  } catch (err) {
    console.log(`  FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
