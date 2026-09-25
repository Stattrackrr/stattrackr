/**
 * API-Tennis (api-tennis.com) cache + fixture → TennisMatchRow mapping.
 * Compiled by scripts/fetch-api-tennis.ts into data/tennis/api-tennis/.
 */

import fs from 'fs';
import path from 'path';
import type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';
import { tennisDominanceRatio, resolveTennisMatchBestOf } from '@/lib/tennis/chartStats';
import { resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';
import { tennisHandForName } from '@/lib/tennis/hands';
import { lookupTennisSurface, tennisSurfacesMtime } from '@/lib/tennis/surfaces';
import { derivePointByPointStats, type ApiPointByPointGame } from '@/lib/tennis/pointByPointStats';
import { tennisIocToIso2 } from '@/lib/tennis/flags';

export const API_TENNIS_EVENT = {
  ATP_SINGLES: '265',
  WTA_SINGLES: '266',
  CHALLENGER_MEN_SINGLES: '281',
  /** Challenger Women Singles. 274 is Teams Mix — do not use that key. */
  CHALLENGER_WOMEN_SINGLES: '272',
  ITF_MEN_SINGLES: '270',
  ITF_WOMEN_SINGLES: '271',
} as const;

export type TennisSinglesEvent = {
  tour: TennisTour;
  eventType: string;
  label: string;
};

/** ATP/WTA tour + Challenger + ITF singles. Doubles/exhibitions/juniors stay out. */
export const API_TENNIS_SINGLES_EVENTS: TennisSinglesEvent[] = [
  { tour: 'ATP', eventType: API_TENNIS_EVENT.ATP_SINGLES, label: 'ATP' },
  { tour: 'WTA', eventType: API_TENNIS_EVENT.WTA_SINGLES, label: 'WTA' },
  { tour: 'ATP', eventType: API_TENNIS_EVENT.CHALLENGER_MEN_SINGLES, label: 'CHALLENGER_MEN' },
  { tour: 'WTA', eventType: API_TENNIS_EVENT.CHALLENGER_WOMEN_SINGLES, label: 'CHALLENGER_WOMEN' },
  { tour: 'ATP', eventType: API_TENNIS_EVENT.ITF_MEN_SINGLES, label: 'ITF_MEN' },
  { tour: 'WTA', eventType: API_TENNIS_EVENT.ITF_WOMEN_SINGLES, label: 'ITF_WOMEN' },
];

export const API_TENNIS_LOWER_SINGLES_EVENTS = API_TENNIS_SINGLES_EVENTS.filter(
  (row) =>
    row.eventType !== API_TENNIS_EVENT.ATP_SINGLES && row.eventType !== API_TENNIS_EVENT.WTA_SINGLES
);

export type ApiTennisStanding = {
  place: number;
  player: string;
  player_key: number | string;
  league: string;
  movement?: string;
  country?: string;
  points?: string | number;
};

export type ApiTennisPlayer = TennisPlayer & { imageUrl?: string | null };

export type ApiTennisCache = {
  fetchedAt: string;
  source: 'api-tennis';
  matches: TennisMatchRow[];
  players: ApiTennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

type ApiStat = {
  player_key?: number | string;
  stat_period?: string;
  stat_type?: string;
  stat_name?: string;
  stat_value?: string | number | null;
  stat_won?: number | string | null;
  stat_total?: number | string | null;
};

type ApiScore = {
  score_first?: string | number;
  score_second?: string | number;
  score_set?: string | number;
};

export type ApiTennisFixture = {
  event_key?: number | string;
  event_date?: string;
  event_time?: string;
  event_first_player?: string;
  first_player_key?: number | string;
  event_second_player?: string;
  second_player_key?: number | string;
  event_final_result?: string;
  event_winner?: string | null;
  event_status?: string;
  event_type_type?: string;
  tournament_name?: string;
  tournament_key?: number | string;
  tournament_round?: string;
  tournament_season?: string | number;
  event_qualification?: string | boolean;
  event_first_player_logo?: string | null;
  event_second_player_logo?: string | null;
  scores?: ApiScore[];
  statistics?: ApiStat[];
  pointbypoint?: ApiPointByPointGame[];
};

export type ApiPlayerInfo = {
  playerId: string;
  name: string;
  tour: TennisTour;
  ioc: string | null;
  rank: number | null;
  rankPoints: number | null;
  imageUrl: string | null;
};

const COUNTRY_TO_IOC: Record<string, string> = {
  argentina: 'ARG',
  australia: 'AUS',
  austria: 'AUT',
  belgium: 'BEL',
  brazil: 'BRA',
  bulgaria: 'BUL',
  canada: 'CAN',
  chile: 'CHI',
  china: 'CHN',
  colombia: 'COL',
  croatia: 'CRO',
  czechia: 'CZE',
  'czech republic': 'CZE',
  denmark: 'DEN',
  ecuador: 'ECU',
  egypt: 'EGY',
  estonia: 'EST',
  finland: 'FIN',
  france: 'FRA',
  germany: 'GER',
  'great britain': 'GBR',
  'united kingdom': 'GBR',
  england: 'GBR',
  greece: 'GRE',
  hungary: 'HUN',
  india: 'IND',
  italy: 'ITA',
  japan: 'JPN',
  kazakhstan: 'KAZ',
  latvia: 'LAT',
  lithuania: 'LTU',
  mexico: 'MEX',
  morocco: 'MAR',
  netherlands: 'NED',
  'new zealand': 'NZL',
  norway: 'NOR',
  poland: 'POL',
  portugal: 'POR',
  romania: 'ROU',
  russia: 'RUS',
  serbia: 'SRB',
  slovakia: 'SVK',
  slovenia: 'SLO',
  'south africa': 'RSA',
  'south korea': 'KOR',
  korea: 'KOR',
  spain: 'ESP',
  sweden: 'SWE',
  switzerland: 'SUI',
  taiwan: 'TPE',
  'chinese taipei': 'TPE',
  tunisia: 'TUN',
  turkey: 'TUR',
  ukraine: 'UKR',
  'united states': 'USA',
  usa: 'USA',
  uruguay: 'URU',
  uzbekistan: 'UZB',
  peru: 'PER',
  ireland: 'IRL',
  'republic of ireland': 'IRL',
  bosnia: 'BIH',
  'bosnia and herzegovina': 'BIH',
  monaco: 'MON',
  luxembourg: 'LUX',
  georgia: 'GEO',
  armenia: 'ARM',
  azerbaijan: 'AZE',
  belarus: 'BLR',
  bolivia: 'BOL',
  'costa rica': 'CRC',
  cyprus: 'CYP',
  'dominican republic': 'DOM',
  'el salvador': 'ESA',
  guatemala: 'GUA',
  honduras: 'HON',
  'hong kong': 'HKG',
  indonesia: 'INA',
  iran: 'IRI',
  israel: 'ISR',
  jamaica: 'JAM',
  kenya: 'KEN',
  lebanon: 'LIB',
  liechtenstein: 'LIE',
  malaysia: 'MAS',
  moldova: 'MDA',
  montenegro: 'MNE',
  nigeria: 'NGR',
  paraguay: 'PAR',
  philippines: 'PHI',
  'puerto rico': 'PUR',
  qatar: 'QAT',
  'saudi arabia': 'KSA',
  thailand: 'THA',
  venezuela: 'VEN',
  vietnam: 'VIE',
  zimbabwe: 'ZIM',
  algeria: 'ALG',
  andorra: 'AND',
  bahamas: 'BAH',
  barbados: 'BAR',
  botswana: 'BOT',
  iceland: 'ISL',
  malta: 'MLT',
  pakistan: 'PAK',
  uae: 'UAE',
  'united arab emirates': 'UAE',
  kosovo: 'KOS',
  senegal: 'SEN',
  ghana: 'GHA',
  cameroon: 'CMR',
  "cote d'ivoire": 'CIV',
  'ivory coast': 'CIV',
};

export function apiTennisDir(): string {
  return path.join(process.cwd(), 'data', 'tennis', 'api-tennis');
}

export function apiTennisCachePath(): string {
  return path.join(apiTennisDir(), 'cache.json');
}

/** Pull one player's rows out of the compiled cache without building the full match list. */
export function readApiTennisPlayerMatches(playerId: string): TennisMatchRow[] {
  const id = String(playerId || '').trim();
  if (!id) return [];
  const file = apiTennisCachePath();
  if (!fs.existsSync(file)) return [];
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const needle = `"playerId":"${id}"`;
  const rows: TennisMatchRow[] = [];
  let from = 0;
  while (from < raw.length) {
    const at = raw.indexOf(needle, from);
    if (at < 0) break;
    let start = at;
    while (start > 0 && raw[start] !== '{') start -= 1;
    let depth = 0;
    let inStr = false;
    let end = start;
    for (; end < raw.length; end += 1) {
      const ch = raw[end];
      if (inStr) {
        if (ch === '\\') {
          end += 1;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    try {
      const row = JSON.parse(raw.slice(start, end)) as TennisMatchRow;
      if (String(row?.playerId || '') === id) rows.push(row);
    } catch {
      /* skip a malformed object */
    }
    from = Math.max(end, at + needle.length);
  }
  return rows;
}

export function apiTennisRosterPath(): string {
  return path.join(apiTennisDir(), 'roster.json');
}

export type ApiTennisRoster = {
  fetchedAt: string;
  source: string;
  players: ApiTennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

export function writeApiTennisRoster(input: {
  fetchedAt?: string;
  players?: ApiTennisPlayer[] | null;
  standings?: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] } | null;
}): void {
  const roster: ApiTennisRoster = {
    fetchedAt: input.fetchedAt || new Date().toISOString(),
    source: 'api-tennis',
    players: input.players || [],
    standings: {
      ATP: input.standings?.ATP || [],
      WTA: input.standings?.WTA || [],
    },
  };
  fs.mkdirSync(apiTennisDir(), { recursive: true });
  fs.writeFileSync(apiTennisRosterPath(), JSON.stringify(roster));
}

export function countryToIoc(country: string | null | undefined): string | null {
  const raw = String(country || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (key === 'world') return null;
  if (COUNTRY_TO_IOC[key]) return COUNTRY_TO_IOC[key];
  const upper = raw.toUpperCase();
  if (upper.length === 3 && tennisIocToIso2(upper)) return upper;
  return null;
}

export function tourFromEventType(eventType: string | null | undefined): TennisTour | null {
  const t = String(eventType || '').toLowerCase();
  if (!t || t.includes('double')) return null;
  if (t.includes('wta') || t.includes('women') || t.includes('girl')) return 'WTA';
  if (t.includes('atp') || t.includes('challenger') || t.includes('itf') || t.includes('men') || t.includes('boy')) {
    return 'ATP';
  }
  return null;
}

export function parseApiRound(raw: string | null | undefined): string {
  const s = String(raw || '').toLowerCase();
  // Qualifying first: API-Tennis labels Q finals as "Qualifying Semi-Final" / "Qualifying Final",
  // which would otherwise collapse to SF/F and inflate Challenger fields to ~46.
  if (/qualif|\bq[\s-]?[123]\b|\bq-?final|\bqr\b/.test(s)) {
    if (/final/.test(s) && !/semi|quarter/.test(s)) return 'Q-F';
    if (/semi/.test(s)) return 'Q-SF';
    if (/quarter/.test(s) || /\bq3\b/.test(s)) return 'Q3';
    if (/\bq2\b/.test(s)) return 'Q2';
    return 'Q1';
  }
  if (/1\/64|round of 128|\br128\b/.test(s)) return 'R128';
  if (/1\/32|round of 64|\br64\b/.test(s)) return 'R64';
  if (/1\/16|round of 32|\br32\b/.test(s)) return 'R32';
  if (/1\/8|round of 16|\br16\b/.test(s)) return 'R16';
  if (/quarter/.test(s)) return 'QF';
  if (/semi/.test(s)) return 'SF';
  if (/\bfinal\b/.test(s) && !/semi|quarter/.test(s)) return 'F';
  if (/round robin|\brr\b/.test(s)) return 'RR';
  return String(raw || '').trim();
}

export function isApiGrandSlam(name: string | null | undefined): boolean {
  return /australian open|roland garros|french open|\bwimbledon\b|\bus open\b/.test(
    String(name || '').toLowerCase()
  );
}

/** WTA singles is always best of 3, including slams. ATP slams are best of 5. */
export function tennisBestOf(tour: TennisTour | null | undefined, isGrandSlam: boolean): 3 | 5 {
  if (tour === 'WTA') return 3;
  return isGrandSlam ? 5 : 3;
}

export function inferApiSurface(
  name: string | null | undefined,
  tournamentKey?: string | number | null
): string {
  return lookupTennisSurface(name, tournamentKey);
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseStatFraction(value: string | number | null | undefined): { won: number; total: number } | null {
  const raw = String(value ?? '').replace(/,/g, '');
  const m = raw.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const won = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(won) || !Number.isFinite(total)) return null;
  return { won, total };
}

function parseSetToken(raw: unknown): { games: number; tb: number | null } {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { games: 0, tb: null };
  const games = Math.trunc(n);
  const frac = Math.round(Math.abs(n - games) * 10);
  return { games, tb: frac > 0 ? frac : null };
}

function formatScoreFromSets(
  scores: ApiScore[],
  firstIsPlayer: boolean,
  retired: boolean
): { score: string; gamesWon: number; gamesLost: number; setsWon: number; setsLost: number } {
  let gamesWon = 0;
  let gamesLost = 0;
  let setsWon = 0;
  let setsLost = 0;
  const parts: string[] = [];
  for (const set of scores) {
    const label = String(set.score_set ?? '').toLowerCase();
    if (label.includes('total') || label.includes('match')) continue;
    const a = parseSetToken(set.score_first);
    const b = parseSetToken(set.score_second);
    const mine = firstIsPlayer ? a : b;
    const opp = firstIsPlayer ? b : a;
    gamesWon += mine.games;
    gamesLost += opp.games;
    if (mine.games === opp.games && mine.games === 0) continue;
    if (mine.games > opp.games) setsWon += 1;
    else if (opp.games > mine.games) setsLost += 1;
    const tb = mine.tb ?? opp.tb;
    parts.push(tb != null ? `${mine.games}-${opp.games}(${tb})` : `${mine.games}-${opp.games}`);
  }
  const score = retired && parts.length ? `${parts.join(' ')} RET` : parts.join(' ');
  return { score, gamesWon, gamesLost, setsWon, setsLost };
}

function normStatName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[%]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasRealApiStatistics(stats: ApiStat[]): boolean {
  return stats.some((st) => {
    const period = String(st.stat_period || 'match').toLowerCase();
    if (period && period !== 'match') return false;
    const name = String(st.stat_name || '').trim();
    if (!name) return false;
    if (st.stat_won != null && String(st.stat_won).trim() !== '') return true;
    if (st.stat_total != null && String(st.stat_total).trim() !== '') return true;
    const value = String(st.stat_value ?? '').trim();
    return value !== '' && value !== '-' && value !== 'null';
  });
}

function statsForPlayer(stats: ApiStat[], playerId: string): Map<string, ApiStat> {
  const map = new Map<string, ApiStat>();
  for (const st of stats) {
    if (String(st.player_key ?? '') !== playerId) continue;
    if (String(st.stat_period || 'match').toLowerCase() !== 'match') continue;
    map.set(normStatName(st.stat_name), st);
  }
  return map;
}

function statWon(map: Map<string, ApiStat>, name: string): number | null {
  const st = map.get(normStatName(name));
  if (!st) return null;
  const won = toNum(st.stat_won);
  if (won != null) return won;
  const frac = parseStatFraction(st.stat_value);
  if (frac) return frac.won;
  const raw = String(st.stat_value ?? '').replace(/,/g, '');
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function statTotal(map: Map<string, ApiStat>, name: string): number | null {
  const st = map.get(normStatName(name));
  if (!st) return null;
  const total = toNum(st.stat_total);
  if (total != null) return total;
  return parseStatFraction(st.stat_value)?.total ?? null;
}

function statPct(map: Map<string, ApiStat>, name: string): number | null {
  const st = map.get(normStatName(name));
  if (!st) return null;
  const won = toNum(st.stat_won);
  const total = toNum(st.stat_total);
  if (won != null && total != null && total > 0) return (won / total) * 100;
  const frac = parseStatFraction(st.stat_value);
  if (frac && frac.total > 0) return (frac.won / frac.total) * 100;
  const m = String(st.stat_value ?? '').match(/([\d.]+)\s*%/);
  return m ? Number(m[1]) : null;
}

function pct(num: number | null, den: number | null): number | null {
  if (num == null || den == null || den <= 0) return null;
  return (num / den) * 100;
}

function parseSpeedKmh(map: Map<string, ApiStat>, name: string): number | null {
  const st = map.get(normStatName(name));
  if (!st) return null;
  const m = String(st.stat_value ?? '').match(/([\d.]+)/);
  return m ? Number(m[1]) : null;
}

export function mapApiFixtureToRows(
  fx: ApiTennisFixture,
  players: Map<string, ApiPlayerInfo>
): TennisMatchRow[] {
  const status = String(fx.event_status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'walkover' || status === 'wo' || status === 'w/o') return [];
  const tour = tourFromEventType(fx.event_type_type);
  if (!tour) return [];
  const firstId = String(fx.first_player_key ?? '').trim();
  const secondId = String(fx.second_player_key ?? '').trim();
  if (!firstId || !secondId) return [];

  const firstInfo = players.get(firstId);
  const secondInfo = players.get(secondId);
  const firstName = firstInfo?.name || String(fx.event_first_player || '').trim();
  const secondName = secondInfo?.name || String(fx.event_second_player || '').trim();
  if (!firstName || !secondName) return [];

  const winnerRaw = String(fx.event_winner || '').toLowerCase();
  const retired = /retir/.test(status);
  const finished = status === 'finished' || retired || winnerRaw.includes('player');
  if (!finished) return [];

  let firstIsWinner = winnerRaw.includes('first');
  if (!firstIsWinner && winnerRaw.includes('second')) firstIsWinner = false;
  else if (!winnerRaw.includes('first') && !winnerRaw.includes('second')) {
    const sets = String(fx.event_final_result || '').split('-').map((p) => Number(p.trim()));
    if (sets.length >= 2 && Number.isFinite(sets[0]) && Number.isFinite(sets[1])) {
      firstIsWinner = sets[0] > sets[1];
    } else {
      return [];
    }
  }

  const season = toNum(fx.tournament_season) || Number(String(fx.event_date || '').slice(0, 4)) || 0;
  const tourneyName = String(fx.tournament_name || '').trim() || 'Unknown';
  const slam = isApiGrandSlam(tourneyName);
  const surface = inferApiSurface(tourneyName, fx.tournament_key);
  const round = parseApiRound(fx.tournament_round);
  const scores = Array.isArray(fx.scores) ? fx.scores : [];
  const stats = Array.isArray(fx.statistics) ? fx.statistics : [];
  const pbp = hasRealApiStatistics(stats) ? null : derivePointByPointStats(fx.pointbypoint);
  const preview = formatScoreFromSets(scores, true, retired);
  if (preview.gamesWon + preview.gamesLost <= 0) return [];
  const qualifyingEvent = fx.event_qualification === 'True' || fx.event_qualification === true;
  const bestOf = resolveTennisMatchBestOf({
    tour,
    isGrandSlam: slam,
    round,
    tournamentName: qualifyingEvent ? `${tourneyName} Qualifying` : tourneyName,
    score: retired ? `${preview.score} RET` : preview.score,
    setsWon: preview.setsWon,
    setsLost: preview.setsLost,
  });
  const date = String(fx.event_date || '').slice(0, 10) || null;
  const eventKey = String(fx.event_key ?? '');

  const sides: Array<{
    playerId: string;
    playerName: string;
    opponentId: string;
    opponent: string;
    isWin: boolean;
    firstIsPlayer: boolean;
    info?: ApiPlayerInfo;
    oppInfo?: ApiPlayerInfo;
    logo?: string | null;
  }> = [
    {
      playerId: firstId,
      playerName: firstName,
      opponentId: secondId,
      opponent: secondName,
      isWin: firstIsWinner,
      firstIsPlayer: true,
      info: firstInfo,
      oppInfo: secondInfo,
      logo: fx.event_first_player_logo,
    },
    {
      playerId: secondId,
      playerName: secondName,
      opponentId: firstId,
      opponent: firstName,
      isWin: !firstIsWinner,
      firstIsPlayer: false,
      info: secondInfo,
      oppInfo: firstInfo,
      logo: fx.event_second_player_logo,
    },
  ];

  return sides.map((side) => {
    const scored = formatScoreFromSets(scores, side.firstIsPlayer, retired);
    const mine = statsForPlayer(stats, side.playerId);
    const opp = statsForPlayer(stats, side.opponentId);
    const derived = pbp ? (side.firstIsPlayer ? pbp.first : pbp.second) : null;
    const firstIn = statTotal(mine, '1st serve points won');
    const firstWon = statWon(mine, '1st serve points won');
    const secondAtt = statTotal(mine, '2nd serve points won');
    const secondWon = statWon(mine, '2nd serve points won');
    const servePoints =
      firstIn != null && secondAtt != null
        ? firstIn + secondAtt
        : statTotal(mine, 'Service Points Won') ?? derived?.servePoints ?? null;
    const serveWon =
      firstWon != null && secondWon != null
        ? firstWon + secondWon
        : statWon(mine, 'Service Points Won') ?? derived?.servePointsWon ?? null;
    const bpSaved = statWon(mine, 'Break Points Saved') ?? derived?.breakPointsSaved ?? null;
    const bpFaced = statTotal(mine, 'Break Points Saved') ?? derived?.breakPointsFaced ?? null;
    const bpConverted = statWon(mine, 'Break Points Converted') ?? derived?.breakPointsConverted ?? null;
    const bpChances = statTotal(mine, 'Break Points Converted');
    const returnWon = statWon(mine, 'Return Points Won') ?? derived?.returnPointsWon ?? null;
    const returnFaced = statTotal(mine, 'Return Points Won') ?? derived?.returnPointsFaced ?? null;
    const pointsWon = statWon(mine, 'Total Points Won') ?? derived?.pointsWon ?? null;
    const totalPoints = statTotal(mine, 'Total Points Won') ?? derived?.totalPoints ?? null;
    const aces = statWon(mine, 'Aces');
    const oppAces = statWon(opp, 'Aces');
    const gamesWon = scored.gamesWon;
    const gamesLost = scored.gamesLost;
    const firstServePct =
      statPct(mine, '1st serve percentage') ?? pct(firstIn, servePoints);
    const firstServeWonPct = statPct(mine, '1st serve points won');
    const secondServeWonPct = statPct(mine, '2nd serve points won');
    const servicePointsWonPct =
      statPct(mine, 'Service Points Won') ?? pct(serveWon, servePoints) ?? derived?.servicePointsWonPct ?? null;
    const returnPointsWonPct = statPct(mine, 'Return Points Won') ?? derived?.returnPointsWonPct ?? null;
    const oppBpFaced = statTotal(opp, 'Break Points Saved') ?? (pbp ? (side.firstIsPlayer ? pbp.second.breakPointsFaced : pbp.first.breakPointsFaced) : null);
    const bpSavedPct =
      statPct(mine, 'Break Points Saved') ?? pct(bpSaved, bpFaced) ?? derived?.breakPointsSavedPct ?? null;
    const bpConvertedPct =
      statPct(mine, 'Break Points Converted') ??
      pct(bpConverted, bpChances) ??
      pct(bpConverted, oppBpFaced) ??
      derived?.breakPointsConvertedPct ??
      null;
    const serveGames = statTotal(mine, 'Service games won') ?? derived?.serveGames ?? null;

    const row: TennisMatchRow = {
      matchId: `${eventKey}-${side.playerId}`,
      tour,
      season,
      tourneyId: String(fx.tournament_key ?? ''),
      tourneyName,
      tourneyLevel: slam ? 'G' : tour === 'ATP' ? 'A' : 'P',
      isGrandSlam: slam,
      surface,
      date,
      tourneyDate: date,
      round,
      score: scored.score || String(fx.event_final_result || ''),
      bestOf,
      minutes: null,
      drawSize: null,
      playerId: side.playerId,
      playerName: side.playerName,
      opponentId: side.opponentId,
      opponent: side.opponent,
      opponentIoc: side.oppInfo?.ioc ?? null,
      opponentRank: side.oppInfo?.rank ?? null,
      opponentRankPoints: side.oppInfo?.rankPoints ?? null,
      playerRank: side.info?.rank ?? null,
      rankPoints: side.info?.rankPoints ?? null,
      seed: null,
      entry: fx.event_qualification === 'True' || fx.event_qualification === true ? 'Q' : null,
      height: null,
      age: null,
      isWin: side.isWin,
      result: side.isWin ? 'W' : 'L',
      team: slam ? 'Grand Slam' : tour,
      teamCode: tour,
      venue: surface,
      isHome: false,
      moneyline: side.isWin ? 1 : 0,
      gamesWon,
      gamesLost,
      totalGames: gamesWon != null && gamesLost != null ? gamesWon + gamesLost : scored.gamesWon + scored.gamesLost,
      spread: gamesWon != null && gamesLost != null ? gamesLost - gamesWon : null,
      setsWon: scored.setsWon,
      setsLost: scored.setsLost,
      totalSets: scored.setsWon + scored.setsLost,
      dominanceRatio: tennisDominanceRatio(returnPointsWonPct, servicePointsWonPct),
      aces,
      opponentAces: oppAces,
      totalAces: aces != null && oppAces != null ? aces + oppAces : null,
      doubleFaults: statWon(mine, 'Double Faults'),
      servePoints,
      serveGames,
      firstServesIn: firstIn,
      firstServesWon: firstWon,
      secondServeAttempts: secondAtt,
      secondServesWon: secondWon,
      firstServePct,
      firstServeWonPct,
      secondServeWonPct,
      servicePointsWonPct,
      breakPointsSaved: bpSaved,
      breakPointsFaced: bpFaced,
      breakPointsSavedPct: bpSavedPct,
      breakPointsConverted: bpConverted,
      breakPointsConvertedPct: bpConvertedPct,
      returnPointsWon: returnWon,
      returnPointsWonPct,
      pointsWon,
      servePointsWon: serveWon,
      totalPoints,
      hand: null,
      opponentHand: null,
      ioc: side.info?.ioc ?? null,
      winners: statWon(mine, 'Winners'),
      unforcedErrors: statWon(mine, 'Unforced errors'),
      netPointsWon: statWon(mine, 'Net points won'),
      netPointsWonPct: statPct(mine, 'Net points won'),
      serviceGamesWon: statWon(mine, 'Service games won') ?? derived?.serviceGamesWon ?? null,
      returnGamesWon: statWon(mine, 'Return games won') ?? derived?.returnGamesWon ?? null,
      firstServeSpeed: parseSpeedKmh(mine, 'Average 1st serve speed'),
      secondServeSpeed: parseSpeedKmh(mine, 'Average 2nd serve speed'),
      distanceCovered: statWon(mine, 'Distance covered metres') ?? statWon(mine, 'Distance covered (metres)'),
      matchPointsSaved: statWon(mine, 'Match points saved') ?? derived?.matchPointsSaved ?? null,
      firstReturnPointsWonPct: statPct(mine, '1st return points won'),
      secondReturnPointsWonPct: statPct(mine, '2nd return points won'),
    };
    void side.logo;
    return row;
  });
}

export function ingestApiFixtures(
  fixtures: ApiTennisFixture[],
  players: Map<string, ApiPlayerInfo>,
  tour: TennisTour,
  seen: Set<string>
): TennisMatchRow[] {
  const matches: TennisMatchRow[] = [];
  for (const fx of fixtures) {
    const firstId = String(fx.first_player_key ?? '');
    const secondId = String(fx.second_player_key ?? '');
    if (firstId && fx.event_first_player) {
      const existing = players.get(firstId);
      if (existing) {
        if (!existing.imageUrl && fx.event_first_player_logo) existing.imageUrl = fx.event_first_player_logo;
      } else {
        players.set(firstId, {
          playerId: firstId,
          name: String(fx.event_first_player || firstId),
          tour,
          ioc: null,
          rank: null,
          rankPoints: null,
          imageUrl: fx.event_first_player_logo || null,
        });
      }
    }
    if (secondId && fx.event_second_player) {
      const existing = players.get(secondId);
      if (existing) {
        if (!existing.imageUrl && fx.event_second_player_logo) existing.imageUrl = fx.event_second_player_logo;
      } else {
        players.set(secondId, {
          playerId: secondId,
          name: String(fx.event_second_player || secondId),
          tour,
          ioc: null,
          rank: null,
          rankPoints: null,
          imageUrl: fx.event_second_player_logo || null,
        });
      }
    }
    for (const row of mapApiFixtureToRows(fx, players)) {
      if (seen.has(row.matchId)) continue;
      seen.add(row.matchId);
      matches.push(row);
    }
  }
  return matches;
}

type TennisOverlaySnapshot = {
  fetchedAt?: string;
  matches?: TennisMatchRow[];
  players?: ApiTennisPlayer[];
  standings?: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

type OverlayGetter = () => TennisOverlaySnapshot | null;

type ApiRuntime = {
  file: ApiTennisCache | null;
  merged: ApiTennisCache | null;
  players: ApiTennisPlayer[] | null;
  roster: ApiTennisRoster | null;
  rosterDiskMtime: number;
  rosterOverlayAt: string;
  diskMtime: number;
  surfacesMtime: number;
  overlayAt: string;
  overlayGetter: OverlayGetter;
};

function apiRuntime(): ApiRuntime {
  const g = globalThis as typeof globalThis & { __tennisApi?: ApiRuntime };
  if (!g.__tennisApi) {
    g.__tennisApi = {
      file: null,
      merged: null,
      players: null,
      roster: null,
      rosterDiskMtime: 0,
      rosterOverlayAt: '',
      diskMtime: 0,
      surfacesMtime: 0,
      overlayAt: '',
      overlayGetter: () => null,
    };
  }
  return g.__tennisApi;
}

export function registerTennisOverlayGetter(fn: OverlayGetter) {
  apiRuntime().overlayGetter = fn;
  apiRuntime().merged = null;
  apiRuntime().players = null;
  apiRuntime().roster = null;
}

function readApiTennisDiskCache(): { cache: ApiTennisCache | null; mtime: number } {
  const runtime = apiRuntime();
  const file = apiTennisCachePath();
  if (!fs.existsSync(file)) return { cache: null, mtime: 0 };
  const mtime = fs.statSync(file).mtimeMs;
  if (runtime.file && runtime.diskMtime === mtime) return { cache: runtime.file, mtime };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ApiTennisCache;
    if (!parsed?.matches?.length) return { cache: null, mtime };
    runtime.file = parsed;
    runtime.diskMtime = mtime;
    runtime.merged = null;
    runtime.players = null;
    try {
      if (!fs.existsSync(apiTennisRosterPath())) writeApiTennisRoster(parsed);
    } catch {
      /* roster sidecar is optional */
    }
    return { cache: parsed, mtime };
  } catch {
    return { cache: null, mtime };
  }
}

function mergeDiskWithOverlay(
  disk: ApiTennisCache | null,
  overlay: TennisOverlaySnapshot | null
): ApiTennisCache | null {
  if (!disk && !overlay?.matches?.length && !overlay?.players?.length) return null;
  const byId = new Map<string, TennisMatchRow>();
  for (const row of disk?.matches || []) {
    if (row?.matchId) byId.set(row.matchId, row);
  }
  for (const row of overlay?.matches || []) {
    if (row?.matchId) byId.set(row.matchId, row);
  }
  const playersById = new Map<string, ApiTennisPlayer>();
  for (const player of disk?.players || []) {
    if (player?.playerId) playersById.set(player.playerId, player);
  }
  for (const player of overlay?.players || []) {
    if (!player?.playerId) continue;
    const prev = playersById.get(player.playerId);
    playersById.set(player.playerId, prev ? { ...prev, ...player, imageUrl: player.imageUrl || prev.imageUrl } : player);
  }
  const standings = {
    ATP: overlay?.standings?.ATP?.length ? overlay.standings.ATP : disk?.standings?.ATP || [],
    WTA: overlay?.standings?.WTA?.length ? overlay.standings.WTA : disk?.standings?.WTA || [],
  };
  return {
    fetchedAt: overlay?.fetchedAt || disk?.fetchedAt || new Date().toISOString(),
    source: 'api-tennis',
    matches: [...byId.values()],
    players: [...playersById.values()],
    standings,
  };
}

export function tennisCacheMtime(): number {
  const file = apiTennisCachePath();
  let n = tennisSurfacesMtime();
  try {
    n += fs.statSync(file).mtimeMs;
  } catch {
    /* cache file optional */
  }
  return n;
}

export function loadApiTennisCache(opts?: { diskOnly?: boolean }): ApiTennisCache | null {
  const runtime = apiRuntime();
  const { cache: disk, mtime } = readApiTennisDiskCache();
  if (opts?.diskOnly) return disk;
  const overlay = runtime.overlayGetter();
  const overlayAt = overlay?.fetchedAt || '';
  const surfacesMtime = tennisSurfacesMtime();
  if (
    runtime.merged &&
    runtime.diskMtime === mtime &&
    runtime.overlayAt === overlayAt &&
    runtime.surfacesMtime === surfacesMtime
  ) {
    return runtime.merged;
  }
  const merged = mergeDiskWithOverlay(disk, overlay);
  runtime.merged = merged;
  runtime.overlayAt = overlayAt;
  runtime.surfacesMtime = surfacesMtime;
  runtime.players = null;
  return merged;
}

function extractRosterFromCacheText(raw: string): ApiTennisRoster | null {
  const i = raw.lastIndexOf(',"players":');
  if (i < 0) return null;
  try {
    const parsed = JSON.parse(`{${raw.slice(i + 1)}`) as {
      players?: ApiTennisPlayer[];
      standings?: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
    };
    const fetchedAt = raw.match(/"fetchedAt":"([^"]+)"/)?.[1] || new Date().toISOString();
    return {
      fetchedAt,
      source: 'api-tennis',
      players: parsed.players || [],
      standings: {
        ATP: parsed.standings?.ATP || [],
        WTA: parsed.standings?.WTA || [],
      },
    };
  } catch {
    return null;
  }
}

function readApiTennisDiskRoster(): { roster: ApiTennisRoster | null; mtime: number } {
  const file = apiTennisRosterPath();
  try {
    if (fs.existsSync(file)) {
      const mtime = fs.statSync(file).mtimeMs;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ApiTennisRoster;
      if (parsed?.players || parsed?.standings) return { roster: parsed, mtime };
    }
  } catch {
    /* ignore corrupt sidecar */
  }
  const cacheFile = apiTennisCachePath();
  try {
    if (!fs.existsSync(cacheFile)) return { roster: null, mtime: 0 };
    const raw = fs.readFileSync(cacheFile, 'utf8');
    const extracted = extractRosterFromCacheText(raw);
    if (extracted) {
      writeApiTennisRoster(extracted);
      return { roster: extracted, mtime: fs.statSync(apiTennisRosterPath()).mtimeMs };
    }
  } catch {
    /* fall through to full cache parse */
  }
  const disk = loadApiTennisCache({ diskOnly: true });
  if (!disk) return { roster: null, mtime: 0 };
  writeApiTennisRoster(disk);
  try {
    return { roster: disk, mtime: fs.statSync(apiTennisRosterPath()).mtimeMs };
  } catch {
    return { roster: disk, mtime: Date.now() };
  }
}

function mergeRosterWithOverlay(
  disk: ApiTennisRoster | null,
  overlay: TennisOverlaySnapshot | null
): ApiTennisRoster | null {
  if (
    !disk &&
    !overlay?.players?.length &&
    !overlay?.standings?.ATP?.length &&
    !overlay?.standings?.WTA?.length
  ) {
    return null;
  }
  const base: ApiTennisRoster = disk || {
    fetchedAt: overlay?.fetchedAt || new Date().toISOString(),
    source: 'api-tennis',
    players: [],
    standings: { ATP: [], WTA: [] },
  };
  if (!overlay?.players?.length && !overlay?.standings?.ATP?.length && !overlay?.standings?.WTA?.length) {
    return base;
  }
  const playersById = new Map<string, ApiTennisPlayer>();
  for (const player of base.players || []) {
    if (player?.playerId) playersById.set(player.playerId, player);
  }
  for (const player of overlay.players || []) {
    if (!player?.playerId) continue;
    const prev = playersById.get(player.playerId);
    playersById.set(
      player.playerId,
      prev ? { ...prev, ...player, imageUrl: player.imageUrl || prev.imageUrl } : player
    );
  }
  return {
    fetchedAt: overlay.fetchedAt || base.fetchedAt,
    source: base.source,
    players: [...playersById.values()],
    standings: {
      ATP: overlay.standings?.ATP?.length ? overlay.standings.ATP : base.standings?.ATP || [],
      WTA: overlay.standings?.WTA?.length ? overlay.standings.WTA : base.standings?.WTA || [],
    },
  };
}

export function loadApiTennisRoster(): ApiTennisRoster | null {
  const runtime = apiRuntime();
  const overlay = runtime.overlayGetter();
  const overlayAt = overlay?.fetchedAt || '';
  const { roster: disk, mtime } = readApiTennisDiskRoster();
  if (runtime.roster && runtime.rosterDiskMtime === mtime && runtime.rosterOverlayAt === overlayAt) {
    return runtime.roster;
  }
  const merged = mergeRosterWithOverlay(disk, overlay);
  runtime.roster = merged;
  runtime.rosterDiskMtime = mtime;
  runtime.rosterOverlayAt = overlayAt;
  runtime.players = null;
  return merged;
}

export function loadApiTennisMatches(years?: readonly number[]): TennisMatchRow[] | null {
  const cache = loadApiTennisCache();
  if (!cache) return null;
  if (!years?.length) return cache.matches;
  const wanted = new Set(years);
  return cache.matches.filter((row) => wanted.has(row.season));
}

export function loadApiTennisPlayers(): ApiTennisPlayer[] | null {
  const runtime = apiRuntime();
  if (runtime.players) return runtime.players;
  const roster = loadApiTennisRoster();
  if (!roster?.players?.length) return null;
  runtime.players = roster.players.map((p) => ({
    ...p,
    hand: tennisHandForName(p.name) || p.hand,
    imageUrl: clientTennisHeadshotUrl(p.playerId, resolveTennisHeadshotUrl(p.playerId, p.imageUrl)),
  }));
  return runtime.players;
}

export function loadApiTennisRankings(tour: TennisTour): TennisRankingRow[] | null {
  const rows = loadApiTennisRoster()?.standings?.[tour];
  return rows?.length ? rows : null;
}
