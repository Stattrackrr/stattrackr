#!/usr/bin/env node

/**
 * Build AFL DVP dataset from season positions + player game logs.
 *
 * Usage:
 *   node scripts/build-afl-dvp.js
 *   node scripts/build-afl-dvp.js --season=2025 --concurrency=6 --base-url=http://localhost:3000
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const AFL_TABLES_BASE = 'https://afltables.com';

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function toDisplayName(lastFirst) {
  const s = String(lastFirst || '').trim();
  const comma = s.indexOf(',');
  if (comma <= 0) return s;
  const last = s.slice(0, comma).trim();
  const first = s.slice(comma + 1).trim();
  return first && last ? `${first} ${last}` : s;
}

async function fetchSeasonTotalsPlayers(season) {
  const url = `${AFL_TABLES_BASE}/afl/stats/${season}a.html`;
  const res = await fetch(url);
  if (!res.ok) return new Set();
  const html = await res.text();
  const names = new Set();
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowRegex.exec(html);
  while (rowMatch) {
    const rowHtml = rowMatch[1];
    const firstLink = rowHtml.match(/<a[^>]+href=['"][^'"]*players\/[A-Za-z0-9]\/[^'"]+\.html['"][^>]*>([\s\S]*?)<\/a>/i);
    if (firstLink?.[1]) {
      const name = toDisplayName(htmlToText(firstLink[1]));
      if (name) names.add(normalizeText(name));
    }
    rowMatch = rowRegex.exec(html);
  }
  return names;
}

async function fetchSeasonTeamGameCounts(season) {
  // Prefer local rankings snapshot (already parsed/clean and includes finals via Gm).
  try {
    const rankingsPath = path.join(process.cwd(), 'data', `afl-team-rankings-${season}.json`);
    if (fs.existsSync(rankingsPath)) {
      const raw = fs.readFileSync(rankingsPath, 'utf8');
      const json = JSON.parse(raw);
      const teams = Array.isArray(json?.teams) ? json.teams : [];
      const fromRankings = new Map();
      for (const t of teams) {
        const teamName = normalizeTeam(t?.team ?? '');
        const gmRaw = t?.stats?.Gm;
        const gm = Number(gmRaw);
        if (teamName && Number.isFinite(gm) && gm > 0) {
          fromRankings.set(teamName, gm);
        }
      }
      if (fromRankings.size >= 10) return fromRankings;
    }
  } catch {
    // fall through to fixture scrape
  }

  const urls = [
    `${AFL_TABLES_BASE}/afl/seas/${season}.html`,
    `${AFL_TABLES_BASE}/afl/seas/${season}a.html`,
  ];
  let html = '';
  for (const url of urls) {
    const res = await fetch(url);
    if (res.ok) {
      html = await res.text();
      if (html) break;
    }
  }
  if (!html) return new Map();

  const counts = new Map();
  const linkRegex = /<a[^>]+href=['"]([^'"]*\/games\/\d+\/[^'"]+\.html)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m = linkRegex.exec(html);
  while (m) {
    const text = htmlToText(m[2]);
    const vIdx = text.toLowerCase().indexOf(' v ');
    if (vIdx > 0) {
      const homeRaw = text.slice(0, vIdx).replace(/\d[\d.\s-]*$/, '').trim();
      const awayRaw = text.slice(vIdx + 3).replace(/\d[\d.\s-]*$/, '').trim();
      const home = normalizeTeam(homeRaw);
      const away = normalizeTeam(awayRaw);
      if (home) counts.set(home, (counts.get(home) || 0) + 1);
      if (away) counts.set(away, (counts.get(away) || 0) + 1);
    }
    m = linkRegex.exec(html);
  }
  return counts;
}

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

function normalizeRoundLabel(rawRound) {
  const r = String(rawRound || '').trim().toUpperCase();
  if (!r) return '';
  const num = r.match(/\b(\d{1,2})\b/);
  if (num && num[1]) return `R${num[1]}`;
  if (r.includes('QUALIFYING') || r === 'QF') return 'QF';
  if (r.includes('ELIMINATION') || r === 'EF') return 'EF';
  if (r.includes('SEMI') || r === 'SF') return 'SF';
  if (r.includes('PRELIMINARY') || r === 'PF') return 'PF';
  if (r.includes('GRAND') || r === 'GF') return 'GF';
  if (r.startsWith('R')) return r.replace(/\s+/g, '');
  return r.replace(/\s+/g, '');
}

function normalizeResultLabel(rawResult) {
  const t = String(rawResult || '').trim().toUpperCase();
  if (!t) return '';
  if (t.startsWith('W')) return 'W';
  if (t.startsWith('L')) return 'L';
  if (t.startsWith('D')) return 'D';
  return t;
}

function gameKeyForOpponentSeason(season, opp, game) {
  const rawUrl = String(game.match_url || '').trim();
  if (rawUrl) {
    const m = rawUrl.match(/\/games\/(\d{4})\/([^/?#]+\.html?)/i);
    if (m?.[1] && m?.[2]) {
      return `${season}|${opp}|URL|${m[1]}|${m[2].toLowerCase()}`;
    }
    return `${season}|${opp}|URL|${rawUrl.toLowerCase()}`;
  }
  const round = normalizeRoundLabel(game.round);
  const result = normalizeResultLabel(game.result);
  const gameNo = Number.isFinite(Number(game.game_number)) ? Number(game.game_number) : null;
  if (round) return `${season}|${opp}|ROUND|${round}|RES|${result}`;
  if (gameNo != null) return `${season}|${opp}|NUM|${gameNo}|RES|${result}`;
  return `${season}|${opp}|FALLBACK|${result}`;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statList() {
  return [
    'disposals',
    'kicks',
    'handballs',
    'marks',
    'goals',
    'behinds',
    'tackles',
    'hitouts',
    'inside_50s',
    'clearances',
    'intercepts',
    'tackles_inside_50',
    'score_involvements',
    'contested_possessions',
    'uncontested_possessions',
    'contested_marks',
    'marks_inside_50',
    'one_percenters',
    'goal_assists',
    'meters_gained',
    'percent_played',
  ];
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function createAccumulator() {
  return {
    sampleSize: 0,
    sums: Object.fromEntries(statList().map((s) => [s, 0])),
  };
}

function addGameToAccumulator(acc, game) {
  acc.sampleSize += 1;
  for (const stat of statList()) {
    acc.sums[stat] += safeNumber(game[stat]);
  }
}

function toAverages(acc) {
  const perPlayerGame = {};
  const denom = Math.max(1, acc.sampleSize);
  for (const stat of statList()) {
    perPlayerGame[stat] = Math.round((acc.sums[stat] / denom) * 100) / 100;
  }
  return perPlayerGame;
}

function toRoundedTotals(acc) {
  const totals = {};
  for (const stat of statList()) {
    totals[stat] = Math.round(safeNumber(acc.sums[stat]) * 100) / 100;
  }
  return totals;
}

async function main() {
  const season = parseInt(getArg('season', '2025'), 10) || 2025;
  const baseUrl = getArg('base-url', process.env.AFL_DVP_BASE_URL || 'http://localhost:3000');
  const concurrency = Math.max(1, parseInt(getArg('concurrency', '6'), 10) || 6);
  const delayMs = Math.max(0, parseInt(getArg('delay-ms', '40'), 10) || 40);
  const playerLimit = Math.max(0, parseInt(getArg('player-limit', '0'), 10) || 0);

  console.log('AFL DVP Builder');
  console.log('='.repeat(50));
  console.log(`Season:      ${season}`);
  console.log(`Base URL:    ${baseUrl}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Delay (ms):  ${delayMs}`);
  console.log(`Player limit:${playerLimit > 0 ? playerLimit : 'none'}`);
  console.log('');

  const seasonTotalsNames = await fetchSeasonTotalsPlayers(season);
  const seasonTeamGameCounts = await fetchSeasonTeamGameCounts(season);
  console.log(`AFLTables season-total players: ${seasonTotalsNames.size}`);
  if (seasonTeamGameCounts.size > 0) {
    console.log(`AFLTables fixture teams found: ${seasonTeamGameCounts.size}`);
  }

  const fantasyUrl = `${baseUrl}/api/afl/fantasy-positions?season=${encodeURIComponent(String(season))}`;
  const fantasyRes = await fetchJson(fantasyUrl);
  if (!fantasyRes.ok || !Array.isArray(fantasyRes.body?.players)) {
    throw new Error(`Failed to fetch fantasy positions (${fantasyRes.status})`);
  }

  let players = fantasyRes.body.players
    .map((p) => ({
      name: String(p.name || '').trim(),
      team: String(p.team || '').trim(),
      position: String(p.position || '').trim().toUpperCase(),
    }))
    .filter((p) => p.name && p.position);

  if (playerLimit > 0) players = players.slice(0, playerLimit);
  players = players.map((p) => ({
    ...p,
    likelyPlayed: seasonTotalsNames.size > 0 ? seasonTotalsNames.has(normalizeText(p.name)) : null,
  }));
  console.log(`Position-mapped players: ${players.length}`);

  let checked = 0;
  const fetched = await mapWithConcurrency(players, concurrency, async (player) => {
    const fullTeam = FANTASY_TEAM_TO_FULL[player.team] || player.team;
    const url = `${baseUrl}/api/afl/player-game-logs?season=${encodeURIComponent(String(season))}&player_name=${encodeURIComponent(player.name)}&team=${encodeURIComponent(fullTeam)}`;
    const res = await fetchJson(url);
    if (delayMs > 0) await sleep(delayMs);
    checked += 1;
    if (checked % 50 === 0 || checked === players.length) {
      console.log(`Fetched ${checked}/${players.length} player logs...`);
    }

    const games = Array.isArray(res.body?.games) ? res.body.games : [];
    return {
      ...player,
      teamFull: fullTeam,
      ok: res.ok && games.length > 0,
      games,
      status: res.status,
      error: res.body?.error || null,
    };
  });

  const valid = fetched.filter((r) => r.ok && Array.isArray(r.games) && r.games.length > 0);
  const missing = fetched.filter((r) => !r.ok);
  const eligiblePlayers = players.filter((p) => p.likelyPlayed === true);
  const validEligible = valid.filter((v) => v.likelyPlayed === true);
  const missingEligible = missing.filter((m) => m.likelyPlayed === true);
  console.log(`Players with logs: ${valid.length}`);
  console.log(`Players missing:   ${missing.length}`);
  if (seasonTotalsNames.size > 0) {
    console.log(`Eligible players (played >=1): ${eligiblePlayers.length}`);
    console.log(`Eligible missing:             ${missingEligible.length}`);
  }

  const byOpponentPosition = new Map();
  const byPosition = new Map();
  const opponentGameKeys = new Map();

  for (const row of valid) {
    const pos = row.position;
    if (!byPosition.has(pos)) byPosition.set(pos, createAccumulator());
    const posAcc = byPosition.get(pos);

    for (const g of row.games) {
      const opp = normalizeTeam(g.opponent || '');
      if (!opp) continue;
      const gameKey = gameKeyForOpponentSeason(season, opp, g);
      if (!opponentGameKeys.has(opp)) opponentGameKeys.set(opp, new Set());
      opponentGameKeys.get(opp).add(gameKey);

      const key = `${opp}|${pos}`;
      if (!byOpponentPosition.has(key)) {
        byOpponentPosition.set(key, {
          opponent: opp,
          position: pos,
          ...createAccumulator(),
        });
      }
      const acc = byOpponentPosition.get(key);
      addGameToAccumulator(acc, g);
      addGameToAccumulator(posAcc, g);
    }
  }

  const leagueBaseline = {};
  for (const [pos, acc] of byPosition.entries()) {
    leagueBaseline[pos] = {
      sampleSize: acc.sampleSize,
      perPlayerGame: toAverages(acc),
    };
  }

  const rows = [];
  for (const [, acc] of byOpponentPosition.entries()) {
    const baseline = leagueBaseline[acc.position];
    const perPlayerGame = toAverages(acc);
    const totals = toRoundedTotals(acc);
    const inferredGames = opponentGameKeys.has(acc.opponent) ? opponentGameKeys.get(acc.opponent).size : 0;
    const teamGames = seasonTeamGameCounts.get(acc.opponent) || inferredGames;
    const perTeamGame = {};
    for (const stat of statList()) {
      perTeamGame[stat] = teamGames > 0
        ? Math.round((safeNumber(totals[stat]) / teamGames) * 100) / 100
        : null;
    }
    const indexVsLeague = {};
    const basePer = baseline?.perPlayerGame || {};
    for (const stat of statList()) {
      const baseVal = safeNumber(basePer[stat]);
      indexVsLeague[stat] = baseVal > 0
        ? Math.round((perPlayerGame[stat] / baseVal) * 1000) / 1000
        : null;
    }
    rows.push({
      opponent: acc.opponent,
      position: acc.position,
      sampleSize: acc.sampleSize,
      teamGames,
      totals,
      perPlayerGame,
      perTeamGame,
      indexVsLeague,
    });
  }

  rows.sort((a, b) => (
    a.opponent.localeCompare(b.opponent) || a.position.localeCompare(b.position)
  ));

  const report = {
    generatedAt: new Date().toISOString(),
    season,
    source: 'afl fantasy positions + player-game-logs',
    summary: {
      playerCount: players.length,
      withLogs: valid.length,
      missingLogs: missing.length,
      coveragePct: players.length > 0 ? Math.round((valid.length / players.length) * 10000) / 100 : 0,
      eligiblePlayers: eligiblePlayers.length,
      withLogsEligible: validEligible.length,
      missingEligible: missingEligible.length,
      coveragePctEligible: eligiblePlayers.length > 0
        ? Math.round((validEligible.length / eligiblePlayers.length) * 10000) / 100
        : null,
    },
    leagueBaselineByPosition: leagueBaseline,
    rows,
    missingPlayers: missing
      .map((m) => ({
        name: m.name,
        team: m.team,
        position: m.position,
        status: m.status,
        error: m.error,
        likelyPlayed: m.likelyPlayed,
        reason: m.likelyPlayed === true ? 'match_or_data_gap' : (m.likelyPlayed === false ? 'likely_no_games_2025' : 'unknown'),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, `afl-dvp-${season}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log(`Wrote DVP data: ${outPath}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Coverage (all): ${report.summary.coveragePct}%`);
  if (report.summary.coveragePctEligible != null) {
    console.log(`Coverage (eligible): ${report.summary.coveragePctEligible}%`);
  }
}

main().catch((err) => {
  console.error('\nBuild failed:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

