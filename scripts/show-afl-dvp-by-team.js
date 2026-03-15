#!/usr/bin/env node

/**
 * Show what each team should show for DvP (per position): team totals from the built file.
 * Use to verify the app will display the "big" numbers (per team game) not per-player.
 *
 * Usage:
 *   node scripts/show-afl-dvp-by-team.js
 *   node scripts/show-afl-dvp-by-team.js --season=2026
 *   node scripts/show-afl-dvp-by-team.js --season=2025 --position=MID
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
  const filePath = path.join(process.cwd(), 'data', `afl-dvp-${season}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'];
const SHOW_STATS = ['disposals', 'goals', 'marks', 'kicks'];

function main() {
  const season = parseInt(getArg('season', '2026'), 10) || 2026;
  const positionFilter = (getArg('position', '') || '').toUpperCase();

  const data = loadDvpFile(season);
  if (!data || !Array.isArray(data.rows) || !data.rows.length) {
    console.log(`No data for ${season}. Run: npm run build:afl:dvp:local (with dev server up).`);
    process.exit(1);
  }

  const positions = positionFilter ? [positionFilter] : POSITIONS;
  const rows = data.rows.filter((r) => positions.includes((r.position || '').toUpperCase()));
  const byTeam = new Map();
  for (const r of rows) {
    const opp = (r.opponent || '').trim();
    if (!opp) continue;
    if (!byTeam.has(opp)) byTeam.set(opp, []);
    byTeam.get(opp).push(r);
  }

  const teams = [...byTeam.keys()].sort((a, b) => a.localeCompare(b));
  const MIN_TEAM_DISPOSALS = 60;

  console.log(`\nDvP ${season} – what each team should show (team totals per game)\n`);
  console.log('Per-team table: disposals, goals, marks, kicks = per team game (what the UI should show).');
  console.log('If disposals < 60 in file, batch API recomputes from totals/teamGames or perPlayer*sampleSize/teamGames.\n');

  for (const pos of positions) {
    const posRows = rows.filter((r) => (r.position || '').toUpperCase() === pos);
    if (!posRows.length) {
      console.log(`[${pos}] No rows.\n`);
      continue;
    }
    console.log(`--- ${pos} ---`);
    const header = ['Team', 'Gm', 'N', 'Disp', 'Goals', 'Marks', 'Kicks', 'OK?'];
    const colWidths = [22, 4, 5, 8, 7, 7, 7, 5];
    console.log(header.map((h, i) => h.padEnd(colWidths[i])).join(' '));
    console.log('-'.repeat(65));

    for (const team of teams) {
      const r = posRows.find((x) => (x.opponent || '').trim() === team);
      if (!r) {
        console.log(team.padEnd(22), '  -     -     -     -     -  ');
        continue;
      }
      const tg = r.teamGames ?? 0;
      const n = r.sampleSize ?? 0;
      const pt = r.perTeamGame || {};
      const disp = pt.disposals;
      const goals = pt.goals;
      const marks = pt.marks;
      const kicks = pt.kicks;
      const ok = typeof disp === 'number' && disp >= MIN_TEAM_DISPOSALS ? 'Y' : '~';
      console.log(
        team.slice(0, 21).padEnd(22),
        String(tg).padStart(4),
        String(n).padStart(5),
        (typeof disp === 'number' ? disp.toFixed(1) : '-').padStart(8),
        (typeof goals === 'number' ? goals.toFixed(1) : '-').padStart(7),
        (typeof marks === 'number' ? marks.toFixed(1) : '-').padStart(7),
        (typeof kicks === 'number' ? kicks.toFixed(1) : '-').padStart(7),
        ok.padStart(5)
      );
    }
    console.log('');
  }

  console.log('Gm = team games, N = sample size (player-games). OK? = Y if disposals already team total (≥60), ~ if batch will fix.');
  console.log('');
}

main();
