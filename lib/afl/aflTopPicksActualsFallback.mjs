/**
 * Alternate sources for AFL Top Picks actual disposals when FootyWire player logs miss.
 * Prefer Wheeloratings match-stats JSON; fall back to ESPN AFL box scores.
 */

const WHEELO_ROUND_URL = (roundId) =>
  `https://www.wheeloratings.com/src/match_stats/table_data/${roundId}.json`;
const ESPN_SCOREBOARD_URL = (yyyymmdd) =>
  `https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=${yyyymmdd}`;
const ESPN_SUMMARY_URL = (eventId) =>
  `https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/summary?event=${eventId}`;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
};

/** Map common StatTrackr / odds names onto Wheeloratings / ESPN short club names. */
const TEAM_CANONICAL = {
  adelaide: 'adelaide',
  'adelaide crows': 'adelaide',
  brisbane: 'brisbane',
  'brisbane lions': 'brisbane',
  carlton: 'carlton',
  'carlton blues': 'carlton',
  collingwood: 'collingwood',
  'collingwood magpies': 'collingwood',
  essendon: 'essendon',
  'essendon bombers': 'essendon',
  fremantle: 'fremantle',
  'fremantle dockers': 'fremantle',
  geelong: 'geelong',
  'geelong cats': 'geelong',
  goldcoast: 'gold coast',
  'gold coast': 'gold coast',
  'gold coast suns': 'gold coast',
  gws: 'greater western sydney',
  'gws giants': 'greater western sydney',
  'greater western sydney': 'greater western sydney',
  'greater western sydney giants': 'greater western sydney',
  hawthorn: 'hawthorn',
  'hawthorn hawks': 'hawthorn',
  melbourne: 'melbourne',
  'melbourne demons': 'melbourne',
  'north melbourne': 'north melbourne',
  'north melbourne kangaroos': 'north melbourne',
  'port adelaide': 'port adelaide',
  'port adelaide power': 'port adelaide',
  richmond: 'richmond',
  'richmond tigers': 'richmond',
  'st kilda': 'st kilda',
  'st kilda saints': 'st kilda',
  sydney: 'sydney',
  'sydney swans': 'sydney',
  'west coast': 'west coast',
  'west coast eagles': 'west coast',
  'western bulldogs': 'western bulldogs',
  bulldogs: 'western bulldogs',
};

function normalizePlayerName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B\u2032`']/g, ' ') // D'Ambrosio -> D Ambrosio
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIRST_NAME_ALIASES = new Map([
  ['joe', 'joseph'],
  ['joseph', 'joseph'],
  ['cam', 'cameron'],
  ['cameron', 'cameron'],
  ['matt', 'matthew'],
  ['matthew', 'matthew'],
  ['will', 'william'],
  ['william', 'william'],
  ['tom', 'thomas'],
  ['thomas', 'thomas'],
  ['sam', 'samuel'],
  ['samuel', 'samuel'],
  ['alex', 'alexander'],
  ['alexander', 'alexander'],
  ['max', 'maxwell'],
  ['maxwell', 'maxwell'],
  ['ben', 'benjamin'],
  ['benjamin', 'benjamin'],
  ['nick', 'nicholas'],
  ['nicholas', 'nicholas'],
  ['dan', 'daniel'],
  ['daniel', 'daniel'],
  ['josh', 'joshua'],
  ['joshua', 'joshua'],
  ['chris', 'christopher'],
  ['christopher', 'christopher'],
]);

function canonicalFirstName(first) {
  const key = String(first ?? '')
    .trim()
    .toLowerCase();
  return FIRST_NAME_ALIASES.get(key) || key;
}

function firstNamesCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true; // cam/cameron, joe/joseph
  return canonicalFirstName(a) === canonicalFirstName(b);
}

function normalizeTeamKey(name) {
  const raw = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return TEAM_CANONICAL[raw] || raw;
}

function teamsMatch(a, b) {
  const na = normalizeTeamKey(a);
  const nb = normalizeTeamKey(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function playersMatch(a, b) {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const as = na.split(' ').filter(Boolean);
  const bs = nb.split(' ').filter(Boolean);
  if (as.length < 2 || bs.length < 2) return false;
  const aLast = as[as.length - 1];
  const bLast = bs[bs.length - 1];
  if (aLast !== bLast) return false;
  // Same surname: allow Joe/Joseph, Cam/Cameron, and dropped middle names.
  if (firstNamesCompatible(as[0], bs[0])) return true;
  return false;
}

function parseDisposals(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '')
    .trim()
    .replace(/,/g, '');
  if (!raw || raw === '--' || raw === '-' || raw.toLowerCase() === 'null') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function roundIdFromRoundKey(roundKey) {
  const match = String(roundKey ?? '')
    .trim()
    .match(/^(\d{4})-R(\d{1,2})$/i);
  if (!match) return null;
  return `${match[1]}${String(Number.parseInt(match[2], 10)).padStart(2, '0')}`;
}

function yyyymmddFromIsoDate(isoDate) {
  const m = String(isoDate ?? '')
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

function wheeloDateMatchesIso(wheeloDate, isoDate) {
  // Wheeloratings uses "09 Jul" (no year).
  const iso = String(isoDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const expected = parsed.toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  // "09 Jul" vs "9 Jul"
  const compact = (s) =>
    String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/^0/, '')
      .replace(/\s+/g, ' ');
  return compact(wheeloDate) === compact(expected);
}

async function fetchJson(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();
  cache.set(url, pending);
  return pending;
}

function extractWheeloRows(payload) {
  const blocks = Array.isArray(payload?.Data) ? payload.Data : [];
  const rows = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const players = asArray(block.Player);
    const disposals = asArray(block.Disposals);
    const matchIds = asArray(block.MatchId);
    const teams = asArray(block.Team);
    for (let i = 0; i < players.length; i += 1) {
      rows.push({
        playerName: String(players[i] ?? ''),
        disposals: parseDisposals(disposals[i]),
        matchId: String(matchIds[i] ?? matchIds[0] ?? ''),
        team: String(teams[i] ?? teams[0] ?? ''),
      });
    }
  }
  return rows;
}

function extractWheeloMatches(payload) {
  const matches = payload?.Matches?.[0] ?? payload?.Matches;
  if (!matches || typeof matches !== 'object') return [];
  const ids = asArray(matches.MatchId);
  const dates = asArray(matches.MatchDate);
  const homes = asArray(matches.HomeTeam);
  const aways = asArray(matches.AwayTeam);
  const out = [];
  const n = Math.max(ids.length, dates.length, homes.length, aways.length);
  for (let i = 0; i < n; i += 1) {
    out.push({
      matchId: String(ids[i] ?? ids[0] ?? ''),
      matchDate: String(dates[i] ?? dates[0] ?? ''),
      homeTeam: String(homes[i] ?? homes[0] ?? ''),
      awayTeam: String(aways[i] ?? aways[0] ?? ''),
    });
  }
  return out;
}

function findEspnEvent(scoreboard, homeTeam, awayTeam) {
  const events = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
  return (
    events.find((ev) => {
      const competitors = ev?.competitions?.[0]?.competitors ?? [];
      const names = competitors.map(
        (c) => c?.team?.displayName || c?.team?.name || c?.team?.shortDisplayName || ''
      );
      const hasHome = names.some((n) => teamsMatch(n, homeTeam));
      const hasAway = names.some((n) => teamsMatch(n, awayTeam));
      return hasHome && hasAway;
    }) ?? null
  );
}

function espnEventIsFinal(event) {
  const type = event?.competitions?.[0]?.status?.type ?? event?.status?.type ?? null;
  if (!type || typeof type !== 'object') return false;
  if (type.completed === true) return true;
  const state = String(type.state ?? '').toLowerCase();
  const name = String(type.name ?? '').toUpperCase();
  return state === 'post' || name === 'STATUS_FINAL';
}

/**
 * True only when ESPN marks the match Final. Live/in-progress box scores must not settle picks.
 */
export async function isAflGameFinalOnEspn({ homeTeam, awayTeam, gameDate }, cache = new Map()) {
  const ymd = yyyymmddFromIsoDate(gameDate);
  if (!ymd) return false;
  const scoreboard = await fetchJson(ESPN_SCOREBOARD_URL(ymd), cache);
  const event = findEspnEvent(scoreboard, homeTeam, awayTeam);
  return espnEventIsFinal(event);
}

async function lookupWheeloratingsActual(
  { playerName, homeTeam, awayTeam, gameDate, roundKey },
  cache
) {
  const roundId = roundIdFromRoundKey(roundKey);
  if (!roundId) return null;
  const payload = await fetchJson(WHEELO_ROUND_URL(roundId), cache);
  if (!payload) return null;

  const matches = extractWheeloMatches(payload);
  const match =
    matches.find(
      (m) =>
        teamsMatch(m.homeTeam, homeTeam) &&
        teamsMatch(m.awayTeam, awayTeam) &&
        (!gameDate || !m.matchDate || wheeloDateMatchesIso(m.matchDate, gameDate))
    ) ||
    matches.find((m) => teamsMatch(m.homeTeam, homeTeam) && teamsMatch(m.awayTeam, awayTeam));

  const rows = extractWheeloRows(payload).filter((row) => {
    if (match?.matchId && row.matchId && row.matchId !== match.matchId) return false;
    return playersMatch(row.playerName, playerName);
  });

  const withDisp = rows.find((row) => row.disposals != null);
  return withDisp?.disposals ?? null;
}

function espnAthleteDisposals(statGroup, athlete) {
  const labels = Array.isArray(statGroup?.labels) ? statGroup.labels : [];
  const stats = Array.isArray(athlete?.stats) ? athlete.stats : [];
  const idx = labels.findIndex((label) => String(label).toUpperCase() === 'D');
  if (idx < 0) return null;
  return parseDisposals(stats[idx]);
}

async function lookupEspnActual({ playerName, homeTeam, awayTeam, gameDate }, cache) {
  const ymd = yyyymmddFromIsoDate(gameDate);
  if (!ymd) return null;
  const scoreboard = await fetchJson(ESPN_SCOREBOARD_URL(ymd), cache);
  const event = findEspnEvent(scoreboard, homeTeam, awayTeam);
  if (!event?.id || !espnEventIsFinal(event)) return null;

  const summary = await fetchJson(ESPN_SUMMARY_URL(event.id), cache);
  const sides = Array.isArray(summary?.boxscore?.players) ? summary.boxscore.players : [];
  for (const side of sides) {
    for (const group of side?.statistics ?? []) {
      for (const athlete of group?.athletes ?? []) {
        const name = athlete?.athlete?.displayName || athlete?.athlete?.shortName || '';
        if (!playersMatch(name, playerName)) continue;
        const disposals = espnAthleteDisposals(group, athlete);
        if (disposals != null) return disposals;
      }
    }
  }
  return null;
}

/**
 * Resolve final actual disposals for one Top Pick from Wheeloratings, then ESPN.
 * Never returns live/in-progress box-score values.
 * @returns {Promise<{ actual: number, source: 'wheeloratings' | 'espn' } | null>}
 */
export async function lookupTopPicksActualFromAltSources(input, cache = new Map()) {
  const final = await isAflGameFinalOnEspn(input, cache);
  if (!final) return null;

  const wheelo = await lookupWheeloratingsActual(input, cache);
  if (wheelo != null) return { actual: wheelo, source: 'wheeloratings' };
  const espn = await lookupEspnActual(input, cache);
  if (espn != null) return { actual: espn, source: 'espn' };
  return null;
}

export const __test = {
  normalizePlayerName,
  normalizeTeamKey,
  teamsMatch,
  playersMatch,
  roundIdFromRoundKey,
  wheeloDateMatchesIso,
  espnEventIsFinal,
};
