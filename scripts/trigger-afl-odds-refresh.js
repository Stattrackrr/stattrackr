#!/usr/bin/env node
/**
 * Trigger AFL odds + player props refresh (same as the cron), then verify the list API returns data.
 * Use this when the props page shows "no odds" – the cache might be empty until the cron runs or you run this.
 *
 * Local (dev server must be running):
 *   npm run dev
 *   node scripts/trigger-afl-odds-refresh.js
 *
 * Production (requires CRON_SECRET):
 *   BASE_URL=https://www.stattrackr.co CRON_SECRET=your_secret node scripts/trigger-afl-odds-refresh.js
 *
 * Requires: ODDS_API_KEY in .env.local (local) or Vercel env. On production, CRON_SECRET for auth.
 */

require('dotenv').config({ path: '.env.local' });

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';

async function main() {
  console.log('AFL odds + props refresh (same as cron)\n');
  console.log('Base URL:', BASE_URL);

  const refreshUrl =
    CRON_SECRET && BASE_URL.includes('stattrackr')
      ? `${BASE_URL}/api/afl/odds/refresh?secret=${encodeURIComponent(CRON_SECRET)}`
      : `${BASE_URL}/api/afl/odds/refresh`;

  console.log('1. Calling refresh...');
  const refreshRes = await fetch(refreshUrl);
  const refreshData = await refreshRes.json().catch(() => ({}));

  if (!refreshRes.ok) {
    console.log('   FAIL. Status:', refreshRes.status);
    if (refreshRes.status === 401) {
      console.log('   On production you must set CRON_SECRET and pass it (e.g. CRON_SECRET=xxx BASE_URL=https://... node scripts/trigger-afl-odds-refresh.js)');
    }
    console.log('   Response:', refreshData?.error ?? JSON.stringify(refreshData).slice(0, 300));
    process.exit(1);
  }

  console.log('   OK. Games:', refreshData.gamesCount ?? 0);
  console.log('   Events with props refreshed:', refreshData.eventsRefreshed ?? 0);
  console.log('   Players with props:', refreshData.playersWithProps ?? 0);
  if (refreshData.playerPropsError) console.log('   Props note:', refreshData.playerPropsError);
  if (refreshData.error) console.log('   Error:', refreshData.error);
  console.log('');

  console.log('2. Checking list API (what the props page uses)...');
  const listRes = await fetch(`${BASE_URL}/api/afl/player-props/list?enrich=false`, { cache: 'no-store' });
  const listData = await listRes.json().catch(() => ({}));

  if (!listRes.ok) {
    console.log('   FAIL. Status:', listRes.status, listData?.error ?? '');
    process.exit(1);
  }

  const games = Array.isArray(listData.games) ? listData.games : [];
  const rows = Array.isArray(listData.data) ? listData.data : [];
  console.log('   Games in list:', games.length);
  console.log('   Prop rows:', rows.length);

  if (games.length === 0 || rows.length === 0) {
    console.log('\n   No data in list API yet. If you just ran refresh successfully above:');
    console.log('   - On localhost with in-memory cache, the next request might hit a different process; try opening the props page again or run this script once more.');
    console.log('   - Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local so cache is shared across requests.');
    process.exit(0);
  }

  console.log('\n   Sample games:', games.slice(0, 3).map((g) => `${g.homeTeam} vs ${g.awayTeam}`).join(' | '));
  console.log('\nDone. Props page should now show odds. Reload /props?sport=afl');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
