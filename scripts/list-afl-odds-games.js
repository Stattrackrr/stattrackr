#!/usr/bin/env node
/**
 * List games the Odds API has for AFL (same source that feeds our props).
 * Use to see exactly which matchups exist and their IDs/commence times.
 *
 * Usage (from project root):
 *   node scripts/list-afl-odds-games.js
 *
 * Optional: also show what our props list API returns (cache):
 *   BASE_URL=http://localhost:3000 node scripts/list-afl-odds-games.js
 *
 * Requires: ODDS_API_KEY in .env.local (or env).
 */

require('dotenv').config({ path: '.env.local' });

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT_KEY = 'aussierules_afl';
const apiKey = process.env.ODDS_API_KEY?.trim();
const BASE_URL = process.env.BASE_URL || '';

if (!apiKey) {
  console.error('ODDS_API_KEY not set. Add it to .env.local or set the env var.');
  process.exit(1);
}

async function fromOddsApi() {
  const url = `${ODDS_API_BASE}/sports/${AFL_SPORT_KEY}/odds?regions=au&oddsFormat=american&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  if (remaining != null) console.log('Odds API x-requests-remaining:', remaining);
  if (!res.ok) {
    console.error('Odds API error:', res.status, await res.text().then((t) => t.slice(0, 200)));
    return null;
  }
  const events = await res.json();
  return Array.isArray(events) ? events : null;
}

async function fromPropsListApi() {
  if (!BASE_URL) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/afl/player-props/list?enrich=false`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.games ?? null;
  } catch (e) {
    console.error('Props list API error:', e.message);
    return null;
  }
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return iso;
  }
}

async function main() {
  console.log('AFL games from The Odds API (source for our props)\n');

  const events = await fromOddsApi();
  if (!events || events.length === 0) {
    console.log('No events returned from Odds API.');
    if (BASE_URL) {
      const games = await fromPropsListApi();
      if (games?.length) {
        console.log('\nGames from props list API (cache):', games.length);
        games.forEach((g, i) => {
          console.log(`  ${i + 1}. ${g.homeTeam ?? '—'} vs ${g.awayTeam ?? '—'}  (${g.gameId ?? '—'})  ${formatTime(g.commenceTime)}`);
        });
      }
    }
    return;
  }

  console.log('Events (games) count:', events.length);
  console.log('');
  console.log('#   gameId (id)                    home_team              away_team               commence_time');
  console.log('-'.repeat(100));
  events.forEach((ev, i) => {
    const id = (ev.id ?? '').slice(0, 28);
    const home = (ev.home_team ?? '—').padEnd(22);
    const away = (ev.away_team ?? '—').padEnd(22);
    const time = formatTime(ev.commence_time);
    console.log(`${String(i + 1).padStart(2)}  ${id}  ${home}  ${away}  ${time}`);
  });

  if (BASE_URL) {
    const games = await fromPropsListApi();
    if (games?.length) {
      console.log('\n--- Games from our props list API (cache) ---');
      console.log('Count:', games.length);
      games.forEach((g, i) => {
        console.log(`  ${i + 1}. ${g.homeTeam ?? '—'} vs ${g.awayTeam ?? '—'}  gameId=${g.gameId ?? '—'}  ${formatTime(g.commenceTime)}`);
      });
    } else {
      console.log('\n(Props list API not reached or returned no games. Start dev server and set BASE_URL=http://localhost:3000 to compare.)');
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
