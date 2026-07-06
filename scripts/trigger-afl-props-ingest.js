#!/usr/bin/env node
/**
 * Trigger AFL props page ingest only (stats warm + enriched list + combined snapshot).
 * Mirrors the props-page steps in .github/workflows/afl-process-stats.yml — does NOT
 * fetch league stats, DvP rebuild, or odds refresh.
 *
 * Usage:
 *   PROD_URL=https://www.stattrackr.co CRON_SECRET=xxx node scripts/trigger-afl-props-ingest.js
 *   BASE_URL=http://localhost:3000 node scripts/trigger-afl-props-ingest.js   # local dev (no auth)
 */

require('dotenv').config({ path: '.env.local' });

const BASE_URL = (process.env.PROD_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const CRON_SECRET = (process.env.CRON_SECRET || '').replace(/\r\n|\r|\n/g, '').trim();
const WARM_TIMEOUT_MS = 11 * 60 * 1000;
const ENRICH_TIMEOUT_MS = 6 * 60 * 1000;

function authHeaders() {
  const headers = { Accept: 'application/json' };
  if (CRON_SECRET) {
    headers.Authorization = `Bearer ${CRON_SECRET}`;
    headers['X-Cron-Secret'] = CRON_SECRET;
  }
  return headers;
}

async function fetchJson(url, { timeoutMs = 120_000, method = 'GET' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: authHeaders(), cache: 'no-store', signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeList(data) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const withStats = rows.filter((r) => r.last5Avg != null || r.seasonAvg != null).length;
  return {
    games: data?.gamesCount ?? (Array.isArray(data?.games) ? data.games.length : 0),
    props: data?.propsCount ?? rows.length,
    withStats,
    na: rows.length - withStats,
    coveragePct: rows.length > 0 ? Math.round((withStats / rows.length) * 100) : 0,
    meta: data?._meta ?? null,
  };
}

async function main() {
  console.log('AFL props page ingest');
  console.log('=====================');
  console.log('Base URL:', BASE_URL);
  console.log('Cron auth:', CRON_SECRET ? 'yes' : 'no (local dev only)');
  console.log('');

  console.log('1) Warm AFL prop stats cache (/api/afl/props-stats/warm)...');
  const warm = await fetchJson(`${BASE_URL}/api/afl/props-stats/warm?skipListEnrich=1`, {
    timeoutMs: WARM_TIMEOUT_MS,
  });
  if (!warm.ok) {
    console.error('   FAIL HTTP', warm.status, warm.data?.error || warm.data?.hint || JSON.stringify(warm.data).slice(0, 300));
    if (warm.status === 401) {
      console.error('   Set CRON_SECRET for production (same as GitHub Actions secret).');
    }
    process.exit(1);
  }
  console.log(
    '   OK warmed=',
    warm.data?.warmed ?? '?',
    'failed=',
    warm.data?.failed ?? '?',
    'coverage=',
    `${warm.data?.coveragePct ?? '?'}%`,
    'total=',
    warm.data?.total ?? '?'
  );
  console.log('');

  console.log('2) Prewarm enriched AFL list (/api/afl/player-props/list?enrich=true)...');
  const enrich = await fetchJson(`${BASE_URL}/api/afl/player-props/list?enrich=true`, {
    timeoutMs: ENRICH_TIMEOUT_MS,
  });
  if (!enrich.ok) {
    console.error('   FAIL HTTP', enrich.status, enrich.data?.error || JSON.stringify(enrich.data).slice(0, 300));
    process.exit(1);
  }
  const enrichSummary = summarizeList(enrich.data);
  console.log(
    '   OK games=',
    enrichSummary.games,
    'props=',
    enrichSummary.props,
    'withStats=',
    enrichSummary.withStats,
    `(${enrichSummary.coveragePct}%)`
  );
  console.log('');

  console.log('3) Prewarm combined props snapshot (/api/props/combined)...');
  const combined = await fetchJson(`${BASE_URL}/api/props/combined`, { timeoutMs: ENRICH_TIMEOUT_MS });
  if (!combined.ok) {
    console.warn('   WARN HTTP', combined.status, combined.data?.error || '(combined prewarm failed — props tab may still work from enriched list)');
  } else {
    const aflProps = Array.isArray(combined.data?.afl?.props) ? combined.data.afl.props : [];
    const aflWithStats = aflProps.filter((r) => r.last5Avg != null || r.seasonAvg != null).length;
    console.log('   OK aflProps=', aflProps.length, 'withStats=', aflWithStats);
  }
  console.log('');

  console.log('4) Verify props page list (/api/afl/player-props/list?debugStats=1)...');
  const verify = await fetchJson(`${BASE_URL}/api/afl/player-props/list?debugStats=1`, { timeoutMs: 120_000 });
  if (!verify.ok) {
    console.error('   FAIL HTTP', verify.status);
    process.exit(1);
  }
  const verifySummary = summarizeList(verify.data);
  console.log('   games=', verifySummary.games, 'props=', verifySummary.props);
  console.log('   withStats=', verifySummary.withStats, 'na=', verifySummary.na, `(${verifySummary.coveragePct}%)`);
  if (verifySummary.meta) {
    console.log('   cacheHits=', verifySummary.meta.cacheHits, 'cacheMisses=', verifySummary.meta.cacheMisses);
    if (verifySummary.meta.hint) console.log('   hint:', verifySummary.meta.hint);
  }
  console.log('');

  if (verifySummary.withStats === 0 && verifySummary.props > 0) {
    console.error('❌ Props list still has 0 rows with stats. Check player logs warm and FootyWire availability.');
    process.exit(1);
  }

  if (verifySummary.coveragePct < 50 && verifySummary.props > 0) {
    console.warn(`⚠️ Stats coverage is low (${verifySummary.coveragePct}%). Props page may show N/A for some players.`);
    process.exit(0);
  }

  console.log('✅ AFL props page ingest complete. Reload /props?sport=afl');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
