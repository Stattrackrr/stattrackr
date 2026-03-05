#!/usr/bin/env node

/**
 * Test FootyWire team selections scrape – see when we extract a working lineup.
 * Run with dev server up: npm run test:afl:team-selections  or  node scripts/test-footywire-team-selections.js
 *
 * Usage:
 *   node scripts/test-footywire-team-selections.js                    # use API (refresh=1), all round matches
 *   node scripts/test-footywire-team-selections.js --raw             # also show raw positions/interchange
 *   node scripts/test-footywire-team-selections.js --team="Geelong"   # lineup for match involving Geelong
 *   BASE_URL=https://your-app.vercel.app node scripts/test-footywire-team-selections.js
 */

const baseUrl = (process.env.BASE_URL || process.env.PROD_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
const showRaw = process.argv.includes('--raw');
const teamArg = process.argv.find((a) => a.startsWith('--team='));
const teamParam = teamArg ? decodeURIComponent(teamArg.slice(7)).trim() : null;

async function main() {
  const apiUrl = `${baseUrl}/api/afl/footywire-team-selections?refresh=1${teamParam ? `&team=${encodeURIComponent(teamParam)}` : ''}`;
  console.log('FootyWire Team Selections – lineup extraction test');
  console.log('  API:', apiUrl);
  console.log('');

  let res;
  try {
    res = await fetch(apiUrl, {
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    console.log('  ERROR: Could not reach API. Is the dev server running?');
    console.log('  ', e.message);
    process.exit(1);
  }

  const json = await res.json().catch(() => ({}));
  const ok = res.ok && !json.error;

  const matches = Array.isArray(json.matches) ? json.matches : [];
  const firstMatch = matches[0];
  const match = json.match ?? firstMatch?.match ?? null;
  const roundLabel = json.round_label ?? null;
  const homeTeam = json.home_team ?? firstMatch?.home_team ?? null;
  const awayTeam = json.away_team ?? firstMatch?.away_team ?? null;
  const positions = Array.isArray(json.positions) ? json.positions : (firstMatch?.positions ?? []);
  const interchange = json.interchange ?? firstMatch?.interchange ?? { home: [], away: [] };
  const interHome = Array.isArray(interchange.home) ? interchange.home : [];
  const interAway = Array.isArray(interchange.away) ? interchange.away : [];

  const posCount = positions.length;
  const interHomeCount = interHome.length;
  const interAwayCount = interAway.length;
  const totalPlayers = positions.reduce((s, r) => s + (r.home_players?.length ?? 0) + (r.away_players?.length ?? 0), 0) + interHomeCount + interAwayCount;

  const hasPositions = posCount >= 4;
  const hasInterchange = interHomeCount > 0 || interAwayCount > 0;
  const working = hasPositions || (posCount > 0 && totalPlayers >= 20);

  console.log('  Match / round');
  console.log('    Round:    ', roundLabel ?? '(none)');
  console.log('    Matches:  ', matches.length, 'game(s) in round');
  console.log('    Match:    ', match ?? '(none)');
  console.log('    Home/Away:', homeTeam ?? '(none)', '|', awayTeam ?? '(none)');
  console.log('');
  console.log('  Lineup');
  console.log('    Position rows: ', posCount);
  console.log('    Interchange:   ', interHomeCount, '(home) +', interAwayCount, '(away)');
  console.log('    Total players: ', totalPlayers);
  console.log('');

  if (working) {
    console.log('  ✅ WORKING LINEUP – extracted successfully.');
  } else {
    console.log('  ❌ NO LINEUP – could not extract (or insufficient data).');
  }

  if (json.error) {
    console.log('');
    console.log('  API error:', json.error);
  }

  if (showRaw && (positions.length > 0 || interHome.length > 0 || interAway.length > 0)) {
    console.log('');
    console.log('  --- Raw data ---');
    if (positions.length > 0) {
      console.log('  Positions:');
      positions.forEach((r, i) => {
        const h = (r.home_players ?? []).join(', ') || '—';
        const a = (r.away_players ?? []).join(', ') || '—';
        console.log(`    ${r.position}: home [${h}] | away [${a}]`);
      });
    }
    if (interHome.length > 0 || interAway.length > 0) {
      console.log('  Interchange home:', interHome.join(', ') || '—');
      console.log('  Interchange away:', interAway.join(', ') || '—');
    }
  }

  console.log('');
  process.exit(working ? 0 : 1);
}

main();
