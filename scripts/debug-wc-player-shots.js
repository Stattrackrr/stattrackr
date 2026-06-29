#!/usr/bin/env node
/**
 * Debug World Cup player shot counts: BDL player_match_stats vs /match_shots vs dashboard API.
 *
 * Usage:
 *   node scripts/debug-wc-player-shots.js --name "Ismael Saibari" --team Morocco
 *   node scripts/debug-wc-player-shots.js --name "Ismael Saibari" --teamId 15 --playerId 12345
 *   node scripts/debug-wc-player-shots.js --name "Ismael Saibari" --team Morocco --app-url http://localhost:3000
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

for (const file of ['.env.local', '.env.development.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) dotenv.config({ path: fullPath, override: false, quiet: true });
}

const API_KEY = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '')
  .trim()
  .replace(/^['"]|['"]$/g, '');
const BDL_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

function getArg(name, fallback = '') {
  const pref = `--${name}=`;
  const fromEq = process.argv.find((a) => a.startsWith(pref));
  if (fromEq) return fromEq.slice(pref.length).trim();
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1].trim();
  }
  return fallback;
}

function authHeaders(key) {
  const auth = key.toLowerCase().startsWith('bearer ') ? key : key;
  return { Accept: 'application/json', 'User-Agent': 'StatTrackr/1.0', Authorization: auth };
}

async function bdlFetch(path, params = {}) {
  if (!API_KEY) throw new Error('BALLDONTLIE_API_KEY not set');
  const url = new URL(`${BDL_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.append(key, String(value));
  }
  const auths = API_KEY.toLowerCase().startsWith('bearer ')
    ? [API_KEY.replace(/^bearer\s+/i, '').trim(), API_KEY]
    : [API_KEY, `Bearer ${API_KEY}`];
  let last = null;
  for (const auth of auths) {
    const res = await fetch(url, { headers: authHeaders(auth), cache: 'no-store' });
    const text = await res.text();
    last = { res, text };
    if (res.ok || res.status !== 401) break;
  }
  if (!last?.res.ok) {
    throw new Error(`BDL ${path} HTTP ${last?.res.status}: ${last?.text?.slice(0, 200)}`);
  }
  return JSON.parse(last.text);
}

async function bdlFetchAll(path, params = {}) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const p = { ...params, per_page: '100' };
    if (cursor != null) p.cursor = String(cursor);
    const payload = await bdlFetch(path, p);
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...batch);
    cursor = payload?.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  return rows;
}

function num(v) {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

function shotsFromRow(row) {
  const direct = num(row.shots_total) ?? num(row.shots);
  const derived = num(row.derived_shots_total) ?? num(row.total_shots);
  if (direct != null && derived != null) return Math.max(direct, derived);
  return direct ?? derived;
}

function normalizeName(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameMatches(query, candidate) {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return false;
  if (q === c || c.includes(q) || q.includes(c)) return true;
  const qParts = q.split(/\s+/).filter(Boolean);
  const cParts = c.split(/\s+/).filter(Boolean);
  if (qParts.length >= 2 && cParts.length >= 2 && qParts.at(-1) === cParts.at(-1)) {
    return (qParts[0] ?? '') === (cParts[0] ?? '') || (qParts[0] ?? '')[0] === (cParts[0] ?? '')[0];
  }
  return false;
}

async function resolvePlayerId(playerName, explicitId) {
  if (explicitId && /^\d+$/.test(explicitId)) return Number(explicitId);
  const players = await bdlFetchAll('/players', { search: playerName.split(' ').pop(), 'seasons[]': '2026' });
  const hit =
    players.find((p) => nameMatches(playerName, p.name)) ||
    players.find((p) => nameMatches(playerName, `${p.first_name ?? ''} ${p.last_name ?? ''}`));
  if (!hit?.id) {
    console.log('BDL /players search results (first 8):');
    for (const p of players.slice(0, 8)) {
      console.log(`  id=${p.id} name=${p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()}`);
    }
    throw new Error(`Could not resolve BDL player id for "${playerName}" — pass --playerId`);
  }
  return hit.id;
}

async function resolveTeamId(teamName, explicitId) {
  if (explicitId && /^\d+$/.test(explicitId)) return Number(explicitId);
  const teams = await bdlFetchAll('/teams', { 'seasons[]': '2026' });
  const hit = teams.find((t) => nameMatches(teamName, t.name) || nameMatches(teamName, t.country_name));
  if (!hit?.id) throw new Error(`Could not resolve BDL team id for "${teamName}" — pass --teamId`);
  return hit.id;
}

function opponentLabel(match, teamId) {
  const homeId = match?.home_team?.id;
  const awayId = match?.away_team?.id;
  const home = match?.home_team?.name ?? 'Home';
  const away = match?.away_team?.name ?? 'Away';
  if (homeId === teamId) return away;
  if (awayId === teamId) return home;
  return `${home} vs ${away}`;
}

async function fetchDashboardRows(appUrl, playerName, playerId, teamId, teamName, chartOnly) {
  const params = new URLSearchParams({
    season: '2026',
    playerName,
    playerId: String(playerId),
    teamId: String(teamId),
    teamName,
  });
  if (chartOnly) params.set('playerChartOnly', '1');
  const url = `${appUrl.replace(/\/$/, '')}/api/world-cup/dashboard?${params}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 180)}`, rows: [] };
    const json = JSON.parse(text);
    return { error: null, rows: json.playerMatchStats ?? [], chartOnly: Boolean(json.playerChartOnly) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), rows: [] };
  }
}

function printTable(title, games) {
  console.log(`\n${title}`);
  console.log('-'.repeat(110));
  console.log(
    [
      'Date'.padEnd(12),
      'Opponent'.padEnd(14),
      'MatchId'.padEnd(8),
      'Mins'.padEnd(5),
      'StatShots'.padEnd(10),
      'Derived'.padEnd(8),
      'ShotEvts'.padEnd(8),
      'SOT'.padEnd(4),
      'Source',
    ].join(' | ')
  );
  console.log('-'.repeat(110));
  for (const g of games) {
    console.log(
      [
        String(g.date).slice(0, 10).padEnd(12),
        String(g.opponent).slice(0, 14).padEnd(14),
        String(g.matchId).padEnd(8),
        String(g.minutes ?? '?').padEnd(5),
        String(g.statShots ?? '-').padEnd(10),
        String(g.derived ?? '-').padEnd(8),
        String(g.shotEvents ?? '-').padEnd(8),
        String(g.sot ?? '-').padEnd(4),
        g.source,
      ].join(' | ')
    );
  }
  if (!games.length) console.log('  (no rows)');
}

async function main() {
  const playerName = getArg('name', getArg('player', 'Ismael Saibari'));
  const teamName = getArg('team', getArg('nation', 'Morocco'));
  const appUrl = getArg('app-url', 'http://localhost:3000');
  const playerIdArg = getArg('playerId', '');
  const teamIdArg = getArg('teamId', '');

  console.log('='.repeat(72));
  console.log('World Cup player shots debug');
  console.log('='.repeat(72));
  console.log(`Player:  ${playerName}`);
  console.log(`Team:    ${teamName}`);
  console.log(`App URL: ${appUrl}`);
  console.log(`BDL key: ${API_KEY ? `${API_KEY.slice(0, 6)}…` : 'MISSING'}`);
  console.log('');

  const [playerId, teamId] = await Promise.all([
    resolvePlayerId(playerName, playerIdArg),
    resolveTeamId(teamName, teamIdArg),
  ]);
  console.log(`Resolved BDL playerId=${playerId}, teamId=${teamId}`);
  console.log('');

  const [statRows, matches2026] = await Promise.all([
    bdlFetchAll('/player_match_stats', { 'player_ids[]': String(playerId), 'seasons[]': '2026' }),
    bdlFetchAll('/matches', { 'seasons[]': '2026' }),
  ]);

  const completedMatches = matches2026.filter((m) => m.status === 'completed');
  const teamMatchIds = completedMatches
    .filter((m) => m.home_team?.id === teamId || m.away_team?.id === teamId)
    .map((m) => m.id)
    .filter(Number.isFinite);

  const statMatchIds = [...new Set(statRows.map((r) => Number(r.match_id)).filter(Number.isFinite))];
  const shotMatchIds = [...new Set([...statMatchIds, ...teamMatchIds])];

  const shotsByMatch = new Map();
  for (let i = 0; i < shotMatchIds.length; i += 50) {
    const chunk = shotMatchIds.slice(i, i + 50);
    const params = { per_page: '100' };
    chunk.forEach((id) => {
      if (!params['match_ids[]']) params['match_ids[]'] = [];
      params['match_ids[]'].push(String(id));
    });
    const shots = await bdlFetchAll('/match_shots', params);
    for (const shot of shots) {
      if (Number(shot.player_id) !== playerId) continue;
      const mid = Number(shot.match_id);
      if (!Number.isFinite(mid)) continue;
      shotsByMatch.set(mid, (shotsByMatch.get(mid) ?? 0) + 1);
    }
  }

  const matchById = new Map(completedMatches.map((m) => [m.id, m]));

  const bdlGames = statRows
    .map((row) => {
      const mid = Number(row.match_id);
      const match = matchById.get(mid);
      return {
        date: match?.datetime ?? row.match_date ?? '',
        opponent: match ? opponentLabel(match, teamId) : '?',
        matchId: mid,
        minutes: num(row.minutes_played),
        statShots: num(row.shots_total) ?? num(row.shots),
        derived: num(row.derived_shots_total) ?? num(row.total_shots),
        resolved: shotsFromRow(row),
        shotEvents: shotsByMatch.get(mid) ?? null,
        sot: num(row.shots_on_target),
        source: 'bdl-live',
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  printTable('BDL live: player_match_stats vs /match_shots (2026)', bdlGames);

  const mismatches = bdlGames.filter(
    (g) =>
      g.minutes != null &&
      g.minutes > 0 &&
      (g.shotEvents ?? 0) > 0 &&
      (g.resolved ?? 0) !== (g.shotEvents ?? 0)
  );
  if (mismatches.length) {
    console.log('\n⚠ Shot mismatches (stat row ≠ match_shots event count):');
    for (const g of mismatches) {
      console.log(
        `  ${String(g.date).slice(0, 10)} vs ${g.opponent}: stats=${g.resolved ?? 0} events=${g.shotEvents}`
      );
    }
  }

  const teamGamesMissingStats = teamMatchIds
    .filter((mid) => !statRows.some((r) => Number(r.match_id) === mid))
    .map((mid) => {
      const match = matchById.get(mid);
      return {
        date: match?.datetime ?? '',
        opponent: match ? opponentLabel(match, teamId) : '?',
        matchId: mid,
        shotEvents: shotsByMatch.get(mid) ?? 0,
      };
    });
  if (teamGamesMissingStats.length) {
    console.log('\n⚠ Morocco 2026 completed matches with NO player_match_stats row for this player:');
    for (const g of teamGamesMissingStats) {
      console.log(
        `  ${String(g.date).slice(0, 10)} vs ${g.opponent} | match=${g.matchId} | shotEvents=${g.shotEvents}`
      );
    }
  }

  for (const [label, chartOnly] of [
    ['Dashboard API (playerChartOnly=1)', true],
    ['Dashboard API (full)', false],
  ]) {
    const { error, rows, chartOnly: isChartOnly } = await fetchDashboardRows(
      appUrl,
      playerName,
      playerId,
      teamId,
      teamName,
      chartOnly
    );
    console.log(`\n${label}`);
    if (error) {
      console.log(`  Skipped: ${error}`);
      continue;
    }
    console.log(`  chartOnly flag: ${isChartOnly}`);
    const wcRows = rows
      .filter((row) => {
        const slug = String(row.tournament_slug ?? '').toLowerCase();
        const src = String(row.source ?? '').toLowerCase();
        return src === 'bdl' || slug.includes('world');
      })
      .map((row) => ({
        date: row.match_date ?? row.date ?? '',
        opponent: row.opponent ?? row.opponent_name ?? '?',
        matchId: row.match_id ?? row.source_match_id ?? '',
        minutes: num(row.minutes_played),
        statShots: num(row.shots_total),
        derived: num(row.derived_shots_total),
        shotEvents: shotsByMatch.get(Number(row.match_id)) ?? null,
        sot: num(row.shots_on_target),
        source: String(row.source ?? '?'),
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    printTable(`  WC rows from API (${wcRows.length})`, wcRows);
  }

  console.log('\n' + '='.repeat(72));
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
