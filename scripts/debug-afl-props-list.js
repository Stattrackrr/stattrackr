#!/usr/bin/env node
/**
 * Debug what the AFL player-props list API actually returns.
 * Shows how many rows have L5/L10/H2H/Season/Streak/DvP so we can see if the stats cache is being used.
 *
 * Local (dev server must be running):
 *   npm run dev
 *   node scripts/debug-afl-props-list.js
 *
 * Production:
 *   BASE_URL=https://your-app.vercel.app node scripts/debug-afl-props-list.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function hasStat(r, key) {
  const v = r[key];
  if (v == null) return false;
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (typeof v === 'object' && v !== null) return true;
  return false;
}

async function main() {
  console.log('AFL Props List Debug');
  console.log('====================');
  console.log('Base URL:', BASE_URL);
  console.log('');

  const url = `${BASE_URL}/api/afl/player-props/list?debugStats=1`;
  console.log('Fetching:', url);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    console.error('Fetch failed:', err.message);
    console.log('\nMake sure the dev server is running (npm run dev) or set BASE_URL to your deployed app.');
    process.exit(1);
  }

  if (!res.ok) {
    console.error('Response:', res.status, res.statusText);
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      console.error('Body:', JSON.stringify(j, null, 2));
    } catch {
      console.error('Body:', text.slice(0, 500));
    }
    process.exit(1);
  }

  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  const games = Array.isArray(data?.games) ? data.games : [];

  console.log('Response: success =', !!data?.success);
  console.log('Games in cache:', games.length);
  console.log('Total rows (props):', rows.length);
  if (data?._meta) {
    const m = data._meta;
    console.log('');
    console.log('Stats cache diagnostic (_meta):');
    console.log('  uniqueCacheKeys:', m.uniqueCacheKeys);
    console.log('  cacheHits:', m.cacheHits);
    console.log('  rowsWithStats:', m.rowsWithStats);
    console.log('  cacheBackend:', m.cacheBackend);
    if (m.hint) console.log('  hint:', m.hint);
    console.log('');
  }

  if (rows.length === 0) {
    console.log('No props in list. Run /api/afl/odds/refresh to populate props cache.');
    if (data?.message) console.log('Message:', data.message);
    return;
  }

  const withLast5 = rows.filter((r) => hasStat(r, 'last5Avg'));
  const withLast10 = rows.filter((r) => hasStat(r, 'last10Avg'));
  const withH2H = rows.filter((r) => hasStat(r, 'h2hAvg'));
  const withSeason = rows.filter((r) => hasStat(r, 'seasonAvg'));
  const withStreak = rows.filter((r) => hasStat(r, 'streak'));
  const withDvp = rows.filter((r) => hasStat(r, 'dvpRating'));

  console.log('Stats coverage (from stats cache):');
  console.log('  last5Avg:  ', withLast5.length, '/', rows.length, withLast5.length ? `(${(100 * withLast5.length / rows.length).toFixed(1)}%)` : '');
  console.log('  last10Avg: ', withLast10.length, '/', rows.length, withLast10.length ? `(${(100 * withLast10.length / rows.length).toFixed(1)}%)` : '');
  console.log('  h2hAvg:    ', withH2H.length, '/', rows.length, withH2H.length ? `(${(100 * withH2H.length / rows.length).toFixed(1)}%)` : '');
  console.log('  seasonAvg: ', withSeason.length, '/', rows.length, withSeason.length ? `(${(100 * withSeason.length / rows.length).toFixed(1)}%)` : '');
  console.log('  streak:    ', withStreak.length, '/', rows.length, withStreak.length ? `(${(100 * withStreak.length / rows.length).toFixed(1)}%)` : '');
  console.log('  dvpRating: ', withDvp.length, '/', rows.length, withDvp.length ? `(${(100 * withDvp.length / rows.length).toFixed(1)}%)` : '');
  console.log('');

  const withAnyStat = rows.filter((r) =>
    hasStat(r, 'last5Avg') || hasStat(r, 'last10Avg') || hasStat(r, 'h2hAvg') || hasStat(r, 'seasonAvg')
  );
  const withNoStat = rows.filter((r) => !withAnyStat.includes(r));
  console.log('Rows WITH at least one of L5/L10/H2H/Season:', withAnyStat.length);
  console.log('Rows with NO stats (will show — in UI):', withNoStat.length);
  console.log('');

  if (withAnyStat.length > 0) {
    console.log('Sample row WITH stats:');
    const s = withAnyStat[0];
    console.log(JSON.stringify({
      playerName: s.playerName,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      statType: s.statType,
      line: s.line,
      last5Avg: s.last5Avg,
      last10Avg: s.last10Avg,
      h2hAvg: s.h2hAvg,
      seasonAvg: s.seasonAvg,
      streak: s.streak,
      dvpRating: s.dvpRating,
    }, null, 2));
    console.log('');
  }

  if (withNoStat.length > 0) {
    console.log('Sample row WITHOUT stats:');
    const s = withNoStat[0];
    console.log(JSON.stringify({
      playerName: s.playerName,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      statType: s.statType,
      line: s.line,
      overOdds: s.overOdds,
      underOdds: s.underOdds,
      last5Avg: s.last5Avg,
      last10Avg: s.last10Avg,
      h2hAvg: s.h2hAvg,
    }, null, 2));
    console.log('');
  }

  console.log('By game (first 5):');
  const byGame = new Map();
  for (const r of rows) {
    const k = `${r.homeTeam} vs ${r.awayTeam}`;
    if (!byGame.has(k)) byGame.set(k, { total: 0, withStats: 0 });
    byGame.get(k).total++;
    if (withAnyStat.includes(r)) byGame.get(k).withStats++;
  }
  let i = 0;
  for (const [game, counts] of byGame) {
    if (i++ >= 5) break;
    console.log(' ', game, '->', counts.withStats, '/', counts.total, 'rows with stats');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
