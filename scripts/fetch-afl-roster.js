#!/usr/bin/env node

/**
 * Fetch AFL players with stats for a season from AFLTables (scrape only).
 * Uses the season "Player Totals" page (e.g. 2025a.html) - one page, no per-player checks.
 * Caches to data/afl-roster-2025.json. No API-Sports used.
 *
 *   node scripts/fetch-afl-roster.js
 *   node scripts/fetch-afl-roster.js --season=2025
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const AFL_TABLES_BASE = 'https://afltables.com';
const STATS_BASE = `${AFL_TABLES_BASE}/afl/stats`;

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

/** "Last, First" -> "First Last" for search display */
function toDisplayName(lastFirst) {
  const s = String(lastFirst || '').trim();
  const comma = s.indexOf(',');
  if (comma <= 0) return s;
  const last = s.slice(0, comma).trim();
  const first = s.slice(comma + 1).trim();
  return first && last ? `${first} ${last}` : s;
}

/**
 * Parse the season Player Totals page (e.g. 2025a.html).
 * Table rows: first cell = player link, second cell = team (TM) abbreviation.
 */
function parseSeasonTotalsPage(html, baseUrl) {
  const out = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 2) continue;
    const firstCell = cells[0];
    const linkMatch = firstCell.match(/<a[^>]+href=['"]([^'"]*players\/[A-Za-z0-9]\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const linkText = htmlToText(linkMatch[2]);
    if (!linkText) continue;
    const team = htmlToText(cells[1]) || '';
    let href = linkMatch[1];
    if (!href.startsWith('http')) {
      if (href.startsWith('/')) href = `${AFL_TABLES_BASE}${href}`;
      else if (href.startsWith('../')) href = `${AFL_TABLES_BASE}/afl/${href.slice(3)}`;
      else href = `${baseUrl}/${href}`;
    }
    const displayName = toDisplayName(linkText);
    out.push({ name: displayName, team, href });
  }
  return out;
}

async function main() {
  const year = new Date().getFullYear();
  const requestedSeason = parseInt(getArg('season', String(year)), 10) || year;

  let season = requestedSeason;
  let res = await fetch(`${STATS_BASE}/${season}a.html`);
  if (!res.ok && requestedSeason === year) {
    const fallback = year - 1;
    console.log(`${year}a.html not found (404). Trying ${fallback}...`);
    res = await fetch(`${STATS_BASE}/${fallback}a.html`);
    if (res.ok) season = fallback;
  }
  if (!res.ok) {
    console.error(`Failed to fetch: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  console.log(`Fetching ${season} Player Totals from AFLTables (one page)...`);
  console.log(`  ${STATS_BASE}/${season}a.html`);

  const html = await res.text();
  const entries = parseSeasonTotalsPage(html, STATS_BASE);

  const seen = new Map();
  const byTeam = new Map();
  for (const e of entries) {
    const key = e.name.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) {
      seen.set(key, { name: e.name, team: e.team });
      const t = e.team || '?';
      byTeam.set(t, (byTeam.get(t) || 0) + 1);
    }
  }
  const players = Array.from(seen.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((p) => (p.team ? { name: p.name, team: p.team } : { name: p.name }));

  const output = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'afltables.com',
    sourcePage: `${season}a.html`,
    playerCount: players.length,
    players,
  };

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const outPath = path.join(dataDir, `afl-roster-${season}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\nWrote ${output.playerCount} players to ${outPath}`);
  const sortedTeams = [...byTeam.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  console.log('\nBy team:');
  for (const [team, count] of sortedTeams) {
    console.log(`  ${team}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
