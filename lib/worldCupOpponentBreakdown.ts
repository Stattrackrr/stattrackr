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
 * ranking. Results are ranked across all nations and cached permanently in the
 * `world_cup_cache` table (one entry per window) so the dashboard's Opponent
 * Breakdown card is instant. Re-run the precompute script to refresh.
 */
import { resolveWorldCupFlagCode } from './worldCupFlags';
import { getWorldCupCache, setWorldCupCache } from './worldCupCache';

export const OPP_BREAKDOWN_WINDOWS = [3, 10, 20] as const;
export const OPP_BREAKDOWN_STATS = [
  'goals',
  'assists',
  'shots_total',
  'shots_on_target',
  'passes_accurate',
  'yellow_cards',
  'red_cards',
] as const;

const CACHE_PREFIX = 'wc:opp-breakdown:v1';
const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
const BDL_SEASONS = [2018, 2022, 2026];
// Only the current edition's qualified nations (the 48 teams) are ranked.
const WORLD_CUP_TEAM_SEASON = 2026;
const INTL_SOURCES = ['statsbomb', 'api-football', 'sofascore'];

export type OppBreakdownMetric = {
  values: Record<string, number>;
  ranks: Record<string, number>;
};

export type OppBreakdownPayload = {
  window: number;
  generatedAt: string;
  /** slug -> display country name */
  names: Record<string, string>;
  /** stat -> { values: { slug: avgAllowed }, ranks: { slug: rank } } */
  metrics: Record<string, OppBreakdownMetric>;
};

type Appearance = {
  slug: string;
  date: number;
  name: string;
  allowed: Record<string, number>;
};

function cacheKeyForWindow(window: number): string {
  return `${CACHE_PREFIX}:${window}`;
}

function toNum(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
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
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'StatTrackr/1.0',
            ...(auth ? { Authorization: auth } : {}),
          },
          cache: 'no-store',
        });
        if (res.ok) {
          payload = await res.json();
          ok = true;
          break;
        }
        if (res.status === 429 && attempt < 2) {
          await sleep(400 + attempt * 500);
          continue;
        }
        break;
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

/**
 * The qualified nations for the current World Cup edition (the 48 teams). Only
 * these are ranked. Returns slug -> canonical display name.
 */
async function collectWorldCupTeams(apiKey: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!apiKey) return out;
  const params = new URLSearchParams();
  params.append('seasons[]', String(WORLD_CUP_TEAM_SEASON));
  const teams = await bdlFetchAll<BdlTeam>('/teams', params, apiKey, 4);
  for (const team of teams) {
    const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name);
    if (slug && !out.has(slug)) out.set(slug, team.name);
  }
  return out;
}

type BdlMatch = {
  id: number;
  datetime?: string | null;
  status?: string | null;
  home_team?: BdlTeam | null;
  away_team?: BdlTeam | null;
};

async function collectBdlAppearances(apiKey: string): Promise<Appearance[]> {
  if (!apiKey) return [];

  const seasonsParam = new URLSearchParams();
  BDL_SEASONS.forEach((s) => seasonsParam.append('seasons[]', String(s)));
  const matches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, 6);
  const completed = matches.filter((m) => m.status === 'completed');
  if (!completed.length) return [];

  const ids = completed.map((m) => m.id);
  const playerStats: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('match_ids[]', String(id)));
    const rows = await bdlFetchAll<Record<string, unknown>>('/player_match_stats', params, apiKey, 6);
    playerStats.push(...rows);
  }

  // Aggregate per (match, team).
  const agg = new Map<string, Record<string, number>>();
  for (const row of playerStats) {
    const matchId = Number((row as { match_id?: unknown }).match_id);
    const teamId = Number((row as { team_id?: unknown }).team_id);
    if (!Number.isFinite(matchId) || !Number.isFinite(teamId)) continue;
    const key = `${matchId}:${teamId}`;
    let acc = agg.get(key);
    if (!acc) {
      acc = {};
      agg.set(key, acc);
    }
    for (const stat of OPP_BREAKDOWN_STATS) {
      acc[stat] = (acc[stat] ?? 0) + toNum((row as Record<string, unknown>)[stat]);
    }
  }

  const out: Appearance[] = [];
  for (const m of completed) {
    const homeId = m.home_team?.id;
    const awayId = m.away_team?.id;
    if (homeId == null || awayId == null) continue;
    const date = Date.parse(m.datetime || '') || 0;
    const homeSlug = resolveWorldCupFlagCode(m.home_team?.country_code) || resolveWorldCupFlagCode(m.home_team?.name);
    const awaySlug = resolveWorldCupFlagCode(m.away_team?.country_code) || resolveWorldCupFlagCode(m.away_team?.name);
    const homeAgg = agg.get(`${m.id}:${homeId}`);
    const awayAgg = agg.get(`${m.id}:${awayId}`);
    // A team's "allowed" = the opponent's aggregated stats in that match.
    if (homeSlug && awayAgg) out.push({ slug: homeSlug, date, name: m.home_team!.name, allowed: awayAgg });
    if (awaySlug && homeAgg) out.push({ slug: awaySlug, date, name: m.away_team!.name, allowed: homeAgg });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Supabase international tables
// ---------------------------------------------------------------------------

async function selectAllBySource(table: string, columns: string, source: string): Promise<Array<Record<string, unknown>>> {
  const { supabaseAdmin } = await import('./supabaseAdmin');
  const pageSize = 1000;
  let from = 0;
  const out: Array<Record<string, unknown>> = [];
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq('source', source)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function collectIntlAppearances(): Promise<Appearance[]> {
  const out: Appearance[] = [];

  for (const source of INTL_SOURCES) {
    const teams = await selectAllBySource(
      'international_teams',
      'source_team_id, team_name, country_code',
      source
    );
    const slugByTeam = new Map<string, string>();
    const nameByTeam = new Map<string, string>();
    for (const t of teams) {
      const id = String(t.source_team_id);
      const name = String(t.team_name ?? '');
      nameByTeam.set(id, name);
      const slug =
        resolveWorldCupFlagCode(t.country_code as string | null) || resolveWorldCupFlagCode(name);
      if (slug) slugByTeam.set(id, slug);
    }

    const matches = await selectAllBySource(
      'international_matches',
      'source_match_id, home_team_source_id, away_team_source_id, home_team_name, away_team_name, kickoff_unix, match_date, status',
      source
    );
    if (!matches.length) continue;

    const aggColumns =
      'source_match_id, source_team_id, goals, assists, shots_total, shots_on_target, passes_accurate, yellow_cards, red_cards';
    const playerStats = await selectAllBySource('international_player_match_stats', aggColumns, source);
    const agg = new Map<string, Record<string, number>>();
    for (const r of playerStats) {
      const key = `${r.source_match_id}:${r.source_team_id}`;
      let acc = agg.get(key);
      if (!acc) {
        acc = {};
        agg.set(key, acc);
      }
      for (const stat of OPP_BREAKDOWN_STATS) {
        acc[stat] = (acc[stat] ?? 0) + toNum(r[stat]);
      }
    }

    // Team-level fallback for team-stats-only sources (e.g. SofaScore WCQ) that
    // have no per-player rows.
    const teamAgg = new Map<string, Record<string, number>>();
    try {
      const teamStats = await selectAllBySource(
        'international_team_match_stats',
        'source_match_id, source_team_id, goals, shots_total, shots_on_target, passes_accurate, yellow_cards, red_cards',
        source
      );
      for (const r of teamStats) {
        const key = `${r.source_match_id}:${r.source_team_id}`;
        const rec: Record<string, number> = {};
        for (const stat of OPP_BREAKDOWN_STATS) {
          if (r[stat] != null) rec[stat] = toNum(r[stat]);
        }
        teamAgg.set(key, rec);
      }
    } catch {
      /* table may not exist for every source; ignore */
    }

    for (const m of matches) {
      const homeId = String(m.home_team_source_id);
      const awayId = String(m.away_team_source_id);
      const kickoff = toNum(m.kickoff_unix);
      const date =
        (kickoff ? kickoff * 1000 : m.match_date ? Date.parse(String(m.match_date)) : 0) || 0;
      const homeSlug = slugByTeam.get(homeId);
      const awaySlug = slugByTeam.get(awayId);
      const homeAgg = agg.get(`${m.source_match_id}:${homeId}`) ?? teamAgg.get(`${m.source_match_id}:${homeId}`);
      const awayAgg = agg.get(`${m.source_match_id}:${awayId}`) ?? teamAgg.get(`${m.source_match_id}:${awayId}`);
      if (homeSlug && awayAgg && Object.keys(awayAgg).length) {
        out.push({ slug: homeSlug, date, name: nameByTeam.get(homeId) || String(m.home_team_name ?? ''), allowed: awayAgg });
      }
      if (awaySlug && homeAgg && Object.keys(homeAgg).length) {
        out.push({ slug: awaySlug, date, name: nameByTeam.get(awayId) || String(m.away_team_name ?? ''), allowed: homeAgg });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Combine + compute
// ---------------------------------------------------------------------------

/** Drop cross-source duplicates of the same game (same nation, same day). */
function dedupeAppearances(appearances: Appearance[]): Appearance[] {
  const statsPresent = (a: Appearance) =>
    OPP_BREAKDOWN_STATS.reduce((n, s) => n + (a.allowed[s] != null ? 1 : 0), 0);
  const best = new Map<string, Appearance>();
  for (const a of appearances) {
    const day = a.date ? new Date(a.date).toISOString().slice(0, 10) : 'na';
    const key = `${a.slug}:${day}`;
    const existing = best.get(key);
    if (!existing || statsPresent(a) > statsPresent(existing)) best.set(key, a);
  }
  return [...best.values()];
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

  const names = new Map<string, string>();
  const valuesByStat: Record<string, Record<string, number>> = {};
  for (const stat of OPP_BREAKDOWN_STATS) valuesByStat[stat] = {};

  for (const [slug, list] of bySlug) {
    const recent = [...list].sort((a, b) => b.date - a.date).slice(0, window);
    if (!recent.length) continue;
    names.set(slug, worldCupTeams.get(slug) || recent[0].name);
    for (const stat of OPP_BREAKDOWN_STATS) {
      let sum = 0;
      let count = 0;
      for (const ap of recent) {
        if (ap.allowed[stat] != null) {
          sum += ap.allowed[stat];
          count += 1;
        }
      }
      valuesByStat[stat][slug] = count > 0 ? Number((sum / count).toFixed(3)) : 0;
    }
  }

  const metrics: Record<string, OppBreakdownMetric> = {};
  for (const stat of OPP_BREAKDOWN_STATS) {
    metrics[stat] = { values: valuesByStat[stat], ranks: rankAscending(valuesByStat[stat]) };
  }

  return {
    window,
    generatedAt: new Date().toISOString(),
    names: Object.fromEntries(names),
    metrics,
  };
}

/** Compute the full payload for every window (no caching). */
export async function computeOpponentBreakdownWindows(
  apiKey: string
): Promise<Record<number, OppBreakdownPayload>> {
  const [bdl, intl, worldCupTeams] = await Promise.all([
    collectBdlAppearances(apiKey),
    collectIntlAppearances(),
    collectWorldCupTeams(apiKey),
  ]);
  const merged = dedupeAppearances([...bdl, ...intl]);
  const result: Record<number, OppBreakdownPayload> = {};
  for (const window of OPP_BREAKDOWN_WINDOWS) result[window] = buildPayload(merged, window, worldCupTeams);
  return result;
}

/** Compute every window and persist each to the permanent cache. */
export async function refreshOpponentBreakdownCache(
  apiKey: string
): Promise<Record<number, OppBreakdownPayload>> {
  const all = await computeOpponentBreakdownWindows(apiKey);
  for (const window of OPP_BREAKDOWN_WINDOWS) {
    await setWorldCupCache(cacheKeyForWindow(window), all[window]);
  }
  return all;
}

/**
 * Cache-first read for a single window. Falls back to computing + caching all
 * windows if the cache is empty (so the endpoint still works pre-warm).
 */
export async function getOpponentBreakdown(window: number, apiKey: string): Promise<OppBreakdownPayload> {
  const safeWindow = (OPP_BREAKDOWN_WINDOWS as readonly number[]).includes(window) ? window : 10;
  const cached = await getWorldCupCache<OppBreakdownPayload>(cacheKeyForWindow(safeWindow));
  if (cached) return cached;
  const all = await refreshOpponentBreakdownCache(apiKey);
  return all[safeWindow];
}
