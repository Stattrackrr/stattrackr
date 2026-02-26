#!/usr/bin/env node

/**
 * Fetch AFL league player stats (season averages) from FootyWire player rankings.
 * Merges multiple stat pages into one dataset. Caches to data/afl-league-player-stats-{year}.json
 *
 *   node scripts/fetch-footywire-league-player-stats.js
 *   node scripts/fetch-footywire-league-player-stats.js --season=2025
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
    .replace(/\s+/g, ' ')
    .trim();
}

// FootyWire ft_player_rankings: rt=LA (League Averages), st= stat code, year= season
// Player links use pp-[team]--[player], not tp-. Stat codes: GO=Goals, HB=Handballs, etc.
const STAT_PAGES = [
  { key: 'disposals', st: 'DI' },
  { key: 'kicks', st: 'KI' },
  { key: 'handballs', st: 'HB' },
  { key: 'marks', st: 'MA' },
  { key: 'goals', st: 'GO' },
  { key: 'tackles', st: 'TA' },
  { key: 'clearances', st: 'CL' },
  { key: 'inside_50s', st: 'I5' },
  { key: 'rebound_50s', st: 'R5' },
];

// Find the table that contains pp- player links: locate first pp-, then find the <table> that contains it
function findRankingsTable(html) {
  const ppIdx = html.indexOf('pp-');
  if (ppIdx < 0) return null;
  const tableStart = html.lastIndexOf('<table', ppIdx);
  if (tableStart < 0) return null;
  let depth = 1;
  const re = /<table|<\/table>/gi;
  re.lastIndex = html.indexOf('>', tableStart) + 1;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].toLowerCase() === '</table>') {
      depth--;
      if (depth === 0) return html.substring(tableStart, m.index + 8);
    } else depth++;
  }
  return null;
}

function parsePlayerRankingsTable(html, statKey) {
  const rows = [];
  const tableHtml = findRankingsTable(html);
  if (!tableHtml) return rows;

  // Match data rows (FootyWire often uses dark/light color classes) or any row with a pp- link
  const rowRegex = /<tr[^>]*(?:class="[^"]*(?:dark|light)color[^"]*"[^>]*)?>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml))) {
    const row = rowMatch[1];
    // FootyWire uses href="pp-team--player" (no leading slash)
    const playerLink = row.match(/<a[^>]+href=['"]([^'"]*pp-[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
    if (!playerLink) continue;
    const name = htmlToText(playerLink[2]).trim();
    if (!name || name.length < 2) continue;
    if (/^(player|rank|#|name)$/i.test(name)) continue;
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(row))) cells.push(htmlToText(c[1]).trim());
    if (cells.length < 4) continue;
    // Value: last column is usually the stat (avg or total); also try 4th and 5th
    let valueNum = parseFloat(cells[cells.length - 1]);
    if (!Number.isFinite(valueNum) && cells.length >= 5) valueNum = parseFloat(cells[4]);
    if (!Number.isFinite(valueNum) && cells.length >= 4) valueNum = parseFloat(cells[3]);
    if (!Number.isFinite(valueNum)) continue;
    const gamesNum = parseInt(cells[3], 10);
    const team = (cells[2] || '').trim();
    rows.push({
      name,
      team: team || '—',
      games: Number.isFinite(gamesNum) ? gamesNum : 0,
      [statKey]: valueNum,
    });
  }
  return rows;
}

function mergeByPlayer(statArrays) {
  const byKey = new Map();
  for (const arr of statArrays) {
    for (const row of arr) {
      const key = `${String(row.name).toLowerCase().trim()}|${String(row.team).toLowerCase().trim()}`;
      let existing = byKey.get(key);
      if (!existing) {
        existing = {
          name: row.name,
          team: row.team,
          games: row.games || 0,
          disposals: 0,
          kicks: 0,
          handballs: 0,
          marks: 0,
          goals: 0,
          tackles: 0,
          clearances: 0,
          inside_50s: 0,
          rebound_50s: 0,
        };
        byKey.set(key, existing);
      }
      if (row.games && row.games > existing.games) existing.games = row.games;
      const statKey = Object.keys(row).find((k) => !['name', 'team', 'games'].includes(k));
      if (statKey && existing.hasOwnProperty(statKey)) existing[statKey] = row[statKey];
    }
  }
  return Array.from(byKey.values());
}

async function fetchOne(season, st) {
  const url = `${FOOTYWIRE_BASE}/afl/footy/ft_player_rankings?year=${season}&rt=LA&st=${st}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-AU,en;q=0.9',
      Referer: 'https://www.footywire.com/',
    },
  });
  return { ok: res.ok, html: await res.text(), url };
}

const DEBUG_HTML = process.argv.includes('--debug-html');

async function fetchSeason(season) {
  const allStats = [];
  for (const { key, st } of STAT_PAGES) {
    const { ok, html, url } = await fetchOne(season, st);
    if (!ok) {
      console.warn(`  Skipping ${key} (st=${st}): request failed`);
      continue;
    }
    if (DEBUG_HTML && key === 'disposals') {
      const ppIdx = html.indexOf('pp-');
      const tableHtml = findRankingsTable(html);
      const outPath = path.join(process.cwd(), 'data', 'debug-league-rankings-snippet.html');
      const snippet = ppIdx >= 0 ? html.substring(Math.max(0, ppIdx - 500), ppIdx + 3000) : (tableHtml || html).substring(0, 8000);
      fs.writeFileSync(outPath, `<!-- ${url} ppIdx=${ppIdx} -->\n${snippet}`, 'utf8');
      console.log(`  Debug: wrote ${outPath} (pp- count: ${(html.match(/pp-/g) || []).length}, tableHtml length: ${tableHtml ? tableHtml.length : 0})`);
    }
    const rows = parsePlayerRankingsTable(html, key);
    if (rows.length === 0) {
      console.warn(`  No rows for ${key} (st=${st}). Page structure may have changed.`);
      continue;
    }
    console.log(`  ${key}: ${rows.length} players`);
    allStats.push(rows);
  }
  return allStats;
}

async function main() {
  const year = new Date().getFullYear();
  let season = parseInt(getArg('season', String(year)), 10) || year;

  console.log(`Fetching FootyWire league player stats for ${season}...`);
  let allStats = await fetchSeason(season);

  if (allStats.length === 0 && season === year && season > 2020) {
    const fallback = season - 1;
    console.log(`No data for ${season}; trying previous season ${fallback}...`);
    season = fallback;
    allStats = await fetchSeason(season);
  }

  const players = mergeByPlayer(allStats);
  const minGames = 1;
  const filtered = players.filter((p) => p.games >= minGames && (p.disposals > 0 || p.kicks > 0 || p.handballs > 0));

  const out = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'footywire.com',
    sourcePage: 'ft_player_rankings (rt=LA, multiple st=)',
    playerCount: filtered.length,
    players: filtered,
  };

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, `afl-league-player-stats-${season}.json`);
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Wrote ${filePath} (${filtered.length} players)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
