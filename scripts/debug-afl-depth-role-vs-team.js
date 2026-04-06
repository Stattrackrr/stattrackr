#!/usr/bin/env node

/**
 * Debug exact contributors behind AFL depth DvP values.
 *
 * Example:
 *   node scripts/debug-afl-depth-role-vs-team.js --season=2026 --opponent="North Melbourne" --role=ruck --stat=disposals --base-url=http://localhost:3000
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const FANTASY_TEAM_TO_FULL = {
  ADE: 'Adelaide',
  BL: 'Brisbane',
  CAR: 'Carlton',
  COLL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GCS: 'Gold Coast',
  GEE: 'Geelong',
  GWS: 'GWS',
  HAW: 'Hawthorn',
  MEL: 'Melbourne',
  NM: 'North Melbourne',
  PA: 'Port Adelaide',
  RICH: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney',
  WC: 'West Coast',
  WB: 'Western Bulldogs',
};

const TEAM_ALIASES = {
  adelaide: 'Adelaide',
  crows: 'Adelaide',
  brisbane: 'Brisbane',
  lions: 'Brisbane',
  carlton: 'Carlton',
  blues: 'Carlton',
  collingwood: 'Collingwood',
  magpies: 'Collingwood',
  essendon: 'Essendon',
  bombers: 'Essendon',
  fremantle: 'Fremantle',
  dockers: 'Fremantle',
  geelong: 'Geelong',
  cats: 'Geelong',
  goldcoast: 'Gold Coast',
  suns: 'Gold Coast',
  gws: 'GWS',
  giants: 'GWS',
  hawthorn: 'Hawthorn',
  hawks: 'Hawthorn',
  melbourne: 'Melbourne',
  demons: 'Melbourne',
  northmelbourne: 'North Melbourne',
  kangaroos: 'North Melbourne',
  north: 'North Melbourne',
  portadelaide: 'Port Adelaide',
  power: 'Port Adelaide',
  richmond: 'Richmond',
  tigers: 'Richmond',
  stkilda: 'St Kilda',
  saints: 'St Kilda',
  sydney: 'Sydney',
  swans: 'Sydney',
  westcoast: 'West Coast',
  eagles: 'West Coast',
  westernbulldogs: 'Western Bulldogs',
  bulldogs: 'Western Bulldogs',
};

const DEPTH_ROLE_TO_GROUP = {
  key_fwd: 'Key Forward',
  gen_fwd: 'Small/Medium Forward',
  ins_mid: 'Inside Midfielder',
  ruck: 'Ruck',
  wng_def: 'Wing/Attacking Defender',
  gen_def: 'General Defender',
  des_kck: 'Designated Kicker',
};

const FIRST_NAME_VARIANTS = {
  matt: ['matthew'],
  matthew: ['matt'],
  tom: ['thomas'],
  thomas: ['tom'],
  josh: ['joshua'],
  joshua: ['josh'],
  jack: ['jackson'],
  jackson: ['jack'],
  will: ['william'],
  william: ['will'],
  max: ['maxwell'],
  maxwell: ['max'],
};

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTeam(raw) {
  const t = normalizeText(raw);
  if (!t) return '';
  const squashed = t.replace(/\s+/g, '');
  if (TEAM_ALIASES[squashed]) return TEAM_ALIASES[squashed];
  const words = t.split(' ');
  for (const w of words) {
    const key = w.replace(/\s+/g, '');
    if (TEAM_ALIASES[key]) return TEAM_ALIASES[key];
  }
  return String(raw || '').trim();
}

function extractLastName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1].toLowerCase() : '';
}

function extractFirstInitial(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first ? first[0].toLowerCase() : '';
}

function readLeaguePlayerNamesByTeam(season) {
  const out = new Map();
  try {
    const filePath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
    if (!fs.existsSync(filePath)) return out;
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    const players = Array.isArray(json?.players) ? json.players : [];
    for (const p of players) {
      const name = String(p?.name || '').trim();
      const teamRaw = String(p?.team || '').trim();
      if (!name || !teamRaw) continue;
      const team = normalizeTeam(teamRaw);
      if (!team) continue;
      if (!out.has(team)) out.set(team, []);
      out.get(team).push(name);
    }
  } catch {
    // ignore
  }
  return out;
}

function buildNameCandidates(name, teamFull, leaguePlayerNamesByTeam) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return [];
  const parts = raw.split(' ');
  const first = String(parts[0] || '').toLowerCase();
  const variants = FIRST_NAME_VARIANTS[first] || [];
  const out = [raw];
  for (const v of variants) {
    const c = [v, ...parts.slice(1)].join(' ').trim();
    if (c && !out.includes(c)) out.push(c);
  }
  const targetLast = extractLastName(raw);
  const targetInitial = extractFirstInitial(raw);
  const leagueNames = leaguePlayerNamesByTeam.get(teamFull) || [];
  if (targetLast && targetInitial) {
    for (const leagueName of leagueNames) {
      if (extractLastName(leagueName) !== targetLast) continue;
      if (extractFirstInitial(leagueName) !== targetInitial) continue;
      if (!out.includes(leagueName)) out.push(leagueName);
    }
  }
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      out[i] = await mapper(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function main() {
  const season = parseInt(getArg('season', String(new Date().getFullYear())), 10) || new Date().getFullYear();
  const opponentRaw = String(getArg('opponent', '') || '').trim();
  const role = String(getArg('role', 'ruck') || 'ruck').trim().toLowerCase();
  const stat = String(getArg('stat', 'disposals') || 'disposals').trim();
  const baseUrl = String(getArg('base-url', 'http://localhost:3000') || 'http://localhost:3000').trim();
  const concurrency = Math.max(1, parseInt(getArg('concurrency', '8'), 10) || 8);

  if (!opponentRaw) {
    throw new Error('Missing --opponent argument.');
  }
  if (!DEPTH_ROLE_TO_GROUP[role]) {
    throw new Error(`Unsupported --role '${role}'.`);
  }

  const opponent = normalizeTeam(opponentRaw);
  const roleGroup = DEPTH_ROLE_TO_GROUP[role];
  const leaguePlayerNamesByTeam = readLeaguePlayerNamesByTeam(season);

  const depthPath = path.join(process.cwd(), 'data', `afl-dvp-depth-${season}.json`);
  const depthJson = JSON.parse(fs.readFileSync(depthPath, 'utf8'));
  const row = (depthJson.rows || []).find((r) => r.opponent === opponent && String(r.depthRole || '').toLowerCase() === role);

  const roleMapPath = path.join(process.cwd(), 'data', 'afl-dfs-role-map-latest.json');
  const roleMap = JSON.parse(fs.readFileSync(roleMapPath, 'utf8'));
  const byNormalizedRole = new Map();
  for (const p of roleMap.players || []) {
    const key = normalizePlayerName(p?.name || p?.normalizedName || '');
    if (!key) continue;
    byNormalizedRole.set(key, String(p?.roleGroup || '').trim());
  }

  const fantasyRes = await fetchJson(`${baseUrl}/api/afl/fantasy-positions?season=${encodeURIComponent(String(season))}`);
  if (!fantasyRes.ok || !Array.isArray(fantasyRes.json?.players)) {
    throw new Error('Failed to load fantasy positions.');
  }
  const players = fantasyRes.json.players
    .map((p) => ({
      name: String(p.name || '').trim(),
      team: String(p.team || '').trim(),
    }))
    .filter((p) => p.name && p.team);

  const candidates = players.filter((p) => byNormalizedRole.get(normalizePlayerName(p.name)) === roleGroup);
  const contributors = [];

  await mapWithConcurrency(candidates, concurrency, async (player) => {
    const teamFull = FANTASY_TEAM_TO_FULL[player.team] || player.team;
    const nameCandidates = buildNameCandidates(player.name, teamFull, leaguePlayerNamesByTeam);
    let games = [];
    let usedName = player.name;
    for (const nm of nameCandidates) {
      const logsRes = await fetchJson(
        `${baseUrl}/api/afl/player-game-logs?season=${encodeURIComponent(String(season))}&player_name=${encodeURIComponent(nm)}&team=${encodeURIComponent(teamFull)}&strict_season=1`
      );
      const g = Array.isArray(logsRes.json?.games) ? logsRes.json.games : [];
      if (g.length > 0) {
        games = g;
        usedName = nm;
        break;
      }
    }
    for (const g of games) {
      const opp = normalizeTeam(g.opponent || '');
      if (opp !== opponent) continue;
      contributors.push({
        player: player.name,
        usedName,
        team: teamFull,
        round: g.round,
        statValue: Number(g[stat] ?? 0),
        disposals: Number(g.disposals ?? 0),
        hitouts: Number(g.hitouts ?? 0),
      });
    }
  });

  contributors.sort((a, b) => a.player.localeCompare(b.player) || String(a.round).localeCompare(String(b.round)));
  const sampleSize = contributors.length;
  const statTotal = contributors.reduce((s, x) => s + (Number.isFinite(x.statValue) ? x.statValue : 0), 0);
  const statPerPlayer = sampleSize > 0 ? Math.round((statTotal / sampleSize) * 100) / 100 : 0;
  const teamGames = Number(row?.teamGames || 0);
  const perGameRoleTotal = teamGames > 0 ? Math.round((statPerPlayer * (sampleSize / teamGames)) * 100) / 100 : 0;

  console.log(`Depth debug | season=${season} | opponent=${opponent} | role=${role} (${roleGroup}) | stat=${stat}`);
  console.log('-'.repeat(90));
  if (row) {
    console.log(`depth-file row: sampleSize=${row.sampleSize}, teamGames=${row.teamGames}, perPlayer=${row.perPlayerGame?.[stat] ?? 'n/a'}, perTeam=${row.perTeamGame?.[stat] ?? 'n/a'}`);
  } else {
    console.log('depth-file row: not found');
  }
  console.log(`recomputed from contributors: sampleSize=${sampleSize}, teamGames=${teamGames}, perPlayer=${statPerPlayer}, perGameRoleTotal=${perGameRoleTotal}`);
  console.log('');
  if (contributors.length === 0) {
    console.log('No contributors found.');
    return;
  }
  for (const c of contributors) {
    console.log(`${c.player.padEnd(24)} | ${String(c.team).padEnd(16)} | ${String(c.round).padEnd(4)} | ${stat}=${String(c.statValue).padStart(5)} | disp=${String(c.disposals).padStart(3)} | ho=${String(c.hitouts).padStart(3)} | used='${c.usedName}'`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

