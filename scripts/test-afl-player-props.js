#!/usr/bin/env node
/**
 * Test script: call AFL player-props API for a player and print the response.
 * Usage:
 *   node scripts/test-afl-player-props.js "Player Name"
 *   node scripts/test-afl-player-props.js "Player Name" disposals
 *   BASE_URL=https://your-app.vercel.app node scripts/test-afl-player-props.js "Player Name"
 *
 * With no stat, fetches all 6 stats the dashboard uses and prints each.
 * Requires dev server running (npm run dev) or set BASE_URL.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const STATS = ['disposals', 'disposals_over', 'anytime_goal_scorer', 'goals_over', 'marks_over', 'tackles_over'];

async function fetchPlayerProps(playerName, stat) {
  const url = `${BASE_URL}/api/afl/player-props?player=${encodeURIComponent(playerName)}&stat=${encodeURIComponent(stat)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { stat, status: res.status, ok: res.ok, data };
}

async function main() {
  const player = process.argv[2] || 'Patrick Cripps';
  const singleStat = process.argv[3]; // optional: only fetch this stat

  console.log('AFL Player Props API test');
  console.log('Base URL:', BASE_URL);
  console.log('Player:', player);
  console.log('');

  if (singleStat) {
    const result = await fetchPlayerProps(player, singleStat);
    console.log(`--- stat=${singleStat} (HTTP ${result.status}) ---`);
    console.log(JSON.stringify(result.data, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log('Fetching all 6 stats...\n');
  for (const stat of STATS) {
    const result = await fetchPlayerProps(player, stat);
    const count = result.data?.props?.length ?? 0;
    const msg = result.ok ? `props: ${count}` : `error: ${result.data?.error || result.status}`;
    console.log(`${stat.padEnd(22)} HTTP ${result.status}  ${msg}`);
    if (result.data?.props?.length > 0) {
      console.log(JSON.stringify(result.data, null, 2));
      console.log('');
    }
  }

  console.log('\nDone. To see full response for one stat:');
  console.log(`  node scripts/test-afl-player-props.js "${player}" disposals`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
