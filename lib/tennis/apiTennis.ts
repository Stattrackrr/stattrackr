/**
 * API-Tennis (api-tennis.com) cache + fixture → TennisMatchRow mapping.
 * Compiled by scripts/fetch-api-tennis.ts into data/tennis/api-tennis/.
 */

import fs from 'fs';
import path from 'path';
import type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';
import { tennisDominanceRatio } from '@/lib/tennis/chartStats';
import { resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';
import { tennisHandForName } from '@/lib/tennis/hands';

export const API_TENNIS_EVENT = {
  ATP_SINGLES: '265',
  WTA_SINGLES: '266',
} as const;

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
};

export function apiTennisDir(): string {
  return path.join(process.cwd(), 'data', 'tennis', 'api-tennis');
}

export function apiTennisCachePath(): string {
  return path.join(apiTennisDir(), 'cache.json');
}

export function countryToIoc(country: string | null | undefined): string | null {
  const key = String(country || '').trim().toLowerCase();
  if (!key || key === 'world') return null;
  return COUNTRY_TO_IOC[key] || null;
}

export function tourFromEventType(eventType: string | null | undefined): TennisTour | null {
  const t = String(eventType || '').toLowerCase();
  if (t.includes('wta')) return 'WTA';
  if (t.includes('atp')) return 'ATP';
  return null;
}

export function parseApiRound(raw: string | null | undefined): string {
  const s = String(raw || '').toLowerCase();
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

export function inferApiSurface(name: string | null | undefined): string {
  const n = String(name || '').toLowerCase();
  if (
    /wimbledon|halle|queen'?s club|eastbourne|hertogenbosch|mallorca|newport|\bberlin\b|nottingham|bad homburg|'s-hertogenbosch/.test(
      n
    )
  ) {
    return 'Grass';
  }
  if (
    /roland garros|french open|monte.?carlo|barcelona|madrid|rome|hamburg|bastad|geneva|lyon|estoril|buenos aires|rio de janeiro|santiago|houston|charleston|istanbul|rabat|strasbourg|palermo|lausanne|gstaad|kitzbuhel|umag|bucharest|budapest|prague|marrakech|umea/.test(
      n
    )
  ) {
    return 'Clay';
  }
  return 'Hard';
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
  const surface = inferApiSurface(tourneyName);
  const round = parseApiRound(fx.tournament_round);
  const scores = Array.isArray(fx.scores) ? fx.scores : [];
  const stats = Array.isArray(fx.statistics) ? fx.statistics : [];
  const preview = formatScoreFromSets(scores, true, retired);
  if (preview.gamesWon + preview.gamesLost <= 0) return [];
  const bestOf = slam || scores.length > 3 ? 5 : 3;
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
    const firstIn = statTotal(mine, '1st serve points won');
    const firstWon = statWon(mine, '1st serve points won');
    const secondAtt = statTotal(mine, '2nd serve points won');
    const secondWon = statWon(mine, '2nd serve points won');
    const servePoints =
      firstIn != null && secondAtt != null ? firstIn + secondAtt : statTotal(mine, 'Service Points Won');
    const serveWon =
      firstWon != null && secondWon != null
        ? firstWon + secondWon
        : statWon(mine, 'Service Points Won');
    const bpSaved = statWon(mine, 'Break Points Saved');
    const bpFaced = statTotal(mine, 'Break Points Saved');
    const bpConverted = statWon(mine, 'Break Points Converted');
    const bpChances = statTotal(mine, 'Break Points Converted');
    const returnWon = statWon(mine, 'Return Points Won');
    const returnFaced = statTotal(mine, 'Return Points Won');
    const pointsWon = statWon(mine, 'Total Points Won');
    const totalPoints = statTotal(mine, 'Total Points Won');
    const aces = statWon(mine, 'Aces');
    const oppAces = statWon(opp, 'Aces');
    const gamesWon = scored.gamesWon;
    const gamesLost = scored.gamesLost;
    const firstServePct =
      statPct(mine, '1st serve percentage') ?? pct(firstIn, servePoints);
    const firstServeWonPct = statPct(mine, '1st serve points won');
    const secondServeWonPct = statPct(mine, '2nd serve points won');
    const servicePointsWonPct = statPct(mine, 'Service Points Won') ?? pct(serveWon, servePoints);
    const returnPointsWonPct = statPct(mine, 'Return Points Won');
    const oppBpFaced = statTotal(opp, 'Break Points Saved');
    const bpSavedPct = statPct(mine, 'Break Points Saved') ?? pct(bpSaved, bpFaced);
    const bpConvertedPct =
      statPct(mine, 'Break Points Converted') ?? pct(bpConverted, bpChances) ?? pct(bpConverted, oppBpFaced);
    const serveGames = statTotal(mine, 'Service games won');

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
      serviceGamesWon: statWon(mine, 'Service games won'),
      returnGamesWon: statWon(mine, 'Return games won'),
      firstServeSpeed: parseSpeedKmh(mine, 'Average 1st serve speed'),
      secondServeSpeed: parseSpeedKmh(mine, 'Average 2nd serve speed'),
      distanceCovered: statWon(mine, 'Distance covered metres') ?? statWon(mine, 'Distance covered (metres)'),
      matchPointsSaved: statWon(mine, 'Match points saved'),
      firstReturnPointsWonPct: statPct(mine, '1st return points won'),
      secondReturnPointsWonPct: statPct(mine, '2nd return points won'),
    };
    void side.logo;
    return row;
  });
}

type ApiRuntime = {
  file: ApiTennisCache | null;
  players: ApiTennisPlayer[] | null;
  mtime: number;
};

function apiRuntime(): ApiRuntime {
  const g = globalThis as typeof globalThis & { __tennisApi?: ApiRuntime };
  if (!g.__tennisApi) g.__tennisApi = { file: null, players: null, mtime: 0 };
  return g.__tennisApi;
}

export function tennisCacheMtime(): number {
  const file = apiTennisCachePath();
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

export function loadApiTennisCache(): ApiTennisCache | null {
  const runtime = apiRuntime();
  const file = apiTennisCachePath();
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  if (runtime.file && runtime.mtime === mtime) return runtime.file;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ApiTennisCache;
    if (!parsed?.matches?.length) return null;
    runtime.file = parsed;
    runtime.mtime = mtime;
    runtime.players = null;
    return parsed;
  } catch {
    return null;
  }
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
  const cache = loadApiTennisCache();
  if (!cache?.matches?.length && !cache?.players?.length) return null;
  const byId = new Map<string, ApiTennisPlayer>();
  for (const p of cache.players || []) {
    byId.set(p.playerId, {
      ...p,
      hand: tennisHandForName(p.name) || p.hand,
      imageUrl: resolveTennisHeadshotUrl(p.playerId, p.imageUrl),
    });
  }
  for (const row of cache.matches || []) {
    const existing = byId.get(row.playerId);
    if (!existing) {
      byId.set(row.playerId, {
        playerId: row.playerId,
        name: row.playerName,
        tour: row.tour,
        ioc: row.ioc,
        hand: tennisHandForName(row.playerName) || row.hand,
        height: row.height,
        rank: row.playerRank,
        rankPoints: row.rankPoints,
        imageUrl: resolveTennisHeadshotUrl(row.playerId, null),
      });
      continue;
    }
    if (existing.rank == null && row.playerRank != null) existing.rank = row.playerRank;
    if (!existing.ioc && row.ioc) existing.ioc = row.ioc;
    if (!existing.hand) existing.hand = tennisHandForName(existing.name) || row.hand;
  }
  runtime.players = [...byId.values()];
  return runtime.players;
}

export function loadApiTennisRankings(tour: TennisTour): TennisRankingRow[] | null {
  const cache = loadApiTennisCache();
  const rows = cache?.standings?.[tour];
  return rows?.length ? rows : null;
}
