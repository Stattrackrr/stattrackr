#!/usr/bin/env node

/**
 * Fetch AFL usage context directly from DFS Australia AJAX endpoints:
 * - CBA% (afl_cbas_call_new_mysql)
 * - Kick-ins (afl_kickins_new_call)
 *
 * Writes:
 *   data/afl-dfs-usage-{season}.json
 *   data/afl-dfs-usage-latest.json
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

function parseNum(v) {
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchDfsAjax(action, season, team) {
  const body = new URLSearchParams({ action, season: String(season), team }).toString();
  const res = await fetch('https://dfsaustralia.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
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
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const TEAM_CODES = ['ADE', 'BRL', 'CAR', 'COL', 'ESS', 'FRE', 'GCS', 'GEE', 'GWS', 'HAW', 'MEL', 'NTH', 'PTA', 'RIC', 'STK', 'SYD', 'WBD', 'WCE'];

  console.log(`Fetching DFS usage data for ${season}...`);

  const byPlayer = new Map();
  let cbaRowsCount = 0;
  let kickRowsCount = 0;

  for (const team of TEAM_CODES) {
    // CBA payload: { cbas: [...] }
    const cbaPayload = await fetchDfsAjax('afl_cbas_call_new_mysql', season, team);
    const cbaRows = Array.isArray(cbaPayload?.cbas) ? cbaPayload.cbas : [];
    cbaRowsCount += cbaRows.length;
    for (const row of cbaRows) {
      const name = String(row?.playerName ?? '').trim();
      const key = normalizeName(name);
      if (!key) continue;
      const cbaPct = parseNum(row?.avg);
      const existing = byPlayer.get(key) || { name };
      if (cbaPct != null) existing.cbaPct = cbaPct;
      byPlayer.set(key, existing);
    }

    // Kick-ins payload: { kickins: [...] }
    const kickPayload = await fetchDfsAjax('afl_kickins_new_call', season, team);
    const kickRows = Array.isArray(kickPayload?.kickins) ? kickPayload.kickins : [];
    kickRowsCount += kickRows.length;
    for (const row of kickRows) {
      const name = String(row?.playerName ?? '').trim();
      const key = normalizeName(name);
      if (!key) continue;
      const kickIns = parseNum(row?.KI);
      const playOnPct = parseNum(row?.POpercentage);
      const existing = byPlayer.get(key) || { name };
      if (kickIns != null) existing.kickIns = kickIns;
      if (playOnPct != null) existing.kickInPlayOnPct = playOnPct;
      byPlayer.set(key, existing);
    }
  }

  const players = Array.from(byPlayer.entries()).map(([key, v]) => ({
    name: v.name,
    normalizedName: key,
    cbaPct: Number.isFinite(v.cbaPct) ? Number(v.cbaPct) : null,
    kickIns: Number.isFinite(v.kickIns) ? Number(v.kickIns) : null,
    kickInPlayOnPct: Number.isFinite(v.kickInPlayOnPct) ? Number(v.kickInPlayOnPct) : null,
  }));

  const out = {
    season,
    generatedAt: new Date().toISOString(),
    source: 'dfsaustralia.com/wp-admin/admin-ajax.php',
    actions: {
      cba: 'afl_cbas_call_new_mysql',
      kickins: 'afl_kickins_new_call',
    },
    teams: TEAM_CODES,
    rowsFetched: {
      cbaRows: cbaRowsCount,
      kickinRows: kickRowsCount,
    },
    count: players.length,
    players,
  };

  const seasonPath = path.join(dataDir, `afl-dfs-usage-${season}.json`);
  const latestPath = path.join(dataDir, 'afl-dfs-usage-latest.json');
  fs.writeFileSync(seasonPath, JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(latestPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(`Wrote ${seasonPath} (${players.length} players)`);
  console.log(`Wrote ${latestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
