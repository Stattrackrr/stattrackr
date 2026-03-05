#!/usr/bin/env node

/**
 * Fetch 2026 jumper numbers for all AFL players by scraping FootyWire profile pages.
 * Reads data/afl-league-player-stats-2026.json (name + team), fetches each player's
 * FootyWire profile to get guernsey #, writes data/afl-player-jumper-numbers-2026.json.
 *
 *   node scripts/fetch-afl-2026-jumper-numbers.js
 *   node scripts/fetch-afl-2026-jumper-numbers.js --delay=300
 *   node scripts/fetch-afl-2026-jumper-numbers.js --limit=30   (test run)
 *
 * Uses --delay=ms between requests (default 250) to avoid rate limits.
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

/** League team name -> FootyWire profile URL slug (pg-{slug}--). */
function teamToSlug(team) {
  const t = (team || '').trim();
  const overrides = {
    'North Melbourne': 'kangaroos',
    'GWS': 'greater-western-sydney-giants',
  };
  if (overrides[t]) return overrides[t];
  return t.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function playerToSlug(name) {
  let s = (name ?? '').trim().toLowerCase();
  s = s.replace(/\bo['\u2019`]\s*/g, 'o-').replace(/\bd['\u2019`]\s*/g, 'd-');
  s = s.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
  return s.replace(/^-|-$/g, '') || 'x';
}

/** Parse guernsey from FootyWire profile HTML. */
function parseGuernsey(html) {
  const m = html.match(/#(\d+)\s*<\/?b>/i) ?? html.match(/playerProfileTeamDiv[\s\S]*?#(\d+)/i);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
}

async function fetchWithRetry(url, delayMs) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-AU,en;q=0.9',
    Referer: 'https://www.footywire.com/',
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return await res.text();
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, delayMs * 2));
      continue;
    }
    return null;
  }
  return null;
}

async function main() {
  const dataDir = path.join(process.cwd(), 'data');
  const leaguePath = path.join(dataDir, 'afl-league-player-stats-2026.json');
  const outPath = path.join(dataDir, 'afl-player-jumper-numbers-2026.json');
  const delayMs = parseInt(getArg('delay', '250'), 10) || 250;
  const limit = parseInt(getArg('limit', '0'), 10) || 0;

  if (!fs.existsSync(leaguePath)) {
    console.error('Run fetch-footywire-league-player-stats.js first to create afl-league-player-stats-2026.json');
    process.exit(1);
  }

  const league = JSON.parse(fs.readFileSync(leaguePath, 'utf-8'));
  let players = league?.players ?? [];
  if (limit > 0) {
    players = players.slice(0, limit);
    console.log(`Limit: ${limit} players`);
  }
  const seen = new Map();
  const out = [];

  console.log(`Fetching jumper numbers for ${players.length} players (delay ${delayMs}ms)...`);

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const name = (p?.name ?? '').trim();
    const team = (p?.team ?? '').trim();
    if (!name || !team) continue;
    const key = `${team}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.set(key, true);

    const teamSlug = teamToSlug(team);
    const playerSlug = playerToSlug(name);
    const url = `${FOOTYWIRE_BASE}/afl/footy/pg-${teamSlug}--${playerSlug}?year=2026`;

    const html = await fetchWithRetry(url, delayMs);
    const number = html ? parseGuernsey(html) : null;
    out.push({ name, team, number });
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${players.length}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const payload = {
    season: 2026,
    generatedAt: new Date().toISOString(),
    source: 'footywire.com (profile pages)',
    playerCount: out.length,
    players: out,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Wrote ${outPath} (${out.length} players, ${out.filter((p) => p.number != null).length} with numbers)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
