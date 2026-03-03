#!/usr/bin/env node
/**
 * Test the AFL odds 90-min cache: refresh → game odds → player props.
 *
 * Local (dev server must be running):
 *   npm run dev
 *   node scripts/test-afl-odds-cache.js
 *
 * Production (no dev server; tests live site):
 *   BASE_URL=https://www.stattrackr.co node scripts/test-afl-odds-cache.js
 *
 * To trigger a refresh on production manually (e.g. before testing), call the refresh
 * endpoint with your CRON_SECRET (set in Vercel env):
 *   curl "https://www.stattrackr.co/api/afl/odds/refresh?secret=YOUR_CRON_SECRET"
 * Or wait for the hourly Vercel cron to run.
 *
 * Requires: ODDS_API_KEY in .env.local (local) or Vercel env (prod). CRON_SECRET in Vercel for cron.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';

async function main() {
  console.log('AFL Odds Cache Test');
  console.log('==================');
  console.log('Base URL:', BASE_URL);
  if (CRON_SECRET && BASE_URL.includes('stattrackr')) console.log('(Using CRON_SECRET for refresh)');
  console.log('');

  // Step 1: Refresh cache (game odds + player props for all events)
  console.log('1. Refreshing cache (game odds + player props goals/disposals)...');
  const refreshUrl = CRON_SECRET ? `${BASE_URL}/api/afl/odds/refresh?secret=${encodeURIComponent(CRON_SECRET)}` : `${BASE_URL}/api/afl/odds/refresh`;
  const refreshRes = await fetch(refreshUrl);
  const refreshData = await refreshRes.json().catch(() => ({}));

  if (!refreshRes.ok) {
    if (refreshRes.status === 401 && BASE_URL.includes('http')) {
      console.log('   Refresh requires auth (401). If cache is warm from cron, continuing to test read endpoints...');
    } else {
      console.log('   FAIL. Status:', refreshRes.status, refreshData?.error ?? refreshData);
      process.exit(1);
    }
  } else {
    console.log('   OK. Games:', refreshData.gamesCount ?? 0);
    console.log('   Player props events refreshed:', refreshData.eventsRefreshed ?? 0);
    if (refreshData.playerPropsError) console.log('   Player props note:', refreshData.playerPropsError);
    console.log('   lastUpdated:', refreshData.lastUpdated ?? '—');
  }
  console.log('');

  // Step 2: Get all games from cache (no team filter)
  console.log('2. GET /api/afl/odds (all games from cache)...');
  const oddsRes = await fetch(`${BASE_URL}/api/afl/odds`);
  const oddsData = await oddsRes.json().catch(() => ({}));

  if (!oddsRes.ok || !oddsData.success) {
    console.log('   FAIL.', oddsRes.status, oddsData?.error ?? oddsData?.message ?? '');
    process.exit(1);
  }
  const games = Array.isArray(oddsData.data) ? oddsData.data : [];
  console.log('   OK. Games returned:', games.length);
  if (games.length > 0) {
    const g = games[0];
    console.log('   First game:', g?.homeTeam ?? '—', 'vs', g?.awayTeam ?? '—');
  } else {
    console.log('   No games in cache. Run refresh with CRON_SECRET or wait for hourly cron.');
    console.log('   Example: CRON_SECRET=your_secret BASE_URL=https://www.stattrackr.co node scripts/test-afl-odds-cache.js');
    process.exit(0);
  }
  console.log('');

  // Step 3: Get one game's odds (team + opponent)
  const homeTeam = games[0]?.homeTeam ?? games[0]?.home_team;
  const awayTeam = games[0]?.awayTeam ?? games[0]?.away_team;
  if (homeTeam && awayTeam) {
    console.log('3. GET /api/afl/odds?team=...&opponent=... (single game from cache)...');
    const oneRes = await fetch(
      `${BASE_URL}/api/afl/odds?team=${encodeURIComponent(homeTeam)}&opponent=${encodeURIComponent(awayTeam)}`
    );
    const oneData = await oneRes.json().catch(() => ({}));
    if (!oneRes.ok || !oneData.success) {
      console.log('   FAIL.', oneRes.status, oneData?.error ?? '');
    } else {
      const books = Array.isArray(oneData.data) ? oneData.data : [];
      console.log('   OK. Bookmakers:', books.length, '| homeTeam:', oneData.homeTeam, 'awayTeam:', oneData.awayTeam);
    }
    console.log('');
  }

  // Step 4: Player props from cache (need a real player name; use a known star or first from API)
  console.log('4. GET /api/afl/player-props (from cache, goals/disposals only)...');
  const teamForProps = homeTeam || 'Geelong Cats';
  const oppForProps = awayTeam || 'Sydney Swans';
  const playerName = process.argv[2] || 'Patrick Cripps'; // optional: node scripts/test-afl-odds-cache.js "Player Name"
  const ppUrl = `${BASE_URL}/api/afl/player-props?player=${encodeURIComponent(playerName)}&team=${encodeURIComponent(teamForProps)}&opponent=${encodeURIComponent(oppForProps)}&all=1`;
  const ppRes = await fetch(ppUrl);
  const ppData = await ppRes.json().catch(() => ({}));

  if (!ppRes.ok) {
    console.log('   FAIL.', ppRes.status, ppData?.error ?? ppData?.message ?? '');
  } else if (ppData.message && !ppData.all) {
    console.log('   No cached props for this player (cache may not have this matchup yet):', ppData.message);
  } else {
    const all = ppData.all || {};
    const stats = Object.keys(all).filter((k) => Array.isArray(all[k]) && all[k].length > 0);
    console.log('   OK. Player:', playerName, '| Stats with odds:', stats.length, stats.join(', ') || 'none');
  }

  console.log('');
  console.log('Done. Cache is working. Run refresh every 90 min (e.g. Vercel cron) to keep data fresh.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
