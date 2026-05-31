import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function bdlFetch<T>(path: string, params: URLSearchParams, apiKey: string): Promise<BdlEnvelope<T>> {
  const authCandidates = getAuthCandidates(apiKey);
  let lastStatus = 0;
  let lastText = '';

  for (const auth of authCandidates.length ? authCandidates : ['']) {
    const url = new URL(`${BDL_FIFA_BASE}${path}`);
    params.forEach((value, key) => url.searchParams.append(key, value));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        ...(auth ? { Authorization: auth } : {}),
      },
      cache: 'no-store',
    });

    if (response.ok) {
      return (await response.json()) as BdlEnvelope<T>;
    }

    lastStatus = response.status;
    lastText = await response.text().catch(() => response.statusText);
    if (response.status !== 401) break;
  }

  throw Object.assign(new Error(lastText || `BDL request failed with ${lastStatus}`), { status: lastStatus });
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
    homeFormation: match.home_formation ?? null,
    awayFormation: match.away_formation ?? null,
  }));
}

export async function GET(request: NextRequest) {
  const apiKey = getBdlApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
  }

  const season = parseSeason(request.nextUrl.searchParams.get('season'));
  const requestedTeamId = request.nextUrl.searchParams.get('teamId');
  const requestedPlayerId = request.nextUrl.searchParams.get('playerId');
  const seasonsParam = new URLSearchParams();
  appendArrayParam(seasonsParam, 'seasons[]', [season]);

  try {
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

    const teamScopedParams = new URLSearchParams(seasonsParam);
    if (selectedTeamId) teamScopedParams.append('team_ids[]', String(selectedTeamId));

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

    const [rosters, teamMatchStats, playerMatchStats, lineups, events, shots, momentum, bestPlayers, avgPositions, teamForm, odds] =
      await Promise.all([
        selectedTeamId ? bdlFetchAll('/rosters', teamScopedParams, apiKey, { cursor: true, maxPages: 4 }) : Promise.resolve([]),
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

    return NextResponse.json(
      {
        season,
        teams,
        stadiums,
        standings,
        matches: summarizeMatches(matches),
        playerMatches: summarizeMatches(playerMatches),
        selectedTeam,
        featureMatch: featureMatch
          ? {
              ...summarizeMatches([featureMatch])[0],
              raw: featureMatch,
            }
          : null,
        selectedTeamMatches: summarizeMatches(selectedTeamMatches),
        rosters,
        teamMatchStats,
        playerMatchStats: enrichedPlayerMatchStats,
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
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
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
