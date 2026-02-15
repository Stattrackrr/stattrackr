#!/usr/bin/env node

/**
 * Fetch AFL team rankings from Footywire.
 * Scrapes Team Averages (TA) and Opponent Averages (OA).
 * Caches to data/afl-team-rankings-{year}-ta.json and afl-team-rankings-{year}-oa.json
 *
 *   node scripts/fetch-footywire-team-rankings.js
 *   node scripts/fetch-footywire-team-rankings.js --season=2025
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const FOOTYWIRE_BASE = 'https://www.footywire.com';

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function htmlToText(v) {
  return String(v || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const STAT_HEADERS = [
  'Rk', 'Team', 'Gm', 'K', 'HB', 'D', 'M', 'G', 'GA', 'I50', 'BH', 'T', 'HO', 'FF', 'FA', 'CL', 'CG', 'R50', 'AF', 'SC',
];
const STAT_LABELS = {
  Rk: 'Rank', Gm: 'Games', K: 'Kicks', HB: 'Handballs', D: 'Disposals', M: 'Marks', G: 'Goals',
  GA: 'Goal Assists', I50: 'Inside 50s', BH: 'Behinds', T: 'Tackles', HO: 'Hitouts', FF: 'Frees For', FA: 'Frees Against',
  CL: 'Clearances', CG: 'Clangers', R50: 'Rebound 50s', AF: 'AFL Fantasy', SC: 'Supercoach',
};

function parseTeamRankings(html) {
  const teams = [];
  // Find the table containing <td class="lbnorm">Team</td>
  const tableStart = html.indexOf('<td class="lbnorm">Team</td>');
  if (tableStart === -1) return { teams: [], statColumns: STAT_HEADERS };
  const tableEnd = html.indexOf('</table>', tableStart);
  const tableSection = tableEnd > tableStart
    ? html.substring(Math.max(0, tableStart - 500), tableEnd + 100)
    : html;

  const rowRegex = /<tr[^>]*(?:class="(?:dark|light)color")[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  const rows = [];
  while ((rowMatch = rowRegex.exec(tableSection))) {
    const row = rowMatch[1];
    if (row.includes('href="th-')) rows.push(row);
  }

  for (const rowHtml of rows) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 4) continue;

    const rankCell = htmlToText(cells[0]);
    const teamCell = cells[1];
    const teamLink = teamCell.match(/<a[^>]+href="[^"]*th-[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const teamName = teamLink ? htmlToText(teamLink[1]) : htmlToText(teamCell);
    if (!teamName || teamName.length < 2) continue;
    if (/^(team|rk|rank|#)$/i.test(teamName)) continue;

    const rank = parseInt(rankCell, 10);
    const team = {
      rank: Number.isFinite(rank) ? rank : null,
      team: teamName.trim(),
      stats: {},
    };
    for (let j = 0; j < STAT_HEADERS.length && j < cells.length; j++) {
      const key = STAT_HEADERS[j];
      const val = htmlToText(cells[j]);
      const num = parseFloat(val);
      team.stats[key] = Number.isFinite(num) ? num : (val || null);
    }
    teams.push(team);
  }

  return { teams, statColumns: STAT_HEADERS, statLabels: STAT_LABELS };
}

async function fetchOne(season, type) {
  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_team_rankings?year=${season}&type=${type}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  return { ok: res.ok, html: await res.text(), url };
}

async function main() {
  const year = new Date().getFullYear();
  let season = parseInt(getArg('season', String(year)), 10) || year;

  console.log(`Fetching Footywire team rankings for ${season}...`);

  let taRes = await fetchOne(season, 'TA');
  if (!taRes.ok && season === year) {
    const fallback = year - 1;
    console.log(`${season} not found. Trying ${fallback}...`);
    season = fallback;
    taRes = await fetchOne(season, 'TA');
  }
  if (!taRes.ok) {
    console.error(`Failed to fetch Team Averages: ${taRes.url}`);
    process.exit(1);
  }
  console.log(`  TA: ${taRes.url}`);

  const oaRes = await fetchOne(season, 'OA');
  if (!oaRes.ok) {
    console.error(`Failed to fetch Opponent Averages: ${oaRes.url}`);
    process.exit(1);
  }
  console.log(`  OA: ${oaRes.url}`);

  const taParsed = parseTeamRankings(taRes.html);
  const oaParsed = parseTeamRankings(oaRes.html);

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const write = (type, parsed) => {
    const output = {
      season,
      type,
      generatedAt: new Date().toISOString(),
      source: 'footywire.com',
      sourcePage: `ft_team_rankings?year=${season}&type=${type}`,
      teamCount: parsed.teams.length,
      statColumns: parsed.statColumns,
      statLabels: parsed.statLabels,
      teams: parsed.teams,
    };
    const outPath = path.join(dataDir, `afl-team-rankings-${season}-${type.toLowerCase()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
    return outPath;
  };

  write('ta', taParsed);
  write('oa', oaParsed);

  console.log(`\nWrote TA: ${taParsed.teams.length} teams`);
  console.log(`Wrote OA: ${oaParsed.teams.length} teams`);
  if (taParsed.teams.length > 0) {
    console.log('Teams:', taParsed.teams.map((t) => t.team).join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
