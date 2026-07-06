#!/usr/bin/env node

/**
 * Fetch AFL injury list from Footywire.
 * Scrapes https://www.footywire.com/afl/footy/injury_list
 * Caches to data/afl-injuries.json
 *
 *   node scripts/fetch-footywire-injuries.js
 *   node scripts/fetch-footywire-injuries.js --allow-stale
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const FOOTYWIRE_BASE = 'https://www.footywire.com';
const FETCH_ATTEMPTS = 5;
const FETCH_RETRY_BASE_MS = 2500;
const FOOTYWIRE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: 'https://www.footywire.com/',
};

const OUT_PATH = path.join(process.cwd(), 'data', 'afl-injuries.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFootywireUnavailableStatus(status) {
  return status === 429 || status === 502 || status === 503;
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
  if (TEAM_FROM_SLUG[slug]) return TEAM_FROM_SLUG[slug];
  if (slug === 'kangaroos') return 'Kangaroos';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

function injuriesLookValid(data) {
  const injuries = Array.isArray(data?.injuries) ? data.injuries : [];
  if (injuries.length < 40) return false;
  const teams = new Set(injuries.map((i) => i.team).filter(Boolean));
  return teams.size >= 12;
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchInjuries() {
  const url = `${FOOTYWIRE_BASE}/afl/footy/injury_list`;
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: FOOTYWIRE_HEADERS });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (isFootywireUnavailableStatus(res.status)) break;
      } else {
        const html = await res.text();
        const injuries = parseInjuryList(html);
        if (injuries.length > 0) return { ok: true, injuries };
        lastError = 'no injuries parsed';
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < FETCH_ATTEMPTS) {
      await sleep(FETCH_RETRY_BASE_MS * attempt);
    }
  }
  return { ok: false, error: lastError };
}

async function main() {
  const allowStale = process.argv.includes('--allow-stale');
  const url = `${FOOTYWIRE_BASE}/afl/footy/injury_list`;

  console.log('Fetching Footywire injury list...');
  console.log(`  ${url}`);

  const result = await fetchInjuries();
  if (!result.ok) {
    const existing = readExisting();
    if (allowStale && injuriesLookValid(existing)) {
      console.warn(`FootyWire unavailable (${result.error}). Keeping existing injuries:`, OUT_PATH);
      return;
    }
    console.error(`Failed to fetch injuries: ${result.error}`);
    process.exit(1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'footywire.com',
    sourcePage: 'injury_list',
    injuryCount: result.injuries.length,
    injuries: result.injuries,
  };

  const dataDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\nWrote ${result.injuries.length} injuries to ${OUT_PATH}`);

  const byTeam = new Map();
  for (const i of result.injuries) {
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
