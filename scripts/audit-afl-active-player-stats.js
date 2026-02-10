#!/usr/bin/env node

/**
 * Audit that active AFL roster players have game logs/stats.
 *
 * Default target is local app API: http://localhost:3000
 * Run:
 *   node scripts/audit-afl-active-player-stats.js
 *   node scripts/audit-afl-active-player-stats.js --season=2025 --concurrency=6
 *   node scripts/audit-afl-active-player-stats.js --team-limit=2
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const AFL_API_BASE = 'https://v1.afl.api-sports.io';

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

async function fetchAflApiJson(apiKey, endpointPath, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${AFL_API_BASE}/${endpointPath}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': apiKey },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body, url };
}

function extractTeams(payload) {
  const rows = Array.isArray(payload?.response)
    ? payload.response
    : Array.isArray(payload)
      ? payload
      : [];

  return rows
    .map((row) => row?.team ?? row)
    .map((team) => ({
      id: team?.id,
      name: String(team?.name ?? '').trim(),
    }))
    .filter((t) => Number.isFinite(Number(t.id)) && t.name);
}

function extractPlayers(payload) {
  const rows = Array.isArray(payload?.response)
    ? payload.response
    : Array.isArray(payload?.players)
      ? payload.players
      : Array.isArray(payload)
        ? payload
        : [];

  return rows
    .map((row) => row?.player ?? row)
    .map((p) => {
      const directName = typeof p?.name === 'string' ? p.name.trim() : '';
      const first = typeof (p?.firstName ?? p?.firstname) === 'string' ? (p.firstName ?? p.firstname).trim() : '';
      const last = typeof (p?.lastName ?? p?.lastname) === 'string' ? (p.lastName ?? p.lastname).trim() : '';
      const name = directName || [first, last].filter(Boolean).join(' ').trim();
      return {
        id: p?.id,
        name,
      };
    })
    .filter((p) => p.name);
}

async function getTeamPlayers(apiKey, season, teamId) {
  const res = await fetchAflApiJson(apiKey, 'players', {
    team: String(teamId),
    season: String(season),
  });
  if (!res.ok || !res.body) return [];
  return extractPlayers(res.body);
}

async function getTeams(apiKey, season) {
  const res = await fetchAflApiJson(apiKey, 'teams', {
    league: '1',
    season: String(season),
  });
  if (!res.ok || !res.body) return [];
  return extractTeams(res.body);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) return;
      out[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return out;
}

function nowStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function main() {
  const season = getArg('season', '2025');
  const baseUrl = getArg('base-url', process.env.AFL_AUDIT_BASE_URL || 'http://localhost:3000');
  const apiKey = process.env.AFL_API_KEY;
  const listOnly = getArg('list-only', '0') === '1';
  const printLimit = Math.max(0, parseInt(getArg('print-limit', '0'), 10) || 0);
  const concurrency = Math.max(1, parseInt(getArg('concurrency', '5'), 10) || 5);
  const teamLimit = Math.max(0, parseInt(getArg('team-limit', '0'), 10) || 0);
  const delayMs = Math.max(0, parseInt(getArg('delay-ms', '50'), 10) || 0);

  console.log('AFL Active Player Stats Audit');
  console.log('='.repeat(60));
  console.log(`Base URL:    ${baseUrl}`);
  console.log(`Season:      ${season}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Delay (ms):  ${delayMs}`);
  console.log(`Team limit:  ${teamLimit > 0 ? teamLimit : 'none'}`);
  console.log(`List only:   ${listOnly ? 'yes' : 'no'}`);
  console.log(`Print limit: ${printLimit > 0 ? printLimit : 'all'}`);
  console.log('');

  if (!apiKey) {
    throw new Error('AFL_API_KEY is required in .env.local for roster discovery.');
  }

  let teams = await getTeams(apiKey, season);
  if (teamLimit > 0) teams = teams.slice(0, teamLimit);
  if (teams.length === 0) {
    throw new Error('No teams returned for the selected season (try --season=2025).');
  }

  console.log(`Teams found: ${teams.length}`);

  const rosterByTeam = [];
  for (const team of teams) {
    const players = await getTeamPlayers(apiKey, season, team.id);
    rosterByTeam.push({ team, players });
    console.log(`- ${team.name}: ${players.length} players`);
  }

  const uniquePlayersMap = new Map();
  for (const row of rosterByTeam) {
    for (const p of row.players) {
      const key = String(p.id ?? p.name).toLowerCase();
      if (!uniquePlayersMap.has(key)) {
        uniquePlayersMap.set(key, {
          id: p.id ?? null,
          name: p.name,
          team: row.team.name,
        });
      }
    }
  }

  const uniquePlayers = Array.from(uniquePlayersMap.values());
  console.log(`\nUnique active players to test: ${uniquePlayers.length}\n`);

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const stamp = nowStamp();
  const rosterPath = path.join(logsDir, `afl-active-roster-${stamp}.json`);
  const rosterReport = {
    generatedAt: new Date().toISOString(),
    season,
    teams: teams.length,
    players: uniquePlayers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  fs.writeFileSync(rosterPath, JSON.stringify(rosterReport, null, 2), 'utf8');
  console.log(`Roster file: ${rosterPath}`);

  if (listOnly) {
    const toPrint = printLimit > 0 ? rosterReport.players.slice(0, printLimit) : rosterReport.players;
    console.log(`\nPlayers (${toPrint.length}/${rosterReport.players.length}):`);
    for (const p of toPrint) {
      console.log(`- ${p.name} (${p.team})`);
    }
    if (printLimit > 0 && printLimit < rosterReport.players.length) {
      console.log(`\nShowing first ${printLimit}. Use --print-limit=0 to print all players.`);
    }
    console.log(`\nList-only mode complete (${rosterReport.players.length} players total).`);
    return;
  }

  let tested = 0;
  const checks = await mapWithConcurrency(uniquePlayers, concurrency, async (player) => {
    const url = `${baseUrl}/api/afl/player-game-logs?season=${encodeURIComponent(String(season))}&player_name=${encodeURIComponent(player.name)}`;
    const startedAt = Date.now();
    const res = await fetchJson(url);
    const elapsedMs = Date.now() - startedAt;
    if (delayMs > 0) await sleep(delayMs);

    tested += 1;
    if (tested % 25 === 0 || tested === uniquePlayers.length) {
      console.log(`Checked ${tested}/${uniquePlayers.length} players...`);
    }

    const gameCount = Number(res.body?.game_count ?? 0);
    return {
      ...player,
      httpStatus: res.status,
      gameCount: Number.isFinite(gameCount) ? gameCount : 0,
      ok: res.ok && gameCount > 0,
      error: res.body?.error ?? null,
      elapsedMs,
    };
  });

  const withStats = checks.filter((c) => c.ok);
  const missing = checks.filter((c) => !c.ok);

  const report = {
    generatedAt: new Date().toISOString(),
    season,
    baseUrl,
    totals: {
      teams: teams.length,
      uniquePlayers: uniquePlayers.length,
      withStats: withStats.length,
      missing: missing.length,
      coveragePct: uniquePlayers.length > 0
        ? Math.round((withStats.length / uniquePlayers.length) * 10000) / 100
        : 0,
    },
    missingPlayers: missing
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({
        name: m.name,
        team: m.team,
        status: m.httpStatus,
        gameCount: m.gameCount,
        error: m.error,
      })),
  };

  const reportPath = path.join(logsDir, `afl-active-stats-audit-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nResults');
  console.log('='.repeat(60));
  console.log(`Players checked: ${report.totals.uniquePlayers}`);
  console.log(`With stats:      ${report.totals.withStats}`);
  console.log(`Missing stats:   ${report.totals.missing}`);
  console.log(`Coverage:        ${report.totals.coveragePct}%`);
  console.log(`Report:          ${reportPath}`);

  if (missing.length > 0) {
    console.log('\nSample missing players:');
    for (const row of missing.slice(0, 20)) {
      console.log(`- ${row.name} (${row.team}) | status=${row.httpStatus} games=${row.gameCount}${row.error ? ` | ${row.error}` : ''}`);
    }
  }
}

main().catch((err) => {
  console.error('\nAudit failed:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

