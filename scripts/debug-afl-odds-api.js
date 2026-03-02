#!/usr/bin/env node
/**
 * Call The Odds API directly and dump raw response for AFL.
 * Shows exactly what market keys and structure the API returns (so we can fix spreads/totals).
 *
 * Usage (from project root):
 *   node scripts/debug-afl-odds-api.js
 *
 * Requires ODDS_API_KEY in .env.local (or set in env).
 */

require('dotenv').config({ path: '.env.local' });

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT_KEY = 'aussierules_afl';
const apiKey = process.env.ODDS_API_KEY?.trim();

if (!apiKey) {
  console.error('ODDS_API_KEY not set. Add it to .env.local or set the env var.');
  process.exit(1);
}

async function main() {
  const url = `${ODDS_API_BASE}/sports/${AFL_SPORT_KEY}/odds?regions=au&oddsFormat=american&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;
  console.log('Fetching:', url.replace(apiKey, '***'));
  console.log('');

  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  console.log('Response status:', res.status);
  console.log('x-requests-remaining:', remaining);
  console.log('x-requests-used:', used);
  console.log('');

  const events = await res.json();
  if (!Array.isArray(events)) {
    console.log('Response (not an array):', JSON.stringify(events, null, 2).slice(0, 1500));
    return;
  }

  console.log('Events count:', events.length);
  if (events.length === 0) {
    console.log('No events returned.');
    return;
  }

  const first = events[0];
  console.log('');
  console.log('First event:');
  console.log('  id:', first.id);
  console.log('  home_team:', first.home_team);
  console.log('  away_team:', first.away_team);
  console.log('  commence_time:', first.commence_time);
  console.log('  bookmakers count:', first.bookmakers?.length ?? 0);
  console.log('');

  if (!first.bookmakers?.length) {
    console.log('No bookmakers in first event.');
    return;
  }

  console.log('--- First bookmaker (raw) ---');
  const b = first.bookmakers[0];
  console.log('  key:', b.key);
  console.log('  title:', b.title);
  console.log('  markets count:', b.markets?.length ?? 0);
  if (b.markets?.length) {
    for (const m of b.markets) {
      console.log('');
      console.log('  Market key:', JSON.stringify(m.key));
      console.log('  outcomes count:', m.outcomes?.length ?? 0);
      if (m.outcomes?.length) {
        m.outcomes.forEach((o, i) => {
          console.log('    outcome[' + i + ']:', JSON.stringify({ name: o.name, price: o.price, point: o.point }));
        });
      }
    }
  }
  console.log('');
  console.log('--- All market keys per bookmaker ---');
  for (let i = 0; i < first.bookmakers.length; i++) {
    const keys = (first.bookmakers[i].markets || []).map((m) => m.key);
    console.log('  ', first.bookmakers[i].title, ':', keys.join(', ') || '(none)');
  }

  console.log('');
  console.log('--- First bookmaker that has "spreads" (full market) ---');
  let found = null;
  for (const b of first.bookmakers) {
    const m = (b.markets || []).find((x) => x.key === 'spreads');
    if (m) {
      found = { bookmaker: b.title, market: m };
      break;
    }
  }
  if (found) {
    console.log('  Bookmaker:', found.bookmaker);
    console.log('  Market key:', found.market.key);
    console.log('  Outcomes:', JSON.stringify(found.market.outcomes, null, 4));
  } else {
    console.log('  (no bookmaker has spreads in this event)');
  }

  console.log('');
  console.log('--- First bookmaker that has "totals" (full market) ---');
  found = null;
  for (const b of first.bookmakers) {
    const m = (b.markets || []).find((x) => x.key === 'totals');
    if (m) {
      found = { bookmaker: b.title, market: m };
      break;
    }
  }
  if (found) {
    console.log('  Bookmaker:', found.bookmaker);
    console.log('  Market key:', found.market.key);
    console.log('  Outcomes:', JSON.stringify(found.market.outcomes, null, 4));
  } else {
    console.log('  (no bookmaker has totals in this event)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
