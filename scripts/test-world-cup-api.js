#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
const loadedEnvFiles = [];

for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(fullPath)) continue;
  const parsed = dotenv.config({ path: fullPath, override: false, quiet: true });
  loadedEnvFiles.push({ file, count: parsed.parsed ? Object.keys(parsed.parsed).length : 0 });
}

const API_KEY = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const API_FOOTBALL_KEY = (process.env.API_FOOTBALL_KEY || '').trim().replace(/^['"]|['"]$/g, '');
const BASE_URL = 'https://api.balldontlie.io/fifa/worldcup/v1';
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

const checks = [
  { label: 'Teams (free)', path: '/teams', params: { 'seasons[]': '2026' } },
  { label: 'Stadiums (free)', path: '/stadiums', params: { 'seasons[]': '2026' } },
  { label: 'Group standings (ALL-STAR+)', path: '/group_standings', params: { 'seasons[]': '2026' } },
  { label: 'Matches (GOAT)', path: '/matches', params: { 'seasons[]': '2026', per_page: '5' } },
  { label: 'Players search Ronaldo (GOAT)', path: '/players', params: { search: 'ronaldo', per_page: '5' } },
  { label: 'Rosters (GOAT)', path: '/rosters', params: { 'seasons[]': '2026', per_page: '5' } },
  { label: 'Futures odds (GOAT)', path: '/odds/futures', params: { 'seasons[]': '2026' } },
];

async function inspectRonaldo() {
  const playerUrl = buildUrl('/players', { search: 'ronaldo', per_page: '5' });
  const playerResult = await fetchWithAuthFallback(playerUrl);
  if (!playerResult?.response.ok) return;
  const playerPayload = JSON.parse(playerResult.text);
  const player = Array.isArray(playerPayload?.data) ? playerPayload.data[0] : null;
  if (!player?.id) return;

  console.log('Ronaldo inspect');
  console.log(`  player_id: ${player.id}`);
  console.log(`  country: ${player.country_name || player.country_code || 'n/a'}`);

  const statsUrl = buildUrl('/player_match_stats', { 'player_ids[]': String(player.id), per_page: '10' });
  const statsResult = await fetchWithAuthFallback(statsUrl);
  const statsPayload = statsResult?.text ? JSON.parse(statsResult.text) : null;
  const statsRows = Array.isArray(statsPayload?.data) ? statsPayload.data : [];
  console.log(`  player_match_stats rows: ${statsRows.length}`);
  if (statsRows[0]) {
    console.log(`  first stat match_id: ${statsRows[0].match_id}`);
    console.log(`  first stat non-null keys: ${Object.entries(statsRows[0]).filter(([, value]) => value != null).map(([key]) => key).join(', ')}`);
    console.log(`  first stat sample: ${JSON.stringify(statsRows[0], null, 2).slice(0, 900)}`);
  }

  const matchIds = statsRows.map((row) => row.match_id).filter(Boolean).slice(0, 10);
  if (matchIds.length) {
    const shotParams = { 'player_ids[]': String(player.id), per_page: '25' };
    matchIds.forEach((id, index) => {
      shotParams[`match_ids[${index}]`] = String(id);
    });
    const shotUrl = new URL(`${BASE_URL}/match_shots`);
    shotUrl.searchParams.set('player_ids[]', String(player.id));
    shotUrl.searchParams.set('per_page', '25');
    matchIds.forEach((id) => shotUrl.searchParams.append('match_ids[]', String(id)));
    const shotResult = await fetchWithAuthFallback(shotUrl);
    const shotPayload = shotResult?.text ? JSON.parse(shotResult.text) : null;
    const shotRows = Array.isArray(shotPayload?.data) ? shotPayload.data : [];
    console.log(`  match_shots rows for first ${matchIds.length} stat matches: ${shotRows.length}`);
    if (shotRows[0]) {
      console.log(`  first shot sample: ${JSON.stringify(shotRows[0], null, 2).slice(0, 600)}`);
    }
  }
  console.log('');
}

function apiFootballPlayerishBet(name) {
  const n = String(name || '').toLowerCase();
  return /goal.?scor|anytime|first.?scor|last.?scor|player|shots?|sot|assist|to score|score a goal/.test(n);
}

function getArgValue(flag, fallback = '') {
  const index = process.argv.lastIndexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function normalizePlayerName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function playerNameMatches(query, candidate) {
  const q = normalizePlayerName(query);
  const c = normalizePlayerName(candidate);
  if (!q || !c) return false;
  if (q === c || c.includes(q) || q.includes(c)) return true;
  const qParts = q.split(/\s+/).filter(Boolean);
  const cParts = c.split(/\s+/).filter(Boolean);
  if (qParts.length >= 2 && cParts.length >= 2 && qParts.at(-1) === cParts.at(-1)) {
    const qFirst = qParts[0] ?? '';
    const cFirst = cParts[0] ?? '';
    if (qFirst === cFirst) return true;
    if (qFirst.length === 1 && cFirst.startsWith(qFirst)) return true;
    if (cFirst.length === 1 && qFirst.startsWith(cFirst)) return true;
  }
  return false;
}

function decimalToAmerican(decimal) {
  const n = Number.parseFloat(String(decimal).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 1) return 'N/A';
  if (n >= 2) return `+${Math.round((n - 1) * 100)}`;
  return String(Math.round(-100 / (n - 1)));
}

function formatOdd(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'N/A';
  if (/^[+-]\d+$/.test(raw)) {
    const american = Number.parseInt(raw, 10);
    return Number.isFinite(american) ? (american > 0 ? `+${american}` : String(american)) : 'N/A';
  }
  const n = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return 'N/A';
  if (n > 1 && n < 500) return decimalToAmerican(n);
  if (n >= 100) return `+${Math.round(n)}`;
  return 'N/A';
}

function classifyBet(name) {
  const n = String(name || '').toLowerCase();
  if (/match|team total|home team|away team|both teams|correct score|half time|full time|corner|card|booking/.test(n)) {
    return null;
  }
  if (/first goalscorer|last goalscorer|first scorer|last scorer|first to score|last to score/.test(n)) {
    return null;
  }
  if (/anytime|goal scorer|to score|score anytime/.test(n) && !/assist/.test(n)) return 'anytime';
  if (/player.*assist|assist.*player|\bassists\b/.test(n) && !/match|team total|home team|away team/.test(n)) {
    return 'assists';
  }
  if (/shots on target|shot on target|\bsot\b/.test(n) && !/match|team total|home team|away team/.test(n)) {
    return 'sot';
  }
  if (/player.*shot|player total shots|\bplayer shots\b/.test(n) && !/on target|match|team total/.test(n)) {
    return 'shots';
  }
  if (/player.*goal|player total goals|\bplayer goals\b/.test(n) && !/anytime|first|last|match|team/.test(n)) {
    return 'goals_ou';
  }
  return null;
}

const TEAM_SEARCH_ALIASES = {
  netherlands: ['netherlands', 'holland'],
  'ivory coast': ['ivory coast', 'cote d ivoire', "cote d'ivoire", 'cote divoire', 'ivoire'],
  usa: ['usa', 'united states', 'united states of america'],
  'south korea': ['south korea', 'korea republic', 'korea'],
  iran: ['iran', 'ir iran'],
};

function normalizeTeamSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamNamesMatch(a, b) {
  const na = normalizeTeamSearch(a);
  const nb = normalizeTeamSearch(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  for (const [canonical, aliases] of Object.entries(TEAM_SEARCH_ALIASES)) {
    const bucket = new Set([canonical, ...aliases.map(normalizeTeamSearch)]);
    if (bucket.has(na) && bucket.has(nb)) return true;
    if (bucket.has(na) && (nb.includes(canonical) || aliases.some((alias) => nb.includes(normalizeTeamSearch(alias))))) {
      return true;
    }
    if (bucket.has(nb) && (na.includes(canonical) || aliases.some((alias) => na.includes(normalizeTeamSearch(alias))))) {
      return true;
    }
  }
  return false;
}

function fixtureMatchesTeam(fixture, teamName) {
  const home = fixture?.teams?.home?.name ?? '';
  const away = fixture?.teams?.away?.name ?? '';
  return teamNamesMatch(home, teamName) || teamNamesMatch(away, teamName);
}

function fixtureMatchesMatchup(fixture, homeTeam, awayTeam) {
  const home = fixture?.teams?.home?.name ?? '';
  const away = fixture?.teams?.away?.name ?? '';
  return (
    (teamNamesMatch(home, homeTeam) && teamNamesMatch(away, awayTeam)) ||
    (teamNamesMatch(home, awayTeam) && teamNamesMatch(away, homeTeam))
  );
}

async function resolveTeamId(teamName) {
  const normalized = normalizeTeamSearch(teamName);
  const needles = TEAM_SEARCH_ALIASES[normalized] ?? [teamName, normalized];
  const searchPlans = [];
  for (const needle of needles) {
    searchPlans.push({ search: needle, league: 1, season: 2026 });
    searchPlans.push({ search: needle });
  }

  for (const params of searchPlans) {
    const { json } = await apiFootballGet('/teams', params);
    const teams = Array.isArray(json?.response) ? json.response : [];
    const nationalTeams = teams.filter((row) => row?.team?.national !== false);
    const pool = nationalTeams.length ? nationalTeams : teams;
    const team = pool.find(
      (row) => teamNamesMatch(row?.team?.name ?? '', teamName) || teamNamesMatch(row?.team?.name ?? '', params.search)
    );
    if (team?.team?.id) return { teamId: team.team.id, teamName: team.team.name };
  }
  return null;
}

async function findLeagueFixtures(params) {
  const { json } = await apiFootballGet('/fixtures', params);
  return Array.isArray(json?.response) ? json.response : [];
}

async function findFixtureByMatchup(homeTeam, awayTeam, opts = {}) {
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const attempts = [
    ...(opts.date ? [{ label: 'match-date', params: { league: 1, season: 2026, from: opts.date, to: opts.date } }] : []),
    { label: 'live-all', params: { league: 1, season: 2026, live: 'all' } },
    { label: 'today-all', params: { league: 1, season: 2026, date: today } },
    { label: 'next-all', params: { league: 1, season: 2026, next: 20 } },
    { label: 'last-all', params: { league: 1, season: 2026, last: 20 } },
  ];

  for (const attempt of attempts) {
    const rows = await findLeagueFixtures(attempt.params);
    const fixture = rows.find((row) => fixtureMatchesMatchup(row, homeTeam, awayTeam));
    if (fixture?.fixture?.id) return { fixture, source: attempt.label, team: null };
  }
  return { fixture: null, source: 'none', team: null };
}

async function findTeamFixture(teamName, opts = {}) {
  if (opts.homeTeam && opts.awayTeam) {
    return findFixtureByMatchup(opts.homeTeam, opts.awayTeam, opts);
  }

  const team = await resolveTeamId(teamName);
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const teamStrategies = team?.teamId
    ? [
        { label: 'live', params: { team: team.teamId, league: 1, season: 2026, live: 'all' } },
        { label: 'today', params: { team: team.teamId, league: 1, season: 2026, date: today } },
        { label: 'next', params: { team: team.teamId, league: 1, season: 2026, next: 5 } },
        { label: 'last', params: { team: team.teamId, league: 1, season: 2026, last: 5 } },
      ]
    : [];

  const leagueStrategies = [
    ...(opts.date ? [{ label: 'match-date', params: { league: 1, season: 2026, from: opts.date, to: opts.date } }] : []),
    { label: 'live-all', params: { league: 1, season: 2026, live: 'all' } },
    { label: 'today-all', params: { league: 1, season: 2026, date: today } },
    { label: 'next-all', params: { league: 1, season: 2026, next: 30 } },
    { label: 'last-all', params: { league: 1, season: 2026, last: 30 } },
  ];

  for (const strategy of teamStrategies) {
    const rows = await findLeagueFixtures(strategy.params);
    const fixture = rows[0] ?? null;
    if (fixture?.fixture?.id) return { fixture, source: strategy.label, team };
  }

  for (const strategy of leagueStrategies) {
    const rows = await findLeagueFixtures(strategy.params);
    const fixture = rows.find((row) => fixtureMatchesTeam(row, teamName));
    if (fixture?.fixture?.id) return { fixture, source: strategy.label, team };
  }

  return { fixture: null, source: 'none', team };
}

async function fetchFixtureOdds(fixtureId) {
  const prematch = await apiFootballGet('/odds', { fixture: fixtureId });
  const prematchRows = Array.isArray(prematch.json?.response) ? prematch.json.response : [];
  if (prematchRows.length) {
    return { rows: prematchRows, endpoint: 'prematch', status: prematch.response.status };
  }
  const live = await apiFootballGet('/odds/live', { fixture: fixtureId });
  const liveRows = Array.isArray(live.json?.response) ? live.json.response : [];
  return { rows: liveRows, endpoint: liveRows.length ? 'live' : 'prematch', status: live.response.status || prematch.response.status };
}

async function probePlayerOdds() {
  const playerName = getArgValue('--player', 'Cody Gakpo');
  const teamName = getArgValue('--team', 'Netherlands');
  const homeTeam = getArgValue('--home', '');
  const awayTeam = getArgValue('--away', '');
  const matchDate = getArgValue('--date', '');
  const fixtureIdArg = getArgValue('--fixture-id', '');
  const outPath = path.resolve(process.cwd(), getArgValue('--out', 'scripts/player-odds-probe.txt'));
  const lines = [];

  const log = (...parts) => {
    const text = parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part, null, 2))).join(' ');
    lines.push(text);
    console.log(text);
  };

  log('API-Football player odds probe');
  log(`Player: ${playerName}`);
  log(`Team: ${teamName}`);
  if (homeTeam && awayTeam) log(`Matchup override: ${homeTeam} vs ${awayTeam}`);
  if (matchDate) log(`Date override: ${matchDate}`);
  if (fixtureIdArg) log(`Fixture id override: ${fixtureIdArg}`);
  log(`Env key: ${API_FOOTBALL_KEY ? 'found' : 'missing'}`);
  log('');

  if (!API_FOOTBALL_KEY) {
    log('Missing API_FOOTBALL_KEY in .env.local');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    process.exitCode = 1;
    return;
  }

  const lookup = await findTeamFixture(teamName, {
    date: matchDate || undefined,
    homeTeam: homeTeam || undefined,
    awayTeam: awayTeam || undefined,
  });
  let fixture = lookup.fixture;
  let fixtureSource = lookup.source;

  if (!fixture?.fixture?.id && fixtureIdArg) {
    const { json } = await apiFootballGet('/fixtures', { id: fixtureIdArg });
    fixture = Array.isArray(json?.response) ? json.response[0] : null;
    fixtureSource = fixture?.fixture?.id ? 'fixture-id' : fixtureSource;
  }

  if (!fixture?.fixture?.id) {
    log(`No World Cup 2026 fixture found for ${teamName} (tried live, today, next, last)`);
    if (lookup.team) log(`Resolved team: ${lookup.team.teamName} (#${lookup.team.teamId})`);
    else log(`Could not resolve API-Football team id for "${teamName}" (also scanned live/today WC fixtures by name)`);
    log('Tips:');
    log('  npm run probe:wc-player-odds -- --player "Cody Gakpo" --home "Netherlands" --away "Japan"');
    log('  npm run probe:wc-player-odds -- --player "Cody Gakpo" --fixture-id 1234567');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    process.exitCode = 1;
    return;
  }

  if (lookup.team) log(`Team resolved: ${lookup.team.teamName} (#${lookup.team.teamId})`);
  log(`Fixture source: ${fixtureSource}`);

  const fixtureId = fixture.fixture.id;
  log(`Fixture id: ${fixtureId}`);
  log(`Match: ${fixture.teams?.home?.name ?? '?'} vs ${fixture.teams?.away?.name ?? '?'}`);
  log(`Kickoff: ${fixture.fixture?.date ?? '?'}`);
  log(`Status: ${fixture.fixture?.status?.short ?? fixture.fixture?.status?.long ?? 'unknown'}`);
  log('');

  const oddsResult = await fetchFixtureOdds(fixtureId);
  const oddsRows = oddsResult.rows;
  log(`Odds HTTP ${oddsResult.status} via ${oddsResult.endpoint} | rows: ${oddsRows.length}`);
  log('');

  const playerHits = [];
  const betNameHits = [];
  const marketSummary = new Map();

  for (const row of oddsRows) {
    for (const bookmaker of row.bookmakers ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        const betName = String(bet.name ?? '');
        const betId = bet.id ?? '?';
        const betNameMatches = playerNameMatches(playerName, betName);
        if (betNameMatches) {
          betNameHits.push({
            bookmaker: bookmaker.name,
            betId,
            betName,
            kind: classifyBet(betName),
            values: (bet.values ?? []).slice(0, 12),
          });
        }
        for (const value of bet.values ?? []) {
          const label = String(value?.value ?? '');
          if (!playerNameMatches(playerName, label) && !betNameMatches) continue;
          const hit = {
            bookmaker: bookmaker.name,
            betId,
            betName,
            kind: classifyBet(betName),
            value: label,
            odd: value?.odd ?? null,
            handicap: value?.handicap ?? null,
            american: formatOdd(value?.odd),
          };
          playerHits.push(hit);
          const key = `${bookmaker.name} :: [${betId}] ${betName}`;
          if (!marketSummary.has(key)) marketSummary.set(key, []);
          marketSummary.get(key).push(hit);
        }
      }
    }
  }

  log(`=== Bets whose MARKET NAME mentions "${playerName}" (${betNameHits.length}) ===`);
  for (const hit of betNameHits) {
    log(`${hit.bookmaker} | [${hit.betId}] ${hit.betName} | kind=${hit.kind ?? 'unclassified'}`);
    for (const value of hit.values) {
      log(`  ${JSON.stringify(value)} (${formatOdd(value?.odd)})`);
    }
  }
  log('');

  log(`=== Raw API rows mentioning "${playerName}" in value or bet name (${playerHits.length}) ===`);
  for (const hit of playerHits) {
    log(
      `${hit.bookmaker} | [${hit.betId}] ${hit.betName} | kind=${hit.kind ?? 'unclassified'} | value="${hit.value}" | decimal=${hit.odd} | american=${hit.american}${hit.handicap != null ? ` | handicap=${hit.handicap}` : ''}`
    );
  }
  log('');

  log('=== Grouped by market ===');
  for (const [key, hits] of [...marketSummary.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    log(key);
    for (const hit of hits) {
      log(`  "${hit.value}" -> ${hit.odd} (${hit.american})`);
    }
  }
  log('');

  log('=== What our dashboard parser would pick (Bet365 / Betano focus) ===');
  const focusBooks = ['Bet365', 'Betano'];
  for (const bookName of focusBooks) {
    log(`--- ${bookName} ---`);
    const bookHits = playerHits.filter((hit) => String(hit.bookmaker).toLowerCase() === bookName.toLowerCase());
    if (!bookHits.length) {
      log('  (no rows for this player)');
      continue;
    }
    for (const kind of ['anytime', 'goals_ou', 'assists', 'sot', 'shots']) {
      const kindHits = bookHits.filter((hit) => hit.kind === kind);
      if (!kindHits.length) continue;
      log(`  ${kind}:`);
      for (const hit of kindHits) {
        log(`    [${hit.betId}] ${hit.betName} | "${hit.value}" -> ${hit.american}`);
      }
    }
  }
  log('');

  log('=== Bare Over/Under rows in player-ish markets (often the bad matches) ===');
  let bareCount = 0;
  for (const row of oddsRows) {
    for (const bookmaker of row.bookmakers ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        if (!apiFootballPlayerishBet(bet.name)) continue;
        for (const value of bet.values ?? []) {
          const label = String(value?.value ?? '').trim();
          if (!/^(over|under)\b/i.test(label)) continue;
          bareCount += 1;
          if (bareCount <= 40) {
            log(
              `${bookmaker.name} | [${bet.id}] ${bet.name} | "${label}" -> ${value?.odd} (${formatOdd(value?.odd)})${value?.handicap != null ? ` handicap=${value.handicap}` : ''}`
            );
          }
        }
      }
    }
  }
  if (bareCount > 40) log(`... +${bareCount - 40} more bare Over/Under rows`);
  if (!bareCount) log('(none)');
  log('');

  log(`Wrote ${outPath}`);
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  const jsonPath = outPath.replace(/\.txt$/i, '.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        playerName,
        teamName,
        fixtureId,
        match: {
          home: fixture.teams?.home?.name ?? null,
          away: fixture.teams?.away?.name ?? null,
          date: fixture.fixture?.date ?? null,
        },
        betNameHits,
        playerHits,
        bareOverUnderSample: bareCount,
      },
      null,
      2
    ),
    'utf8'
  );
  log(`Wrote ${jsonPath}`);
}

async function apiFootballGet(path, params) {
  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { 'x-apisports-key': API_FOOTBALL_KEY },
    cache: 'no-store',
  });
  const json = await response.json().catch(() => ({}));
  return { response, json, url: url.toString() };
}

async function inspectApiFootballOdds() {
  console.log('API-Football odds inspect');
  console.log('Env key:', API_FOOTBALL_KEY ? 'found' : 'missing');
  console.log('');

  if (!API_FOOTBALL_KEY) {
    console.error('Missing API_FOOTBALL_KEY in .env.local');
    process.exitCode = 1;
    return;
  }

  console.log('=== Bet type searches ===');
  for (const term of ['scorer', 'goal', 'shot', 'assist', 'player']) {
    const { response, json } = await apiFootballGet('/odds/bets', { search: term });
    const rows = Array.isArray(json?.response) ? json.response : [];
    console.log(`search="${term}" -> ${rows.length} types (HTTP ${response.status})`);
    for (const bet of rows.slice(0, 15)) {
      console.log(`  [${bet.id}] ${bet.name}`);
    }
    if (rows.length > 15) console.log(`  ... +${rows.length - 15} more`);
  }
  console.log('');

  console.log('=== World Cup 2026 coverage ===');
  const wc = await apiFootballGet('/leagues', { id: 1, season: 2026 });
  const wcRow = Array.isArray(wc.json?.response) ? wc.json.response[0] : null;
  console.log(`HTTP ${wc.response.status} | league: ${wcRow?.league?.name ?? 'n/a'}`);
  const coverage = wcRow?.seasons?.[0]?.coverage ?? wcRow?.coverage ?? null;
  console.log(`coverage: ${JSON.stringify(coverage)}`);
  console.log('');

  console.log('=== Pick a fixture ===');
  const candidates = [
    { label: 'World Cup 2026 next', league: 1, season: 2026, mode: 'next' },
    { label: 'World Cup 2022 last', league: 1, season: 2022, mode: 'last' },
    { label: 'Premier League 2025 next', league: 39, season: 2025, mode: 'next' },
  ];

  let fixture = null;
  let source = null;
  for (const candidate of candidates) {
    const params = { league: candidate.league, season: candidate.season };
    params[candidate.mode] = 1;
    const { json } = await apiFootballGet('/fixtures', params);
    const rows = Array.isArray(json?.response) ? json.response : [];
    if (rows[0]?.fixture?.id) {
      fixture = rows[0];
      source = candidate.label;
      break;
    }
  }

  if (!fixture) {
    console.log('No fixture found.');
    return;
  }

  const fixtureId = fixture.fixture.id;
  console.log(`source: ${source}`);
  console.log(`fixture id: ${fixtureId}`);
  console.log(
    `match: ${fixture.teams?.home?.name ?? '?'} vs ${fixture.teams?.away?.name ?? '?'} @ ${fixture.fixture?.date}`
  );
  console.log('');

  console.log(`=== Odds for fixture ${fixtureId} ===`);
  const odds = await apiFootballGet('/odds', { fixture: fixtureId });
  const oddsRows = Array.isArray(odds.json?.response) ? odds.json.response : [];
  console.log(`HTTP ${odds.response.status} | rows: ${oddsRows.length}`);

  const betMap = new Map();
  for (const row of oddsRows) {
    for (const bookmaker of row.bookmakers ?? []) {
      for (const bet of bookmaker.bets ?? []) {
        betMap.set(bet.id, bet.name);
      }
    }
  }

  const bets = [...betMap.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  console.log(`unique markets: ${bets.length}`);
  for (const [id, name] of bets) {
    const tag = apiFootballPlayerishBet(name) ? ' <-- player-ish' : '';
    console.log(`  [${id}] ${name}${tag}`);
  }

  const playerBets = bets.filter(([, name]) => apiFootballPlayerishBet(name));
  console.log(`player-ish markets: ${playerBets.length}`);
  console.log('');

  if (playerBets.length) {
    console.log('=== Sample player-ish odds ===');
    for (const row of oddsRows) {
      for (const bookmaker of row.bookmakers ?? []) {
        for (const bet of bookmaker.bets ?? []) {
          if (!apiFootballPlayerishBet(bet.name)) continue;
          console.log(`Bookmaker: ${bookmaker.name} | [${bet.id}] ${bet.name}`);
          for (const value of (bet.values ?? []).slice(0, 8)) {
            console.log(`  ${JSON.stringify(value)}`);
          }
          if ((bet.values?.length ?? 0) > 8) {
            console.log(`  ... +${bet.values.length - 8} more`);
          }
        }
      }
    }
  }

  console.log('');
  console.log('API-Football odds inspect done.');
}

function buildUrl(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  return url;
}

function authHeaders(candidate) {
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: candidate,
  };
}

function authCandidates() {
  if (!API_KEY) return [];
  if (API_KEY.toLowerCase().startsWith('bearer ')) {
    const raw = API_KEY.replace(/^bearer\s+/i, '').trim();
    return [raw, API_KEY].filter(Boolean);
  }
  return [API_KEY, `Bearer ${API_KEY}`];
}

async function fetchWithAuthFallback(url) {
  let lastResult = null;
  for (const candidate of authCandidates()) {
    const response = await fetch(url, { headers: authHeaders(candidate), cache: 'no-store' });
    const text = await response.text();
    lastResult = { response, text };
    if (response.ok || response.status !== 401) return lastResult;
  }
  return lastResult;
}

function summarizePayload(text) {
  try {
    const payload = JSON.parse(text);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const first = data[0] || null;
    const firstLabel =
      first?.name ||
      first?.homeLabel ||
      first?.home_team?.name ||
      first?.player?.name ||
      first?.subject?.name ||
      first?.market_name ||
      null;
    return {
      count: data.length,
      nextCursor: payload?.meta?.next_cursor ?? null,
      firstLabel,
      error: payload?.error || null,
    };
  } catch {
    return { count: null, nextCursor: null, firstLabel: null, error: text.slice(0, 180) };
  }
}

async function main() {
  if (process.argv.includes('--probe-player-odds')) {
    await probePlayerOdds();
    return;
  }

  if (process.argv.includes('--api-football-odds')) {
    await inspectApiFootballOdds();
    return;
  }

  console.log('FIFA World Cup BDL API smoke test');
  console.log(
    'Env files:',
    loadedEnvFiles.length
      ? loadedEnvFiles.map((entry) => `${entry.file} (${entry.count} keys)`).join(', ')
      : 'none found'
  );
  console.log('Env key:', API_KEY ? 'found' : 'missing');
  console.log('');

  if (!API_KEY) {
    console.error('Missing BALLDONTLIE_API_KEY or BALL_DONT_LIE_API_KEY.');
    console.error('Checked .env.local, .env.development.local, and .env from the repo root.');
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const check of checks) {
    const url = buildUrl(check.path, check.params);
    try {
      const result = await fetchWithAuthFallback(url);
      if (!result) {
        failures++;
        console.log(`FAIL ${check.label}: no auth candidates`);
        continue;
      }

      const { response, text } = result;
      const summary = summarizePayload(text);
      const status = response.ok ? 'OK' : 'FAIL';
      if (!response.ok) failures++;

      console.log(`${status} ${check.label}`);
      console.log(`  HTTP ${response.status}`);
      console.log(`  rows: ${summary.count ?? 'n/a'}${summary.nextCursor ? `, next_cursor: ${summary.nextCursor}` : ''}`);
      if (summary.firstLabel) console.log(`  first: ${summary.firstLabel}`);
      if (summary.error) console.log(`  message: ${summary.error}`);
    } catch (error) {
      failures++;
      console.log(`FAIL ${check.label}`);
      console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('');
  }

  await inspectRonaldo();

  if (failures > 0) {
    console.log(`${failures} check(s) failed. A 401 on GOAT endpoints usually means the World Cup sport tier is not active yet.`);
    process.exitCode = 1;
    return;
  }

  console.log('All World Cup API checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
