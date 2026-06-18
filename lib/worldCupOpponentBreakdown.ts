/**
 * Cross-source "Opponent Breakdown" rankings.
 *
 * For every nation we compute their defensive "allowed averages" (what their
 * opponents recorded against them) over that nation's most recent N completed
 * games — across ANY competition we ingest:
 *   - BDL FIFA World Cup (2018 / 2022 / 2026)
 *   - Supabase `international_*` tables (StatsBomb Euros, API-Football Nations
 *     League / Copa / AFCON / WCQ, SofaScore qualifiers, ...)
 *
 * Teams are unified across sources by FIFA country slug (via
 * `resolveWorldCupFlagCode`) so a nation's games from every provider feed one
 * ranking. Only "rich" games (shots, SOT, corners, possession, passes — same
 * rule as the Game Props chart) are counted; goals/scoreline-only matches are
 * excluded entirely. Results are ranked across all nations and cached permanently in the
 * `world_cup_cache` table (one entry per window) so the dashboard's Opponent
 * Breakdown card is instant. Re-run the precompute script to refresh.
 */
import { resolveWorldCupFlagCode } from './worldCupFlags';
import { getWorldCupCache, setWorldCupCache, deleteWorldCupCacheByPrefix, buildWorldCupPlayerPropsList } from './worldCupCache';
import { loadInternationalTeamStatsByCountry } from './internationalDashboard';
import { resolveWorldCupAliasName } from './worldCupPlayerAliases';

// ---------------------------------------------------------------------------
// Shared team-match-stat building blocks (also used by the Game Props chart)
// ---------------------------------------------------------------------------

export const RICH_TEAM_STAT_KEYS = [
  'shots_total',
  'shots_on_target',
  'corners',
  'possession_pct',
  'passes_total',
] as const;

export const WC_ALLOWED_STATS = [
  'goals',
  'shots_total',
  'shots_on_target',
  'corners',
  'passes_accurate',
  'yellow_cards',
  'red_cards',
  'fouls',
  'was_fouled',
] as const;

export function toFiniteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(num) ? num : null;
}

export function deriveShotsTotal(
  onTarget: unknown,
  offTarget: unknown,
  blocked: unknown
): number | null {
  const parts = [onTarget, offTarget, blocked].map(toFiniteOrNull);
  if (parts.every((p) => p == null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

export function normalizeDerivedTeamStats(row: Record<string, any>): Record<string, any> {
  const out = { ...row };
  const own = toFiniteOrNull(out.shots_total);
  if (own == null || own === 0) {
    const derived = deriveShotsTotal(out.shots_on_target, out.shots_off_target, out.shots_blocked);
    if (derived != null && derived > 0) out.shots_total = derived;
  }
  const opp = toFiniteOrNull(out.opp_shots_total);
  if (opp == null || opp === 0) {
    const derivedOpp = deriveShotsTotal(
      out.opp_shots_on_target,
      out.opp_shots_off_target,
      out.opp_shots_blocked
    );
    if (derivedOpp != null && derivedOpp > 0) out.opp_shots_total = derivedOpp;
  }
  // Fouls are symmetric: fouls suffered == opponent fouls committed. Prefer the
  // opponent's team-level fouls over a player-summed was_fouled of 0 (sparse
  // per-player coverage marks the stat "present" but sums to zero).
  const oppFouls = toFiniteOrNull(out.opp_fouls);
  if (oppFouls != null) out.was_fouled = oppFouls;
  const fouls = toFiniteOrNull(out.fouls);
  if (fouls != null) out.opp_was_fouled = fouls;
  return out;
}

export function isRichTeamStatRow(row: Record<string, unknown>): boolean {
  let present = 0;
  let total = 0;
  for (const key of RICH_TEAM_STAT_KEYS) {
    const value = row[key];
    if (value == null) continue;
    const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (Number.isFinite(num)) {
      present += 1;
      total += num;
    }
  }
  return present >= 4 && total > 0;
}

export function dedupeCrossSourceTeamStatRows(
  rows: Array<Record<string, unknown>>,
  matches: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const dayByMatchId = new Map<string, string>();
  for (const m of matches) {
    const id = String(m.id ?? '');
    const dt = m.datetime ?? m.match_date;
    if (!id || !dt) continue;
    const parsed = Date.parse(String(dt));
    if (!Number.isFinite(parsed)) continue;
    dayByMatchId.set(id, new Date(parsed).toISOString().slice(0, 10));
  }
  const richness = (row: Record<string, unknown>) => {
    let n = 0;
    for (const key of RICH_TEAM_STAT_KEYS) {
      const v = row[key];
      if (v != null && Number.isFinite(Number(v))) n += 1;
    }
    return n;
  };
  const best = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const teamId = String(row.team_id ?? '');
    const day = dayByMatchId.get(String(row.match_id ?? '')) ?? `id:${row.match_id ?? ''}`;
    const key = `${teamId}:${day}`;
    const existing = best.get(key);
    if (!existing || richness(row) > richness(existing)) best.set(key, row);
  }
  return [...best.values()];
}

type BdlHistoryMatch = {
  id: number;
  home_team?: { id?: number | null } | null;
  away_team?: { id?: number | null } | null;
  home_score?: number | null;
  away_score?: number | null;
};

export function buildBdlTeamHistoryRows(
  teamId: number,
  teamMatches: BdlHistoryMatch[],
  statsByMatchTeam: Map<string, Record<string, any>>
): Array<Record<string, any>> {
  const prefixOpp = (row: Record<string, any> | undefined): Record<string, any> => {
    const out: Record<string, any> = {};
    if (!row) return out;
    for (const [key, value] of Object.entries(row)) {
      if (key === 'match_id' || key === 'team_id' || key === 'is_home') continue;
      out[`opp_${key}`] = value;
    }
    return out;
  };

  const rows: Array<Record<string, any>> = [];
  for (const match of teamMatches) {
    const matchId = Number(match.id);
    const isHome = match.home_team?.id === teamId;
    const oppId = isHome ? match.away_team?.id : match.home_team?.id;
    const ourRow = statsByMatchTeam.get(`${matchId}:${teamId}`);
    if (!ourRow) continue;
    const oppRow = oppId != null ? statsByMatchTeam.get(`${matchId}:${oppId}`) : undefined;
    const scoreGoals = (isHome ? match.home_score : match.away_score) ?? null;
    const oppScoreGoals = (isHome ? match.away_score : match.home_score) ?? null;
    rows.push({
      ...ourRow,
      match_id: matchId,
      team_id: teamId,
      is_home: isHome,
      goals: ourRow?.goals ?? (scoreGoals != null ? scoreGoals : undefined),
      ...prefixOpp(oppRow),
      opp_goals: oppRow?.goals ?? (oppScoreGoals != null ? oppScoreGoals : undefined),
      source: 'bdl',
      tournament_slug: 'worldcup',
    });
  }
  return rows;
}

export function enrichTeamStatRowsWithScoreline(
  rows: Array<Record<string, any>>,
  matches: Array<Record<string, any>>
): Array<Record<string, any>> {
  const byId = new Map<string, Record<string, any>>();
  for (const m of matches) {
    const id = String(m.id ?? '');
    if (id) byId.set(id, m);
  }
  return rows.map((row) => {
    const match = byId.get(String(row.match_id ?? ''));
    if (!match) return row;
    const homeId = String(match.home_team?.id ?? match.homeTeam?.id ?? '');
    const awayId = String(match.away_team?.id ?? match.awayTeam?.id ?? '');
    const teamId = String(row.team_id ?? '');
    const isHome = row.is_home === true || Boolean(homeId && teamId && homeId === teamId);
    const homeScore = toFiniteOrNull(match.home_score ?? match.homeScore);
    const awayScore = toFiniteOrNull(match.away_score ?? match.awayScore);
    const scoreFor = isHome ? homeScore : awayScore;
    const scoreAgainst = isHome ? awayScore : homeScore;
    const out = { ...row };
    if (scoreFor != null) {
      const rowGoals = toFiniteOrNull(out.goals);
      if (rowGoals == null || rowGoals === 0) out.goals = scoreFor;
    }
    if (scoreAgainst != null) {
      const rowOppGoals = toFiniteOrNull(out.opp_goals);
      if (rowOppGoals == null || rowOppGoals === 0) out.opp_goals = scoreAgainst;
    }
    return out;
  });
}

export function extractAllowedFromTeamRow(row: Record<string, any>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stat of WC_ALLOWED_STATS) {
    out[stat] = toFiniteOrNull(row[`opp_${stat}`]) ?? 0;
  }
  return out;
}

/**
 * The team's OWN per-game values for a row = what that team did going forward
 * (attacking). Mirror of extractAllowedFromTeamRow but on the base keys, so the
 * Team Matchup card can show "attack" alongside the opponent's "allowed".
 */
export function extractForFromTeamRow(row: Record<string, any>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stat of WC_ALLOWED_STATS) {
    out[stat] = toFiniteOrNull(row[stat]) ?? 0;
  }
  return out;
}

// Window sizes for the Opponent Breakdown. 0 is the sentinel for "All games"
// (each nation averaged over every game we have for them). "All" is the default
// because some nations only have a handful of international games.
export const OPP_BREAKDOWN_ALL_WINDOW = 0;
export const OPP_BREAKDOWN_WINDOWS = [5, 10, OPP_BREAKDOWN_ALL_WINDOW] as const;
export const OPP_BREAKDOWN_STATS = [
  'goals',
  'shots_total',
  'shots_on_target',
  'corners',
  'passes_accurate',
  'yellow_cards',
  'red_cards',
  'fouls',
  'was_fouled',
] as const;

const CACHE_PREFIX = 'wc:opp-breakdown:v12';
const LEGACY_CACHE_PREFIX = 'wc:opp-breakdown:v11';
const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
const BDL_SEASONS = [2018, 2022, 2026];
// Only the current edition's qualified nations (the 48 teams) are ranked.
const WORLD_CUP_TEAM_SEASON = 2026;

export type OppBreakdownMetric = {
  values: Record<string, number>;
  ranks: Record<string, number>;
};

export type OppBreakdownPayload = {
  /** Requested window (5 / 10 / 0=all). */
  window: number;
  generatedAt: string;
  /** slug -> display country name */
  names: Record<string, string>;
  /** slug -> number of games actually used for this window (sample size). */
  games: Record<string, number>;
  /** slug -> total games available for that nation (across all comps). */
  totalGames: Record<string, number>;
  /** stat -> { values: { slug: avgAllowed }, ranks: { slug: rank } } (defense) */
  metrics: Record<string, OppBreakdownMetric>;
  /**
   * stat -> { values: { slug: avgFor }, ranks: { slug: rank } } (attack). The
   * team's OWN per-game averages, ranked descending (most = rank 1). Powers the
   * Team Matchup card's attack side. Optional for backward compat with old cache.
   */
  forMetrics?: Record<string, OppBreakdownMetric>;
};

type Appearance = {
  matchId: string;
  slug: string;
  date: number;
  name: string;
  allowed: Record<string, number>;
  forStats: Record<string, number>;
};

function cacheKeyForWindow(window: number): string {
  return `${CACHE_PREFIX}:${window}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rank ascending: lowest allowed = rank 1 (stingiest / hardest matchup). */
function rankAscending(values: Record<string, number>): Record<string, number> {
  const sorted = Object.entries(values).sort((a, b) => a[1] - b[1]);
  const ranks: Record<string, number> = {};
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach(([slug, value], index) => {
    const rank = lastValue !== null && value === lastValue ? lastRank : index + 1;
    ranks[slug] = rank;
    lastValue = value;
    lastRank = rank;
  });
  return ranks;
}

/** Rank descending: highest value = rank 1 (best attack). */
function rankDescending(values: Record<string, number>): Record<string, number> {
  const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const ranks: Record<string, number> = {};
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach(([slug, value], index) => {
    const rank = lastValue !== null && value === lastValue ? lastRank : index + 1;
    ranks[slug] = rank;
    lastValue = value;
    lastRank = rank;
  });
  return ranks;
}

// ---------------------------------------------------------------------------
// BDL World Cup
// ---------------------------------------------------------------------------

function bdlAuthCandidates(apiKey: string): string[] {
  if (!apiKey) return [];
  if (apiKey.startsWith('Bearer ')) {
    const plain = apiKey.replace(/^Bearer\s+/i, '').trim();
    return [plain, apiKey].filter(Boolean);
  }
  return [apiKey, `Bearer ${apiKey}`];
}

async function bdlFetchAll<T>(
  path: string,
  baseParams: URLSearchParams,
  apiKey: string,
  maxPages = 8
): Promise<T[]> {
  const rows: T[] = [];
  const auths = bdlAuthCandidates(apiKey);
  let cursor: string | number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams(baseParams);
    if (!params.has('per_page')) params.set('per_page', '100');
    if (cursor != null) params.set('cursor', String(cursor));
    const url = `${BDL_FIFA_BASE}${path}?${params.toString()}`;

    let payload: { data?: T[]; meta?: { next_cursor?: number | string | null } } | null = null;
    for (const auth of auths.length ? auths : ['']) {
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'StatTrackr/1.0',
              ...(auth ? { Authorization: auth } : {}),
            },
            cache: 'no-store',
            signal: ctrl.signal,
          });
          if (res.ok) {
            payload = await res.json();
            ok = true;
            break;
          }
          if ((res.status === 429 || res.status >= 500) && attempt < 2) {
            await sleep(500 + attempt * 600);
            continue;
          }
          break;
        } catch {
          if (attempt < 2) {
            await sleep(400 + attempt * 600);
            continue;
          }
          break;
        } finally {
          clearTimeout(timer);
        }
      }
      if (ok) break;
    }

    if (!payload) break;
    rows.push(...(Array.isArray(payload.data) ? payload.data : []));
    cursor = payload.meta?.next_cursor ?? null;
    if (!cursor) break;
  }

  return rows;
}

type BdlTeam = { id: number; name: string; country_code?: string | null };

type BdlMatch = {
  id: number;
  datetime?: string | null;
  status?: string | null;
  home_team?: BdlTeam | null;
  away_team?: BdlTeam | null;
  home_score?: number | null;
  away_score?: number | null;
};

const WORLD_CUP_TEAMS_CACHE_KEY = `${CACHE_PREFIX}:wc-teams`;
const WORLD_CUP_TEAM_LIST_CACHE_KEY = `${CACHE_PREFIX}:wc-team-list`;

/**
 * The qualified nations for the current World Cup edition (the 48 teams). Only
 * these are ranked. Returns the full BDL team objects (id + country_code + name)
 * because the per-nation chart assembly needs the BDL team id to join the
 * international tables.
 *
 * The list is cached in Supabase (both the full objects and a slug→name map). If
 * BDL is unreachable we fall back to the last cached list so a rebuild never
 * hard-depends on a live BDL call.
 */
async function loadWorldCupTeamList(apiKey: string): Promise<BdlTeam[]> {
  let teams: BdlTeam[] = [];
  if (apiKey) {
    try {
      const params = new URLSearchParams();
      params.append('seasons[]', String(WORLD_CUP_TEAM_SEASON));
      teams = await bdlFetchAll<BdlTeam>('/teams', params, apiKey, 4);
    } catch (err) {
      console.warn('[opp-breakdown] BDL /teams failed, using cached team list:', (err as Error)?.message);
    }
  }

  if (teams.length > 0) {
    const slugMap: Record<string, string> = {};
    for (const team of teams) {
      const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name);
      if (slug && !slugMap[slug]) slugMap[slug] = team.name;
    }
    await setWorldCupCache(WORLD_CUP_TEAMS_CACHE_KEY, slugMap);
    await setWorldCupCache(WORLD_CUP_TEAM_LIST_CACHE_KEY, teams);
    return teams;
  }

  const cached = await getWorldCupCache<BdlTeam[]>(WORLD_CUP_TEAM_LIST_CACHE_KEY);
  return Array.isArray(cached) ? cached : [];
}

/** slug -> display name for the qualified nations (the ranking universe). */
function worldCupSlugMap(teams: BdlTeam[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const team of teams) {
    const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name);
    if (slug && !out.has(slug)) out.set(slug, team.name);
  }
  return out;
}

/**
 * Set of FIFA slugs for the current World Cup's 48 qualified nations — the same
 * universe the Opponent Breakdown ranks across. Used to restrict the DVP rankings
 * so a team's rank is out of 48 (not every international nation we have data for).
 * Falls back to the cached team list when BDL is unavailable; returns an empty
 * set if neither is available (callers then rank across all nations seen).
 */
export async function loadWorldCupQualifiedSlugs(apiKey = ''): Promise<Set<string>> {
  return new Set((await loadWorldCupQualifiedTeamMap(apiKey)).keys());
}

/** slug -> display name for the 48 qualified World Cup nations. */
export async function loadWorldCupQualifiedTeamMap(apiKey = ''): Promise<Map<string, string>> {
  const teams = await loadWorldCupTeamList(apiKey);
  return worldCupSlugMap(teams);
}

/** Qualified WC nations for ranking — BDL live list, then Supabase slug cache. */
export async function ensureWorldCupQualifiedUniverse(apiKey = ''): Promise<Map<string, string>> {
  const live = await loadWorldCupQualifiedTeamMap(apiKey);
  if (live.size > 0) return live;
  const cached = await getWorldCupCache<Record<string, string>>(WORLD_CUP_TEAMS_CACHE_KEY);
  if (cached && typeof cached === 'object') {
    return new Map(Object.entries(cached));
  }
  return live;
}

// ---------------------------------------------------------------------------
// BDL World Cup data (fetched once, shared across all nations)
// ---------------------------------------------------------------------------

type BdlWorldCupData = {
  matches: BdlMatch[];
  /** `${match_id}:${team_id}` -> team_match_stats row. */
  statsByMatchTeam: Map<string, Record<string, any>>;
};

/**
 * Fetch every completed BDL World Cup match (2018/2022/2026) and both teams'
 * team_match_stats once. The per-nation assembly then reuses
 * `buildBdlTeamHistoryRows` — the exact builder the Game Props chart uses — so
 * BDL "allowed" values can never diverge from the chart.
 */
async function loadBdlWorldCupData(
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<BdlWorldCupData> {
  const cached = await loadBdlWorldCupDataFromCache();
  if (cached) {
    onProgress?.(`BDL World Cup (cache): ${cached.matches.length} completed matches`);
    return cached;
  }
  if (!apiKey) return { matches: [], statsByMatchTeam: new Map() };

  const seasonsParam = new URLSearchParams();
  BDL_SEASONS.forEach((s) => seasonsParam.append('seasons[]', String(s)));
  const matches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, 6);
  const completed = matches.filter((m) => m.status === 'completed');
  onProgress?.(`BDL World Cup: ${completed.length} completed matches`);

  const statsByMatchTeam = new Map<string, Record<string, any>>();
  const ids = completed.map((m) => m.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('match_ids[]', String(id)));
    const rows = await bdlFetchAll<Record<string, any>>('/team_match_stats', params, apiKey, 6);
    for (const row of rows) {
      statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
    }
  }

  return { matches: completed, statsByMatchTeam };
}

async function loadBdlWorldCupDataFromCache(): Promise<BdlWorldCupData | null> {
  const [matches, teamStats] = await Promise.all([
    getWorldCupCache<BdlMatch[]>(WC2026_CACHE_KEYS.matchesAllSeasons),
    getWorldCupCache<Array<Record<string, any>>>(WC2026_CACHE_KEYS.teamStatsAllSeasons),
  ]);
  if (!matches?.length || !teamStats?.length) return null;

  const statsByMatchTeam = new Map<string, Record<string, any>>();
  for (const row of teamStats) {
    const matchId = Number(row?.match_id);
    const teamId = Number(row?.team_id);
    if (!Number.isFinite(matchId) || !Number.isFinite(teamId)) continue;
    statsByMatchTeam.set(`${matchId}:${teamId}`, row);
  }

  return {
    matches: matches.filter((match) => match.status === 'completed'),
    statsByMatchTeam,
  };
}

async function loadMatches2026FromCache(apiKey: string): Promise<BdlMatch[]> {
  const cached = await getWorldCupCache<BdlMatch[]>(WC2026_CACHE_KEYS.matches2026);
  if (cached?.length) return cached;
  if (!apiKey) return [];
  const params = new URLSearchParams();
  params.append('seasons[]', '2026');
  return (await bdlFetchAll<BdlMatch>('/matches', params, apiKey, 6)).filter(
    (match) => match.status === 'completed'
  );
}

// ---------------------------------------------------------------------------
// Per-nation assembly (identical pipeline to the Game Props chart)
// ---------------------------------------------------------------------------

/**
 * Build a single nation's "allowed" appearances using the SAME pipeline the
 * Game Props chart uses for that team:
 *   1. BDL World Cup rows via `buildBdlTeamHistoryRows`
 *   2. International rows via `loadInternationalTeamStatsByCountry`
 *   3. normalizeDerivedTeamStats → dedupeCrossSourceTeamStatRows → isRichTeamStatRow
 *   4. allowed = the opponent's per-game values (`opp_*`)
 * Because every value-determining step is shared code, the breakdown can never
 * disagree with the chart for the same nation.
 */
async function appearancesForNation(
  team: BdlTeam,
  slug: string,
  bdl: BdlWorldCupData
): Promise<Appearance[]> {
  const bdlMatches = bdl.matches.filter(
    (m) => m.home_team?.id === team.id || m.away_team?.id === team.id
  );
  const bdlRows = buildBdlTeamHistoryRows(team.id, bdlMatches, bdl.statsByMatchTeam);

  let intlRows: Array<Record<string, any>> = [];
  let intlMatches: Array<Record<string, unknown>> = [];
  try {
    const intl = await loadInternationalTeamStatsByCountry({
      countryCode: team.country_code ?? undefined,
      teamName: team.name,
      bdlTeamId: String(team.id),
    });
    intlRows = (intl.teamMatchStats as Array<Record<string, any>>) ?? [];
    intlMatches = (intl.matches as Array<Record<string, unknown>>) ?? [];
  } catch (err) {
    console.warn(`[opp-breakdown] intl load failed for ${team.name}:`, (err as Error)?.message);
  }

  const matchMeta: Array<Record<string, unknown>> = [
    ...bdlMatches.map((m) => ({ id: m.id, datetime: m.datetime })),
    ...intlMatches,
  ];
  const dateByMatch = new Map<string, number>();
  for (const mm of matchMeta) {
    const id = String(mm.id ?? '');
    if (!id) continue;
    const dt = mm.datetime ?? (mm as Record<string, unknown>).match_date;
    const parsed = dt ? Date.parse(String(dt)) : 0;
    dateByMatch.set(id, Number.isFinite(parsed) ? parsed : 0);
  }

  let rows = [...bdlRows, ...intlRows].map(normalizeDerivedTeamStats);
  rows = dedupeCrossSourceTeamStatRows(rows, matchMeta) as Array<Record<string, any>>;
  rows = rows.filter(isRichTeamStatRow);

  const out: Appearance[] = [];
  for (const row of rows) {
    out.push({
      matchId: String(row.match_id ?? ''),
      slug,
      date: dateByMatch.get(String(row.match_id)) ?? 0,
      name: team.name,
      allowed: extractAllowedFromTeamRow(row),
      forStats: extractForFromTeamRow(row),
    });
  }
  return out;
}

function buildPayload(
  appearances: Appearance[],
  window: number,
  worldCupTeams: Map<string, string>
): OppBreakdownPayload {
  // Restrict the ranking universe to the current World Cup's qualified nations.
  // (When the WC team list is unavailable we fall back to every nation seen.)
  const restrict = worldCupTeams.size > 0;

  const bySlug = new Map<string, Appearance[]>();
  for (const a of appearances) {
    if (restrict && !worldCupTeams.has(a.slug)) continue;
    const list = bySlug.get(a.slug) ?? [];
    list.push(a);
    bySlug.set(a.slug, list);
  }

  const isAll = window === OPP_BREAKDOWN_ALL_WINDOW;
  const names = new Map<string, string>();
  const games = new Map<string, number>();
  const totalGames = new Map<string, number>();
  // Defense (allowed) and attack (for) per-game averages, keyed stat -> slug.
  const allowedByStat: Record<string, Record<string, number>> = {};
  const forByStat: Record<string, Record<string, number>> = {};
  for (const stat of OPP_BREAKDOWN_STATS) {
    allowedByStat[stat] = {};
    forByStat[stat] = {};
  }

  const avg = (recent: Appearance[], pick: (a: Appearance) => Record<string, number>, stat: string) => {
    let sum = 0;
    let count = 0;
    for (const ap of recent) {
      const v = pick(ap)[stat];
      if (v != null) {
        sum += v;
        count += 1;
      }
    }
    return count > 0 ? Number((sum / count).toFixed(3)) : 0;
  };

  for (const [slug, list] of bySlug) {
    const sorted = [...list].sort((a, b) => b.date - a.date);
    const recent = isAll ? sorted : sorted.slice(0, window);
    if (!recent.length) continue;
    names.set(slug, worldCupTeams.get(slug) || recent[0].name);
    games.set(slug, recent.length);
    totalGames.set(slug, sorted.length);
    for (const stat of OPP_BREAKDOWN_STATS) {
      allowedByStat[stat][slug] = avg(recent, (a) => a.allowed, stat);
      forByStat[stat][slug] = avg(recent, (a) => a.forStats, stat);
    }
  }

  const metrics: Record<string, OppBreakdownMetric> = {};
  const forMetrics: Record<string, OppBreakdownMetric> = {};
  for (const stat of OPP_BREAKDOWN_STATS) {
    metrics[stat] = { values: allowedByStat[stat], ranks: rankAscending(allowedByStat[stat]) };
    forMetrics[stat] = { values: forByStat[stat], ranks: rankDescending(forByStat[stat]) };
  }

  return {
    window,
    generatedAt: new Date().toISOString(),
    names: Object.fromEntries(names),
    games: Object.fromEntries(games),
    totalGames: Object.fromEntries(totalGames),
    metrics,
    forMetrics,
  };
}

export type OppBreakdownComputeOptions = {
  onProgress?: (msg: string) => void;
};

/**
 * Compute the full payload for every window (no caching).
 *
 * Iterates the 48 qualified nations and, for each, assembles its games through
 * the exact same pipeline the Game Props chart uses (`appearancesForNation`), so
 * the breakdown's "allowed" averages always match the chart.
 */
export async function computeOpponentBreakdownWindows(
  apiKey: string,
  options: OppBreakdownComputeOptions = {}
): Promise<Record<number, OppBreakdownPayload>> {
  const log = options.onProgress ?? ((msg: string) => console.log(`[opp-breakdown] ${msg}`));

  const teams = await loadWorldCupTeamList(apiKey);
  log(`world cup nations: ${teams.length}`);
  if (!teams.length) {
    log('warning: no WC team list (BDL unavailable and no cache) — cannot rank');
    const empty: Record<number, OppBreakdownPayload> = {};
    for (const window of OPP_BREAKDOWN_WINDOWS) empty[window] = emptyPayload(window);
    return empty;
  }

  const worldCupTeams = worldCupSlugMap(teams);
  const bdl = await loadBdlWorldCupData(apiKey, log);

  const appearances: Appearance[] = [];
  const seenSlug = new Set<string>();
  let done = 0;
  for (const team of teams) {
    done += 1;
    const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name);
    if (!slug || seenSlug.has(slug)) continue;
    seenSlug.add(slug);
    const nationApps = await appearancesForNation(team, slug, bdl);
    appearances.push(...nationApps);
    log(`(${done}/${teams.length}) ${team.name}: ${nationApps.length} games`);
  }
  log(`total appearances: ${appearances.length} across ${seenSlug.size} nations`);

  const result: Record<number, OppBreakdownPayload> = {};
  for (const window of OPP_BREAKDOWN_WINDOWS) result[window] = buildPayload(appearances, window, worldCupTeams);
  return result;
}

/** Compute every window and persist each to the permanent cache. */
let refreshInFlight: Promise<Record<number, OppBreakdownPayload>> | null = null;

export async function refreshOpponentBreakdownCache(
  apiKey: string,
  options: OppBreakdownComputeOptions = {}
): Promise<Record<number, OppBreakdownPayload>> {
  if (refreshInFlight) {
    console.warn('[opp-breakdown] refresh already in progress — reusing in-flight compute');
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const all = await computeOpponentBreakdownWindows(apiKey, options);
      for (const window of OPP_BREAKDOWN_WINDOWS) {
        const payload = all[window];
        const teamCount = Object.keys(payload.names).length;
        console.log(`[opp-breakdown] writing cache window ${window} (${teamCount} nations)…`);
        const ok = await setWorldCupCache(cacheKeyForWindow(window), payload);
        if (!ok) {
          throw new Error(`Failed to write cache for window ${window}`);
        }
        console.log(`[opp-breakdown] window ${window}: cached ${teamCount} nations`);
      }
      return all;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function emptyPayload(window: number): OppBreakdownPayload {
  const metrics: Record<string, OppBreakdownMetric> = {};
  const forMetrics: Record<string, OppBreakdownMetric> = {};
  for (const stat of OPP_BREAKDOWN_STATS) {
    metrics[stat] = { values: {}, ranks: {} };
    forMetrics[stat] = { values: {}, ranks: {} };
  }
  return {
    window,
    generatedAt: new Date().toISOString(),
    names: {},
    games: {},
    totalGames: {},
    metrics,
    forMetrics,
  };
}

/**
 * Cache-only read for a single window. The full rankings are heavy to assemble
 * (every BDL World Cup game + all international sources), so they are NEVER
 * computed on a live request — doing so previously OOM-crashed the server. The
 * payload is warmed offline by `scripts/build-world-cup-opponent-breakdown.ts`
 * (or `refreshOpponentBreakdownCache`); until then this returns an empty payload
 * and the UI shows its "no data yet" state.
 *
 * `apiKey` is kept for signature compatibility with the route but is unused.
 */
export async function getOpponentBreakdown(window: number, _apiKey: string): Promise<OppBreakdownPayload> {
  const safeWindow = (OPP_BREAKDOWN_WINDOWS as readonly number[]).includes(window)
    ? window
    : OPP_BREAKDOWN_ALL_WINDOW;
  const cached = await getWorldCupCache<OppBreakdownPayload>(cacheKeyForWindow(safeWindow));
  if (cached && cached.games && Object.keys(cached.games).length > 0) return cached;
  // Fall back to the previous cache version while a v6 rebuild is in progress or
  // if the latest write failed partway through.
  const legacy = await getWorldCupCache<OppBreakdownPayload>(
    `${LEGACY_CACHE_PREFIX}:${safeWindow}`
  );
  if (legacy && legacy.games && Object.keys(legacy.games).length > 0) return legacy;
  return emptyPayload(safeWindow);
}

/**
 * Compute an opponent breakdown using ONLY completed BDL season=2026 matches,
 * but through the SAME per-nation pipeline as the Game Props chart
 * (`appearancesForNation`). This keeps goals/shots/corners allowed in sync with
 * the chart when 🏆 WC 2026 is toggled on.
 */
export async function computeWcOnlyOppBreakdown(
  apiKey: string,
  options: { allowLiveBdl?: boolean } = {}
): Promise<OppBreakdownPayload> {
  const allowLiveBdl = options.allowLiveBdl !== false;
  const matches2026 = await loadMatches2026FromCache(allowLiveBdl ? apiKey : '');
  const matchIds2026 = new Set(matches2026.map((match) => String(match.id)));
  if (!matchIds2026.size) return emptyPayload(OPP_BREAKDOWN_ALL_WINDOW);

  const teams = await loadWorldCupTeamList(allowLiveBdl ? apiKey : '');
  const wcSlugMap = worldCupSlugMap(teams);
  const cachedBdl = await loadBdlWorldCupDataFromCache();
  const bdl =
    cachedBdl ??
    (allowLiveBdl && apiKey ? await loadBdlWorldCupData(apiKey) : { matches: [], statsByMatchTeam: new Map() });

  const appearances: Appearance[] = [];
  const seenSlug = new Set<string>();
  const nationJobs = teams
    .map((team) => {
      const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name);
      if (!slug || seenSlug.has(slug)) return null;
      seenSlug.add(slug);
      return { team, slug };
    })
    .filter((job): job is { team: BdlTeam; slug: string } => job != null);

  const nationChunks = await Promise.all(
    nationJobs.map(async ({ team, slug }) => {
      const nationApps = await appearancesForNation(team, slug, bdl);
      return nationApps.filter((app) => app.matchId && matchIds2026.has(app.matchId));
    })
  );
  for (const chunk of nationChunks) appearances.push(...chunk);

  return buildPayload(appearances, OPP_BREAKDOWN_ALL_WINDOW, wcSlugMap);
}

// ---------------------------------------------------------------------------
// BDL 2026 full cache ingestion (run via scripts/build-world-cup-opponent-breakdown.ts --bdl-cache)
// ---------------------------------------------------------------------------

export const WC2026_CACHE_KEYS = {
  teams: 'wc:raw:teams:2026:v1',
  standings: 'wc:raw:standings:2026:v1',
  stadiums: 'wc:raw:stadiums:2026:v1',
  matches2026: 'wc:raw:matches:2026:v1',
  matchesAllSeasons: 'wc:raw:matches:allseasons:v1',
  teamStatsAllSeasons: 'wc:raw:team-stats-allseasons:v1',
  rosterForTeam: (teamId: number | string) => `wc:raw:roster:${teamId}:v1`,
  playersForTeam: (teamId: number | string) => `wc:raw:players:${teamId}:v1`,
  matchDetail: (matchId: number | string) => `wc:match:${matchId}:v1`,
  playerStats: (playerId: number | string) => `wc:player:stats:${playerId}:v1`,
  playerShots: (playerId: number | string) => `wc:player:shots:${playerId}:v1`,
  playerIdByName: 'wc:player-id-by-name:v1',
  dvpWc2026ForPosition: (pos: string) => `wc:dvp-wc2026:v4:${pos}`,
  dvpWc2026Raw: 'wc:dvp-wc2026:raw:v4',
  oppBreakdownWc2026: 'wc:opp-breakdown:wc2026:v2',
  playerVsPoolWc: 'wc:player-vs-pool:worldcup:v2',
} as const;

const BDL_CACHE_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

function bdlCacheSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function bdlCacheFetchPage<T>(
  path: string,
  params: URLSearchParams,
  apiKey: string
): Promise<{ data: T[]; nextCursor: string | number | null }> {
  const url = new URL(`${BDL_CACHE_BASE}${path}`);
  params.forEach((v, k) => url.searchParams.append(k, v));
  if (!url.searchParams.has('per_page')) url.searchParams.set('per_page', '100');
  const bearerKey = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  const rawKey = apiKey.startsWith('Bearer ') ? apiKey.slice(7).trim() : apiKey;
  for (const auth of [bearerKey, rawKey]) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          headers: { Accept: 'application/json', 'User-Agent': 'StatTrackr/1.0', Authorization: auth },
          cache: 'no-store',
        });
        if (res.ok) {
          const json = (await res.json()) as { data?: T[]; meta?: { next_cursor?: string | number | null } };
          return { data: Array.isArray(json.data) ? json.data : [], nextCursor: json.meta?.next_cursor ?? null };
        }
        if (res.status === 429 || res.status >= 500) { await bdlCacheSleep(1500 * (attempt + 1)); continue; }
        if (res.status === 401) break;
        throw new Error(`BDL ${res.status} for ${path}`);
      } catch (err) {
        if (attempt < 3) { await bdlCacheSleep(600 * (attempt + 1)); continue; }
        throw err;
      }
    }
  }
  throw new Error(`BDL all auth candidates failed for ${path}`);
}

async function bdlCacheAll<T>(path: string, params: URLSearchParams, apiKey: string, maxPages = 20, politeMs = 120): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | number | null = null;
  for (let page = 0; page < maxPages; page++) {
    const p = new URLSearchParams(params);
    if (cursor != null) p.set('cursor', String(cursor));
    const { data, nextCursor } = await bdlCacheFetchPage<T>(path, p, apiKey);
    rows.push(...data);
    cursor = nextCursor;
    if (!cursor) break;
    if (page > 0) await bdlCacheSleep(politeMs);
  }
  return rows;
}

async function bdlCacheByMatchIds<T>(path: string, matchIds: number[], apiKey: string, chunkSize = 50): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < matchIds.length; i += chunkSize) {
    const chunk = matchIds.slice(i, i + chunkSize);
    const p = new URLSearchParams();
    chunk.forEach((id) => p.append('match_ids[]', String(id)));
    rows.push(...(await bdlCacheAll<T>(path, p, apiKey, 8, 80)));
    if (i + chunkSize < matchIds.length) await bdlCacheSleep(200);
  }
  return rows;
}

function bdlCacheOnlyStep(argv: string[], n: number): boolean {
  const arg = argv.find((a) => a.startsWith('--step='));
  if (!arg) return true;
  return Number(arg.split('=')[1]) === n;
}

function bdlCacheStatNum(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function readBdlCachePlayerStat(row: Record<string, unknown>, stat: string, shotsFromEndpoint?: number): number | null {
  if (stat === 'fouls') return bdlCacheStatNum(row.fouls) ?? bdlCacheStatNum(row.fouls_committed);
  if (stat === 'was_fouled') return bdlCacheStatNum(row.was_fouled) ?? bdlCacheStatNum(row.fouls_suffered);
  if (stat === 'shots_total') {
    const fromRow = bdlCacheStatNum(row.shots_total) ?? bdlCacheStatNum(row.shots) ?? bdlCacheStatNum(row.derived_shots_total);
    if (shotsFromEndpoint != null && fromRow != null) return Math.max(shotsFromEndpoint, fromRow);
    return shotsFromEndpoint ?? fromRow ?? null;
  }
  if (stat === 'passes_total') return bdlCacheStatNum(row.passes_total) ?? bdlCacheStatNum(row.passes);
  return bdlCacheStatNum(row[stat]);
}

const BDL_CACHE_POOL_STATS = ['goals', 'assists', 'shots_total', 'shots_on_target', 'fouls', 'was_fouled', 'passes_total', 'yellow_cards', 'red_cards', 'saves'] as const;
const BDL_CACHE_OPP_STATS = ['goals', 'shots_total', 'shots_on_target', 'fouls', 'was_fouled', 'passes_total', 'yellow_cards', 'red_cards', 'saves'] as const;

export async function runBuildWorldCup2026Cache(argv: string[]): Promise<void> {
  const { normalizeWorldCupPlayerName } = await import('./worldCupPlayerIndex');
  const {
    loadBdlWc2026DvpData,
    aggregateInternationalDvp,
    buildIntlPlayerPositionMap,
    getWorldCupDvpStats,
    WC_DVP_POSITIONS,
  } = await import('./internationalDashboard');

  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const incremental = argv.includes('--incremental');
  const apiKey = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!apiKey) throw new Error('BALLDONTLIE_API_KEY is not set');
  if (dryRun) console.log('[bdl-cache] DRY RUN -- no Supabase writes');
  if (force) console.log('[bdl-cache] FORCE mode -- overwriting existing cache entries');
  if (incremental) console.log('[bdl-cache] INCREMENTAL mode -- refresh fixtures + new match details + derived panels');

  async function set(key: string, value: unknown, label?: string): Promise<void> {
    if (dryRun) { console.log(`[dry-run] would write ${key}${label ? ` (${label})` : ''}`); return; }
    const ok = await setWorldCupCache(key, value);
    if (!ok) console.warn(`[cache] FAILED to write ${key}`);
  }
  async function skip<T>(key: string, opts?: { allowIncrementalReuse?: boolean }): Promise<T | null> {
    if (force) return null;
    if (incremental && !opts?.allowIncrementalReuse) return null;
    return getWorldCupCache<T>(key);
  }

  const t0 = Date.now();
  console.log('[bdl-cache] Starting World Cup 2026 cache build...\n');

  if (bdlCacheOnlyStep(argv, 1)) {
    console.log('-- Step 1: Core 2026 data --');
    const existing = await skip<unknown[]>(WC2026_CACHE_KEYS.teams, { allowIncrementalReuse: true });
    if (existing && incremental) {
      console.log(`  teams: ${existing.length} (cached)`);
      const [standings, matches2026] = await Promise.all([
        bdlCacheAll<Record<string, unknown>>('/group_standings', new URLSearchParams({ 'seasons[]': '2026' }), apiKey),
        bdlCacheAll<Record<string, unknown>>('/matches', new URLSearchParams({ 'seasons[]': '2026' }), apiKey, 20),
      ]);
      const completed = matches2026.filter((m) => m.status === 'completed').length;
      await Promise.all([
        set(WC2026_CACHE_KEYS.standings, standings, `${standings.length} groups`),
        set(WC2026_CACHE_KEYS.matches2026, matches2026, `${matches2026.length} fixtures`),
        set('wc:dashboard:v22:teams:2026', { season: 2026, teams: existing, standings }, 'teams-only payload'),
      ]);
      console.log(`  [incremental] fixtures: ${matches2026.length} (${completed} completed), standings: ${standings.length}`);
    } else if (existing) {
      console.log(`  teams: ${existing.length} (cached, skipping -- use --force or --incremental to refresh)`);
    } else {
      const [teams, standings, stadiums, matches2026, futures] = await Promise.all([
        bdlCacheAll<Record<string, unknown>>('/teams', new URLSearchParams({ 'seasons[]': '2026' }), apiKey),
        bdlCacheAll<Record<string, unknown>>('/group_standings', new URLSearchParams({ 'seasons[]': '2026' }), apiKey),
        bdlCacheAll<Record<string, unknown>>('/stadiums', new URLSearchParams({ 'seasons[]': '2026' }), apiKey),
        bdlCacheAll<Record<string, unknown>>('/matches', new URLSearchParams({ 'seasons[]': '2026' }), apiKey, 20),
        bdlCacheAll<Record<string, unknown>>('/odds/futures', new URLSearchParams({ 'seasons[]': '2026' }), apiKey, 4),
      ]);
      await Promise.all([
        set(WC2026_CACHE_KEYS.teams, teams, `${teams.length} teams`),
        set(WC2026_CACHE_KEYS.standings, standings, `${standings.length} groups`),
        set(WC2026_CACHE_KEYS.stadiums, stadiums, `${stadiums.length} stadiums`),
        set(WC2026_CACHE_KEYS.matches2026, matches2026, `${matches2026.length} fixtures`),
        set('wc:raw:odds-futures:2026:v1', futures, `${futures.length} futures`),
        set('wc:dashboard:v22:teams:2026', { season: 2026, teams, standings }, 'teams-only payload'),
      ]);
      console.log(`  teams: ${teams.length}, standings: ${standings.length}, stadiums: ${stadiums.length}, matches: ${matches2026.length}`);
    }
  }

  if (bdlCacheOnlyStep(argv, 2)) {
    console.log('\n-- Step 2: All-seasons matches --');
    const existing = await skip<unknown[]>(WC2026_CACHE_KEYS.matchesAllSeasons, { allowIncrementalReuse: true });
    if (existing) {
      console.log(`  all-seasons matches: ${existing.length} (cached, skipping full fetch)`);
      if (incremental) {
        const matches2026 =
          (await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.matches2026)) ?? [];
        const existingAllSeasons = (existing as Array<Record<string, unknown>>) ?? [];
        const knownMatchIds = new Set(
          existingAllSeasons.map((m) => Number(m.id)).filter((id) => Number.isFinite(id))
        );
        const newMatches = matches2026.filter((m) => {
          const id = Number(m.id);
          return Number.isFinite(id) && !knownMatchIds.has(id);
        });
        if (newMatches.length) {
          await set(
            WC2026_CACHE_KEYS.matchesAllSeasons,
            [...existingAllSeasons, ...newMatches],
            `${existingAllSeasons.length + newMatches.length} matches`
          );
          console.log(`  [incremental] merged ${newMatches.length} new 2026 fixture(s) into all-seasons matches`);
        }
        const completed2026Ids = matches2026
          .filter((m) => m.status === 'completed' && Number.isFinite(m.id))
          .map((m) => Number(m.id));
        const existingTeamStats =
          (await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.teamStatsAllSeasons)) ?? [];
        const cachedMatchIds = new Set(
          existingTeamStats.map((r) => Number(r.match_id)).filter((id) => Number.isFinite(id))
        );
        const newCompletedIds = completed2026Ids.filter((id) => !cachedMatchIds.has(id));
        if (newCompletedIds.length) {
          const newRows = await bdlCacheByMatchIds<Record<string, unknown>>(
            '/team_match_stats',
            newCompletedIds,
            apiKey
          );
          await set(
            WC2026_CACHE_KEYS.teamStatsAllSeasons,
            [...existingTeamStats, ...newRows],
            `${existingTeamStats.length + newRows.length} rows`
          );
          console.log(`  [incremental] appended team stats for ${newCompletedIds.length} newly completed 2026 match(es)`);
        } else {
          console.log('  [incremental] no new 2026 team stats to append');
        }
        console.log('  [incremental] refreshing BDL DVP supplement (2018/2022/2026 player stats)...');
        const { warmBdlWorldCupDvpSupplementCache } = await import('./internationalDashboard');
        await warmBdlWorldCupDvpSupplementCache({ force: true });
        console.log('  BDL DVP supplement refreshed');
      }
    } else {
      const p = new URLSearchParams();
      ['2018', '2022', '2026'].forEach((y) => p.append('seasons[]', y));
      const allMatches = await bdlCacheAll<Record<string, unknown>>('/matches', p, apiKey, 20);
      await set(WC2026_CACHE_KEYS.matchesAllSeasons, allMatches, `${allMatches.length} matches`);
      const completedIds = (allMatches as Array<{ id?: number; status?: string }>)
        .filter((m) => m.status === 'completed' && Number.isFinite(m.id))
        .map((m) => m.id as number);
      const teamStats = await bdlCacheByMatchIds<Record<string, unknown>>('/team_match_stats', completedIds, apiKey);
      await set(WC2026_CACHE_KEYS.teamStatsAllSeasons, teamStats, `${teamStats.length} rows`);
      console.log(`  all-seasons matches: ${allMatches.length}, team stats rows: ${teamStats.length}`);
      console.log('  warming BDL DVP supplement (2018/2022/2026 player stats)...');
      const { warmBdlWorldCupDvpSupplementCache } = await import('./internationalDashboard');
      await warmBdlWorldCupDvpSupplementCache({ force });
      console.log('  BDL DVP supplement cached');
    }
  }

  if (bdlCacheOnlyStep(argv, 3)) {
    console.log('\n-- Step 3: Rosters + player profiles --');
    const teams = await getWorldCupCache<Array<{ id?: number }>>(WC2026_CACHE_KEYS.teams) ?? [];
    if (!teams.length) {
      console.warn('  teams not cached -- run step 1 first');
    } else {
      let done = 0;
      for (let i = 0; i < teams.length; i += 4) {
        await Promise.all(teams.slice(i, i + 4).map(async (team) => {
          const teamId = team.id;
          if (!Number.isFinite(teamId)) return;
          const rKey = WC2026_CACHE_KEYS.rosterForTeam(teamId!);
          const pKey = WC2026_CACHE_KEYS.playersForTeam(teamId!);
          const [er, ep] = await Promise.all([
            skip<unknown[]>(rKey, { allowIncrementalReuse: !incremental }),
            skip<unknown[]>(pKey, { allowIncrementalReuse: !incremental }),
          ]);
          if (er && ep) { done++; return; }
          const p = new URLSearchParams({ 'seasons[]': '2026', 'team_ids[]': String(teamId) });
          const [roster, players] = await Promise.all([
            bdlCacheAll<Record<string, unknown>>('/rosters', p, apiKey, 4),
            bdlCacheAll<Record<string, unknown>>('/players', p, apiKey, 4),
          ]);
          await Promise.all([set(rKey, roster), set(pKey, players)]);
          done++;
        }));
        await bdlCacheSleep(150);
      }
      console.log(`  rosters + players cached for ${done} teams`);
    }
  }

  if (bdlCacheOnlyStep(argv, 4)) {
    console.log('\n-- Step 4: Per-match details --');
    const matches2026 = await getWorldCupCache<Array<{ id?: number; status?: string }>>(WC2026_CACHE_KEYS.matches2026) ?? [];
    const allMatchIds = matches2026.filter((m) => Number.isFinite(m.id)).map((m) => m.id as number);
    const completedIds = matches2026.filter((m) => m.status === 'completed' && Number.isFinite(m.id)).map((m) => m.id as number);
    if (!allMatchIds.length) {
      console.log('  no matches yet -- skipping');
    } else {
      const allPlayerStats = completedIds.length
        ? await bdlCacheByMatchIds<Record<string, unknown>>('/player_match_stats', completedIds, apiKey)
        : [];
      const allShots = completedIds.length
        ? await bdlCacheByMatchIds<Record<string, unknown>>('/match_shots', completedIds, apiKey)
        : [];
      const allTeamStats = completedIds.length
        ? await bdlCacheByMatchIds<Record<string, unknown>>('/team_match_stats', completedIds, apiKey)
        : [];
      const playerStatsByMatch = new Map<number, Array<Record<string, unknown>>>();
      for (const row of allPlayerStats) {
        const mid = Number(row.match_id);
        if (!Number.isFinite(mid)) continue;
        const list = playerStatsByMatch.get(mid) ?? [];
        list.push(row);
        playerStatsByMatch.set(mid, list);
      }
      const shotsByMatch = new Map<number, Array<Record<string, unknown>>>();
      for (const shot of allShots) {
        const mid = Number(shot.match_id);
        if (!Number.isFinite(mid)) continue;
        const list = shotsByMatch.get(mid) ?? [];
        list.push(shot);
        shotsByMatch.set(mid, list);
      }
      const teamStatsByMatch = new Map<number, Array<Record<string, unknown>>>();
      for (const row of allTeamStats) {
        const mid = Number(row.match_id);
        if (!Number.isFinite(mid)) continue;
        const list = teamStatsByMatch.get(mid) ?? [];
        list.push(row);
        teamStatsByMatch.set(mid, list);
      }
      let written = 0;
      let skipped = 0;
      let refreshed = 0;
      const completedSet = new Set(completedIds);
      for (const matchId of allMatchIds) {
        const key = WC2026_CACHE_KEYS.matchDetail(matchId);
        const isCompleted = completedSet.has(matchId);
        // Incremental: always refresh completed games — blobs may have been cached
        // before the match finished (empty stats) or before BDL published player data.
        if (!force && !(incremental && isCompleted)) {
          if (await skip<unknown>(key, { allowIncrementalReuse: true })) {
            skipped++;
            continue;
          }
        } else if (incremental && isCompleted && (await getWorldCupCache<unknown>(key))) {
          refreshed++;
        }
        const p = new URLSearchParams({ 'match_ids[]': String(matchId) });
        const [lineups, events, momentum, bestPlayers, avgPositions, teamForm, odds] = await Promise.all([
          bdlCacheAll<Record<string, unknown>>('/match_lineups', p, apiKey, 2).catch(() => []),
          bdlCacheAll<Record<string, unknown>>('/match_events', p, apiKey, 2).catch(() => []),
          bdlCacheAll<Record<string, unknown>>('/match_momentum', p, apiKey, 2).catch(() => []),
          bdlCacheAll<Record<string, unknown>>('/match_best_players', p, apiKey, 2).catch(() => []),
          bdlCacheAll<Record<string, unknown>>('/match_avg_positions', p, apiKey, 2).catch(() => []),
          bdlCacheAll<Record<string, unknown>>('/match_team_form', p, apiKey, 2).catch(() => []),
          bdlCacheAll<Record<string, unknown>>('/odds', p, apiKey, 2).catch(() => []),
        ]);
        await set(key, {
          playerStats: playerStatsByMatch.get(matchId) ?? [],
          teamStats: teamStatsByMatch.get(matchId) ?? [],
          shots: shotsByMatch.get(matchId) ?? [],
          lineups, events, momentum, bestPlayers, avgPositions, teamForm, odds,
        });
        written++;
        await bdlCacheSleep(120);
      }
      console.log(
        `  match detail blobs written: ${written}, refreshed (completed): ${refreshed}, skipped: ${skipped} (${allMatchIds.length} total, ${completedIds.length} completed)`
      );
    }
  }

  if (bdlCacheOnlyStep(argv, 5)) {
    console.log('\n-- Step 5: Player index --');
    const teams = await getWorldCupCache<Array<{ id?: number }>>(WC2026_CACHE_KEYS.teams) ?? [];
    const playerProfiles = new Map<number, { name?: string; position?: string | null }>();
    for (const team of teams) {
      if (!Number.isFinite(team.id)) continue;
      const players = await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.playersForTeam(team.id!)) ?? [];
      for (const p of players) {
        const id = Number(p.id);
        if (Number.isFinite(id)) playerProfiles.set(id, { name: String(p.name ?? ''), position: String(p.position ?? '') || null });
      }
    }
    const matches2026 = await getWorldCupCache<Array<{ id?: number; status?: string; datetime?: string; home_team?: Record<string, unknown>; away_team?: Record<string, unknown> }>>(WC2026_CACHE_KEYS.matches2026) ?? [];
    const byPlayer = new Map<number, { stats: Array<Record<string, unknown>>; shots: Array<Record<string, unknown>> }>();
    for (const match of matches2026.filter((m) => m.status === 'completed' && Number.isFinite(m.id))) {
      const detail = await getWorldCupCache<{ playerStats?: Array<Record<string, unknown>>; shots?: Array<Record<string, unknown>> }>(WC2026_CACHE_KEYS.matchDetail(match.id!));
      if (!detail) continue;
      const shotsForPlayer = new Map<number, number>();
      for (const shot of detail.shots ?? []) {
        const pid = Number(shot.player_id);
        if (Number.isFinite(pid)) shotsForPlayer.set(pid, (shotsForPlayer.get(pid) ?? 0) + 1);
      }
      for (const statRow of detail.playerStats ?? []) {
        const pid = Number(statRow.player_id);
        if (!Number.isFinite(pid)) continue;
        const entry = byPlayer.get(pid) ?? { stats: [], shots: [] };
        entry.stats.push({ ...statRow, source: 'bdl', tournament_slug: 'worldcup', match_datetime: match.datetime ?? null, match_home_team: match.home_team ?? null, match_away_team: match.away_team ?? null, derived_shots_total: shotsForPlayer.get(pid) ?? null });
        byPlayer.set(pid, entry);
      }
      for (const shot of detail.shots ?? []) {
        const pid = Number(shot.player_id);
        if (!Number.isFinite(pid)) continue;
        const entry = byPlayer.get(pid) ?? { stats: [], shots: [] };
        entry.shots.push(shot);
        byPlayer.set(pid, entry);
      }
    }
    const nameToId: Record<string, number> = {};
    let written = 0;
    for (const [playerId, data] of byPlayer) {
      await set(WC2026_CACHE_KEYS.playerStats(playerId), data.stats);
      await set(WC2026_CACHE_KEYS.playerShots(playerId), data.shots);
      written++;
      const profile = playerProfiles.get(playerId);
      if (profile?.name) {
        const normalized = normalizeWorldCupPlayerName(profile.name);
        if (normalized) nameToId[normalized] = playerId;
        const parts = normalized.split(' ');
        if (parts.length >= 2) {
          const lastName = parts[parts.length - 1]!;
          if (lastName.length >= 3 && !nameToId[lastName]) nameToId[lastName] = playerId;
        }
      }
    }
    for (const [playerId, profile] of playerProfiles) {
      if (!byPlayer.has(playerId) && profile.name) {
        const normalized = normalizeWorldCupPlayerName(profile.name);
        if (normalized && !nameToId[normalized]) nameToId[normalized] = playerId;
      }
    }
    await set(WC2026_CACHE_KEYS.playerIdByName, nameToId, `${Object.keys(nameToId).length} names`);
    console.log(`  per-player caches: ${written}, name entries: ${Object.keys(nameToId).length}`);
  }

  if (bdlCacheOnlyStep(argv, 6)) {
    console.log('\n-- Step 6: DVP WC 2026 only --');
    const bdl2026 = await loadBdlWc2026DvpData({ skipCache: true });
    const teamsWithGames = Array.from(bdl2026.teamsWithGames);
    if (!bdl2026.matches.length) {
      console.log('  no WC 2026 games yet -- skipping');
    } else {
      await set(WC2026_CACHE_KEYS.dvpWc2026Raw, { matches: bdl2026.matches, statRows: bdl2026.statRows, teamsWithGames });
      const qualifiedSlugs = await loadWorldCupQualifiedSlugs(apiKey);
      const positionMap = buildIntlPlayerPositionMap(bdl2026.statRows);
      const matchesWithStats = new Set(bdl2026.statRows.map((r) => `bdl:${r.source_match_id}`));
      const teamMatchesBySlug = new Map<string, Array<{ key: string; ts: number }>>();
      const addTeamMatch = (name: string, key: string, ts: number) => {
        const s = resolveWorldCupFlagCode(name) || name.trim().toLowerCase();
        if (!s) return;
        const list = teamMatchesBySlug.get(s) ?? [];
        if (!list.some((e) => e.key === key)) list.push({ key, ts });
        teamMatchesBySlug.set(s, list);
      };
      const matchInfo = new Map(bdl2026.matches.map((m) => [`bdl:${m.source_match_id}`, m] as const));
      for (const m of bdl2026.matches) {
        const key = `bdl:${m.source_match_id}`;
        if (!matchesWithStats.has(key)) continue;
        const ts = m.kickoff_unix ? m.kickoff_unix * 1000 : m.match_date ? Date.parse(m.match_date) : 0;
        addTeamMatch(m.home_team_name, key, ts);
        addTeamMatch(m.away_team_name, key, ts);
      }
      const wcSrc = { matchInfo, teamMatchesBySlug, slugNames: new Map<string, string>(), statRows: bdl2026.statRows, positionMap };
      for (const position of WC_DVP_POSITIONS) {
        const result = aggregateInternationalDvp(wcSrc, {
          position,
          requestedStats: getWorldCupDvpStats(position),
          window: 0,
          positionMode: 'lineupPerMatch',
          restrictSlugs: qualifiedSlugs,
        });
        await set(WC2026_CACHE_KEYS.dvpWc2026ForPosition(position), { ...result, wcTeamsWithGames: teamsWithGames });
        console.log(`  ${position}: cached (${teamsWithGames.length} teams)`);
      }
      console.log(`  stat rows joined with BDL lineups: ${bdl2026.statRows.length}`);
    }
  }

  if (bdlCacheOnlyStep(argv, 7)) {
    console.log('\n-- Step 7: Opponent Breakdown WC 2026 only --');
    const payload = await computeWcOnlyOppBreakdown(apiKey);
    await set(WC2026_CACHE_KEYS.oppBreakdownWc2026, payload, `${Object.keys(payload.names).length} teams`);
    console.log(`  opp breakdown cached: ${Object.keys(payload.names).length} teams`);
  }

  if (bdlCacheOnlyStep(argv, 8)) {
    console.log('\n-- Step 8: Player vs Pool (worldcup scope) --');
    const matches2026 = await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.matches2026) ?? [];
    const completedMatches = matches2026.filter((m) => m.status === 'completed' && Number.isFinite(m.id));
    if (!completedMatches.length) {
      console.log('  no completed WC 2026 matches -- skipping');
    } else {
      const teams = await getWorldCupCache<Array<{ id?: number; name?: string; country_code?: string | null }>>(WC2026_CACHE_KEYS.teams) ?? [];
      const teamIdToSlug = new Map<number, string>();
      const teamIdToName = new Map<number, string>();
      for (const t of teams) {
        const id = Number(t.id);
        if (!Number.isFinite(id)) continue;
        teamIdToSlug.set(id, resolveWorldCupFlagCode(t.country_code) || resolveWorldCupFlagCode(t.name) || String(t.name ?? '').toLowerCase());
        teamIdToName.set(id, String(t.name ?? ''));
      }
      const rosterByPlayer = new Map<number, { teamId: number; position: string | null }>();
      for (const t of teams) {
        const teamId = Number(t.id);
        if (!Number.isFinite(teamId)) continue;
        const roster = await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.rosterForTeam(teamId)) ?? [];
        for (const row of roster) {
          const pid = Number(row.player_id);
          if (!Number.isFinite(pid) || rosterByPlayer.has(pid)) continue;
          rosterByPlayer.set(pid, { teamId, position: String(row.position ?? '') || null });
        }
      }
      const byPlayer = new Map<number, { teamId: number; position: string | null; matchStats: Map<number, Record<string, number>> }>();
      for (const [pid, r] of rosterByPlayer) byPlayer.set(pid, { teamId: r.teamId, position: r.position, matchStats: new Map() });
      const byTeamMatch = new Map<number, Map<number, Record<string, number>>>();
      const teamMeta = new Map<number, { name: string; slug: string }>();
      for (const match of completedMatches) {
        const matchId = Number(match.id);
        const homeId = Number((match.home_team as Record<string, unknown>)?.id);
        const awayId = Number((match.away_team as Record<string, unknown>)?.id);
        if (!Number.isFinite(matchId) || !Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;
        const detail = await getWorldCupCache<{ playerStats?: Array<Record<string, unknown>>; shots?: Array<Record<string, unknown>> }>(WC2026_CACHE_KEYS.matchDetail(matchId));
        if (!detail) continue;
        const shotsForPlayer = new Map<number, number>();
        for (const shot of detail.shots ?? []) {
          const pid = Number(shot.player_id);
          if (Number.isFinite(pid)) shotsForPlayer.set(pid, (shotsForPlayer.get(pid) ?? 0) + 1);
        }
        const homeSlug = teamIdToSlug.get(homeId) ?? '';
        const awaySlug = teamIdToSlug.get(awayId) ?? '';
        if (homeSlug) teamMeta.set(homeId, { name: teamIdToName.get(homeId) ?? '', slug: homeSlug });
        if (awaySlug) teamMeta.set(awayId, { name: teamIdToName.get(awayId) ?? '', slug: awaySlug });
        for (const side of [{ defendingId: homeId, opponentId: awayId }, { defendingId: awayId, opponentId: homeId }]) {
          const matchMap = byTeamMatch.get(side.defendingId) ?? new Map();
          const matchSums: Record<string, number> = matchMap.get(matchId) ?? Object.fromEntries(BDL_CACHE_OPP_STATS.map((s) => [s, 0]));
          for (const row of detail.playerStats ?? []) {
            if ((bdlCacheStatNum(row.minutes_played) ?? 1) < 1) continue;
            const rowTeamId = Number(row.team_id);
            const rowPid = Number(row.player_id);
            const shots = Number.isFinite(rowPid) ? shotsForPlayer.get(rowPid) : undefined;
            if (rowTeamId === side.opponentId) {
              for (const stat of BDL_CACHE_OPP_STATS) {
                const v = readBdlCachePlayerStat(row, stat, stat === 'shots_total' ? shots : undefined);
                if (v != null) matchSums[stat] = (matchSums[stat] ?? 0) + v;
              }
            }
            if (side.defendingId === homeId && Number.isFinite(rowPid)) {
              const existing = byPlayer.get(rowPid);
              const entry = existing ?? { teamId: rowTeamId, position: String(row.position ?? '') || null, matchStats: new Map() };
              if (!entry.matchStats.has(matchId)) entry.matchStats.set(matchId, Object.fromEntries(BDL_CACHE_POOL_STATS.map((s) => [s, 0])));
              const ps = entry.matchStats.get(matchId)!;
              for (const stat of BDL_CACHE_POOL_STATS) {
                const v = readBdlCachePlayerStat(row, stat, stat === 'shots_total' ? shots : undefined);
                if (v != null) ps[stat] = (ps[stat] ?? 0) + v;
              }
              if (!existing) byPlayer.set(rowPid, entry);
            }
          }
          matchMap.set(matchId, matchSums);
          byTeamMatch.set(side.defendingId, matchMap);
        }
      }
      const names: Record<string, string> = {};
      const games: Record<string, number> = {};
      const totalGames: Record<string, number> = {};
      const metrics: Record<string, { values: Record<string, number>; ranks: Record<string, number> }> = {};
      for (const stat of BDL_CACHE_OPP_STATS) metrics[stat] = { values: {}, ranks: {} };
      for (const [teamId, matchMap] of byTeamMatch) {
        const meta = teamMeta.get(teamId);
        if (!meta || !matchMap.size) continue;
        names[meta.slug] = meta.name;
        games[meta.slug] = matchMap.size;
        totalGames[meta.slug] = matchMap.size;
        for (const stat of BDL_CACHE_OPP_STATS) {
          let sum = 0;
          for (const s of matchMap.values()) sum += s[stat] ?? 0;
          metrics[stat].values[meta.slug] = Number((sum / matchMap.size).toFixed(3));
        }
      }
      const allSlugs = Object.keys(names);
      for (const stat of BDL_CACHE_OPP_STATS) {
        const vals = metrics[stat].values;
        const sorted = [...allSlugs].sort((a, b) => (vals[a] ?? 0) - (vals[b] ?? 0));
        const ranks: Record<string, number> = {};
        sorted.forEach((sl, idx) => { ranks[sl] = idx + 1; });
        metrics[stat].ranks = ranks;
      }
      const SQUAD_SIZE = 26;
      const playersByTeam = new Map<string, number>();
      const poolPlayers: Array<{ playerKey: string; source: string; sourcePlayerId: string; teamSlug: string; position: string | null; games: number; averages: Record<string, number> }> = [];
      const mapPos = (pos: string | null): string | null => {
        const p = String(pos ?? '').toUpperCase().trim();
        if (p === 'GK' || p.startsWith('G')) return 'GK';
        if (['D', 'DEF', 'CB', 'LB', 'RB', 'WB'].includes(p)) return 'DEF';
        if (['RW', 'LW', 'RM', 'LM', 'FW', 'F', 'W', 'ST', 'CF', 'SS', 'LF', 'RF', 'WG'].includes(p)) return 'FWD';
        if (['M', 'MID', 'CM', 'DM', 'AM'].includes(p)) return 'MID';
        return 'FWD';
      };
      for (const [pid, data] of byPlayer) {
        const slug = teamMeta.get(data.teamId)?.slug ?? teamIdToSlug.get(data.teamId) ?? '';
        if (!slug) continue;
        const gc = data.matchStats.size;
        const avgs: Record<string, number> = {};
        for (const stat of BDL_CACHE_POOL_STATS) {
          if (!gc) { avgs[stat] = 0; continue; }
          let sum = 0;
          for (const ms of data.matchStats.values()) sum += ms[stat] ?? 0;
          avgs[stat] = Number((sum / gc).toFixed(3));
        }
        poolPlayers.push({ playerKey: `bdl:${pid}`, source: 'bdl', sourcePlayerId: String(pid), teamSlug: slug, position: mapPos(data.position), games: gc, averages: avgs });
        playersByTeam.set(slug, (playersByTeam.get(slug) ?? 0) + 1);
      }
      const zeroAvgs = Object.fromEntries(BDL_CACHE_POOL_STATS.map((k) => [k, 0]));
      for (const t of teams) {
        const slug = resolveWorldCupFlagCode(t.country_code) || resolveWorldCupFlagCode(t.name) || String(t.name ?? '').toLowerCase();
        if (!slug) continue;
        for (let i = 0; i < Math.max(0, SQUAD_SIZE - (playersByTeam.get(slug) ?? 0)); i++) {
          poolPlayers.push({ playerKey: `pad:${slug}:${i}`, source: 'bdl', sourcePlayerId: `pad:${slug}:${i}`, teamSlug: slug, position: null, games: 0, averages: { ...zeroAvgs } });
        }
      }
      const rankingTotal = allSlugs.length || teams.length;
      await set(WC2026_CACHE_KEYS.playerVsPoolWc, {
        generatedAt: new Date().toISOString(),
        scope: 'worldcup' as const,
        players: poolPlayers,
        ...(rankingTotal ? { opponentBreakdown: { window: 0, names, games, totalGames, rankingTotal, metrics } } : {}),
      }, `${poolPlayers.filter((p) => p.games > 0).length} players with games`);
      console.log(`  pool: ${poolPlayers.length} entries, opp breakdown: ${allSlugs.length} teams`);
    }
  }

  if (bdlCacheOnlyStep(argv, 9)) {
    console.log('\n-- Step 9: Player vs pool (all scope) --');
    const { loadWorldCupPlayerPool } = await import('./internationalDashboard');
    const payload = await loadWorldCupPlayerPool({ scope: 'all' });
    console.log(`  player pool (all): ${payload.players.length} entries`);
  }

  if (bdlCacheOnlyStep(argv, 10)) {
    console.log('\n-- Step 10: Player search index --');
    const { rebuildAndPersistWorldCupPlayerIndex } = await import('./worldCupPlayerIndex');
    const result = await rebuildAndPersistWorldCupPlayerIndex({ log: (msg) => console.log(`  ${msg}`) });
    console.log(`  player index: ${result.count} entries`);
  }

  console.log(`\n[bdl-cache] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function teamDashboardCacheKey(competition: string, season: number, teamId: number): string {
  return `wc:dashboard:v23:${competition}:${season}:${teamId}:none:none`;
}

async function loadWc2026FixtureIdSet(): Promise<{
  fixtureIds: Set<string>;
  matchPool: Map<string, Record<string, any>>;
}> {
  const matches2026 =
    (await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.matches2026)) ?? [];
  const matchesAll =
    (await getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.matchesAllSeasons)) ?? [];
  const fixtureIds = new Set(
    matches2026
      .filter((m) => m.status === 'completed' && Number.isFinite(Number(m.id)))
      .map((m) => String(m.id))
  );
  const matchPool = new Map<string, Record<string, any>>();
  for (const m of [...matches2026, ...matchesAll]) {
    const id = String(m.id ?? '');
    if (id) matchPool.set(id, m as Record<string, any>);
  }
  return { fixtureIds, matchPool };
}

function buildTeamShareTeamWcStats(
  teamId: number,
  wc2026FixtureIds: Set<string>,
  matchPool: Map<string, Record<string, any>>,
  cachedMatches: Array<Record<string, any>>,
  cachedTeamStats: Array<Record<string, any>>
): Array<Record<string, any>> {
  const teamMatches = cachedMatches.filter(
    (m) =>
      (Number((m.home_team as Record<string, unknown> | undefined)?.id) === teamId ||
        Number((m.away_team as Record<string, unknown> | undefined)?.id) === teamId) &&
      m.status === 'completed'
  ) as BdlHistoryMatch[];
  if (!teamMatches.length) return [];

  const statsByMatchTeam = new Map<string, Record<string, any>>();
  for (const row of cachedTeamStats) {
    statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
  }
  const allRows = buildBdlTeamHistoryRows(teamId, teamMatches, statsByMatchTeam);
  const filtered = allRows.filter((row) => wc2026FixtureIds.has(String(row.match_id ?? '')));
  return enrichTeamStatRowsWithScoreline(filtered, Array.from(matchPool.values()));
}

function hasEmbeddedTeamShare(payload: Record<string, unknown> | null | undefined): boolean {
  return Boolean(
    payload &&
      Array.isArray(payload.teamWcMatchStats) &&
      (payload.teamWcMatchStats as unknown[]).length > 0 &&
      Array.isArray(payload.squadPlayerMatchStats) &&
      (payload.squadPlayerMatchStats as unknown[]).length > 0
  );
}

function bdlPlayerIdFromRow(row: Record<string, unknown>): number | null {
  const nested = row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : {};
  const id = Number(row.player_id ?? nested.id ?? row.id);
  return Number.isFinite(id) ? id : null;
}

function bdlPlayerNameFromRow(row: Record<string, unknown>): string {
  const nested = row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : {};
  return String(
    row.name ??
      row.full_name ??
      row.short_name ??
      nested.name ??
      nested.full_name ??
      nested.short_name ??
      ''
  ).trim();
}

function normalizeWarmPlayerName(name: string): string {
  return resolveWorldCupAliasName(
    String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

function normalizeWarmTeamName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function loadLiveOddsPlayerDashboardTargets(log: (msg: string) => void): Promise<{
  names: Set<string>;
  ids: Set<string>;
  teams: Set<string>;
  rows: number;
}> {
  log('[team-dashboard] reading live-odds targets from Supabase world_cup_cache');
  const list = await buildWorldCupPlayerPropsList({ cacheOnly: true });
  const names = new Set<string>();
  const ids = new Set<string>();
  const teams = new Set<string>();

  for (const row of list.data ?? []) {
    const normalizedName = normalizeWarmPlayerName(row.playerName);
    if (normalizedName) names.add(normalizedName);
    if (row.playerId) ids.add(String(row.playerId));
    const homeTeam = normalizeWarmTeamName(row.homeTeam);
    const awayTeam = normalizeWarmTeamName(row.awayTeam);
    const playerTeam = normalizeWarmTeamName(row.playerTeam ?? '');
    if (homeTeam) teams.add(homeTeam);
    if (awayTeam) teams.add(awayTeam);
    if (playerTeam) teams.add(playerTeam);
  }

  log(
    `[team-dashboard] live-odds player targets: ${names.size} names, ${ids.size} ids, ${teams.size} teams from ${list.data.length} prop rows`
  );
  return { names, ids, teams, rows: list.data.length };
}

/** Team Share fields embedded on the team dashboard cache blob (2026 WC only). */
export async function buildTeamShareFieldsForTeamDashboard(
  teamId: number,
  teamPayload: Record<string, unknown>
): Promise<{
  squadPlayerMatchStats: Array<Record<string, any>>;
  teamWcMatchStats: Array<Record<string, any>>;
}> {
  const [cachedMatches, cachedTeamStats, { fixtureIds, matchPool }] = await Promise.all([
    getWorldCupCache<Array<Record<string, any>>>(WC2026_CACHE_KEYS.matchesAllSeasons),
    getWorldCupCache<Array<Record<string, any>>>(WC2026_CACHE_KEYS.teamStatsAllSeasons),
    loadWc2026FixtureIdSet(),
  ]);

  const teamWcMatchStats = buildTeamShareTeamWcStats(
    teamId,
    fixtureIds,
    matchPool,
    cachedMatches ?? [],
    cachedTeamStats ?? []
  );

  let squadPlayerMatchStats: Array<Record<string, any>> = [];
  if (Array.isArray(teamPayload.playerMatchStats)) {
    squadPlayerMatchStats = (teamPayload.playerMatchStats as Array<Record<string, any>>).filter((row) =>
      fixtureIds.has(String(row.match_id ?? ''))
    );
  }

  return { squadPlayerMatchStats, teamWcMatchStats };
}

/** Patch an existing team dashboard blob with Team Share fields (incremental repair). */
export async function patchTeamDashboardWithTeamShare(
  teamId: number,
  opts?: { season?: number; competition?: string; log?: (msg: string) => void }
): Promise<boolean> {
  const season = opts?.season ?? 2026;
  const competition = opts?.competition ?? 'world-cup';
  const log = opts?.log ?? (() => {});

  const cacheKey = teamDashboardCacheKey(competition, season, teamId);
  const teamPayload = await getWorldCupCache<Record<string, unknown>>(cacheKey);
  if (!teamPayload) {
    log(`[team-dashboard] team ${teamId} missing dashboard blob — run full warm first`);
    return false;
  }
  if (hasEmbeddedTeamShare(teamPayload)) return true;

  try {
    const shareFields = await buildTeamShareFieldsForTeamDashboard(teamId, teamPayload);
    const ok = await setWorldCupCache(cacheKey, { ...teamPayload, ...shareFields });
    if (!ok) {
      log(`[team-dashboard] team ${teamId} team-share patch write failed`);
      return false;
    }
    return true;
  } catch (err) {
    log(`[team-dashboard] team ${teamId} team-share patch error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

type BdlTeamRef = { id?: number; name?: string };

function warmDashboardSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pre-warm team + player dashboard payloads (Game Props + Player Props share fixture data). */
export async function warmWorldCupTeamDashboardCaches(opts?: {
  season?: number;
  competition?: string;
  incremental?: boolean;
  skipPlayerDashboards?: boolean;
  liveOddsPlayerOnly?: boolean;
  concurrency?: number;
  politeMs?: number;
  log?: (msg: string) => void;
}): Promise<{ warmed: number; playersWarmed: number; skipped: number; failed: number }> {
  const season = opts?.season ?? 2026;
  const competition = opts?.competition ?? 'world-cup';
  const incremental = opts?.incremental ?? true;
  const skipPlayerDashboards = opts?.skipPlayerDashboards ?? false;
  const liveOddsPlayerOnly = opts?.liveOddsPlayerOnly ?? false;
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 3, 6));
  const politeMs = opts?.politeMs ?? 150;
  const log = opts?.log ?? (() => {});

  const teams = (await getWorldCupCache<BdlTeamRef[]>(WC2026_CACHE_KEYS.teams)) ?? [];
  const teamIds = teams.map((t) => Number(t.id)).filter((id) => Number.isFinite(id));

  if (!teamIds.length) {
    log('[team-dashboard] no teams in cache — run BDL cache step 1 first');
    return { warmed: 0, playersWarmed: 0, skipped: 0, failed: 0 };
  }

  const { NextRequest } = await import('next/server');
  const { GET } = await import('../app/api/world-cup/dashboard/route');

  let warmed = 0;
  let playersWarmed = 0;
  let skipped = 0;
  let failed = 0;
  const liveOddsTargets = skipPlayerDashboards ? null : await loadLiveOddsPlayerDashboardTargets(log);

  log(
    `[team-dashboard] warming ${teamIds.length} team dashboards (concurrency=${concurrency}, ${
      incremental ? 'cached teams allowed' : 'force rebuild'
    }${
      skipPlayerDashboards
        ? ', skip player dashboards'
        : liveOddsPlayerOnly
          ? ', live-odds players only'
          : ' + live-odds player dashboards'
    })`
  );

  for (let i = 0; i < teamIds.length; i += concurrency) {
    const batch = teamIds.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (teamId) => {
        const teamName = teams.find((t) => Number(t.id) === teamId)?.name ?? String(teamId);
        const cacheKey = teamDashboardCacheKey(competition, season, teamId);
        let teamReady = false;

        if (liveOddsPlayerOnly && liveOddsTargets && !liveOddsTargets.teams.has(normalizeWarmTeamName(teamName))) {
          skipped += 1;
          return;
        }

        if (incremental) {
          const cached = await getWorldCupCache<Record<string, unknown>>(cacheKey);
          if (cached && hasEmbeddedTeamShare(cached)) {
            skipped += 1;
            teamReady = true;
          } else if (cached) {
            const patched = await patchTeamDashboardWithTeamShare(teamId, { season, competition, log });
            if (patched) {
              warmed += 1;
              log(`[team-dashboard] ${teamName} team-share patched`);
              teamReady = true;
            }
          }
        }

        if (liveOddsPlayerOnly && !teamReady) {
          failed += 1;
          log(`[team-dashboard] ${teamName} player warm skipped — team dashboard cache missing`);
          return;
        }

        if (!teamReady) {
          try {
            await deleteWorldCupCacheByPrefix(`wc:dashboard:v23:${competition}:${season}:${teamId}:`);

            const url = new URL('http://localhost/api/world-cup/dashboard');
            url.searchParams.set('season', String(season));
            url.searchParams.set('competition', competition);
            url.searchParams.set('teamId', String(teamId));
            url.searchParams.set('rebuildDashboard', '1');

            const response = await GET(new NextRequest(url));
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as { error?: string };
              failed += 1;
              log(`[team-dashboard] ${teamName} failed: ${body.error ?? response.status}`);
              return;
            }

            warmed += 1;
            log(`[team-dashboard] ${teamName} cached (fixtures + team share)`);
            teamReady = true;
          } catch (err) {
            failed += 1;
            log(`[team-dashboard] ${teamName} error: ${err instanceof Error ? err.message : String(err)}`);
            return;
          }
        }

        if (teamReady && !skipPlayerDashboards) {
          if (!liveOddsTargets || liveOddsTargets.rows === 0) {
            log(`[team-dashboard] ${teamName} player warm skipped — no live odds targets in cache`);
            return;
          }
          if (!liveOddsTargets.teams.has(normalizeWarmTeamName(teamName))) {
            log(`[team-dashboard] ${teamName} player warm skipped — team not in live odds window`);
            return;
          }

          const [roster, squad] = await Promise.all([
            getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.rosterForTeam(teamId)),
            getWorldCupCache<Array<Record<string, unknown>>>(WC2026_CACHE_KEYS.playersForTeam(teamId)),
          ]);
          const nameById = new Map<number, string>();
          for (const p of squad ?? []) {
            const id = bdlPlayerIdFromRow(p);
            const name = bdlPlayerNameFromRow(p);
            if (id != null && name) nameById.set(id, name);
          }

          let candidates = 0;
          let unresolved = 0;
          let skippedNoOdds = 0;
          for (const row of roster ?? []) {
            const playerId = bdlPlayerIdFromRow(row);
            const playerName = playerId != null ? bdlPlayerNameFromRow(row) || nameById.get(playerId) : '';
            if (playerId == null || !playerName) {
              unresolved += 1;
              continue;
            }
            const hasLiveOdds =
              liveOddsTargets.ids.has(String(playerId)) || liveOddsTargets.names.has(normalizeWarmPlayerName(playerName));
            if (!hasLiveOdds) {
              skippedNoOdds += 1;
              continue;
            }
            candidates += 1;
            try {
              const playerUrl = new URL('http://localhost/api/world-cup/dashboard');
              playerUrl.searchParams.set('season', String(season));
              playerUrl.searchParams.set('competition', competition);
              playerUrl.searchParams.set('teamId', String(teamId));
              playerUrl.searchParams.set('playerId', String(playerId));
              playerUrl.searchParams.set('playerName', playerName);
              const playerRes = await GET(new NextRequest(playerUrl));
              if (playerRes.ok) playersWarmed += 1;
            } catch {
              /* non-fatal: team blob still drives shared fixture fields */
            }
            await warmDashboardSleep(60);
          }

          if ((roster?.length ?? 0) > 0 && candidates === 0) {
            log(
              `[team-dashboard] ${teamName} player warm skipped — no roster players with live odds ` +
                `(${skippedNoOdds} without odds, ${unresolved} unresolved)`
            );
          } else if (candidates > 0) {
            log(`[team-dashboard] ${teamName} live-odds players cache-checked/warmed: ${candidates} (${skippedNoOdds} roster players skipped)`);
          }
        }
      })
    );
    if (i + concurrency < teamIds.length) await warmDashboardSleep(politeMs);
  }

  log(`[team-dashboard] done — teams ${warmed}, players ${playersWarmed}, skipped ${skipped}, failed ${failed}`);

  return { warmed, playersWarmed, skipped, failed };
}
