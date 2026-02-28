#!/usr/bin/env node

/**
 * Fetch AFL premiership ladder from FootyWire (wins, losses, points for/against, percentage).
 * Caches to data/afl-ladder-{year}.json
 *
 *   node scripts/fetch-footywire-ladder.js
 *   node scripts/fetch-footywire-ladder.js --season=2025
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

/** Read numeric value from cell HTML. */
function toNum(s) {
  if (s == null) return null;
  const t = htmlToText(s);
  const n = parseFloat(t.replace(/[,%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse FootyWire ft_ladder page. Table: Position, Team, Played, Win, Loss, Draw,
 * then Points (prem), For, Against, Percentage (order may vary).
 */
function parseLadder(html) {
  const teams = [];
  // Find table containing ladder - try lbnorm "Team" header first, then any table with ladder-like content
  let tableStart = html.indexOf('<td class="lbnorm">Team</td>');
  if (tableStart !== -1) tableStart = Math.max(0, tableStart - 800);
  else {
    tableStart = html.indexOf('ft_ladder');
    if (tableStart !== -1) {
      const tableOpen = html.lastIndexOf('<table', tableStart);
      if (tableOpen !== -1) tableStart = tableOpen;
    } else tableStart = html.indexOf('>Team<');
  }
  if (tableStart === -1) return { teams: [] };

  const tableEnd = html.indexOf('</table>', tableStart);
  const tableSection = tableEnd > tableStart
    ? html.substring(tableStart, tableEnd + 100)
    : html.substring(tableStart, tableStart + 12000);

  // Match table rows: FootyWire uses class="darkcolor" / "lightcolor", or plain <tr>
  let rowRegex = /<tr[^>]*(?:class="(?:dark|light)color")[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rows = [];
  while ((rowMatch = rowRegex.exec(tableSection))) {
    const row = rowMatch[1];
    const cellCount = (row.match(/<t[dh][^>]*>/gi) || []).length;
    if (row.includes('href="th-') || (cellCount >= 8 && row.includes('<td'))) rows.push(row);
  }
  if (rows.length === 0) {
    rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    rowMatch = null;
    while ((rowMatch = rowRegex.exec(tableSection))) {
      const row = rowMatch[1];
      const cellCount = (row.match(/<t[dh][^>]*>/gi) || []).length;
      if (cellCount >= 8 && row.includes('<td') && !row.includes('<th')) rows.push(row);
    }
  }

  for (const rowHtml of rows) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 5) continue;

    const pos = parseInt(htmlToText(cells[0]), 10);
    const teamCell = cells[1];
    const teamLink = teamCell.match(/<a[^>]+href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    let teamName = teamLink ? htmlToText(teamLink[1]) : htmlToText(teamCell);
    teamName = (teamName || '').trim();
    if (!teamName || teamName.length < 2) continue;
    if (/^(team|pos|#|rank|played|win|loss|draw|for|against|%|pts?)$/i.test(teamName)) continue;

    // Cells 2+: Played, W, L, D, then Pts, PF, PA, Pct (order on FootyWire may be P, W, L, D, PF, PA, %, Pts)
    const nums = cells.slice(2).map((cell) => toNum(cell));
    let played = null;
    let win = null;
    let loss = null;
    let draw = null;
    let premiership_points = null;
    let points_for = null;
    let points_against = null;
    let percentage = null;

    for (let i = 0; i < nums.length; i++) {
      const v = nums[i];
      if (v == null) continue;
      if (v >= 0 && v <= 25 && Number.isInteger(v) && played == null) played = v;
      else if (v >= 0 && v <= 25 && Number.isInteger(v) && win == null && played != null) win = v;
      else if (v >= 0 && v <= 25 && Number.isInteger(v) && loss == null) loss = v;
      else if (v >= 0 && v <= 5 && Number.isInteger(v) && draw == null) draw = v;
      else if (v >= 50 && v <= 150) percentage = v;
      else if (v >= 0 && v <= 88 && Number.isInteger(v)) premiership_points = v;
      else if (v > 100 && v < 4000 && points_for == null) points_for = v;
      else if (v > 100 && v < 4000 && points_against == null) points_against = v;
    }

    const computedPts = (win ?? 0) * 4 + (draw ?? 0) * 2;
    teams.push({
      pos: Number.isFinite(pos) ? pos : teams.length + 1,
      team: teamName.trim(),
      played: played ?? 0,
      win: win ?? 0,
      loss: loss ?? 0,
      draw: draw ?? 0,
      points_for: points_for ?? null,
      points_against: points_against ?? null,
      percentage: percentage ?? null,
      premiership_points: computedPts > 0 ? computedPts : (premiership_points != null && premiership_points <= 88 ? premiership_points : null),
    });
  }

  return { teams };
}

async function fetchLadder(season) {
  // FootyWire loads ladder via AJAX. Try JSON endpoint that returns the table HTML fragment.
  const url = `${FOOTYWIRE_BASE}/afl/json/json-sort-stats-ladder.json`;
  const body = new URLSearchParams({
    sby: '8',
    template: 'ladder',
    advv: 'N',
    skipImg: 'Y',
    year: String(season),
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json, text/javascript',
      Referer: `https://www.footywire.com/afl/footy/ft_ladder?year=${season}`,
    },
    body: body.toString(),
  });
  const text = await res.text();
  let html = text;
  try {
    const json = JSON.parse(text);
    if (json.sortBy) html = json.sortBy;
  } catch (_) {}
  return { ok: res.ok, html, url };
}

async function main() {
  const year = new Date().getFullYear();
  let season = parseInt(getArg('season', String(year)), 10) || year;

  console.log(`Fetching FootyWire AFL ladder for ${season}...`);

  let res = await fetchLadder(season);
  if (!res.ok && season === year) {
    const fallback = year - 1;
    console.log(`${season} not found. Trying ${fallback}...`);
    season = fallback;
    res = await fetchLadder(season);
  }
  if (!res.ok) {
    console.error(`Failed to fetch ladder: ${res.url}`);
    process.exit(1);
  }

  const parsed = parseLadder(res.html);
  if (parsed.teams.length === 0) {
    const debugPath = path.join(process.cwd(), 'data', 'debug-ladder-snippet.html');
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const snippet = res.html.substring(0, 40000);
    fs.writeFileSync(debugPath, snippet, 'utf8');
    console.error('No ladder rows parsed. Page structure may have changed. Wrote debug snippet to data/debug-ladder-snippet.html');
    process.exit(1);
  }

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const sorted = [...parsed.teams].sort((a, b) => {
    const ptsA = a.premiership_points ?? 0;
    const ptsB = b.premiership_points ?? 0;
    if (ptsB !== ptsA) return ptsB - ptsA;
    return (b.percentage ?? 0) - (a.percentage ?? 0);
  });
  sorted.forEach((t, i) => { t.pos = i + 1; });

  const output = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'footywire.com',
    sourcePage: `ft_ladder?year=${season}`,
    teams: sorted,
  };
  const outPath = path.join(dataDir, `afl-ladder-${season}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`Wrote ${parsed.teams.length} teams to ${outPath}`);
  console.log('Teams:', parsed.teams.map((t) => t.team).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
