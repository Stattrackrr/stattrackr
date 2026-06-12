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
import { getWorldCupCache, setWorldCupCache } from './worldCupCache';
import { loadInternationalTeamStatsByCountry } from './internationalDashboard';

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
 * Compute an opponent breakdown using ONLY 2026 World Cup matches from BDL.
 * Unlike the precomputed cache (which spans all competitions and editions), this
 * runs live and only includes teams that have played ≥1 WC 2026 game.
 * International Supabase data is intentionally excluded so the result is purely
 * the current tournament.
 */
export async function computeWcOnlyOppBreakdown(apiKey: string): Promise<OppBreakdownPayload> {
  if (!apiKey) return emptyPayload(OPP_BREAKDOWN_ALL_WINDOW);

  // Fetch only 2026 WC matches.
  const params = new URLSearchParams();
  params.append('seasons[]', '2026');
  const allMatches = await bdlFetchAll<BdlMatch>('/matches', params, apiKey, 6);
  const matches = allMatches.filter((m) => m.status === 'completed');
  if (!matches.length) return emptyPayload(OPP_BREAKDOWN_ALL_WINDOW);

  // Fetch team stats for all 2026 completed matches.
  const statsByMatchTeam = new Map<string, Record<string, any>>();
  const ids = matches.map((m) => m.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const chunkParams = new URLSearchParams();
    chunk.forEach((id) => chunkParams.append('match_ids[]', String(id)));
    const rows = await bdlFetchAll<Record<string, any>>('/team_match_stats', chunkParams, apiKey, 6);
    for (const row of rows) {
      statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
    }
  }
  const bdl: BdlWorldCupData = { matches, statsByMatchTeam };

  // Load the 48 qualified WC teams to build the slug map (ranking universe).
  const teams = await loadWorldCupTeamList(apiKey);
  const wcSlugMap = worldCupSlugMap(teams);

  // Build appearances using only BDL 2026 rows (skip intl Supabase data).
  const appearances: Appearance[] = [];
  for (const team of teams) {
    const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name);
    if (!slug) continue;
    const teamMatches = matches.filter(
      (m) => m.home_team?.id === team.id || m.away_team?.id === team.id
    );
    if (!teamMatches.length) continue; // has not played yet — exclude from rankings
    const rows = buildBdlTeamHistoryRows(team.id, teamMatches, statsByMatchTeam)
      .map(normalizeDerivedTeamStats)
      .filter(isRichTeamStatRow);
    const dateByMatch = new Map<string, number>();
    for (const m of teamMatches) {
      dateByMatch.set(String(m.id), m.datetime ? Date.parse(m.datetime) : 0);
    }
    for (const row of rows) {
      appearances.push({
        slug,
        date: dateByMatch.get(String(row.match_id)) ?? 0,
        name: team.name,
        allowed: extractAllowedFromTeamRow(row),
        forStats: extractForFromTeamRow(row),
      });
    }
  }

  return buildPayload(appearances, OPP_BREAKDOWN_ALL_WINDOW, wcSlugMap);
}
