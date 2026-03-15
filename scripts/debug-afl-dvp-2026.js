#!/usr/bin/env node

/**
 * Debug why 2026 DvP returns small numbers (e.g. 25.5 disposals) instead of team totals (e.g. 150).
 * Compares 2025 vs 2026 for the same opponent/position (e.g. GWS vs MID).
 *
 * Usage:
 *   node scripts/debug-afl-dvp-2026.js
 *   node scripts/debug-afl-dvp-2026.js --opponent=Giants --position=MID
 *   node scripts/debug-afl-dvp-2026.js --fetch  # hit API when local 2026 file missing (dev or prod)
 *   node scripts/debug-afl-dvp-2026.js --fetch --base-url=https://your-app.vercel.app  # debug prod (2026 lives in Redis)
 */

const fs = require('fs');
const path = require('path');

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function loadDvpFile(season) {
  const dataDir = path.join(process.cwd(), 'data');
  const filePath = path.join(dataDir, `afl-dvp-${season}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to read ${filePath}:`, e.message);
    return null;
  }
}

function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

async function fetchBatch(baseUrl, season, position) {
  const url = `${baseUrl}/api/afl/dvp/batch?season=${season}&position=${position}&stats=disposals,kicks,marks,goals,tackles`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('  Fetch error:', e.message);
    return null;
  }
}

function main() {
  const opponentFilter = norm(getArg('opponent', 'gws'));
  const positionFilter = (getArg('position', 'MID') || 'MID').toUpperCase();
  const doFetch = process.argv.includes('--fetch');
  const baseUrl = (getArg('base-url', '') || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  console.log('AFL DvP 2026 debug – why team totals might show as per-player\n');
  console.log(`Filter: opponent contains "${opponentFilter}", position = ${positionFilter}\n`);

  (async () => {
  for (const season of [2025, 2026]) {
    let data = loadDvpFile(season);
    if (!data && doFetch && season === 2026) {
      console.log(`[${season}] No local file; fetching from ${baseUrl}...`);
      data = await fetchBatch(baseUrl, season, positionFilter);
      if (data?.success && data.metrics) {
        const opponents = data.opponents || [];
        const oppKey = opponents.find((o) => norm(o).includes(opponentFilter) || opponentFilter.includes(norm(o)));
        if (oppKey) {
          console.log(`  API teamTotalValues for "${oppKey}" (from batch):`);
          for (const [stat, m] of Object.entries(data.metrics)) {
            const v = m.teamTotalValues?.[oppKey];
            const r = m.teamTotalRanks?.[oppKey];
            console.log(`    ${stat}: ${v} (rank #${r})`);
          }
          console.log('');
        } else {
          console.log('  Opponent not found in API opponents:', opponents.slice(0, 5).join(', '), '...');
          console.log('');
        }
      } else {
        console.log('  API returned no data or error.');
        console.log('');
      }
      continue;
    }
    if (!data) {
      console.log(`[${season}] No local file (data/afl-dvp-${season}.json)`);
      if (season === 2026) {
        const rankPath = path.join(process.cwd(), 'data', 'afl-team-rankings-2026-oa.json');
        if (fs.existsSync(rankPath)) {
          try {
            const rank = JSON.parse(fs.readFileSync(rankPath, 'utf8'));
            const teams = rank.teams || [];
            const gws = teams.find((t) => norm(t.team || '').includes('gws') || norm(t.team || '').includes('giant'));
            if (gws) {
              const gm = gws.stats?.Gm ?? gws.stats?.gm;
              console.log(`  Rankings file (2026 OA) has ${teams.length} teams; GWS/Giants Gm (games): ${gm ?? '?'}`);
              console.log('  Build would use this as teamGames → perTeamGame = totals/teamGames (big number if Gm is 2–5).');
            }
          } catch (e) {
            console.log('  Could not read rankings file:', e.message);
          }
        } else {
          console.log('  No data/afl-team-rankings-2026-oa.json – build on server would use inferredGames (distinct games).');
        }
        if (!doFetch) console.log('  Run with --fetch to try API (dev server or BASE_URL).');
      }
      console.log('');
      continue;
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const matches = rows.filter(
      (r) =>
        (r.position || '').toUpperCase() === positionFilter &&
        (norm(r.opponent).includes(opponentFilter) || opponentFilter.includes(norm(r.opponent)))
    );

    console.log(`[${season}] File: data/afl-dvp-${season}.json`);
    console.log(`  Rows for ${positionFilter} matching "${opponentFilter}": ${matches.length}`);
    if (matches.length === 0) {
      console.log('');
      continue;
    }

    for (const r of matches) {
      const teamGames = r.teamGames ?? '?';
      const sampleSize = r.sampleSize ?? '?';
      const totals = r.totals || {};
      const perPlayer = r.perPlayerGame || {};
      const perTeam = r.perTeamGame || {};
      const dispTotal = totals.disposals;
      const dispPerPlayer = perPlayer.disposals;
      const dispPerTeam = perTeam.disposals;

      console.log(`  Opponent: ${r.opponent}`);
      console.log(`  teamGames: ${teamGames}  sampleSize: ${sampleSize}`);
      console.log(`  disposals – totals: ${dispTotal}  perPlayerGame: ${dispPerPlayer}  perTeamGame: ${dispPerTeam}`);
      if (typeof teamGames === 'number' && teamGames > 0 && typeof dispTotal === 'number') {
        const expected = Math.round((dispTotal / teamGames) * 100) / 100;
        console.log(`  expected perTeamGame (totals/teamGames): ${expected}`);
      }
      console.log('');
    }
  }

  console.log('Interpretation:');
  console.log('  - perTeamGame should be the BIG number (e.g. ~150 disposals per team game).');
  console.log('  - If perTeamGame is small (~25), either teamGames is too large or perTeamGame was never set.');
  console.log('  - 2026 build uses teamGames from rankings file or inferredGames (distinct games).');
  console.log('  - If rankings file is missing on build, we use inferredGames; if that were wrong you’d see wrong totals.');
  })();
}

main();
