#!/usr/bin/env node

/**
 * Test that symbol-name players (apostrophe + hyphen) use AFL Tables only.
 * Run with dev server up: npm run test:afl:symbols  or  node scripts/test-afl-symbol-players.js
 */

const baseUrl = (process.env.BASE_URL || process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');

const SYMBOL_PLAYERS = [
  { name: "Massimo D Ambrosio", team: 'Hawthorn Hawks', label: 'apostrophe (D\'Ambrosio)' },
  { name: 'Nasiah Wanganeen-Milera', team: 'St Kilda Saints', label: 'hyphen (Wanganeen-Milera)' },
];

const NORMAL_PLAYER = { name: 'Nick Daicos', team: 'Collingwood Magpies', label: 'normal (no symbol)' };

async function fetchLogs(season, playerName, team) {
  const params = new URLSearchParams({
    season: String(season),
    player_name: playerName,
    team,
    include_both: '1',
    force_fetch: '1',
  });
  const res = await fetch(`${baseUrl}/api/afl/player-game-logs?${params}`, { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => ({}));
  const source = res.headers.get('x-afl-player-logs-source') || res.headers.get('X-AFL-Player-Logs-Source') || '';
  const games = Array.isArray(json?.games) ? json.games : [];
  const count = Number(json?.game_count ?? games.length);
  return { ok: res.ok, source, count, games };
}

async function main() {
  console.log('AFL Tables symbol-player test');
  console.log('  BASE_URL:', baseUrl);
  console.log('  Expect: symbol names → source=afltables, normal → cache or footywire\n');

  let failed = 0;

  for (const { name, team, label } of SYMBOL_PLAYERS) {
    const { source, count } = await fetchLogs(2025, name, team);
    const fromAflTables = source.toLowerCase() === 'afltables';
    const status = fromAflTables ? 'OK' : 'FAIL';
    if (!fromAflTables) failed++;
    console.log(`  [${status}] ${label}`);
    console.log(`         ${name} (2025) → source=${source || '(none)'} | games=${count}`);
    if (!fromAflTables) console.log('         Expected source=afltables for symbol-name player.');
    console.log('');
  }

  const { name, team, label } = NORMAL_PLAYER;
  const { source, count } = await fetchLogs(2025, name, team);
  const notAflTables = source.toLowerCase() !== 'afltables';
  const status = notAflTables ? 'OK' : 'FAIL';
  if (!notAflTables) failed++;
  console.log(`  [${status}] ${label}`);
  console.log(`         ${name} (2025) → source=${source || '(none)'} | games=${count}`);
  if (!notAflTables) console.log('         Normal players should get cache or footywire, not afltables.');
  console.log('');

  if (failed > 0) {
    console.log('  Some checks failed. Ensure dev server is running (npm run dev).');
    process.exit(1);
  }
  console.log('  All checks passed: symbol players use AFL Tables, normal player does not.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
