#!/usr/bin/env node
/**
 * Trigger AFL odds + player props refresh (same as the cron), then verify the list API returns data.
 * Use when: (1) props page shows "no odds", or (2) matchups are wrong (e.g. wrong team names).
 *
 * Uses ?quick=1 so the refresh returns right after updating odds + props cache (skips DvP build and
 * stats warm, which can take several minutes). Matchups and props will be correct; full cron does DvP + warm.
 *
 * To fix wrong matchups: set ODDS_API_KEY, then run this script or load the props page once.
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
const REFRESH_TIMEOUT_MS = 90_000; // 90s – server returns right after odds+props if code is up to date

async function fetchRefresh(url, signal) {
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function main() {
  console.log('AFL odds + props refresh (same as cron)\n');
  console.log('Base URL:', BASE_URL);

  const refreshUrl =
    CRON_SECRET && BASE_URL.includes('stattrackr')
      ? `${BASE_URL}/api/afl/odds/refresh?secret=${encodeURIComponent(CRON_SECRET)}&quick=1`
      : `${BASE_URL}/api/afl/odds/refresh?quick=1`;

  console.log('1. Calling refresh...');
  let refreshRes;
  let refreshData;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    try {
      ({ res: refreshRes, data: refreshData } = await fetchRefresh(refreshUrl, controller.signal));
      clearTimeout(timeout);
      break;
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      const isReset = (e && (e.code === 'ECONNRESET' || e.message?.includes('ECONNRESET')));
      const isAbort = e?.name === 'AbortError';
      if (attempt === 1 && (isReset || isAbort)) {
        console.log('   Connection reset or timeout. Retrying once in 3s...');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (isAbort) {
        console.log('   Timed out after', REFRESH_TIMEOUT_MS / 1000, 's.');
        console.log('   Restart your dev server (npm run dev) so the refresh returns right after odds+props, then run this script again.');
      } else {
        console.log('   Error:', e?.message || e);
        console.log('   If you see ECONNRESET, restart the dev server and try again.');
      }
      process.exit(1);
    }
  }

  if (!refreshRes.ok) {
    console.log('   FAIL. Status:', refreshRes.status);
    if (refreshRes.status === 401) {
      console.log('   On production you must set CRON_SECRET and pass it (e.g. CRON_SECRET=xxx BASE_URL=https://... node scripts/trigger-afl-odds-refresh.js)');
    }
    console.log('   Response:', refreshData?.error ?? JSON.stringify(refreshData).slice(0, 300));
    process.exit(1);
  }

  console.log('   OK. Games:', refreshData.gamesCount ?? 0);
  console.log('   Events with props refreshed:', refreshData.eventsRefreshed ?? 0, refreshData.eventsRefreshed === 0 ? '(running in background)' : '');
  console.log('   Players with props:', refreshData.playersWithProps ?? 0);
  if (refreshData.message) console.log('   ', refreshData.message);
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
    console.log('\n   No prop rows in list yet. Props refresh runs in the background after odds update.');
    console.log('   Wait 1–2 min then reload the props page or run this script again.');
    process.exit(0);
  }

  console.log('\n   Sample games:', games.slice(0, 3).map((g) => `${g.homeTeam} vs ${g.awayTeam}`).join(' | '));
  const meta = listData._meta || {};
  if (meta.canonicalError) {
    console.log('\n   ⚠ Canonical games fetch failed:', meta.canonicalError);
    console.log('   → Set ODDS_API_KEY in .env.local (local) or Vercel env vars so matchups can be corrected.');
  } else if (meta.canonicalUsed) {
    console.log('\n   ✓ List API used canonical Odds API data (matchups are correct).');
  }
  console.log('\nDone. Props page should now show odds. Reload /props?sport=afl');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
