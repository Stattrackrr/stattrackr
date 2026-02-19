#!/usr/bin/env node
/**
 * Test the AFL next-game API (with optional debug) to see why countdown might be missing.
 *
 * Usage (from project root, with dev server running on default port):
 *   node scripts/test-afl-next-game.js
 *   node scripts/test-afl-next-game.js Essendon
 *   node scripts/test-afl-next-game.js "Collingwood Magpies" 2026
 *
 * Or call the API directly in the browser:
 *   http://localhost:3000/api/afl/next-game?team=Essendon&season=2026&debug=1
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function main() {
  const team = process.argv[2] || 'Essendon';
  const season = process.argv[3] || '2026';
  const url = `${BASE}/api/afl/next-game?team=${encodeURIComponent(team)}&season=${season}&debug=1`;
  console.log('GET', url);
  console.log('');
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    console.log('');
    if (data._debug) {
      console.log('--- Debug summary ---');
      console.log('next_game_tipoff:', data.next_game_tipoff == null ? 'null (countdown will not show)' : data.next_game_tipoff);
      if (data._debug.next_match) {
        console.log('Next match:', data._debug.next_match);
      }
      if (data._debug.fixture_matches_with_parsed_time != null) {
        console.log('Fixture matches with parsed time:', data._debug.fixture_matches_with_parsed_time, 'of', data._debug.fixture_total_matches);
      }
    }
  } catch (e) {
    console.error('Request failed:', e.message);
    console.error('Is the dev server running? Try: npm run dev');
  }
}

main();
