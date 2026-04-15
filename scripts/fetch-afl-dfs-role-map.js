#!/usr/bin/env node

/**
 * Fetch AFL DFS role map (player -> role group) from DFS Australia DVP Player Positions endpoint.
 *
 * Endpoint discovered from inline script on:
 *   https://dfsaustralia.com/dvp-player-positions/
 * Ajax call:
 *   POST /wp-admin/admin-ajax.php
 *   action=afl_dvp_positions_call_mysql
 *   team=<TEAM_CODE|ALL>
 *
 * Writes:
 *   data/afl-dfs-role-map-{season}.json
 *   data/afl-dfs-role-map-latest.json
 *
 * When this fetch returns zero players (no DFS_COOKIE), the app falls back to
 * `dfs-role-map-all-teams.json` or `data/afl-dfs-role-map-static.json` — see `lib/aflDfsRoleMap.ts`.
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleBucketFromGroup(group) {
  const g = String(group || '').toLowerCase();
  if (!g) return null;
  if (g.includes('inside midfielder')) return 'MID';
  if (g.includes('ruck')) return 'RUC';
  if (g.includes('forward')) return 'FWD';
  if (g.includes('defender') || g.includes('kicker')) return 'DEF';
  return null;
}

function parsePlayersFromRoleString(raw) {
  const text = String(raw || '')
    .replace(/<br\s*\/?>/gi, ',')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return [];
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/\s*\(.*?\)\s*$/g, '').trim())
    .map((x) => x.replace(/\s*injured\s*$/i, '').trim())
    .filter(Boolean);
}

async function fetchRolePayload(team = 'ALL') {
  const cookie = String(getArg('cookie', process.env.DFS_COOKIE || '') || '').trim();
  const body = new URLSearchParams({
    action: 'afl_dvp_positions_call_mysql',
    team: String(team || 'ALL'),
  }).toString();
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Referer: 'https://dfsaustralia.com/dvp-player-positions/',
    Origin: 'https://dfsaustralia.com',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch('https://dfsaustralia.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) return null;
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function main() {
  const season = parseInt(getArg('season', String(new Date().getFullYear())), 10) || new Date().getFullYear();
  const team = String(getArg('team', 'ALL') || 'ALL').toUpperCase();
  const cookieProvided = String(getArg('cookie', process.env.DFS_COOKIE || '') || '').trim().length > 0;

  const payload = await fetchRolePayload(team);
  const rows = Array.isArray(payload?.players) ? payload.players : [];

  const byPlayer = new Map();
  for (const row of rows) {
    const roleGroup = String(row?.positionGroup || '').trim();
    const roleBucket = roleBucketFromGroup(roleGroup);
    const names = parsePlayersFromRoleString(row?.string);
    for (const name of names) {
      const key = normalizeName(name);
      if (!key) continue;
      if (!byPlayer.has(key)) {
        byPlayer.set(key, {
          name,
          normalizedName: key,
          roleGroup,
          roleBucket,
        });
      }
    }
  }

  const players = Array.from(byPlayer.values()).sort((a, b) => a.name.localeCompare(b.name));
  const out = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'dfsaustralia.com/wp-admin/admin-ajax.php',
    action: 'afl_dvp_positions_call_mysql',
    teamFilter: team,
    auth: {
      cookieProvided,
    },
    count: players.length,
    players,
  };

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const seasonPath = path.join(dataDir, `afl-dfs-role-map-${season}.json`);
  const latestPath = path.join(dataDir, 'afl-dfs-role-map-latest.json');
  fs.writeFileSync(seasonPath, JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(latestPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`Wrote ${seasonPath} (${players.length} players)`);
  console.log(`Wrote ${latestPath}`);
  if (players.length === 0 && !cookieProvided) {
    console.log('Hint: DFS endpoint likely requires premium session cookie. Re-run with --cookie="<your_cookie_string>" or DFS_COOKIE env var.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

