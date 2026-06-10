import { NextRequest, NextResponse } from 'next/server';
import {
  InternationalCompetition,
  loadInternationalDashboardData,
  loadInternationalDvp,
  loadInternationalStatsByPlayerName,
  loadInternationalTeamForm,
  loadInternationalTeamStatsByCountry,
} from '@/lib/internationalDashboard';
import {
  getOpponentBreakdown,
  isRichTeamStatRow,
  normalizeDerivedTeamStats,
  dedupeCrossSourceTeamStatRows,
  buildBdlTeamHistoryRows,
  toFiniteOrNull,
} from '@/lib/worldCupOpponentBreakdown';
import { getWorldCupCache, setWorldCupCache } from '@/lib/worldCupCache';
import { resolveWorldCupFlagCode } from '@/lib/worldCupFlags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompetitionParam = 'all' | 'world-cup' | InternationalCompetition;

// Persist the assembled World Cup dashboard payload in Supabase so a player's
// stats are only fetched from BDL once and then served from cache on
// subsequent loads (links every searched name to its resolved stats).
// Stored permanently (no expiry).
const WC_DASHBOARD_CACHE_PREFIX = 'wc:dashboard:v22';

function buildDashboardCacheKey(opts: {
  competition: CompetitionParam;
  season: number;
  teamId: string | null;
  playerId: string | null;
  playerName: string | null;
}): string {
  const teamPart = opts.teamId && /^\d+$/.test(opts.teamId) ? opts.teamId : 'none';
  const playerPart = opts.playerId && /^\d+$/.test(opts.playerId) ? opts.playerId : 'none';
  const namePart = (opts.playerName || '').toLowerCase().replace(/\s+/g, ' ').trim() || 'none';
  return `${WC_DASHBOARD_CACHE_PREFIX}:${opts.competition}:${opts.season}:${teamPart}:${playerPart}:${namePart}`;
}

function enrichWorldCupRosters(
  rosters: Array<Record<string, any>>,
  players: Array<Record<string, any>>
): Array<Record<string, any>> {
  const positionByPlayerId = new Map<number, string>();
  for (const player of players) {
    const id = Number(player?.id);
    const pos = String(player?.position ?? '').trim();
    if (Number.isFinite(id) && pos) positionByPlayerId.set(id, pos);
  }
  return rosters.map((row) => {
    const nested = row.player && typeof row.player === 'object' ? (row.player as Record<string, any>) : {};
    const playerId = Number(row.player_id ?? nested.id);
    const resolvedPos =
      String(row.position ?? '').trim() ||
      String(nested.position ?? '').trim() ||
      (Number.isFinite(playerId) ? positionByPlayerId.get(playerId) ?? '' : '');
    return {
      ...row,
      position: resolvedPos || row.position || null,
      player: {
        ...nested,
        id: nested.id ?? row.player_id ?? null,
        position: resolvedPos || nested.position || null,
      },
    };
  });
}

function parseCompetition(value: string | null): CompetitionParam {
  const v = (value || '').toLowerCase();
  if (v === 'euros' || v === 'nations-league' || v === 'all') return v;
  return 'world-cup';
}

/**
 * Resolve a player name → all their BDL World Cup match stats + matches
 * across the three WC seasons. Returns BDL-shaped rows so they can be merged
 * directly into the dashboard response.
 */
async function fetchBdlStatsForPlayerName(
  name: string,
  apiKey: string
): Promise<{ playerMatchStats: any[]; matches: any[] }> {
  if (!name || !apiKey) return { playerMatchStats: [], matches: [] };
  try {
    const searchParams = new URLSearchParams();
    searchParams.set('search', name);
    searchParams.set('per_page', '25');
    const response = await bdlFetch<{ id: number; name?: string }>('/players', searchParams, apiKey);
    const candidates = Array.isArray(response.data) ? response.data : [];
    if (!candidates.length) return { playerMatchStats: [], matches: [] };
    const target = name.trim().toLowerCase();
    const exact = candidates.find((p) => String(p.name || '').trim().toLowerCase() === target);
    const picked = exact || candidates[0];
    if (!picked) return { playerMatchStats: [], matches: [] };

    const playerStatsParams = new URLSearchParams();
    playerStatsParams.append('player_ids[]', String(picked.id));
    const statsRows = await bdlFetchAll<Record<string, any>>(
      '/player_match_stats',
      playerStatsParams,
      apiKey,
      { cursor: true, maxPages: 6 }
    );

    const matchIds = Array.from(
      new Set(
        statsRows
          .map((row) => Number(row?.match_id))
          .filter((id) => Number.isFinite(id))
      )
    );
    let matchRows: BdlMatch[] = [];
    if (matchIds.length) {
      const matchParams = new URLSearchParams();
      appendArrayParam(matchParams, 'seasons[]', [2018, 2022, 2026]);
      appendArrayParam(matchParams, 'match_ids[]', matchIds);
      matchRows = await bdlFetchAll<BdlMatch>('/matches', matchParams, apiKey, {
        cursor: true,
        maxPages: 2,
      });
    }
    return {
      playerMatchStats: statsRows.map((row) => ({ ...row, source: 'bdl', tournament_slug: 'worldcup' })),
      matches: summarizeMatches(matchRows),
    };
  } catch (err) {
    console.warn('[world-cup/dashboard] BDL-by-name fetch failed:', err);
    return { playerMatchStats: [], matches: [] };
  }
}

/**
 * Team-mode (Game Props): fetch a team's completed World Cup matches across all
 * three editions (2018 / 2022 / 2026) and their per-match team stats. The main
 * dashboard path only loads season 2026 (no completed games yet), so previous
 * World Cup bars never appear without this. Returns BDL-shaped rows tagged as
 * World Cup so the chart's competition tag resolves to "WC".
 */
async function fetchBdlTeamWorldCupHistory(
  teamId: number,
  apiKey: string
): Promise<{ teamMatchStats: any[]; matches: any[] }> {
  if (!Number.isFinite(teamId) || !apiKey) return { teamMatchStats: [], matches: [] };
  try {
    const seasonsParam = new URLSearchParams();
    appendArrayParam(seasonsParam, 'seasons[]', [2018, 2022, 2026]);
    const allMatches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, {
      cursor: true,
      maxPages: 6,
    });
    const teamMatches = allMatches.filter(
      (match) =>
        (match.home_team?.id === teamId || match.away_team?.id === teamId) &&
        match.status === 'completed'
    );
    if (!teamMatches.length) return { teamMatchStats: [], matches: [] };

    const matchIds = Array.from(
      new Set(teamMatches.map((match) => match.id).filter((id): id is number => Number.isFinite(id)))
    );

    // BDL's /team_match_stats returns both teams' rows for each match. Key every
    // row by `${match_id}:${team_id}` so the shared builder can pair each team
    // with its opponent. Row assembly lives in lib/worldCupOpponentBreakdown so the
    // chart and Opponent Breakdown produce identical values.
    const statsByMatchTeam = new Map<string, Record<string, any>>();
    for (let i = 0; i < matchIds.length; i += 50) {
      const chunk = matchIds.slice(i, i + 50);
      const params = new URLSearchParams();
      chunk.forEach((id) => params.append('match_ids[]', String(id)));
      const rows = await bdlFetchAll<Record<string, any>>('/team_match_stats', params, apiKey, {
        cursor: true,
        maxPages: 4,
      });
      for (const row of rows) {
        statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
      }
    }

    const teamMatchStats = buildBdlTeamHistoryRows(teamId, teamMatches, statsByMatchTeam);
    return { teamMatchStats, matches: summarizeMatches(teamMatches) };
  } catch (err) {
    console.warn('[world-cup/dashboard] BDL team history fetch failed:', err);
    return { teamMatchStats: [], matches: [] };
  }
}

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
const DEFAULT_SEASON = 2026;
const MAX_PAGES = 8;

type BdlMeta = {
  next_cursor?: number | string | null;
  per_page?: number;
};

type BdlEnvelope<T> = {
  data?: T[];
  meta?: BdlMeta;
  error?: string;
};

type BdlTeam = {
  id: number;
  name: string;
  abbreviation?: string | null;
  country_code?: string | null;
  confederation?: string | null;
};

type BdlMatch = {
  id: number;
  match_number?: number | null;
  datetime?: string | null;
  status?: string | null;
  season?: { id?: number; year?: number } | null;
  stage?: { id?: number; name?: string; order?: number } | null;
  group?: { id?: number; name?: string } | null;
  stadium?: { id?: number; name?: string; city?: string | null; country?: string | null } | null;
  home_team?: BdlTeam | null;
  away_team?: BdlTeam | null;
  home_team_source?: { description?: string | null; placeholder?: string | null } | null;
  away_team_source?: { description?: string | null; placeholder?: string | null } | null;
  home_score?: number | null;
  away_score?: number | null;
  home_score_penalties?: number | null;
  away_score_penalties?: number | null;
  has_penalty_shootout?: boolean | null;
  home_formation?: string | null;
  away_formation?: string | null;
};

function getBdlApiKey(): string {
  const raw = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
  return raw.trim();
}

function getAuthCandidates(apiKey: string): string[] {
  if (!apiKey) return [];
  if (apiKey.startsWith('Bearer ')) {
    const plain = apiKey.replace(/^Bearer\s+/i, '').trim();
    return [plain, apiKey].filter(Boolean);
  }
  return [apiKey, `Bearer ${apiKey}`];
}

function appendArrayParam(params: URLSearchParams, key: string, values: Array<string | number>) {
  values.forEach((value) => {
    if (value !== '' && value != null) params.append(key, String(value));
  });
}

// Tiny in-memory cache + in-flight dedupe to soften BDL rate limits when the
// page fires multiple parallel/sequential requests for the same URL.
const BDL_CACHE_TTL_MS = 60_000;
const bdlCache = new Map<string, { ts: number; payload: unknown }>();
const bdlInflight = new Map<string, Promise<unknown>>();

async function bdlFetch<T>(path: string, params: URLSearchParams, apiKey: string): Promise<BdlEnvelope<T>> {
  const url = new URL(`${BDL_FIFA_BASE}${path}`);
  params.forEach((value, key) => url.searchParams.append(key, value));
  const cacheKey = url.toString();

  const cached = bdlCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BDL_CACHE_TTL_MS) {
    return cached.payload as BdlEnvelope<T>;
  }
  const inflight = bdlInflight.get(cacheKey);
  if (inflight) {
    return inflight as Promise<BdlEnvelope<T>>;
  }

  const exec = async (): Promise<BdlEnvelope<T>> => {
    const authCandidates = getAuthCandidates(apiKey);
    let lastStatus = 0;
    let lastText = '';

    for (const auth of authCandidates.length ? authCandidates : ['']) {
      // 429 backoff: try up to 2 retries with short waits.
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(cacheKey, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'StatTrackr/1.0',
            ...(auth ? { Authorization: auth } : {}),
          },
          cache: 'no-store',
        });

        if (response.ok) {
          const payload = (await response.json()) as BdlEnvelope<T>;
          bdlCache.set(cacheKey, { ts: Date.now(), payload });
          return payload;
        }

        lastStatus = response.status;
        lastText = await response.text().catch(() => response.statusText);
        if (response.status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 350 + attempt * 500));
          continue;
        }
        if (response.status !== 401) break;
        break;
      }
    }

    throw Object.assign(new Error(lastText || `BDL request failed with ${lastStatus}`), { status: lastStatus });
  };

  const promise = exec().finally(() => bdlInflight.delete(cacheKey));
  bdlInflight.set(cacheKey, promise);
  return promise;
}

async function bdlFetchAll<T>(
  path: string,
  baseParams: URLSearchParams,
  apiKey: string,
  options: { cursor?: boolean; maxPages?: number } = {}
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | number | null = null;
  const maxPages = options.maxPages ?? MAX_PAGES;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams(baseParams);
    if (!params.has('per_page')) params.set('per_page', '100');
    if (cursor != null) params.set('cursor', String(cursor));

    const payload = await bdlFetch<T>(path, params, apiKey);
    rows.push(...(Array.isArray(payload.data) ? payload.data : []));

    if (!options.cursor) break;
    cursor = payload.meta?.next_cursor ?? null;
    if (!cursor) break;
  }

  return rows;
}

function parseSeason(value: string | null): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return [2018, 2022, 2026].includes(parsed) ? parsed : DEFAULT_SEASON;
}

function findSelectedTeam(teams: BdlTeam[], requestedTeamId: string | null): BdlTeam | null {
  const id = Number.parseInt(String(requestedTeamId || ''), 10);
  if (Number.isFinite(id)) {
    const byId = teams.find((team) => team.id === id);
    if (byId) return byId;
  }
  return teams[0] ?? null;
}

function getTeamLabel(match: BdlMatch, side: 'home' | 'away'): string {
  const team = side === 'home' ? match.home_team : match.away_team;
  const source = side === 'home' ? match.home_team_source : match.away_team_source;
  return team?.name || source?.description || source?.placeholder || 'TBD';
}

function resolveTeamFromPlayerMatchStats(
  stats: Array<Record<string, unknown>>,
  teams: BdlTeam[]
): BdlTeam | null {
  const counts = new Map<number, number>();
  for (const row of stats) {
    const teamId = Number(row.team_id);
    if (!Number.isFinite(teamId)) continue;
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  let bestTeamId: number | null = null;
  let bestCount = 0;
  for (const [teamId, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestTeamId = teamId;
    }
  }
  if (bestTeamId == null) return null;
  return teams.find((team) => team.id === bestTeamId) ?? null;
}

function findFeatureMatch(matches: BdlMatch[], selectedTeam: BdlTeam | null): BdlMatch | null {
  if (!matches.length) return null;
  const teamMatches = selectedTeam
    ? matches.filter((match) => match.home_team?.id === selectedTeam.id || match.away_team?.id === selectedTeam.id)
    : matches;
  const sorted = [...(teamMatches.length ? teamMatches : matches)].sort((a, b) => {
    const aTime = Date.parse(a.datetime || '') || 0;
    const bTime = Date.parse(b.datetime || '') || 0;
    return aTime - bTime;
  });
  return (
    sorted.find((match) => match.status === 'in_progress') ??
    sorted.find((match) => match.status === 'scheduled') ??
    [...sorted].reverse().find((match) => match.status === 'completed') ??
    sorted[0] ??
    null
  );
}

function summarizeMatches(matches: BdlMatch[]) {
  return matches.map((match) => ({
    id: match.id,
    matchNumber: match.match_number ?? null,
    datetime: match.datetime ?? null,
    status: match.status ?? null,
    stage: match.stage?.name ?? null,
    group: match.group?.name ?? null,
    venue: match.stadium ? [match.stadium.name, match.stadium.city].filter(Boolean).join(' - ') : null,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeLabel: getTeamLabel(match, 'home'),
    awayLabel: getTeamLabel(match, 'away'),
    homeScore: match.home_score ?? null,
    awayScore: match.away_score ?? null,
    homeScorePenalties: match.home_score_penalties ?? null,
    awayScorePenalties: match.away_score_penalties ?? null,
    hasPenaltyShootout: match.has_penalty_shootout === true,
    homeFormation: match.home_formation ?? null,
    awayFormation: match.away_formation ?? null,
  }));
}

const DVP_SEASONS = new Set([2018, 2022, 2026]);
const DVP_POSITIONS = new Set(['DEF', 'MID', 'ATT']);
const DVP_STAT_KEYS = new Set([
  'goals',
  'assists',
  'shots_total',
  'shots_on_target',
  'passes_accurate',
  'yellow_cards',
  'red_cards',
]);

type DvpPosition = 'DEF' | 'MID' | 'ATT';

type BdlPlayerMatchStat = Record<string, unknown> & {
  match_id?: number;
  player_id?: number;
  team_id?: number;
  position?: string | null;
  is_home?: boolean;
};

type BdlLineupRow = Record<string, unknown> & {
  match_id?: number;
  player_id?: number;
  position?: string | null;
};

type BdlRosterRow = Record<string, unknown> & {
  player_id?: number;
  position?: string | null;
};

type BdlPlayerProfile = {
  id: number;
  position?: string | null;
};

function dvpToNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDvpPosition(value: unknown): DvpPosition | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (['g', 'gk', 'goalkeeper', 'goalie', 'portero'].includes(lower) || lower.includes('keeper')) return 'DEF';
  if (
    [
      'd', 'def', 'defender', 'cb', 'centre back', 'center back', 'centerback', 'centreback',
      'lb', 'left back', 'leftback', 'rb', 'right back', 'rightback',
      'wb', 'lwb', 'rwb', 'wing back', 'left wing back', 'right wing back',
    ].includes(lower)
  ) return 'DEF';
  if (
    [
      'm', 'mf', 'mid', 'midfielder', 'cm', 'mc', 'centre midfielder', 'center midfielder',
      'cdm', 'dm', 'defensive midfielder', 'defensive mid',
      'cam', 'am', 'attacking midfielder', 'attacking mid',
      'lm', 'left midfielder', 'rm', 'right midfielder',
    ].includes(lower)
  ) return 'MID';
  if (
    [
      'f', 'fw', 'forward', 'st', 'striker', 'cf', 'centre forward', 'center forward',
      'ss', 'second striker', 'lw', 'left wing', 'leftwing', 'left winger',
      'rw', 'right wing', 'rightwing', 'right winger', 'w', 'winger',
    ].includes(lower)
  ) return 'ATT';
  return null;
}

function heuristicDvpPosition(row: BdlPlayerMatchStat): DvpPosition {
  if (dvpToNumber(row.saves) > 0) return 'DEF';
  const shots = dvpToNumber(row.shots_total) + dvpToNumber(row.derived_shots_total);
  const attacking = shots + dvpToNumber(row.shots_on_target) + dvpToNumber(row.goals) * 2 + dvpToNumber(row.expected_goals);
  const defending =
    dvpToNumber(row.tackles) + dvpToNumber(row.tackles_won) + dvpToNumber(row.clearances) + dvpToNumber(row.interceptions);
  if (attacking >= 1.5 && attacking > defending) return 'ATT';
  if (defending > attacking && defending >= 2) return 'DEF';
  return 'MID';
}

async function handleWorldCupDvpBatch(request: NextRequest, apiKey: string): Promise<NextResponse> {
  const seasonRaw = Number.parseInt(String(request.nextUrl.searchParams.get('season') || ''), 10);
  if (!DVP_SEASONS.has(seasonRaw)) {
    return NextResponse.json({ error: 'season must be 2018, 2022, or 2026' }, { status: 400 });
  }
  const positionRaw = String(request.nextUrl.searchParams.get('position') || '').toUpperCase();
  if (!DVP_POSITIONS.has(positionRaw)) {
    return NextResponse.json({ error: 'position must be DEF, MID, or ATT' }, { status: 400 });
  }
  const position = positionRaw as DvpPosition;
  const requestedStatsCsv = String(request.nextUrl.searchParams.get('stats') || '').trim();
  const requestedStats = requestedStatsCsv
    ? requestedStatsCsv
        .split(',')
        .map((s) => s.trim())
        .filter((s) => DVP_STAT_KEYS.has(s))
    : Array.from(DVP_STAT_KEYS);
  if (requestedStats.length === 0) {
    return NextResponse.json({ error: 'No supported stat keys requested' }, { status: 400 });
  }

  const seasonsParam = new URLSearchParams();
  seasonsParam.append('seasons[]', String(seasonRaw));

  const matches = await bdlFetchAll<BdlMatch>('/matches', new URLSearchParams(seasonsParam), apiKey, {
    cursor: true,
    maxPages: 4,
  });
  const completedMatches = matches.filter((match) => match.status === 'completed');
  if (completedMatches.length === 0) {
    return NextResponse.json(
      {
        success: true,
        season: seasonRaw,
        position,
        opponents: [] as string[],
        metrics: {} as Record<string, unknown>,
        samples: {} as Record<string, number>,
        teamGames: {} as Record<string, number>,
        message: 'No completed matches for this season',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300' } }
    );
  }

  const completedMatchIds = Array.from(new Set(completedMatches.map((m) => m.id)));
  const matchById = new Map<number, BdlMatch>();
  completedMatches.forEach((match) => matchById.set(match.id, match));

  const matchIdChunks: number[][] = [];
  for (let i = 0; i < completedMatchIds.length; i += 50) {
    matchIdChunks.push(completedMatchIds.slice(i, i + 50));
  }

  const fetchByMatchIds = async <T>(path: string): Promise<T[]> => {
    const collected: T[] = [];
    for (const chunk of matchIdChunks) {
      const params = new URLSearchParams();
      chunk.forEach((id) => params.append('match_ids[]', String(id)));
      const rows = await bdlFetchAll<T>(path, params, apiKey, { cursor: true, maxPages: 6 });
      collected.push(...rows);
    }
    return collected;
  };

  const wantsShots = requestedStats.includes('shots_total');
  const [playerMatchStats, lineups, rosters, players, matchShots] = await Promise.all([
    fetchByMatchIds<BdlPlayerMatchStat>('/player_match_stats'),
    fetchByMatchIds<BdlLineupRow>('/match_lineups'),
    bdlFetchAll<BdlRosterRow>('/rosters', new URLSearchParams(seasonsParam), apiKey, { cursor: true, maxPages: 12 }),
    bdlFetchAll<BdlPlayerProfile>('/players', new URLSearchParams(seasonsParam), apiKey, { cursor: true, maxPages: 12 }),
    wantsShots
      ? fetchByMatchIds<Record<string, unknown>>('/match_shots')
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  // BDL's player_match_stats.shots_total is unreliable; rebuild it from /match_shots
  // by counting shots per (match_id, player_id).
  const shotsByPair = new Map<string, number>();
  for (const shot of matchShots) {
    const matchId = Number((shot as { match_id?: unknown }).match_id);
    const playerId = Number((shot as { player_id?: unknown }).player_id);
    if (!Number.isFinite(matchId) || !Number.isFinite(playerId)) continue;
    const key = `${matchId}:${playerId}`;
    shotsByPair.set(key, (shotsByPair.get(key) ?? 0) + 1);
  }

  const lineupPositionByPair = new Map<string, string>();
  for (const row of lineups) {
    const matchId = Number(row.match_id);
    const playerId = Number(row.player_id);
    if (!Number.isFinite(matchId) || !Number.isFinite(playerId)) continue;
    const pos = String(row.position ?? '').trim();
    if (!pos) continue;
    lineupPositionByPair.set(`${matchId}:${playerId}`, pos);
  }

  const rosterPositionByPlayer = new Map<number, string>();
  for (const row of rosters) {
    const playerId = Number(row.player_id);
    if (!Number.isFinite(playerId)) continue;
    const pos = String(row.position ?? '').trim();
    if (!pos) continue;
    if (!rosterPositionByPlayer.has(playerId)) rosterPositionByPlayer.set(playerId, pos);
  }

  const profilePositionByPlayer = new Map<number, string>();
  for (const player of players) {
    const playerId = Number(player.id);
    if (!Number.isFinite(playerId)) continue;
    const pos = String(player.position ?? '').trim();
    if (!pos) continue;
    profilePositionByPlayer.set(playerId, pos);
  }

  const positionForRow = (row: BdlPlayerMatchStat): DvpPosition => {
    const matchId = Number(row.match_id);
    const playerId = Number(row.player_id);
    const candidates = [
      lineupPositionByPair.get(`${matchId}:${playerId}`),
      row.position,
      rosterPositionByPlayer.get(playerId),
      profilePositionByPlayer.get(playerId),
    ];
    for (const candidate of candidates) {
      const bucket = parseDvpPosition(candidate);
      if (bucket) return bucket;
    }
    return heuristicDvpPosition(row);
  };

  type AccumulatorRow = {
    teamName: string;
    teamId: number;
    sums: Map<string, number>;
    sampleCount: number;
  };

  const teamNameById = new Map<number, string>();
  completedMatches.forEach((match) => {
    if (match.home_team?.id != null) teamNameById.set(match.home_team.id, match.home_team.name);
    if (match.away_team?.id != null) teamNameById.set(match.away_team.id, match.away_team.name);
  });

  const accumulator = new Map<number, AccumulatorRow>();
  for (const teamId of teamNameById.keys()) {
    accumulator.set(teamId, {
      teamId,
      teamName: teamNameById.get(teamId) ?? String(teamId),
      sums: new Map(requestedStats.map((key) => [key, 0])),
      sampleCount: 0,
    });
  }

  for (const row of playerMatchStats) {
    const matchId = Number(row.match_id);
    const match = matchById.get(matchId);
    if (!match) continue;
    const homeId = match.home_team?.id ?? null;
    const awayId = match.away_team?.id ?? null;
    if (homeId == null || awayId == null) continue;

    const teamId = Number(row.team_id);
    const isHome = row.is_home === true || teamId === homeId;
    const opponentId = isHome ? awayId : homeId;
    if (positionForRow(row) !== position) continue;

    const acc = accumulator.get(opponentId);
    if (!acc) continue;

    const rowShotsTotal = wantsShots
      ? Math.max(
          dvpToNumber(row.shots_total),
          shotsByPair.get(`${matchId}:${Number(row.player_id)}`) ?? 0
        )
      : 0;
    for (const stat of requestedStats) {
      const value = stat === 'shots_total' ? rowShotsTotal : dvpToNumber(row[stat]);
      acc.sums.set(stat, (acc.sums.get(stat) ?? 0) + value);
    }
    acc.sampleCount += 1;
  }

  const teamGamesPlayed = new Map<number, number>();
  for (const match of completedMatches) {
    const homeId = match.home_team?.id;
    const awayId = match.away_team?.id;
    if (homeId != null) teamGamesPlayed.set(homeId, (teamGamesPlayed.get(homeId) ?? 0) + 1);
    if (awayId != null) teamGamesPlayed.set(awayId, (teamGamesPlayed.get(awayId) ?? 0) + 1);
  }

  const opponentNames: string[] = [];
  const teamGames: Record<string, number> = {};
  const samples: Record<string, number> = {};
  const metricValuesByStat: Record<string, Record<string, number>> = {};
  const metricRanksByStat: Record<string, Record<string, number>> = {};
  for (const stat of requestedStats) {
    metricValuesByStat[stat] = {};
    metricRanksByStat[stat] = {};
  }

  const orderedTeamIds = Array.from(accumulator.keys()).sort((a, b) => {
    const nameA = teamNameById.get(a) ?? String(a);
    const nameB = teamNameById.get(b) ?? String(b);
    return nameA.localeCompare(nameB);
  });

  for (const teamId of orderedTeamIds) {
    const row = accumulator.get(teamId)!;
    opponentNames.push(row.teamName);
    teamGames[row.teamName] = teamGamesPlayed.get(teamId) ?? 0;
    samples[row.teamName] = row.sampleCount;
    const games = teamGamesPlayed.get(teamId) ?? 0;
    for (const stat of requestedStats) {
      const sum = row.sums.get(stat) ?? 0;
      metricValuesByStat[stat][row.teamName] = Number((games > 0 ? sum / games : 0).toFixed(3));
    }
  }

  for (const stat of requestedStats) {
    const sorted = Object.entries(metricValuesByStat[stat]).sort((a, b) => a[1] - b[1]);
    let lastValue: number | null = null;
    let lastRank = 0;
    sorted.forEach(([teamName, value], index) => {
      const rank = lastValue !== null && value === lastValue ? lastRank : index + 1;
      metricRanksByStat[stat][teamName] = rank;
      lastValue = value;
      lastRank = rank;
    });
  }

  return NextResponse.json(
    {
      success: true,
      season: seasonRaw,
      position,
      opponents: opponentNames,
      metrics: requestedStats.reduce<Record<string, { values: Record<string, number>; ranks: Record<string, number> }>>(
        (acc, stat) => {
          acc[stat] = { values: metricValuesByStat[stat], ranks: metricRanksByStat[stat] };
          return acc;
        },
        {}
      ),
      samples,
      teamGames,
    },
    {
      headers: {
        'Cache-Control': seasonRaw === 2026 ? 'public, s-maxage=120' : 'public, s-maxage=21600',
      },
    }
  );
}

async function handleInternationalDvp(
  request: NextRequest,
  competition: InternationalCompetition
): Promise<NextResponse> {
  const seasonRaw = Number.parseInt(String(request.nextUrl.searchParams.get('season') || ''), 10);
  if (!Number.isFinite(seasonRaw)) {
    return NextResponse.json({ error: 'season is required' }, { status: 400 });
  }
  const positionRaw = String(request.nextUrl.searchParams.get('position') || '').toUpperCase();
  if (positionRaw !== 'DEF' && positionRaw !== 'MID' && positionRaw !== 'ATT') {
    return NextResponse.json({ error: 'position must be DEF, MID, or ATT' }, { status: 400 });
  }
  const requestedStatsCsv = String(request.nextUrl.searchParams.get('stats') || '').trim();
  const requestedStats = requestedStatsCsv
    ? requestedStatsCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : ['goals', 'assists', 'shots_total', 'shots_on_target', 'passes_accurate', 'yellow_cards', 'red_cards'];

  const result = await loadInternationalDvp({
    competition,
    seasonYear: seasonRaw,
    position: positionRaw as 'DEF' | 'MID' | 'ATT',
    requestedStats,
  });

  return NextResponse.json(
    {
      success: true,
      season: seasonRaw,
      position: positionRaw,
      opponents: result.opponents,
      metrics: requestedStats.reduce<
        Record<string, { values: Record<string, number>; ranks: Record<string, number> }>
      >((acc, stat) => {
        const values = result.metrics[stat] ?? {};
        // Rank: opponent with lowest avg -> rank 1 (best matchup vs that position).
        const sortedTeams = [...result.opponents].sort(
          (a, b) => (values[a] ?? 0) - (values[b] ?? 0)
        );
        const ranks: Record<string, number> = {};
        sortedTeams.forEach((team, idx) => {
          ranks[team] = idx + 1;
        });
        acc[stat] = { values, ranks };
        return acc;
      }, {}),
      samples: result.samples,
      teamGames: result.teamGames,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=3600' } }
  );
}

async function handleInternationalTeamForm(
  request: NextRequest,
  competition: InternationalCompetition
): Promise<NextResponse> {
  const teamId = String(request.nextUrl.searchParams.get('teamId') || '');
  const opponentId = request.nextUrl.searchParams.get('opponentId');
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }
  const result = await loadInternationalTeamForm({ competition, teamId, opponentId });
  return NextResponse.json(
    {
      success: true,
      teamId,
      opponentId: opponentId || null,
      teamMatches: result.teamMatches,
      opponentMatches: result.opponentMatches,
      teamMatchStats: result.teamMatchStats,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=600' } }
  );
}

// ---------------------------------------------------------------------------
// Recent form (cross-source) — a national team's genuine last N games across
// EVERY competition we ingest (BDL World Cup finals + StatsBomb Euros +
// API-Football Nations League / Copa / AFCON / Asian Cup + SofaScore qualifiers),
// not just World Cup matches. Each game is self-describing (opponent, score,
// result, competition tag, key stats) so the UI can render it directly.
// ---------------------------------------------------------------------------

type RecentFormGame = {
  matchId: string;
  datetime: string | null;
  competitionTag: string;
  isHome: boolean;
  goalsFor: number | null;
  goalsAgainst: number | null;
  outcome: 'W' | 'D' | 'L' | null;
  penaltyWin: boolean | null;
  opponentName: string;
  opponentCode: string | null;
  stats: Record<string, number | null>;
  statsAgainst: Record<string, number | null>;
};

const RECENT_FORM_STAT_KEYS = [
  'goals',
  'expected_goals',
  'shots_total',
  'shots_on_target',
  'possession_pct',
  'corners',
  'passes_accurate',
  'yellow_cards',
  'red_cards',
  'fouls',
] as const;

function recentFormCompetitionTag(tournamentSlug?: unknown, source?: unknown): string {
  const slug = String(tournamentSlug ?? '').toLowerCase();
  const src = String(source ?? '').toLowerCase();
  if (slug === 'worldcup' || slug === 'world-cup') return 'WC';
  if (slug.startsWith('club')) return 'Club';
  if (slug.startsWith('wcq') || slug === 'wc-qualifiers' || slug === 'world-cup-qualification') return 'WCQ';
  if (slug === 'copa-america' || slug === 'copa_america') return 'Copa';
  if (slug === 'afcon' || slug === 'africa-cup-of-nations') return 'AFCON';
  if (slug === 'asian-cup' || slug === 'afc-asian-cup') return 'AC';
  if (slug === 'euros' || slug === 'euro') return 'Euros';
  if (slug === 'nations-league' || slug === 'nationsleague') return 'NL';
  if (src === 'statsbomb') return 'Euros';
  if (src === 'api-football') return 'NL';
  return 'WC';
}

function recentFormPickStats(row: Record<string, any> | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of RECENT_FORM_STAT_KEYS) out[key] = toFiniteOrNull(row?.[key]);
  return out;
}

// Conceded ("against") values for the defensive perspective toggle: read the
// match-mate's `opp_<key>` fields attached by the team-history builders.
function recentFormPickStatsAgainst(row: Record<string, any> | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const key of RECENT_FORM_STAT_KEYS) out[key] = toFiniteOrNull(row?.[`opp_${key}`]);
  return out;
}

function recentFormOutcome(goalsFor: number | null, goalsAgainst: number | null): 'W' | 'D' | 'L' | null {
  if (goalsFor == null || goalsAgainst == null) return null;
  return goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
}

function recentFormPenaltyWin(match: Record<string, any> | null | undefined, isHome: boolean): boolean | null {
  const home =
    toFiniteOrNull(match?.home_score_penalties) ??
    toFiniteOrNull(match?.homeScorePenalties) ??
    toFiniteOrNull(match?.home_score_penalty);
  const away =
    toFiniteOrNull(match?.away_score_penalties) ??
    toFiniteOrNull(match?.awayScorePenalties) ??
    toFiniteOrNull(match?.away_score_penalty);
  if (home == null || away == null || home === away) return null;
  const homeWon = home > away;
  return isHome ? homeWon : !homeWon;
}

function recentFormStatCount(game: RecentFormGame): number {
  return Object.values(game.stats).filter((v) => v != null).length;
}

function resolveBdlTeamFromMatches(matches: BdlMatch[], teamId: number): BdlTeam | null {
  for (const match of matches) {
    if (match.home_team?.id === teamId) return match.home_team;
    if (match.away_team?.id === teamId) return match.away_team;
  }
  return null;
}

/**
 * Assemble a single nation's genuine last `limit` games across all competitions.
 * `statsByMatchTeam` holds BDL World Cup `/team_match_stats` rows keyed by
 * `${matchId}:${teamId}` (both teams per match) so we can attach the opponent's
 * values to each World Cup game; international games come fully assembled from
 * `loadInternationalTeamStatsByCountry`.
 */
async function buildTeamRecentForm(
  team: BdlTeam,
  bdlAllMatches: BdlMatch[],
  statsByMatchTeam: Map<string, Record<string, any>>,
  limit: number | null = 5
): Promise<RecentFormGame[]> {
  const teamSlug =
    resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name) || null;

  const games: RecentFormGame[] = [];

  // 1. BDL World Cup finals games (completed).
  const wcMatches = bdlAllMatches.filter(
    (match) =>
      (match.home_team?.id === team.id || match.away_team?.id === team.id) &&
      match.status === 'completed'
  );
  const wcMatchById = new Map(wcMatches.map((match) => [match.id, match]));
  const bdlRows = buildBdlTeamHistoryRows(team.id, wcMatches, statsByMatchTeam);
  for (const row of bdlRows) {
    const match = wcMatchById.get(Number(row.match_id));
    if (!match) continue;
    const isHome = row.is_home === true;
    const goalsFor = toFiniteOrNull(row.goals);
    const goalsAgainst = toFiniteOrNull(row.opp_goals);
    const oppTeam = isHome ? match.away_team : match.home_team;
    const oppName = oppTeam?.name || getTeamLabel(match, isHome ? 'away' : 'home');
    const oppCode =
      resolveWorldCupFlagCode(oppTeam?.country_code) || resolveWorldCupFlagCode(oppName) || null;
    games.push({
      matchId: String(row.match_id),
      datetime: match.datetime ?? null,
      competitionTag: 'WC',
      isHome,
      goalsFor,
      goalsAgainst,
      outcome: recentFormOutcome(goalsFor, goalsAgainst),
      penaltyWin: recentFormPenaltyWin(match, isHome),
      opponentName: oppName,
      opponentCode: oppCode,
      stats: recentFormPickStats(row),
      statsAgainst: recentFormPickStatsAgainst(row),
    });
  }

  // 2. International games (all other competitions) unified by FIFA slug.
  if (teamSlug) {
    try {
      const intl = await loadInternationalTeamStatsByCountry({
        countryCode: team.country_code ?? null,
        teamName: team.name ?? null,
        bdlTeamId: String(team.id),
      });
      const statByMatchId = new Map<string, Record<string, any>>();
      for (const r of intl.teamMatchStats as Array<Record<string, any>>) {
        statByMatchId.set(String(r.match_id), r);
      }
      for (const m of intl.matches as Array<Record<string, any>>) {
        const matchId = String(m.id);
        const home = m.home_team ?? {};
        const away = m.away_team ?? {};
        const homeCode =
          resolveWorldCupFlagCode(home.country_code) || resolveWorldCupFlagCode(home.name) || null;
        const awayCode =
          resolveWorldCupFlagCode(away.country_code) || resolveWorldCupFlagCode(away.name) || null;
        const statRow = statByMatchId.get(matchId);
        let isHome: boolean;
        if (statRow && typeof statRow.is_home === 'boolean') isHome = statRow.is_home;
        else if (homeCode && homeCode === teamSlug) isHome = true;
        else if (awayCode && awayCode === teamSlug) isHome = false;
        else continue;
        const goalsFor = toFiniteOrNull(isHome ? m.home_score : m.away_score);
        const goalsAgainst = toFiniteOrNull(isHome ? m.away_score : m.home_score);
        const oppTeam = isHome ? away : home;
        const oppName = String(oppTeam.name || 'Opponent');
        const oppCode = isHome ? awayCode : homeCode;
        games.push({
          matchId,
          datetime: (m.datetime as string | null) ?? null,
          competitionTag: recentFormCompetitionTag(m.tournament_slug, m.source),
          isHome,
          goalsFor,
          goalsAgainst,
          outcome: recentFormOutcome(goalsFor, goalsAgainst),
          penaltyWin: recentFormPenaltyWin(m, isHome),
          opponentName: oppName,
          opponentCode: oppCode,
          stats: statRow ? recentFormPickStats(statRow) : recentFormPickStats({ goals: goalsFor }),
          statsAgainst: statRow
            ? recentFormPickStatsAgainst(statRow)
            : recentFormPickStats({ goals: goalsAgainst }),
        });
      }
    } catch (err) {
      console.warn('[world-cup/recent-form] intl load failed:', err);
    }
  }

  // Dedupe games that appear in more than one source (same day + opponent),
  // keeping the richest copy, then take the genuine most-recent `limit`.
  const byKey = new Map<string, RecentFormGame>();
  for (const game of games) {
    const day = game.datetime
      ? new Date(Date.parse(game.datetime)).toISOString().slice(0, 10)
      : game.matchId;
    const oppKey = (game.opponentCode || game.opponentName).toLowerCase();
    const key = `${day}:${oppKey}`;
    const existing = byKey.get(key);
    if (!existing || recentFormStatCount(game) > recentFormStatCount(existing)) {
      byKey.set(key, game);
    }
  }

  const sorted = [...byKey.values()]
    .filter((game) => game.goalsFor != null || recentFormStatCount(game) > 0)
    .sort((a, b) => (Date.parse(b.datetime || '') || 0) - (Date.parse(a.datetime || '') || 0));

  return limit == null ? sorted : sorted.slice(0, limit);
}

async function handleWorldCupTeamForm(request: NextRequest, apiKey: string): Promise<NextResponse> {
  const teamIdRaw = request.nextUrl.searchParams.get('teamId') || '';
  const opponentIdRaw = request.nextUrl.searchParams.get('opponentId') || '';
  const teamId = /^\d+$/.test(teamIdRaw) ? Number(teamIdRaw) : null;
  const opponentId = /^\d+$/.test(opponentIdRaw) ? Number(opponentIdRaw) : null;
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  // Pull every match across all 3 World Cup seasons (small dataset).
  const seasonsParam = new URLSearchParams();
  appendArrayParam(seasonsParam, 'seasons[]', [2018, 2022, 2026]);
  const allMatches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, {
    cursor: true,
    maxPages: 6,
  });

  const isCompletedMatch = (match: BdlMatch) => match.status === 'completed';
  const teamMatchesAll = allMatches.filter(
    (match) => match.home_team?.id === teamId || match.away_team?.id === teamId
  );
  const opponentMatchesAll = opponentId
    ? allMatches.filter((match) => match.home_team?.id === opponentId || match.away_team?.id === opponentId)
    : [];

  const teamMatches = teamMatchesAll.filter(isCompletedMatch);
  const opponentMatches = opponentMatchesAll.filter(isCompletedMatch);

  const matchIds = Array.from(
    new Set(
      [...teamMatches, ...opponentMatches]
        .map((match) => match.id)
        .filter((id): id is number => Number.isFinite(id))
    )
  );

  const matchIdChunks: number[][] = [];
  for (let i = 0; i < matchIds.length; i += 50) {
    matchIdChunks.push(matchIds.slice(i, i + 50));
  }

  const teamMatchStats: Array<Record<string, unknown>> = [];
  for (const chunk of matchIdChunks) {
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('match_ids[]', String(id)));
    const rows = await bdlFetchAll<Record<string, unknown>>('/team_match_stats', params, apiKey, {
      cursor: true,
      maxPages: 4,
    });
    teamMatchStats.push(...rows);
  }

  // Cross-source recent form (genuine last 5 games across all competitions) for
  // both the selected team and its opponent, shown side-by-side in the UI.
  const statsByMatchTeam = new Map<string, Record<string, any>>();
  for (const row of teamMatchStats as Array<Record<string, any>>) {
    statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
  }
  // Resolve full team metadata (name + country_code) so the cross-source
  // assembler can map each nation to its FIFA slug. Prefer the 2026 teams list
  // (all qualified nations, even those without a completed finals game yet),
  // falling back to whatever appears in the match feed.
  const teamsList = await bdlFetchAll<BdlTeam>(
    '/teams',
    new URLSearchParams([['seasons[]', '2026']]),
    apiKey
  );
  const teamById = new Map(teamsList.map((team) => [team.id, team]));
  const resolveTeamObj = (id: number): BdlTeam | null =>
    teamById.get(id) ?? resolveBdlTeamFromMatches(allMatches, id);
  const teamObj = resolveTeamObj(teamId);
  const opponentObj = opponentId ? resolveTeamObj(opponentId) : null;
  const [teamAll, opponentAll] = await Promise.all([
    teamObj
      ? buildTeamRecentForm(teamObj, allMatches, statsByMatchTeam, null)
      : Promise.resolve([] as RecentFormGame[]),
    opponentObj
      ? buildTeamRecentForm(opponentObj, allMatches, statsByMatchTeam, null)
      : Promise.resolve([] as RecentFormGame[]),
  ]);
  const teamRecent = teamAll.slice(0, 5);
  const opponentRecent = opponentAll.slice(0, 5);

  return NextResponse.json(
    {
      success: true,
      teamId,
      opponentId,
      teamMatches: summarizeMatches(teamMatches),
      opponentMatches: summarizeMatches(opponentMatches),
      teamMatchStats,
      teamRecent,
      opponentRecent,
      teamAll,
      opponentAll,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=600',
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const competition = parseCompetition(request.nextUrl.searchParams.get('competition'));
  const apiKey = getBdlApiKey();

  if (request.nextUrl.searchParams.get('dvpBatch') === '1') {
    try {
      if (competition === 'euros' || competition === 'nations-league') {
        return await handleInternationalDvp(request, competition);
      }
      if (!apiKey) {
        return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
      }
      return await handleWorldCupDvpBatch(request, apiKey);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to compute DVP' },
        { status }
      );
    }
  }

  if (request.nextUrl.searchParams.get('oppBreakdown') === '1') {
    try {
      // Competition-agnostic: rankings span every nation's last N games across
      // all ingested competitions. Served from the precomputed cache (see
      // scripts/build-world-cup-opponent-breakdown.ts) for an instant response.
      // Default window is 0 = "All games" (each nation averaged over every game).
      const windowN = Number.parseInt(request.nextUrl.searchParams.get('window') || '0', 10);
      const payload = await getOpponentBreakdown(windowN, apiKey);
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'public, s-maxage=600' },
      });
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to compute opponent breakdown' },
        { status }
      );
    }
  }

  if (request.nextUrl.searchParams.get('teamForm') === '1') {
    try {
      if (competition === 'euros' || competition === 'nations-league') {
        return await handleInternationalTeamForm(request, competition);
      }
      if (!apiKey) {
        return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
      }
      return await handleWorldCupTeamForm(request, apiKey);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to load team form' },
        { status }
      );
    }
  }

  if (competition === 'euros' || competition === 'nations-league') {
    try {
      const data = await loadInternationalDashboardData({
        competition,
        teamId: request.nextUrl.searchParams.get('teamId'),
        playerId: request.nextUrl.searchParams.get('playerId'),
      });

      // Merge in ALL other sources for the selected player so the chart shows
      // every game (BDL World Cup + the other international source).
      const playerName = request.nextUrl.searchParams.get('playerName') || '';
      const requestedPlayerId = request.nextUrl.searchParams.get('playerId') || '';
      if (playerName) {
        const [intl, bdl] = await Promise.all([
          loadInternationalStatsByPlayerName(playerName, { bdlPlayerId: requestedPlayerId }),
          apiKey ? fetchBdlStatsForPlayerName(playerName, apiKey) : Promise.resolve({ playerMatchStats: [], matches: [] }),
        ]);

        const existingKeys = new Set(
          (data.playerMatchStats as Array<Record<string, unknown>>).map(
            (r) => `${(r as { player_id?: unknown }).player_id ?? ''}|${(r as { match_id?: unknown }).match_id ?? ''}`
          )
        );
        const extraIntl = intl.playerMatchStats.filter(
          (r) =>
            !existingKeys.has(
              `${(r as { player_id?: unknown }).player_id ?? ''}|${(r as { match_id?: unknown }).match_id ?? ''}`
            )
        );
        let mergedStats: Array<Record<string, unknown>> = [
          ...(data.playerMatchStats as Array<Record<string, unknown>>),
          ...extraIntl,
          ...bdl.playerMatchStats,
        ];

        // Unify player_id so the frontend filter keeps cross-source rows.
        if (requestedPlayerId) {
          mergedStats = mergedStats.map((row) => ({
            ...row,
            player_id: requestedPlayerId,
            player:
              (row as { player?: Record<string, unknown> }).player != null
                ? { ...(row as { player: Record<string, unknown> }).player, id: requestedPlayerId }
                : { id: requestedPlayerId },
          }));
        }

        const matchIds = new Set(
          [
            ...(data.matches as Array<Record<string, unknown>>),
            ...(data.playerMatches as Array<Record<string, unknown>>),
          ].map((m) => String((m as { id?: unknown }).id ?? ''))
        );
        const extraMatches: Array<Record<string, unknown>> = [];
        for (const m of [...intl.matches, ...bdl.matches]) {
          const id = String((m as { id?: unknown }).id ?? '');
          if (id && !matchIds.has(id)) {
            extraMatches.push(m);
            matchIds.add(id);
          }
        }

        return NextResponse.json(
          {
            ...data,
            playerMatchStats: mergedStats,
            playerMatches: [...(data.playerMatches as Array<unknown>), ...extraMatches],
          },
          { headers: { 'Cache-Control': 'public, s-maxage=300' } }
        );
      }

      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=300' },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to load international data' },
        { status: 500 }
      );
    }
  }

  if (!apiKey) {
    return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
  }

  const season = parseSeason(request.nextUrl.searchParams.get('season'));
  const requestedTeamId = request.nextUrl.searchParams.get('teamId');
  const requestedPlayerId = request.nextUrl.searchParams.get('playerId');
  const requestedPlayerNameForKey = request.nextUrl.searchParams.get('playerName');
  const seasonsParam = new URLSearchParams();
  appendArrayParam(seasonsParam, 'seasons[]', [season]);

  // Lightweight teams-only fetch so the Game Props team search can list real
  // BDL national teams (with numeric ids) before any selection is made.
  if (request.nextUrl.searchParams.get('teamsOnly') === '1') {
    const teamsCacheKey = `${WC_DASHBOARD_CACHE_PREFIX}:teams:${season}`;
    const cachedTeams = await getWorldCupCache<Record<string, unknown>>(teamsCacheKey);
    if (cachedTeams) {
      return NextResponse.json(cachedTeams, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [teamsOnly, standingsOnly] = await Promise.all([
      bdlFetchAll<BdlTeam>('/teams', seasonsParam, apiKey),
      bdlFetchAll('/group_standings', seasonsParam, apiKey),
    ]);
    const teamsPayload = { season, teams: teamsOnly, standings: standingsOnly };
    await setWorldCupCache(teamsCacheKey, teamsPayload);
    return NextResponse.json(teamsPayload, { headers: { 'Cache-Control': 'no-store' } });
  }

  const dashboardCacheKey = buildDashboardCacheKey({
    competition,
    season,
    teamId: requestedTeamId,
    playerId: requestedPlayerId,
    playerName: requestedPlayerNameForKey,
  });

  try {
    const cachedDashboard = await getWorldCupCache<Record<string, unknown>>(dashboardCacheKey);
    if (cachedDashboard) {
      return NextResponse.json(cachedDashboard, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [teams, stadiums, standings, matches, futures] = await Promise.all([
      bdlFetchAll<BdlTeam>('/teams', seasonsParam, apiKey),
      bdlFetchAll('/stadiums', seasonsParam, apiKey),
      bdlFetchAll('/group_standings', seasonsParam, apiKey),
      bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, { cursor: true }),
      bdlFetchAll('/odds/futures', seasonsParam, apiKey),
    ]);

    const selectedTeam = findSelectedTeam(teams, requestedTeamId);
    const featureMatch = findFeatureMatch(matches, selectedTeam);
    const selectedTeamId = selectedTeam?.id ?? null;
    const featureMatchId = featureMatch?.id ?? null;
    const selectedTeamMatches = selectedTeamId
      ? matches.filter((match) => match.home_team?.id === selectedTeamId || match.away_team?.id === selectedTeamId)
      : matches;
    const completedMatchIds = selectedTeamMatches
      .filter((match) => match.status === 'completed')
      .map((match) => match.id)
      .slice(-12);
    const statMatchIds = completedMatchIds.length ? completedMatchIds : featureMatchId ? [featureMatchId] : [];

    // Opponent in the upcoming/feature fixture — used so rosters cover BOTH
    // sides of the matchup (the Availability panel lists both squads).
    const opponentTeamId = featureMatch
      ? featureMatch.home_team?.id === selectedTeamId
        ? featureMatch.away_team?.id ?? null
        : featureMatch.home_team?.id ?? null
      : null;

    const teamScopedParams = new URLSearchParams(seasonsParam);
    if (selectedTeamId) teamScopedParams.append('team_ids[]', String(selectedTeamId));
    if (opponentTeamId && opponentTeamId !== selectedTeamId) {
      teamScopedParams.append('team_ids[]', String(opponentTeamId));
    }

    const matchScopedParams = new URLSearchParams();
    appendArrayParam(matchScopedParams, 'match_ids[]', statMatchIds);
    const playerStatsParams = new URLSearchParams();
    if (requestedPlayerId && /^\d+$/.test(requestedPlayerId)) {
      playerStatsParams.append('player_ids[]', requestedPlayerId);
    } else {
      appendArrayParam(playerStatsParams, 'match_ids[]', statMatchIds);
    }

    const featureMatchParams = new URLSearchParams();
    if (featureMatchId) featureMatchParams.append('match_ids[]', String(featureMatchId));

    const [rostersRaw, squadPlayers, teamMatchStats, playerMatchStats, lineups, events, shots, momentum, bestPlayers, avgPositions, teamForm, odds] =
      await Promise.all([
        selectedTeamId ? bdlFetchAll('/rosters', teamScopedParams, apiKey, { cursor: true, maxPages: 4 }) : Promise.resolve([]),
        selectedTeamId ? bdlFetchAll('/players', teamScopedParams, apiKey, { cursor: true, maxPages: 4 }) : Promise.resolve([]),
        statMatchIds.length ? bdlFetchAll('/team_match_stats', matchScopedParams, apiKey, { cursor: true, maxPages: 4 }) : Promise.resolve([]),
        requestedPlayerId || statMatchIds.length ? bdlFetchAll('/player_match_stats', playerStatsParams, apiKey, { cursor: true, maxPages: 6 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_lineups', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_events', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_shots', featureMatchParams, apiKey, { cursor: true, maxPages: 3 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_momentum', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_best_players', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_avg_positions', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/match_team_form', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
        featureMatchId ? bdlFetchAll('/odds', featureMatchParams, apiKey, { cursor: true, maxPages: 2 }) : Promise.resolve([]),
      ]);
    const rosters = enrichWorldCupRosters(
      rostersRaw as Array<Record<string, any>>,
      squadPlayers as Array<Record<string, any>>
    );

    let playerMatches: BdlMatch[] = [];
    let playerShots: any[] = [];
    if (requestedPlayerId && Array.isArray(playerMatchStats) && playerMatchStats.length) {
      const knownMatchIds = new Set(matches.map((match) => match.id));
      const allPlayerMatchIds = Array.from(
        new Set(
          playerMatchStats
            .map((row: any) => Number(row?.match_id))
            .filter((id) => Number.isFinite(id))
        )
      ).slice(0, 80);
      const playerMatchIds = allPlayerMatchIds.filter((id) => !knownMatchIds.has(id));
      if (playerMatchIds.length) {
        const playerMatchParams = new URLSearchParams();
        appendArrayParam(playerMatchParams, 'seasons[]', [2018, 2022, 2026]);
        appendArrayParam(playerMatchParams, 'match_ids[]', playerMatchIds);
        playerMatches = await bdlFetchAll<BdlMatch>('/matches', playerMatchParams, apiKey, { cursor: true, maxPages: 2 });
      }
      if (allPlayerMatchIds.length) {
        const playerShotParams = new URLSearchParams();
        appendArrayParam(playerShotParams, 'match_ids[]', allPlayerMatchIds);
        playerShotParams.append('player_ids[]', requestedPlayerId);
        playerShots = await bdlFetchAll('/match_shots', playerShotParams, apiKey, { cursor: true, maxPages: 4 });
      }
    }
    const derivedShotsByMatch = new Map<number, Record<string, number>>();
    for (const shot of playerShots) {
      const matchId = Number((shot as any)?.match_id);
      if (!Number.isFinite(matchId)) continue;
      const row =
        derivedShotsByMatch.get(matchId) ??
        {
          derived_shots_total: 0,
          derived_shots_off_target: 0,
          derived_shots_blocked: 0,
          derived_shots_inside_box: 0,
          derived_shots_outside_box: 0,
          derived_hit_woodwork: 0,
          derived_xgot: 0,
        };
      row.derived_shots_total += 1;
      const shotType = String((shot as any)?.shot_type || '').toLowerCase();
      if (shotType === 'miss') row.derived_shots_off_target += 1;
      if (shotType === 'block') row.derived_shots_blocked += 1;
      if (shotType === 'post') row.derived_hit_woodwork += 1;
      const x = Number.parseFloat(String((shot as any)?.player_x ?? ''));
      if (Number.isFinite(x)) {
        if (x <= 16.5) row.derived_shots_inside_box += 1;
        else row.derived_shots_outside_box += 1;
      }
      const xgot = Number.parseFloat(String((shot as any)?.xgot ?? ''));
      if (Number.isFinite(xgot)) row.derived_xgot += xgot;
      derivedShotsByMatch.set(matchId, row);
    }
    const enrichedPlayerMatchStats = (playerMatchStats as Array<Record<string, any>>).map((row) => ({
      ...row,
      ...(derivedShotsByMatch.get(Number(row.match_id)) ?? {}),
    }));

    // Always merge stats from every source we have for the currently selected
    // player so the main chart shows every game across BDL + Euros + Nations
    // League. This runs whenever a `playerName` is provided.
    let mergedPlayerMatchStats: Array<Record<string, any>> = enrichedPlayerMatchStats.map((row) => ({
      ...row,
      source: 'bdl',
      tournament_slug: 'worldcup',
    }));
    let mergedPlayerMatches: Array<Record<string, any>> = summarizeMatches(playerMatches);
    const requestedPlayerName = request.nextUrl.searchParams.get('playerName') || '';
    if (requestedPlayerName) {
      try {
        const [intl, bdlByName] = await Promise.all([
          loadInternationalStatsByPlayerName(requestedPlayerName, { bdlPlayerId: requestedPlayerId }),
          // If the requested player wasn't already a BDL ID (e.g. user came
          // here from intl search in `all` mode), additionally look up BDL by
          // name to surface their World Cup games too.
          enrichedPlayerMatchStats.length
            ? Promise.resolve({ playerMatchStats: [] as any[], matches: [] as any[] })
            : fetchBdlStatsForPlayerName(requestedPlayerName, apiKey),
        ]);

        if (intl.playerMatchStats.length || bdlByName.playerMatchStats.length) {
          mergedPlayerMatchStats = [
            ...mergedPlayerMatchStats,
            ...bdlByName.playerMatchStats.map((row) => ({ ...row, source: 'bdl', tournament_slug: 'worldcup' })),
            ...intl.playerMatchStats,
          ];
          const knownIds = new Set([
            ...mergedPlayerMatches.map((m) => String(m.id)),
            ...summarizeMatches(matches).map((m) => String(m.id)),
          ]);
          for (const m of [...bdlByName.matches, ...intl.matches]) {
            if (!knownIds.has(String(m.id))) {
              mergedPlayerMatches.push(m);
              knownIds.add(String(m.id));
            }
          }
        }
      } catch (mergeError) {
        console.warn('[world-cup/dashboard] cross-source merge failed:', mergeError);
      }
    }

    // Rewrite player_id on every merged row to the requested playerId so the
    // frontend's `String(row.player_id) === selectedPlayerId` filter keeps
    // all cross-source rows for the same player.
    if (requestedPlayerId) {
      mergedPlayerMatchStats = mergedPlayerMatchStats.map((row) => ({
        ...row,
        player_id: requestedPlayerId,
        player: row.player ? { ...row.player, id: requestedPlayerId } : { id: requestedPlayerId },
      }));
    }

    let resolvedSelectedTeam = selectedTeam;
    if (requestedPlayerId && /^\d+$/.test(requestedPlayerId) && enrichedPlayerMatchStats.length) {
      const playerTeam = resolveTeamFromPlayerMatchStats(enrichedPlayerMatchStats, teams);
      if (playerTeam) resolvedSelectedTeam = playerTeam;
    }

    const resolvedSelectedTeamId = resolvedSelectedTeam?.id ?? null;
    const resolvedFeatureMatch = findFeatureMatch(matches, resolvedSelectedTeam);
    const resolvedSelectedTeamMatches = resolvedSelectedTeamId
      ? matches.filter(
          (match) => match.home_team?.id === resolvedSelectedTeamId || match.away_team?.id === resolvedSelectedTeamId
        )
      : matches;

    // Team-mode (Game Props): BDL only has World Cup matches, and the 2026
    // edition has no completed games yet — so `teamMatchStats` is empty and the
    // chart renders nothing. Merge the selected national team's per-match team
    // stats from every international competition we ingest (Euros / Nations
    // League / Copa América / AFCON) so the chart, supporting stats and team
    // form panels populate, exactly like the Soccer dashboard's recent matches.
    // BDL returns both teams' rows per match. Attach each row's match-mate as
    // `opp_<field>` so the chart's team/opponent/home/away perspective toggle
    // works for live (2026) World Cup games once they complete.
    const attachOpponentFields = (rows: Array<Record<string, any>>): Array<Record<string, any>> => {
      const byMatch = new Map<string, Array<Record<string, any>>>();
      for (const row of rows) {
        const mid = String(row?.match_id ?? '');
        const list = byMatch.get(mid) ?? [];
        list.push(row);
        byMatch.set(mid, list);
      }
      return rows.map((row) => {
        const mid = String(row?.match_id ?? '');
        const mate = (byMatch.get(mid) ?? []).find((r) => r !== row && String(r?.team_id) !== String(row?.team_id));
        if (!mate) return row;
        const out: Record<string, any> = { ...row };
        for (const [key, value] of Object.entries(mate)) {
          if (key === 'match_id' || key === 'team_id' || key === 'is_home') continue;
          if (out[`opp_${key}`] === undefined) out[`opp_${key}`] = value;
        }
        return out;
      });
    };

    let mergedTeamMatchStats: Array<Record<string, any>> = attachOpponentFields(
      teamMatchStats as Array<Record<string, any>>
    );
    if (!requestedPlayerId && resolvedSelectedTeam?.id != null) {
      try {
        const [intlTeam, bdlHistory] = await Promise.all([
          loadInternationalTeamStatsByCountry({
            countryCode: resolvedSelectedTeam.country_code ?? null,
            teamName: resolvedSelectedTeam.name ?? null,
            bdlTeamId: String(resolvedSelectedTeam.id),
          }),
          // Past World Cup editions (2018/2022) for the "WC" bars.
          fetchBdlTeamWorldCupHistory(resolvedSelectedTeam.id, apiKey),
        ]);

        const knownMatchIds = new Set(mergedPlayerMatches.map((m) => String(m.id)));
        const knownStatKeys = new Set(
          mergedTeamMatchStats.map((r) => `${r.match_id ?? ''}|${r.team_id ?? ''}`)
        );
        const addStats = (rows: Array<Record<string, any>>) => {
          for (const row of rows) {
            const key = `${row.match_id ?? ''}|${row.team_id ?? ''}`;
            if (knownStatKeys.has(key)) continue;
            mergedTeamMatchStats.push(row);
            knownStatKeys.add(key);
          }
        };
        const addMatches = (rows: Array<Record<string, any>>) => {
          for (const m of rows) {
            if (knownMatchIds.has(String(m.id))) continue;
            mergedPlayerMatches.push(m);
            knownMatchIds.add(String(m.id));
          }
        };

        addStats(bdlHistory.teamMatchStats);
        addMatches(bdlHistory.matches);
        addStats(intlTeam.teamMatchStats);
        addMatches(intlTeam.matches);
      } catch (teamMergeError) {
        console.warn('[world-cup/dashboard] team cross-source merge failed:', teamMergeError);
      }
    }

    // Game Props (team mode): only chart games whose team stats match the full
    // BDL stat set — shots, shots on target, corners, possession, passes. Drop
    // goals-and-cards-only / scoreline-only games (CAF / lower-tier AFC / OFC
    // World Cup qualifiers, which no provider tracks in depth) entirely so a
    // stat is never shown with a half-empty set of bars. These games are
    // removed from the cached payload, not hidden at render. xG is intentionally
    // excluded from the requirement since not every rich source provides it.
    mergedTeamMatchStats = mergedTeamMatchStats.map(normalizeDerivedTeamStats);
    mergedTeamMatchStats = dedupeCrossSourceTeamStatRows(
      mergedTeamMatchStats,
      mergedPlayerMatches
    ) as Array<Record<string, any>>;
    mergedTeamMatchStats = mergedTeamMatchStats.filter(isRichTeamStatRow);

    const responsePayload = {
      season,
      teams,
      stadiums,
      standings,
      matches: summarizeMatches(matches),
      playerMatches: mergedPlayerMatches,
      selectedTeam: resolvedSelectedTeam,
      featureMatch: resolvedFeatureMatch
        ? {
            ...summarizeMatches([resolvedFeatureMatch])[0],
            raw: resolvedFeatureMatch,
          }
        : null,
      selectedTeamMatches: summarizeMatches(resolvedSelectedTeamMatches),
      rosters,
      teamMatchStats: mergedTeamMatchStats,
      playerMatchStats: mergedPlayerMatchStats,
      lineups,
      events,
      shots,
      playerShots,
      momentum,
      bestPlayers,
      avgPositions,
      teamForm,
      odds,
      futures,
    };

    // Cache the assembled payload permanently so this player's stats are reused
    // next time without re-querying BDL.
    await setWorldCupCache(dashboardCacheKey, responsePayload);

    return NextResponse.json(responsePayload, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load World Cup data from BDL',
      },
      { status }
    );
  }
}
