#!/usr/bin/env node
/**
 * Debug why props page and dashboard show wrong teams.
 * Compares: (1) canonical games from Odds API, (2) games + props from list API.
 * Reports mismatches so we can see if gameId/home/away are wrong per row.
 *
 * Usage (dev server must be running for list API):
 *   node scripts/debug-afl-props-matchups.js
 *
 * With production:
 *   BASE_URL=https://www.stattrackr.co node scripts/debug-afl-props-matchups.js
 *
 * Requires: ODDS_API_KEY in .env.local for canonical games. BASE_URL for list API.
 */

require('dotenv').config({ path: '.env.local' });

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const AFL_SPORT_KEY = 'aussierules_afl';
const apiKey = process.env.ODDS_API_KEY?.trim();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function norm(t) {
  return (t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameTeam(a, b) {
  if (!a || !b) return false;
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function getCanonicalGames() {
  if (!apiKey) return null;
  const url = `${ODDS_API_BASE}/sports/${AFL_SPORT_KEY}/odds?regions=au&oddsFormat=american&markets=h2h,spreads,totals&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const events = await res.json();
  if (!Array.isArray(events)) return null;
  return events.map((e) => ({
    gameId: e.id,
    homeTeam: (e.home_team || '').trim(),
    awayTeam: (e.away_team || '').trim(),
    commenceTime: e.commence_time,
  }));
}

async function getListApiResponse() {
  try {
    const res = await fetch(`${BASE_URL}/api/afl/player-props/list?enrich=false`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('List API error:', e.message);
    return null;
  }
}

function main() {
  return (async () => {
    console.log('AFL props matchup debug\n');
    console.log('BASE_URL:', BASE_URL);
    console.log('');

    const canonical = await getCanonicalGames();
    if (canonical?.length) {
      console.log('--- Canonical games (Odds API) ---');
      canonical.forEach((g, i) => {
        console.log(`  ${i + 1}. ${g.gameId}  ${g.homeTeam} vs ${g.awayTeam}`);
      });
      console.log('');
    } else {
      console.log('(No canonical games from Odds API – set ODDS_API_KEY)\n');
    }

    const list = await getListApiResponse();
    if (!list) {
      console.log('List API failed or returned nothing.');
      process.exit(1);
    }

    const games = Array.isArray(list.games) ? list.games : [];
    const rows = Array.isArray(list.data) ? list.data : [];

    console.log('--- Games from list API (cache) ---');
    if (games.length === 0) {
      console.log('  (none)');
    } else {
      games.forEach((g, i) => {
        console.log(`  ${i + 1}. ${g.gameId}  ${g.homeTeam} vs ${g.awayTeam}`);
      });
    }
    console.log('');

    const gameById = new Map();
    games.forEach((g) => gameById.set(g.gameId, { homeTeam: g.homeTeam, awayTeam: g.awayTeam }));

    const canonicalById = new Map();
    if (canonical) canonical.forEach((g) => canonicalById.set(g.gameId, g));

    const mismatches = [];
    const rowsByGameId = new Map();

    rows.forEach((r) => {
      const id = r.gameId;
      if (!id) return;
      const g = gameById.get(id);
      if (!g) {
        mismatches.push({ type: 'unknown_gameId', gameId: id, playerName: r.playerName, homeTeam: r.homeTeam, awayTeam: r.awayTeam });
        return;
      }
      const rowHome = (r.homeTeam || '').trim();
      const rowAway = (r.awayTeam || '').trim();
      const gameHome = (g.homeTeam || '').trim();
      const gameAway = (g.awayTeam || '').trim();
      if (!sameTeam(rowHome, gameHome) || !sameTeam(rowAway, gameAway)) {
        mismatches.push({
          type: 'row_vs_game_mismatch',
          gameId: id,
          playerName: r.playerName,
          rowHome,
          rowAway,
          gameHome,
          gameAway,
        });
      }
      if (!rowsByGameId.has(id)) rowsByGameId.set(id, []);
      rowsByGameId.get(id).push({ playerName: r.playerName, homeTeam: r.homeTeam, awayTeam: r.awayTeam });
    });

    if (canonicalById.size > 0 && gameById.size > 0) {
      console.log('--- List API games vs canonical (Odds API) ---');
      let anyMismatch = false;
      for (const [id, g] of gameById) {
        const can = canonicalById.get(id);
        if (!can) {
          console.log(`  gameId ${id}: IN LIST BUT NOT IN ODDS API (stale?)  ${g.homeTeam} vs ${g.awayTeam}`);
          anyMismatch = true;
        } else if (!sameTeam(g.homeTeam, can.homeTeam) || !sameTeam(g.awayTeam, can.awayTeam)) {
          console.log(`  gameId ${id}: MISMATCH`);
          console.log(`    list API (cache): ${g.homeTeam} vs ${g.awayTeam}`);
          console.log(`    Odds API (canonical): ${can.homeTeam} vs ${can.awayTeam}`);
          anyMismatch = true;
        }
      }
      if (anyMismatch) {
        console.log('\n  → Fix: run the cron/refresh so cache is repopulated from current Odds API.');
        console.log('    Local: open /api/afl/odds/refresh or run node scripts/trigger-afl-odds-refresh.js');
        console.log('    Prod:  trigger the Vercel cron or call /api/afl/odds/refresh with CRON_SECRET');
      }
      console.log('');
    }

    console.log('--- Row vs game mismatch (row has different home/away than its gameId) ---');
    if (mismatches.length === 0) {
      console.log('  (none – every row’s home/away match its game in the list)');
    } else {
      const byType = {};
      mismatches.forEach((m) => {
        byType[m.type] = (byType[m.type] || 0) + 1;
      });
      console.log('  Total:', mismatches.length, byType);
      mismatches.slice(0, 20).forEach((m) => {
        if (m.type === 'row_vs_game_mismatch') {
          console.log(`  ${m.playerName} gameId=${m.gameId}`);
          console.log(`    row:    ${m.rowHome} vs ${m.rowAway}`);
          console.log(`    game:   ${m.gameHome} vs ${m.gameAway}`);
        } else {
          console.log(`  ${m.playerName} gameId=${m.gameId} (game not in list) ${m.homeTeam} vs ${m.awayTeam}`);
        }
      });
      if (mismatches.length > 20) console.log('  ... and', mismatches.length - 20, 'more');
    }
    console.log('');

    console.log('--- Rows per gameId (sample players) ---');
    for (const [id, listRows] of rowsByGameId) {
      const g = gameById.get(id);
      const gameStr = g ? `${g.homeTeam} vs ${g.awayTeam}` : '?';
      const sample = listRows.slice(0, 3).map((r) => r.playerName).join(', ');
      const first = listRows[0];
      const same = listRows.every((r) => sameTeam(r.homeTeam, first?.homeTeam) && sameTeam(r.awayTeam, first?.awayTeam));
      console.log(`  ${id}: ${gameStr}  (${listRows.length} rows) ${same ? '✓ same H/A' : '⚠ different H/A in rows'}  e.g. ${sample}`);
    }

    console.log('\nDone.');
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
