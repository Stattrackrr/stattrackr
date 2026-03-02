#!/usr/bin/env node
/**
 * Check what odds a player has across all AFL player-prop markets.
 * Prints a readable summary so you can verify you're getting everything.
 *
 * Usage (from project root; dev server must be running or set BASE_URL):
 *   node scripts/check-afl-player-odds.js "Player Name" "Team" "Opponent"
 *   node scripts/check-afl-player-odds.js "Errol Gulden" "Sydney Swans" "Essendon"
 *   node scripts/check-afl-player-odds.js "Isaac Heeney" "Sydney Swans" "Collingwood Magpies"
 *
 * Optional: add game_date (YYYY-MM-DD) if you need a specific round:
 *   node scripts/check-afl-player-odds.js "Player" "Team" "Opponent" 2026-03-15
 *
 * Optional: BASE_URL for deployed app:
 *   BASE_URL=https://your-app.vercel.app node scripts/check-afl-player-odds.js "Player" "Team" "Opponent"
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const STATS = [
  { key: 'disposals', label: 'Disposals (O/U)' },
  { key: 'disposals_over', label: 'Disposals (Over only / alt lines)' },
  { key: 'anytime_goal_scorer', label: 'Anytime Goal Scorer (Yes/No)' },
  { key: 'goals_over', label: 'Goals (Over only)' },
  { key: 'marks_over', label: 'Marks (Over only)' },
  { key: 'tackles_over', label: 'Tackles (Over only)' },
];

function fmtDec(d) {
  if (d == null || typeof d !== 'number') return '—';
  return d.toFixed(2);
}

async function fetchPlayerProps(player, team, opponent, gameDate, stat) {
  const params = new URLSearchParams({
    player,
    stat,
    team: team || '',
    opponent: opponent || '',
  });
  if (gameDate) params.set('game_date', gameDate);
  const url = `${BASE_URL}/api/afl/player-props?${params}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const player = process.argv[2];
  const team = process.argv[3];
  const opponent = process.argv[4];
  const gameDate = process.argv[5] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[5]) ? process.argv[5] : null;

  if (!player) {
    console.log('Usage: node scripts/check-afl-player-odds.js "Player Name" "Team" "Opponent" [game_date]');
    console.log('');
    console.log('Example: node scripts/check-afl-player-odds.js "Errol Gulden" "Sydney Swans" "Essendon"');
    console.log('');
    console.log('Team and opponent should match fixture names (e.g. "Sydney Swans", "Collingwood Magpies").');
    console.log('Ensure dev server is running: npm run dev');
    process.exit(1);
  }

  if (!team || !opponent) {
    console.log('Team and opponent are required so the script can resolve the game.');
    console.log('Usage: node scripts/check-afl-player-odds.js "Player Name" "Team" "Opponent"');
    process.exit(1);
  }

  console.log('AFL Player Odds Check');
  console.log('====================');
  console.log('Base URL:', BASE_URL);
  console.log('Player:', player);
  console.log('Team:', team);
  console.log('Opponent:', opponent);
  if (gameDate) console.log('Game date:', gameDate);
  console.log('');

  const results = {};
  for (const { key, label } of STATS) {
    const { ok, status, data } = await fetchPlayerProps(player, team, opponent, gameDate, key);
    results[key] = { ok, status, data, label };
  }

  const anyError = Object.values(results).some((r) => !r.ok || r.data?.error);
  if (anyError) {
    for (const [key, r] of Object.entries(results)) {
      if (!r.ok || r.data?.error) {
        console.log(`[${r.label}] HTTP ${r.status}`);
        if (r.data?.error) console.log('  Error:', r.data.error);
        if (r.data?.message) console.log('  Message:', r.data.message);
      }
    }
    console.log('');
  }

  if (results.disposals?.data?.message && !results.disposals?.data?.props) {
    console.log('Message:', results.disposals.data.message);
    process.exit(1);
  }

  for (const { key, label } of STATS) {
    const r = results[key];
    const props = r.data?.props ?? [];
    console.log('--- ' + label + ' ---');
    if (props.length === 0) {
      console.log('  (no bookmakers returned)');
    } else {
      const isYesNo = key === 'anytime_goal_scorer';
      for (const p of props) {
        if (isYesNo) {
          console.log(`  ${p.bookmaker.padEnd(20)}  Yes ${fmtDec(p.yesPrice)}  |  No ${fmtDec(p.noPrice)}`);
        } else if (p.overPrice != null && p.underPrice != null) {
          console.log(`  ${p.bookmaker.padEnd(20)}  Line ${p.line}  |  O ${fmtDec(p.overPrice)}  U ${fmtDec(p.underPrice)}`);
        } else {
          console.log(`  ${p.bookmaker.padEnd(20)}  Line ${p.line}  |  Over ${fmtDec(p.overPrice)}`);
        }
      }
      console.log(`  (${props.length} bookmaker(s))`);
    }
    console.log('');
  }

  const totalBooks = new Set();
  for (const r of Object.values(results)) {
    for (const p of r.data?.props ?? []) totalBooks.add(p.bookmaker);
  }
  console.log('Summary: ' + totalBooks.size + ' unique bookmaker(s) across all markets.');
  console.log('');
  console.log('If a market is empty, that player may not have a line for it, or the game/event could not be resolved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
