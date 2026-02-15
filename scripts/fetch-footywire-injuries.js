#!/usr/bin/env node

/**
 * Fetch AFL injury list from Footywire.
 * Scrapes https://www.footywire.com/afl/footy/injury_list
 * Caches to data/afl-injuries.json
 *
 *   node scripts/fetch-footywire-injuries.js
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const FOOTYWIRE_BASE = 'https://www.footywire.com';

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

const TEAM_FROM_SLUG = {
  'adelaide-crows': 'Adelaide Crows', 'brisbane-lions': 'Brisbane Lions', 'carlton-blues': 'Carlton Blues',
  'collingwood-magpies': 'Collingwood Magpies', 'essendon-bombers': 'Essendon Bombers',
  'fremantle-dockers': 'Fremantle Dockers', 'geelong-cats': 'Geelong Cats', 'gold-coast-suns': 'Gold Coast Suns',
  'greater-western-sydney-giants': 'GWS Giants', 'hawthorn-hawks': 'Hawthorn Hawks',
  'melbourne-demons': 'Melbourne Demons', 'north-melbourne-kangaroos': 'North Melbourne Kangaroos',
  'port-adelaide-power': 'Port Adelaide Power', 'richmond-tigers': 'Richmond Tigers',
  'st-kilda-saints': 'St Kilda Saints', 'sydney-swans': 'Sydney Swans',
  'west-coast-eagles': 'West Coast Eagles', 'western-bulldogs': 'Western Bulldogs',
};

function slugToTeam(href) {
  const m = href.match(/pp-([a-z0-9-]+)--/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  return TEAM_FROM_SLUG[slug] || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseInjuryList(html) {
  const injuries = [];
  const rowRegex = /<tr[^>]*class="(?:dark|light)color"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    if (!rowHtml.includes('pp-') || !rowHtml.includes('/afl/footy/')) continue;
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRegex.exec(rowHtml))) cells.push(c[1]);
    if (cells.length < 3) continue;

    const playerCell = cells[0];
    const playerLink = playerCell.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const playerName = playerLink ? htmlToText(playerLink[2]).trim() : htmlToText(playerCell).trim();
    const href = playerLink ? playerLink[1] : '';
    const team = slugToTeam(href) || '';
    const injury = htmlToText(cells[1]).trim();
    const returning = htmlToText(cells[2]).trim();

    if (!playerName || playerName.length < 2) continue;
    if (/^(player|injury|returning)$/i.test(playerName)) continue;

    injuries.push({ team, player: playerName, injury, returning });
  }

  return injuries;
}

async function main() {
  const url = `${FOOTYWIRE_BASE}/afl/footy/injury_list`;

  console.log('Fetching Footywire injury list...');
  console.log(`  ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  const injuries = parseInjuryList(html);

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'footywire.com',
    sourcePage: 'injury_list',
    injuryCount: injuries.length,
    injuries,
  };

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, 'afl-injuries.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\nWrote ${injuries.length} injuries to ${outPath}`);

  const byTeam = new Map();
  for (const i of injuries) {
    const t = i.team || 'Unknown';
    byTeam.set(t, (byTeam.get(t) || 0) + 1);
  }
  console.log('\nBy team:');
  [...byTeam.entries()].sort((a, b) => b[1] - a[1]).forEach(([team, count]) => {
    console.log(`  ${team}: ${count}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
