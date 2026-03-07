#!/usr/bin/env node
/**
 * Test AFL props flow locally: refresh odds (triggers warm), then check list has stats.
 * Run with dev server: npm run dev (in another terminal), then: node scripts/test-afl-props-local.js
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function get(url, opts = {}) {
  const res = await fetch(url, { cache: 'no-store', ...opts });
  const data = res.ok ? await res.json() : null;
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log('AFL props – local test');
  console.log('Base URL:', BASE);
  console.log('');

  // 1) List (may have 0 stats if cache cold)
  console.log('1) GET /api/afl/player-props/list?debugStats=1');
  const listBefore = await get(`${BASE}/api/afl/player-props/list?debugStats=1`);
  if (!listBefore.ok) {
    console.error('List failed:', listBefore.status, listBefore.data?.error || '');
    process.exit(1);
  }
  const rows = listBefore.data?.data?.length ?? 0;
  const meta = listBefore.data?._meta ?? {};
  console.log('   Rows:', rows, '| With stats:', meta.rowsWithStats ?? '?', '| Cache backend:', meta.cacheBackend ?? '?');
  if (rows === 0) {
    console.log('   No props in cache. Run odds/refresh first (see step 2).');
  }
  console.log('');

  // 2) Refresh odds (this also runs warm in same request)
  console.log('2) GET /api/afl/odds/refresh (refreshes odds then runs props-stats warm)');
  const refresh = await get(`${BASE}/api/afl/odds/refresh`);
  if (!refresh.ok) {
    console.log('   Refresh failed:', refresh.status, refresh.data?.error || '');
    console.log('   (Need ODDS_API_KEY; CRON_SECRET optional for local)');
  } else {
    const d = refresh.data;
    console.log('   Games:', d.gamesCount, '| Events refreshed:', d.eventsRefreshed, '| Stats warmed:', d.statsWarmed ?? d.statsWarmError ?? '?');
  }
  console.log('');

  // 3) List again – should have stats (from cache or fallback)
  console.log('3) GET /api/afl/player-props/list?debugStats=1 (after refresh)');
  const listAfter = await get(`${BASE}/api/afl/player-props/list?debugStats=1`);
  if (!listAfter.ok) {
    console.error('List failed:', listAfter.status);
    process.exit(1);
  }
  const rowsAfter = listAfter.data?.data?.length ?? 0;
  const metaAfter = listAfter.data?._meta ?? {};
  const withStats = metaAfter.rowsWithStats ?? listAfter.data?.data?.filter((r) => r.last5Avg != null || r.seasonAvg != null).length;
  console.log('   Rows:', rowsAfter, '| With stats:', withStats);
  if (rowsAfter > 0 && withStats < rowsAfter) {
    console.log('   WARN: some rows still missing stats (fallback should have filled; check logs).');
  } else if (rowsAfter > 0) {
    console.log('   OK: all rows have stats (cache or fallback).');
  }
  console.log('');
  console.log('Done. Open', BASE + '/props', 'and switch to AFL tab to verify UI.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
