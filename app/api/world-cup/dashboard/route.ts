import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  WORLD_CUP_LOGO_DOWNLOADS_EXTENSIONS,
  WORLD_CUP_LOGO_DOWNLOADS_STEM,
  WORLD_CUP_LOGO_PUBLIC_FILENAME,
} from '@/lib/nbaConstants';
import {
  InternationalCompetition,
  IntlPositionBucket,
  buildWorldCupDvpCacheKey,
  getWorldCupDvpStats,
  loadInternationalDashboardData,
  loadInternationalDvp,
  loadInternationalDvpAggregate,
  loadInternationalStatsByPlayerName,
  loadInternationalTeamForm,
  loadInternationalTeamStatsByCountry,
  expandWorldCupOpponentBreakdownUniverse,
  loadWorldCupPlayerPool,
  mergeWorldCupOpponentAllowedSnapshot,
  opponentAllowedRankingTotal,
  rankPlayerVsOpponentAllowed,
  WorldCupPlayerPoolEntry,
  WorldCupPlayerVsOpponentBreakdown,
  WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS,
  loadBdlWc2026DvpData,
  aggregateInternationalDvp,
  buildIntlPlayerPositionMap,
} from '@/lib/internationalDashboard';
import {
  getOpponentBreakdown,
  computeWcOnlyOppBreakdown,
  isRichTeamStatRow,
  normalizeDerivedTeamStats,
  dedupeCrossSourceTeamStatRows,
  buildBdlTeamHistoryRows,
  enrichTeamStatRowsWithScoreline,
  toFiniteOrNull,
  ensureWorldCupQualifiedUniverse,
  loadWorldCupQualifiedSlugs,
  loadWorldCupQualifiedTeamMap,
  buildTeamShareFieldsForTeamDashboard,
} from '@/lib/worldCupOpponentBreakdown';
import { worldCupTeamsMatch } from '@/lib/worldCupFlags';
import {
  buildWorldCupPlayerPropsList,
  enrichWorldCupPlayerPropsList,
  fetchWorldCupPlayerOdds,
  filterWorldCupPropsWithPlayerCategoryStats,
  getWorldCupCache,
  getWorldCupEnrichedListCache,
  refreshWorldCupOddsCache,
  runWorldCupPropsStatsWarm,
  setWorldCupEnrichedListCache,
  getWcCacheDebugSummary,
  isWcCacheDebug,
  logWcCacheRequestComplete,
  probeWorldCupPlayerOddsRaw,
  recordWcSource,
  runWithWcCacheDebug,
  setWorldCupCache,
  wcCacheLog,
} from '@/lib/worldCupCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveWorldCupFlagCode } from '@/lib/worldCupFlags';
import {
  buildWorldCupPlayerNameById,
  loadLineupPlayerPhotos,
  normalizeWorldCupPlayerName,
} from '@/lib/worldCupPlayerIndex';
import { getPrimaryOddsLineForStat } from '@/lib/impliedProbability';
import { authorizeCronRequest, isCronRequestAuthorized } from '@/lib/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompetitionParam = 'all' | 'world-cup' | InternationalCompetition;

// ─────────────────────────────────────────────────────────────────────────────
// Pre-warmed cache key constants (must stay in sync with lib/worldCupOpponentBreakdown.ts WC2026_CACHE_KEYS)
// ─────────────────────────────────────────────────────────────────────────────
const WC2026 = {
  teams: 'wc:raw:teams:2026:v1',
  standings: 'wc:raw:standings:2026:v1',
  stadiums: 'wc:raw:stadiums:2026:v1',
  matches2026: 'wc:raw:matches:2026:v1',
  matchesAllSeasons: 'wc:raw:matches:allseasons:v1',
  teamStatsAllSeasons: 'wc:raw:team-stats-allseasons:v1',
  rosterForTeam: (id: number | string) => `wc:raw:roster:${id}:v1`,
  playersForTeam: (id: number | string) => `wc:raw:players:${id}:v1`,
  matchDetail: (id: number | string) => `wc:match:${id}:v1`,
  playerStats: (id: number | string) => `wc:player:stats:${id}:v1`,
  playerShots: (id: number | string) => `wc:player:shots:${id}:v1`,
  playerIdByName: 'wc:player-id-by-name:v1',
  dvpWc2026ForPosition: (pos: string) => `wc:dvp-wc2026:v4:${pos}`,
  dvpWc2026Raw: 'wc:dvp-wc2026:raw:v3',
  oppBreakdownWc2026: 'wc:opp-breakdown:wc2026:v2',
  playerVsPoolWc: 'wc:player-vs-pool:worldcup:v2',
} as const;

/** Thin typed wrapper: returns null on miss, never throws. */
async function readWcCache<T>(key: string): Promise<T | null> {
  const value = await getWorldCupCache<T>(key);
  recordWcSource(key, value != null ? 'supabase-cache' : 'cache-miss');
  return value;
}

// Persist the assembled World Cup dashboard payload in Supabase so a player's
// stats are only fetched from BDL once and then served from cache on
// subsequent loads (links every searched name to its resolved stats).
// Stored permanently (no expiry).
const WC_DASHBOARD_CACHE_PREFIX = 'wc:dashboard:v23';

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

/** Fixture + side-panel fields shared with Game Props; never overwrite player chart history. */
const TEAM_SHARED_DASHBOARD_FIELDS = [
  'featureMatch',
  'selectedTeam',
  'selectedTeamMatches',
  'lineups',
  'lineupMeta',
  'events',
  'shots',
  'momentum',
  'bestPlayers',
  'avgPositions',
  'teamForm',
  'odds',
  'standings',
  'teams',
  'stadiums',
  'futures',
  'rosters',
  'teamMatchStats',
  'wc2026OpponentBreakdown',
  'playerVsPool',
  'squadPlayerMatchStats',
  'teamWcMatchStats',
] as const;

function dashboardMatchRichness(match: Record<string, unknown>): number {
  let score = 0;
  if (match.awayLabel || (match.awayTeam as Record<string, unknown> | undefined)?.name) score += 2;
  if (match.homeLabel || (match.homeTeam as Record<string, unknown> | undefined)?.name) score += 2;
  if (match.away_team || match.home_team) score += 1;
  if (match.datetime) score += 1;
  return score;
}

/** Union team + player match lists; never let team blob clobber richer player match metadata. */
function mergeDashboardPlayerMatches(
  playerMatches: Array<Record<string, unknown>> | undefined,
  teamMatches: Array<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const match of teamMatches ?? []) {
    const id = String(match.id ?? '');
    if (id) byId.set(id, match);
  }
  for (const match of playerMatches ?? []) {
    const id = String(match.id ?? '');
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || dashboardMatchRichness(match) >= dashboardMatchRichness(existing)) {
      byId.set(id, match);
    }
  }
  return Array.from(byId.values());
}

function resolveRequestedPlayerName(
  payload: Record<string, unknown>,
  playerId: string | null,
  playerNameParam: string | null
): string | null {
  const fromParam = playerNameParam?.trim();
  if (fromParam) return fromParam;
  if (!playerId || !Array.isArray(payload.rosters)) return null;
  for (const row of payload.rosters as Array<Record<string, any>>) {
    const id = String(row.player_id ?? row.player?.id ?? '');
    if (id !== playerId) continue;
    const name = String(row.player?.name ?? row.player?.short_name ?? '').trim();
    if (name) return name;
  }
  return null;
}

/** Backfill opponent metadata for intl stat rows when a stale player cache lacks playerMatches. */
async function repairPlayerMatchesFromIntl(
  playerMatchStats: Array<Record<string, any>>,
  playerMatches: Array<Record<string, any>>,
  opts: { playerName?: string | null; playerId?: string | null }
): Promise<Array<Record<string, any>>> {
  const byId = new Map<string, Record<string, any>>();
  for (const match of playerMatches) {
    const id = String(match.id ?? '');
    if (id) byId.set(id, match);
  }
  const needsRepair = playerMatchStats.some((row) => {
    const source = String(row.source ?? '').toLowerCase();
    if (!source || source === 'bdl') return false;
    const id = String(row.match_id ?? '');
    if (!id) return false;
    const match = byId.get(id);
    if (!match) return true;
    return dashboardMatchRichness(match) < 4;
  });
  if (!needsRepair || !opts.playerName?.trim()) return playerMatches;

  try {
    const intl = await loadInternationalStatsByPlayerName(opts.playerName.trim(), {
      bdlPlayerId: opts.playerId ?? undefined,
    });
    for (const match of intl.matches as Array<Record<string, any>>) {
      const id = String(match.id ?? '');
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing || dashboardMatchRichness(match) >= dashboardMatchRichness(existing)) {
        byId.set(id, match);
      }
    }
  } catch {
    /* non-fatal */
  }
  return Array.from(byId.values());
}

/** Player Props reads fixture/context from the canonical team dashboard blob. */
async function mergeTeamSharedDashboardFields(
  playerPayload: Record<string, unknown>,
  opts: { competition: CompetitionParam; season: number; teamId: string | null }
): Promise<Record<string, unknown>> {
  if (!opts.teamId || !/^\d+$/.test(opts.teamId)) return playerPayload;
  const teamKey = buildDashboardCacheKey({
    competition: opts.competition,
    season: opts.season,
    teamId: opts.teamId,
    playerId: null,
    playerName: null,
  });
  const teamPayload = await getWorldCupCache<Record<string, unknown>>(teamKey);
  if (!teamPayload) return playerPayload;
  const merged: Record<string, unknown> = { ...playerPayload };
  for (const field of TEAM_SHARED_DASHBOARD_FIELDS) {
    if (teamPayload[field] !== undefined) merged[field] = teamPayload[field];
  }
  // Union team + player match metadata so intl fixtures from the team blob backfill logos.
  if (teamPayload.playerMatches !== undefined || playerPayload.playerMatches !== undefined) {
    merged.playerMatches = mergeDashboardPlayerMatches(
      teamPayload.playerMatches as Array<Record<string, unknown>> | undefined,
      playerPayload.playerMatches as Array<Record<string, unknown>> | undefined
    );
  }
  return merged;
}

/** Side-panel payloads for Player Props — served from pre-warmed caches (no extra client fetches). */
function playerSidePanelFullyCached(payload: Record<string, unknown>): boolean {
  const dvpBundles = payload.dvpBundles;
  const hasDvpBundles =
    dvpBundles &&
    typeof dvpBundles === 'object' &&
    Object.keys(dvpBundles as object).length > 0;
  return Boolean(
    payload.wc2026OpponentBreakdown &&
      payload.playerVsPool &&
      Array.isArray(payload.teamWcMatchStats) &&
      (payload.teamWcMatchStats as unknown[]).length > 0 &&
      Array.isArray(payload.squadPlayerMatchStats) &&
      (payload.squadPlayerMatchStats as unknown[]).length > 0 &&
      hasDvpBundles
  );
}

async function attachWc2026OpponentBreakdownIfMissing(out: Record<string, unknown>): Promise<void> {
  if (
    out.wc2026OpponentBreakdown &&
    typeof (out.wc2026OpponentBreakdown as Record<string, unknown>).names === 'object' &&
    Object.keys((out.wc2026OpponentBreakdown as { names: Record<string, unknown> }).names).length > 0
  ) {
    return;
  }

  const wc2026OpponentBreakdown = await readWcCache<Record<string, unknown>>(WC2026.oppBreakdownWc2026);
  if (
    wc2026OpponentBreakdown &&
    typeof wc2026OpponentBreakdown.names === 'object' &&
    Object.keys(wc2026OpponentBreakdown.names as object).length > 0
  ) {
    recordWcSource('oppBreakdownWc2026', 'supabase-cache', 'dashboard-bundle');
    out.wc2026OpponentBreakdown = wc2026OpponentBreakdown;
  }
}

async function attachDvpBundlesIfMissing(out: Record<string, unknown>): Promise<void> {
  const existingBundles =
    out.dvpBundles && typeof out.dvpBundles === 'object'
      ? (out.dvpBundles as Record<string, DvpBatchApiPayload>)
      : {};
  const freshBundles = await loadBundledDvpCaches();
  const mergedBundles = { ...existingBundles, ...freshBundles };
  if (Object.keys(mergedBundles).length > 0) {
    recordWcSource('dvpAggregate', 'supabase-cache', 'dashboard-bundle');
    out.dvpBundles = mergedBundles;
  }
}

async function attachPlayerSidePanelData(
  payload: Record<string, unknown>,
  opts: { competition: CompetitionParam; season: number; teamId: string | null; apiKey: string }
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...payload };

  await attachWc2026OpponentBreakdownIfMissing(out);

  const playerVsPool = await readWcCache<Record<string, unknown>>(WC2026.playerVsPoolWc);
  if (playerVsPool && Array.isArray(playerVsPool.players) && (playerVsPool.players as unknown[]).length > 0) {
    recordWcSource('playerVsPool', 'supabase-cache', 'dashboard-bundle');
    out.playerVsPool = {
      ...playerVsPool,
      ...(out.wc2026OpponentBreakdown ? { wc2026OpponentBreakdown: out.wc2026OpponentBreakdown } : {}),
    };
  }

  const teamIdNum = opts.teamId && /^\d+$/.test(opts.teamId) ? Number(opts.teamId) : null;
  if (!teamIdNum) {
    await attachDvpBundlesIfMissing(out);
    return out;
  }

  const teamKey = buildDashboardCacheKey({
    competition: opts.competition,
    season: opts.season,
    teamId: opts.teamId,
    playerId: null,
    playerName: null,
  });

  const teamPayload = await getWorldCupCache<Record<string, unknown>>(teamKey);
  const hasTeamShareOnPayload =
    Array.isArray(out.teamWcMatchStats) &&
    (out.teamWcMatchStats as unknown[]).length > 0 &&
    Array.isArray(out.squadPlayerMatchStats) &&
    (out.squadPlayerMatchStats as unknown[]).length > 0;
  const hasTeamShareOnTeamBlob =
    Array.isArray(teamPayload?.teamWcMatchStats) &&
    (teamPayload!.teamWcMatchStats as unknown[]).length > 0 &&
    Array.isArray(teamPayload?.squadPlayerMatchStats) &&
    (teamPayload!.squadPlayerMatchStats as unknown[]).length > 0;

  if (hasTeamShareOnPayload || hasTeamShareOnTeamBlob) {
    if (!hasTeamShareOnPayload && teamPayload) {
      recordWcSource('teamShare', 'supabase-cache', 'team-dashboard-blob');
      out.teamWcMatchStats = teamPayload.teamWcMatchStats;
      out.squadPlayerMatchStats = teamPayload.squadPlayerMatchStats;
    }
    await attachDvpBundlesIfMissing(out);
    return out;
  }

  const [bdlHistory] = await Promise.all([fetchBdlTeamWorldCupHistory(teamIdNum, opts.apiKey)]);

  const wc2026FixtureIds = new Set(
    (Array.isArray(out.matches) ? (out.matches as Array<Record<string, any>>) : [])
      .map((m) => String(m.id ?? ''))
      .filter(Boolean)
  );
  const matchPool = new Map<string, Record<string, any>>();
  for (const m of [
    ...(Array.isArray(out.playerMatches) ? (out.playerMatches as Array<Record<string, any>>) : []),
    ...(Array.isArray(out.matches) ? (out.matches as Array<Record<string, any>>) : []),
    ...bdlHistory.matches,
  ]) {
    matchPool.set(String(m.id ?? ''), m);
  }
  const teamHistoryRows = bdlHistory.teamMatchStats.filter((row) =>
    wc2026FixtureIds.has(String(row.match_id ?? ''))
  );
  out.teamWcMatchStats = enrichTeamStatRowsWithScoreline(
    teamHistoryRows,
    Array.from(matchPool.values())
  );

  if (teamPayload && Array.isArray(teamPayload.playerMatchStats) && teamPayload.playerMatchStats.length) {
    out.squadPlayerMatchStats = (teamPayload.playerMatchStats as Array<Record<string, any>>).filter((row) =>
      wc2026FixtureIds.has(String(row.match_id ?? ''))
    );
  }

  await attachDvpBundlesIfMissing(out);
  return out;
}

function enrichWorldCupRosters(
  rosters: Array<Record<string, any>>,
  players: Array<Record<string, any>>
): Array<Record<string, any>> {
  const positionByPlayerId = new Map<number, string>();
  const nameByPlayerId = new Map<number, string>();
  for (const player of players) {
    const id = Number(player?.id);
    const pos = String(player?.position ?? '').trim();
    const name = String(player?.name || player?.short_name || '').trim();
    if (Number.isFinite(id)) {
      if (pos) positionByPlayerId.set(id, pos);
      if (name) nameByPlayerId.set(id, name);
    }
  }
  return rosters.map((row) => {
    const nested = row.player && typeof row.player === 'object' ? (row.player as Record<string, any>) : {};
    const playerId = Number(row.player_id ?? nested.id);
    const resolvedPos =
      String(row.position ?? '').trim() ||
      String(nested.position ?? '').trim() ||
      (Number.isFinite(playerId) ? positionByPlayerId.get(playerId) ?? '' : '');
    const resolvedName =
      String(nested.name || nested.short_name || '').trim() ||
      (Number.isFinite(playerId) ? nameByPlayerId.get(playerId) ?? '' : '');
    return {
      ...row,
      position: resolvedPos || row.position || null,
      player: {
        ...nested,
        id: nested.id ?? row.player_id ?? null,
        name: resolvedName || nested.name || null,
        short_name: nested.short_name || resolvedName || null,
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
 * Resolve a player name → their BDL World Cup match stats + matches.
 * Cache-only: reads from the pre-warmed Supabase keys written by
 * `scripts/build-world-cup-2026-cache.ts`. Returns empty when the cache is cold.
 */
async function fetchBdlStatsForPlayerName(
  name: string,
  apiKey: string
): Promise<{ playerMatchStats: any[]; matches: any[] }> {
  if (!name) return { playerMatchStats: [], matches: [] };

  // ── Cache-first path ──────────────────────────────────────────────────────
  try {
    const nameIndex = await readWcCache<Record<string, number>>(WC2026.playerIdByName);
    if (nameIndex) {
      const normalized = normalizeWorldCupPlayerName(name);
      let playerId: number | undefined = nameIndex[normalized];
      if (!playerId) {
        // Try partial matches: last word of the normalized name (family name heuristic)
        const parts = normalized.split(' ');
        for (const part of parts.reverse()) {
          if (part.length >= 3 && nameIndex[part]) { playerId = nameIndex[part]; break; }
        }
      }
      if (playerId) {
        const [cachedStats, cachedShots, cachedMatches2026] = await Promise.all([
          readWcCache<Array<Record<string, any>>>(WC2026.playerStats(playerId)),
          readWcCache<Array<Record<string, any>>>(WC2026.playerShots(playerId)),
          readWcCache<BdlMatch[]>(WC2026.matches2026),
        ]);
        if (cachedStats) {
          recordWcSource('playerStatsByName', 'supabase-cache', String(playerId));
          // Attach shot-derived fields from the shot cache
          const shotsByMatch = new Map<number, number>();
          for (const shot of cachedShots ?? []) {
            const mid = Number(shot.match_id);
            if (Number.isFinite(mid)) shotsByMatch.set(mid, (shotsByMatch.get(mid) ?? 0) + 1);
          }
          const stats: Array<Record<string, any>> = cachedStats.map((row) => ({
            ...row,
            source: 'bdl',
            tournament_slug: 'worldcup',
            derived_shots_total: shotsByMatch.get(Number(row.match_id)) ?? row.derived_shots_total ?? null,
          }));
          const wc2026 = (cachedMatches2026 ?? []).filter((m) => m.status === 'completed');
          return {
            playerMatchStats: stats,
            matches: summarizeMatches(wc2026.filter((m) =>
              stats.some((s) => Number(s.match_id) === m.id)
            )),
          };
        }
      }
    }
  } catch (cacheErr) {
    console.warn('[world-cup/dashboard] player cache lookup failed:', cacheErr);
  }

  // ── BDL live fallback (cache cold / player not indexed) ───────────────────
  recordWcSource('playerStatsByName', 'cache-miss', name);
  wcCacheLog('[wc-cache] playerStatsByName → cache miss (no BDL live)', { name });
  return { playerMatchStats: [], matches: [] };
}

/**
 * Team-mode (Game Props): fetch a team's completed World Cup matches across all
 * three editions (2018 / 2022 / 2026) and their per-match team stats.
 * Cache-only: reads from `wc:raw:matches:allseasons:v1` and
 * `wc:raw:team-stats-allseasons:v1` written by the ingestion script.
 */
async function fetchBdlTeamWorldCupHistory(
  teamId: number,
  apiKey: string
): Promise<{ teamMatchStats: any[]; matches: any[] }> {
  if (!Number.isFinite(teamId)) return { teamMatchStats: [], matches: [] };

  // ── Cache-first path ──────────────────────────────────────────────────────
  try {
    const [cachedMatches, cachedTeamStats] = await Promise.all([
      readWcCache<BdlMatch[]>(WC2026.matchesAllSeasons),
      readWcCache<Array<Record<string, any>>>(WC2026.teamStatsAllSeasons),
    ]);
    if (cachedMatches && cachedTeamStats) {
      const teamMatches = cachedMatches.filter(
        (m) => (m.home_team?.id === teamId || m.away_team?.id === teamId) && m.status === 'completed'
      );
      if (teamMatches.length) {
        const statsByMatchTeam = new Map<string, Record<string, any>>();
        for (const row of cachedTeamStats) {
          statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
        }
        return {
          teamMatchStats: buildBdlTeamHistoryRows(teamId, teamMatches, statsByMatchTeam),
          matches: summarizeMatches(teamMatches),
        };
      }
    }
  } catch (cacheErr) {
    console.warn('[world-cup/dashboard] team history cache lookup failed:', cacheErr);
  }

  recordWcSource('teamWorldCupHistory', 'cache-miss', String(teamId));
  return { teamMatchStats: [], matches: [] };
}

const OPPONENT_ALLOWED_PLAYER_STATS = [
  'goals',
  'shots_total',
  'shots_on_target',
  'fouls',
  'was_fouled',
  'passes_total',
  'yellow_cards',
  'red_cards',
  'saves',
] as const;

function bdlStatNum(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function readBdlPlayerStat(row: Record<string, unknown>, stat: string, shotsFromEndpoint?: number): number | null {
  if (stat === 'fouls') return bdlStatNum(row.fouls) ?? bdlStatNum(row.fouls_committed);
  if (stat === 'was_fouled') return bdlStatNum(row.was_fouled) ?? bdlStatNum(row.fouls_suffered);
  if (stat === 'shots_total') {
    const fromRow = bdlStatNum(row.shots_total) ?? bdlStatNum(row.shots) ?? bdlStatNum(row.derived_shots_total);
    if (shotsFromEndpoint != null && fromRow != null) return Math.max(shotsFromEndpoint, fromRow);
    return shotsFromEndpoint ?? fromRow ?? null;
  }
  if (stat === 'passes_total') return bdlStatNum(row.passes_total) ?? bdlStatNum(row.passes);
  return bdlStatNum(row[stat]);
}
// kept for callers that haven't been updated
const readBdlPlayerAllowedStat = readBdlPlayerStat;

function mapBdlPosition(pos: string | null | undefined): IntlPositionBucket {
  const p = String(pos ?? '').toUpperCase().trim();
  if (p === 'GK' || p.startsWith('G')) return 'GK';
  if (p === 'D' || p === 'DEF' || p === 'CB' || p === 'LB' || p === 'RB' || p === 'WB') return 'DEF';
  if (['RW', 'LW', 'RM', 'LM', 'FW', 'F', 'W', 'ST', 'CF', 'SS', 'LF', 'RF', 'WG'].includes(p)) return 'FWD';
  if (p === 'M' || p === 'MID' || p === 'CM' || p === 'DM' || p === 'AM') return 'MID';
  return 'FWD';
}

/**
 * Live BDL aggregate of what a nation allows per World Cup finals game, built
 * from opposing players' match stats. Ensures today's completed games appear
 * even before the bulk DVP supplement catches up.
 */
async function computeBdlWorldCupOpponentAllowedLive(
  teamId: number,
  teamName: string,
  countryCode: string | null | undefined,
  apiKey: string,
  seasonYear = DEFAULT_SEASON
): Promise<{ slug: string; name: string; games: number; allowed: Record<string, number> } | null> {
  if (!Number.isFinite(teamId) || !apiKey) return null;
  try {
    const seasonsParam = new URLSearchParams();
    appendArrayParam(seasonsParam, 'seasons[]', [2018, 2022, 2026]);
    const allMatches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, {
      cursor: true,
      maxPages: 8,
    });
    const completedTeamMatches = allMatches.filter((match) => {
      if (match.status !== 'completed') return false;
      if (match.home_team?.id !== teamId && match.away_team?.id !== teamId) return false;
      const kickoffMs = match.datetime ? Date.parse(match.datetime) : NaN;
      const editionYear = Number.isFinite(kickoffMs) ? new Date(kickoffMs).getUTCFullYear() : null;
      return editionYear === seasonYear;
    });
    if (!completedTeamMatches.length) return null;

    const matchIds = completedTeamMatches
      .map((match) => match.id)
      .filter((id): id is number => Number.isFinite(id));
    const statsByMatch = new Map<number, Array<Record<string, unknown>>>();
    for (let i = 0; i < matchIds.length; i += 50) {
      const chunk = matchIds.slice(i, i + 50);
      const params = new URLSearchParams();
      chunk.forEach((id) => params.append('match_ids[]', String(id)));
      const rows = await bdlFetchAll<Record<string, unknown>>('/player_match_stats', params, apiKey, {
        cursor: true,
        maxPages: 6,
      });
      for (const row of rows) {
        const matchId = Number(row?.match_id);
        if (!Number.isFinite(matchId)) continue;
        const list = statsByMatch.get(matchId) ?? [];
        list.push(row);
        statsByMatch.set(matchId, list);
      }
    }

    const slug =
      resolveWorldCupFlagCode(countryCode) ||
      resolveWorldCupFlagCode(teamName) ||
      teamName.trim().toLowerCase();
    const allowed: Record<string, number> = {};
    for (const stat of OPPONENT_ALLOWED_PLAYER_STATS) {
      let sum = 0;
      for (const match of completedTeamMatches) {
        const rows = statsByMatch.get(match.id) ?? [];
        let matchSum = 0;
        for (const row of rows) {
          const minutes = bdlStatNum(row.minutes_played);
          if (minutes != null && minutes < 1) continue;
          if (Number(row.team_id) === teamId) continue;
          const value = readBdlPlayerAllowedStat(row, stat);
          if (value != null) matchSum += value;
        }
        sum += matchSum;
      }
      allowed[stat] = Number((sum / completedTeamMatches.length).toFixed(3));
    }

    return {
      slug,
      name: teamName,
      games: completedTeamMatches.length,
      allowed,
    };
  } catch (err) {
    console.warn('[world-cup/dashboard] live opponent allowed failed:', err);
    return null;
  }
}

type BdlWorldCupSeasonResult = {
  opponentBreakdown: WorldCupPlayerVsOpponentBreakdown | null;
  players: WorldCupPlayerPoolEntry[];
};

/**
 * Full 2026 (or any edition year) opponent-allowed breakdown + live player pool
 * from BDL player stats. Also fetches /match_shots to get reliable shot counts.
 */
async function computeBdlWorldCupSeason(
  apiKey: string,
  seasonYear: number,
  qualifiedUniverse?: Map<string, string>
): Promise<BdlWorldCupSeasonResult> {
  const empty: BdlWorldCupSeasonResult = { opponentBreakdown: null, players: [] };
  if (!apiKey) return empty;
  try {
    const universe =
      qualifiedUniverse?.size ? qualifiedUniverse : await ensureWorldCupQualifiedUniverse(apiKey);
    // Only fetch this specific edition — no cross-year leakage even if datetime is malformed.
    const seasonsParam = new URLSearchParams();
    seasonsParam.set('seasons[]', String(seasonYear));
    const allMatches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, {
      cursor: true,
      maxPages: 8,
    });
    const completedMatches = allMatches.filter((m) => m.status === 'completed');
    if (!completedMatches.length) return empty;

    const matchIds = completedMatches
      .map((match) => match.id)
      .filter((id): id is number => Number.isFinite(id));

    // Fetch player stats, shots, and full rosters in parallel
    const statsByMatch = new Map<number, Array<Record<string, unknown>>>();
    const shotsByPair = new Map<string, number>(); // `${matchId}:${playerId}` -> count
    // playerId -> { teamId, position } — seeded from rosters so unplayed players are included
    const rosterByPlayer = new Map<number, { teamId: number; position: string | null }>();
    // teamId -> slug — extended beyond just played teams
    const teamIdToSlug = new Map<number, string>();

    const rosterParams = new URLSearchParams();
    rosterParams.set('seasons[]', String(seasonYear));
    const teamsParams = new URLSearchParams();
    teamsParams.set('seasons[]', String(seasonYear));

    await Promise.all([
      (async () => {
        for (let i = 0; i < matchIds.length; i += 50) {
          const chunk = matchIds.slice(i, i + 50);
          const params = new URLSearchParams();
          chunk.forEach((id) => params.append('match_ids[]', String(id)));
          const rows = await bdlFetchAll<Record<string, unknown>>('/player_match_stats', params, apiKey, { cursor: true, maxPages: 6 });
          for (const row of rows) {
            const matchId = Number(row?.match_id);
            if (!Number.isFinite(matchId)) continue;
            const list = statsByMatch.get(matchId) ?? [];
            list.push(row);
            statsByMatch.set(matchId, list);
          }
        }
      })(),
      (async () => {
        for (let i = 0; i < matchIds.length; i += 50) {
          const chunk = matchIds.slice(i, i + 50);
          const params = new URLSearchParams();
          chunk.forEach((id) => params.append('match_ids[]', String(id)));
          const shots = await bdlFetchAll<Record<string, unknown>>('/match_shots', params, apiKey, { cursor: true, maxPages: 6 });
          for (const shot of shots) {
            const mId = Number(shot.match_id);
            const pId = Number(shot.player_id);
            if (!Number.isFinite(mId) || !Number.isFinite(pId)) continue;
            shotsByPair.set(`${mId}:${pId}`, (shotsByPair.get(`${mId}:${pId}`) ?? 0) + 1);
          }
        }
      })(),
      // Fetch all teams so unplayed teams get a slug mapping
      (async () => {
        try {
          const allTeams = await bdlFetchAll<BdlTeam>('/teams', teamsParams, apiKey, { cursor: true, maxPages: 6 });
          for (const team of allTeams) {
            if (!Number.isFinite(team.id)) continue;
            const slug = resolveWorldCupFlagCode(team.country_code) || resolveWorldCupFlagCode(team.name) || team.name.toLowerCase();
            teamIdToSlug.set(team.id, slug);
          }
        } catch { /* non-fatal */ }
      })(),
      // Fetch full squad rosters so unplayed players are in the pool
      (async () => {
        try {
          const rosters = await bdlFetchAll<BdlRosterRow>('/rosters', rosterParams, apiKey, { cursor: true, maxPages: 12 });
          for (const row of rosters) {
            const playerId = Number(row.player_id);
            const teamId = Number((row as Record<string, unknown>).team_id);
            if (!Number.isFinite(playerId)) continue;
            if (!rosterByPlayer.has(playerId)) {
              rosterByPlayer.set(playerId, {
                teamId: Number.isFinite(teamId) ? teamId : 0,
                position: String(row.position ?? '') || null,
              });
            }
          }
        } catch { /* non-fatal */ }
      })(),
    ]);

    type TeamMeta = { name: string; slug: string };
    const teamMeta = new Map<number, TeamMeta>();
    const byTeamMatch = new Map<number, Map<number, Record<string, number>>>();
    // player pool: playerId -> { teamId, position, matchStats }
    const byPlayer = new Map<number, { teamId: number; position: string | null; matchStats: Map<number, Record<string, number>> }>();

    // Seed every rostered player with an empty entry so unplayed players appear in the pool
    for (const [playerId, roster] of rosterByPlayer) {
      byPlayer.set(playerId, { teamId: roster.teamId, position: roster.position, matchStats: new Map() });
    }

    for (const match of completedMatches) {
      const homeId = match.home_team?.id;
      const awayId = match.away_team?.id;
      if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;
      const rows = statsByMatch.get(match.id) ?? [];

      const sides: Array<{ defendingId: number; defendingName: string; defendingCountryCode?: string | null; opponentId: number }> = [
        { defendingId: homeId!, defendingName: match.home_team?.name?.trim() || `Team ${homeId}`, defendingCountryCode: (match.home_team as BdlTeam | undefined)?.country_code, opponentId: awayId! },
        { defendingId: awayId!, defendingName: match.away_team?.name?.trim() || `Team ${awayId}`, defendingCountryCode: (match.away_team as BdlTeam | undefined)?.country_code, opponentId: homeId! },
      ];

      for (const side of sides) {
        const slug = resolveWorldCupFlagCode(side.defendingCountryCode) || resolveWorldCupFlagCode(side.defendingName) || side.defendingName.toLowerCase();
        teamMeta.set(side.defendingId, { name: side.defendingName, slug });

        const matchMap = byTeamMatch.get(side.defendingId) ?? new Map();
        const matchSums = matchMap.get(match.id) ?? Object.fromEntries(OPPONENT_ALLOWED_PLAYER_STATS.map((stat) => [stat, 0]));

        for (const row of rows) {
          const minutes = bdlStatNum(row.minutes_played);
          if (minutes != null && minutes < 1) continue;
          const rowTeamId = Number(row.team_id);
          const rowPlayerId = Number(row.player_id);
          const shotsForRow = Number.isFinite(rowPlayerId) ? shotsByPair.get(`${match.id}:${rowPlayerId}`) : undefined;

          // Opponent breakdown: sum attacking team's stats against this defender
          if (rowTeamId === side.opponentId) {
            for (const stat of OPPONENT_ALLOWED_PLAYER_STATS) {
              const value = readBdlPlayerStat(row, stat, stat === 'shots_total' ? shotsForRow : undefined);
              if (value != null) matchSums[stat] = (matchSums[stat] ?? 0) + value;
            }
          }

          // Player pool: track each player's own stats (only once — use side[0] to avoid double-counting)
          if (side === sides[0] && Number.isFinite(rowPlayerId)) {
            const existing = byPlayer.get(rowPlayerId);
            const poolEntry = existing ?? { teamId: rowTeamId, position: String(row.position ?? '') || null, matchStats: new Map() };
            if (!poolEntry.matchStats.has(match.id)) {
              poolEntry.matchStats.set(match.id, Object.fromEntries(WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS.map((s) => [s, 0])));
            }
            const ps = poolEntry.matchStats.get(match.id)!;
            for (const stat of WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS) {
              const value = readBdlPlayerStat(row, stat, stat === 'shots_total' ? shotsForRow : undefined);
              if (value != null) ps[stat] = (ps[stat] ?? 0) + value;
            }
            if (!existing) byPlayer.set(rowPlayerId, poolEntry);
          }
        }
        matchMap.set(match.id, matchSums);
        byTeamMatch.set(side.defendingId, matchMap);
      }
    }

    // Build opponent breakdown
    const names: Record<string, string> = {};
    const games: Record<string, number> = {};
    const totalGames: Record<string, number> = {};
    if (universe.size) {
      for (const [slug, displayName] of universe) { names[slug] = displayName; games[slug] = 0; totalGames[slug] = 0; }
    }
    const metrics: WorldCupPlayerVsOpponentBreakdown['metrics'] = {};
    for (const stat of OPPONENT_ALLOWED_PLAYER_STATS) metrics[stat] = { values: {}, ranks: {} };

    for (const [teamId, matchMap] of byTeamMatch) {
      const meta = teamMeta.get(teamId);
      if (!meta) continue;
      const gameCount = matchMap.size;
      if (!gameCount) continue;
      names[meta.slug] = meta.name;
      games[meta.slug] = gameCount;
      totalGames[meta.slug] = gameCount;
      for (const stat of OPPONENT_ALLOWED_PLAYER_STATS) {
        let sum = 0;
        for (const matchSums of matchMap.values()) sum += matchSums[stat] ?? 0;
        metrics[stat].values[meta.slug] = Number((sum / gameCount).toFixed(3));
      }
    }
    for (const stat of OPPONENT_ALLOWED_PLAYER_STATS) {
      metrics[stat].ranks = rankPlayerVsOpponentAllowed(metrics[stat].values, universe, games);
    }
    const rankingTotal = opponentAllowedRankingTotal(universe) || Object.keys(names).length;
    const opponentBreakdown: WorldCupPlayerVsOpponentBreakdown | null = rankingTotal
      ? { window: 0, names, games, totalGames, rankingTotal, metrics }
      : null;

    // Build player pool entries — includes rostered players with 0 games
    const players: WorldCupPlayerPoolEntry[] = [];
    for (const [playerId, data] of byPlayer) {
      const teamSlug = teamMeta.get(data.teamId)?.slug ?? teamIdToSlug.get(data.teamId) ?? '';
      if (!teamSlug) continue;
      const gameCount = data.matchStats.size;
      const averages: Partial<Record<(typeof WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS)[number], number>> = {};
      for (const stat of WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS) {
        if (gameCount === 0) {
          averages[stat] = 0;
        } else {
          let sum = 0;
          for (const ms of data.matchStats.values()) sum += ms[stat] ?? 0;
          averages[stat] = Number((sum / gameCount).toFixed(3));
        }
      }
      players.push({
        playerKey: `bdl:${playerId}`,
        source: 'bdl',
        sourcePlayerId: String(playerId),
        teamSlug,
        position: mapBdlPosition(data.position),
        games: gameCount,
        averages,
      });
    }

    // BDL only returns rosters for teams that have active match data, so teams
    // that haven't played yet are completely absent. Pad the pool with synthetic
    // zero-stat entries for every qualified team that is underrepresented so the
    // tournament ranking denominator reflects all 48 squads (~1,248 players).
    const SQUAD_SIZE = 26;
    const playersByTeam = new Map<string, number>();
    for (const p of players) playersByTeam.set(p.teamSlug, (playersByTeam.get(p.teamSlug) ?? 0) + 1);
    const zeroAverages = Object.fromEntries(
      WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS.map((k) => [k, 0])
    ) as Record<(typeof WORLD_CUP_PLAYER_VS_POOL_STAT_KEYS)[number], number>;
    for (const [slug] of universe) {
      const existing = playersByTeam.get(slug) ?? 0;
      const toAdd = Math.max(0, SQUAD_SIZE - existing);
      for (let i = 0; i < toAdd; i++) {
        players.push({
          playerKey: `pad:${slug}:${i}`,
          source: 'bdl',
          sourcePlayerId: `pad:${slug}:${i}`,
          teamSlug: slug,
          position: null,
          games: 0,
          averages: { ...zeroAverages },
        });
      }
    }

    return { opponentBreakdown, players };
  } catch (err) {
    console.warn('[world-cup/dashboard] season breakdown failed:', err);
    return empty;
  }
}

/** @deprecated Use computeBdlWorldCupSeason instead */
async function computeBdlWorldCupSeasonOpponentBreakdown(
  apiKey: string,
  seasonYear: number,
  qualifiedUniverse?: Map<string, string>
): Promise<WorldCupPlayerVsOpponentBreakdown | null> {
  return (await computeBdlWorldCupSeason(apiKey, seasonYear, qualifiedUniverse)).opponentBreakdown;
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
    recordWcSource(`bdl${path}`, 'bdl-memory', cacheKey);
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
          recordWcSource(`bdl${path}`, 'bdl-live', cacheKey);
          wcCacheLog('[wc-cache] BDL LIVE', { path, url: cacheKey });
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
  if (!Number.isFinite(id)) return null;
  return teams.find((team) => team.id === id) ?? null;
}

function resolveRequestedTeam(
  teams: BdlTeam[],
  requestedTeamId: string | null,
  fallback?: BdlTeam | null
): BdlTeam | null {
  const byRequest = findSelectedTeam(teams, requestedTeamId);
  if (byRequest) return byRequest;
  if (fallback?.id != null) {
    return teams.find((team) => team.id === fallback.id) ?? fallback;
  }
  return null;
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

function findBdlTeamByName(teams: BdlTeam[], name: string | null | undefined): BdlTeam | null {
  const label = String(name || '').trim();
  if (!label || !teams.length) return null;
  return (
    teams.find((team) => worldCupTeamsMatch(team.name || '', label)) ??
    teams.find((team) => worldCupTeamsMatch(team.country_code || '', label)) ??
    teams.find((team) => worldCupTeamsMatch(team.abbreviation || '', label)) ??
    null
  );
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

function findFeatureMatchWithOpponentHint(
  matches: BdlMatch[],
  selectedTeam: BdlTeam | null,
  opponentHint: string | null | undefined
): BdlMatch | null {
  const hint = String(opponentHint || '').trim();
  if (!matches.length) return null;
  if (!hint || !selectedTeam) return findFeatureMatch(matches, selectedTeam);

  let pool = matches.filter(
    (match) => match.home_team?.id === selectedTeam.id || match.away_team?.id === selectedTeam.id
  );
  const narrowed = pool.filter((match) => {
    const isHome = match.home_team?.id === selectedTeam.id;
    const otherTeam = isHome ? match.away_team : match.home_team;
    const otherLabel = isHome ? getTeamLabel(match, 'away') : getTeamLabel(match, 'home');
    const candidates = [otherLabel, otherTeam?.name ?? '', otherTeam?.country_code ?? '', otherTeam?.abbreviation ?? ''];
    return candidates.some((candidate) => candidate && worldCupTeamsMatch(candidate, hint));
  });
  if (narrowed.length) pool = narrowed;
  return findFeatureMatch(pool.length ? pool : matches, selectedTeam);
}

function isLineupStarterRow(row: Record<string, unknown>): boolean {
  if (row.is_starter === true) return true;
  if (row.is_substitute === true) return false;
  // BDL rows often omit flags — mirror buildWorldCupLineup on the client.
  return true;
}

function countTeamLineupStarters(lineups: Array<Record<string, unknown>>, teamId: number): number {
  return lineups.filter(
    (row) => String(row?.team_id ?? '') === String(teamId) && isLineupStarterRow(row)
  ).length;
}

function completedMatchesForTeam(
  allMatches: BdlMatch[],
  teamId: number,
  excludeMatchId?: number | null
): BdlMatch[] {
  return allMatches
    .filter(
      (match) =>
        match.status === 'completed' &&
        match.id !== excludeMatchId &&
        (match.home_team?.id === teamId || match.away_team?.id === teamId)
    )
    .sort((a, b) => (Date.parse(b.datetime || '') || 0) - (Date.parse(a.datetime || '') || 0));
}

function findLastCompletedMatchForTeam(
  allMatches: BdlMatch[],
  teamId: number,
  excludeMatchId?: number | null
): BdlMatch | null {
  return completedMatchesForTeam(allMatches, teamId, excludeMatchId)[0] ?? null;
}

function getOtherTeamIdFromMatch(match: BdlMatch, teamId: number): number | null {
  if (match.home_team?.id === teamId) return match.away_team?.id ?? null;
  if (match.away_team?.id === teamId) return match.home_team?.id ?? null;
  return null;
}

async function loadCachedMatchLineups(matchId: number): Promise<any[]> {
  const cached = await readWcCache<{ lineups?: any[] }>(WC2026.matchDetail(matchId));
  if (cached?.lineups?.length) {
    recordWcSource(`lineups:${matchId}`, 'supabase-cache');
    return cached.lineups;
  }
  return [];
}

async function loadMatchLineups(matchId: number, apiKey?: string): Promise<any[]> {
  const cached = await loadCachedMatchLineups(matchId);
  if (cached.length) return cached;
  if (!apiKey) return [];
  try {
    const params = new URLSearchParams();
    params.append('match_ids[]', String(matchId));
    const live = await bdlFetchAll('/match_lineups', params, apiKey, { cursor: true, maxPages: 2 });
    if (live.length) {
      recordWcSource(`lineups:${matchId}`, 'bdl-live');
      const existing = (await readWcCache<Record<string, unknown>>(WC2026.matchDetail(matchId))) ?? {};
      setWorldCupCache(WC2026.matchDetail(matchId), { ...existing, lineups: live }).catch(() => {});
    }
    return live;
  } catch {
    return [];
  }
}

function mergeBdlMatches(...lists: Array<BdlMatch[] | undefined | null>): BdlMatch[] {
  const byId = new Map<number, BdlMatch>();
  for (const list of lists) {
    for (const match of list ?? []) {
      const id = Number(match.id);
      if (!Number.isFinite(id)) continue;
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, match);
        continue;
      }
      const prevDone = prev.status === 'completed';
      const nextDone = match.status === 'completed';
      const prevTs = Date.parse(prev.datetime || '') || 0;
      const nextTs = Date.parse(match.datetime || '') || 0;
      if (nextDone && !prevDone) byId.set(id, match);
      else if (nextTs >= prevTs) byId.set(id, match);
    }
  }
  return Array.from(byId.values());
}

function resolveLineupExcludeMatchId(
  matches: BdlMatch[],
  featureMatchId: number | null
): number | null {
  if (!featureMatchId) return null;
  const feature = matches.find((match) => match.id === featureMatchId);
  // Only skip the upcoming fixture — completed games stay eligible as "last match".
  if (feature?.status === 'completed') return null;
  return featureMatchId;
}

async function loadLineupLookupMatches(
  apiKey?: string,
  opts?: { cacheOnly?: boolean }
): Promise<{
  matches2026: BdlMatch[];
  allSeasonMatches: BdlMatch[];
}> {
  const [cachedAllSeason, cached2026] = await Promise.all([
    readWcCache<BdlMatch[]>(WC2026.matchesAllSeasons),
    readWcCache<BdlMatch[]>(WC2026.matches2026),
  ]);
  let matches2026 = cached2026 ?? [];
  let allSeasonMatches = cachedAllSeason ?? [];

  if (apiKey && !opts?.cacheOnly) {
    try {
      const params = new URLSearchParams();
      params.append('seasons[]', '2026');
      const live2026 = await bdlFetchAll<BdlMatch>('/matches', params, apiKey, { cursor: true, maxPages: 3 });
      if (live2026.length) {
        matches2026 = mergeBdlMatches(matches2026, live2026);
        recordWcSource('lineupMatches2026', 'bdl-live');
      }
    } catch {
      // cache-only fallback
    }
  }

  if (!allSeasonMatches.length) allSeasonMatches = matches2026;
  return { matches2026, allSeasonMatches };
}

function playerStatRowKey(row: Record<string, any>): string {
  return `${row.match_id ?? ''}|${row.team_id ?? ''}|${row.player_id ?? ''}`;
}

function mergePlayerStatRows(
  existing: Array<Record<string, any>>,
  incoming: Array<Record<string, any>>
): Array<Record<string, any>> {
  const seen = new Set(existing.map(playerStatRowKey));
  const merged = [...existing];
  for (const row of incoming) {
    const key = playerStatRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

/** Copy `source` / `tournament_slug` from match metadata onto stat rows for chart tags + logos. */
function attachStatRowMatchContext(
  stats: Array<Record<string, any>>,
  matches: Array<Record<string, any>>
): Array<Record<string, any>> {
  const byId = new Map<string, Record<string, any>>();
  for (const match of matches) {
    for (const key of [match.id, match.source_match_id, match.match_id]
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)) {
      const existing = byId.get(key);
      if (!existing || dashboardMatchRichness(match) >= dashboardMatchRichness(existing)) {
        byId.set(key, match);
      }
    }
  }
  return stats.map((row) => {
    const match = byId.get(String(row.match_id ?? ''));
    if (!match) return row;
    const tournamentSlug = row.tournament_slug ?? match.tournament_slug ?? match.tournamentSlug;
    const source = row.source ?? match.source;
    if (tournamentSlug == null && source == null) return row;
    return {
      ...row,
      ...(tournamentSlug != null ? { tournament_slug: tournamentSlug } : {}),
      ...(source != null ? { source } : {}),
    };
  });
}

function wc2026CompletedMatchIdSet(matches2026: BdlMatch[]): Set<number> {
  return new Set(
    matches2026
      .filter((match) => match.status === 'completed')
      .map((match) => Number(match.id))
      .filter(Number.isFinite)
  );
}

function playerHasWc2026Appearance(
  rows: Array<Record<string, any>>,
  completed2026Ids: Set<number>
): boolean {
  return rows.some((row) => {
    if (!completed2026Ids.has(Number(row.match_id))) return false;
    const minutes = bdlStatNum(row.minutes_played);
    return minutes != null && minutes >= 1;
  });
}

async function loadPlayerStatsFromTeamCompletedMatches(opts: {
  teamId: number;
  matches2026: BdlMatch[];
  playerId?: string | null;
  apiKey?: string;
  maxMatches?: number;
}): Promise<Array<Record<string, any>>> {
  const completedIds = completedMatchesForTeam(opts.matches2026, opts.teamId)
    .map((match) => match.id)
    .filter((id): id is number => Number.isFinite(id))
    .slice(0, opts.maxMatches ?? 12);
  if (!completedIds.length) return [];

  const stats: Array<Record<string, any>> = [];
  const coveredMatchIds = new Set<number>();
  const details = await Promise.all(
    completedIds.map((matchId) => readWcCache<{ playerStats?: any[] }>(WC2026.matchDetail(matchId)))
  );

  for (let index = 0; index < completedIds.length; index++) {
    const rows = details[index]?.playerStats ?? [];
    if (!rows.length) continue;
    coveredMatchIds.add(completedIds[index]);
    if (opts.playerId) {
      for (const row of rows) {
        const rowPlayerId = String(row.player_id ?? row.player?.id ?? '');
        if (rowPlayerId === opts.playerId) stats.push(row);
      }
    } else {
      stats.push(...rows);
    }
  }

  const missing = completedIds.filter((matchId) => !coveredMatchIds.has(matchId));
  if (missing.length && opts.apiKey) {
    for (let offset = 0; offset < missing.length; offset += 50) {
      const chunk = missing.slice(offset, offset + 50);
      const params = new URLSearchParams();
      chunk.forEach((matchId) => params.append('match_ids[]', String(matchId)));
      try {
        const live = await bdlFetchAll<Record<string, unknown>>(
          '/player_match_stats',
          params,
          opts.apiKey,
          { cursor: true, maxPages: 4 }
        );
        for (const row of live) {
          if (opts.playerId) {
            const rowPlayerId = String(
              row.player_id ?? (row.player as Record<string, unknown> | undefined)?.id ?? ''
            );
            if (rowPlayerId !== opts.playerId) continue;
          }
          stats.push(row as Record<string, any>);
        }
      } catch {
        // best effort
      }
    }
  }

  return stats;
}

async function fetchLivePlayerStatsById(
  playerId: string,
  apiKey: string
): Promise<Array<Record<string, any>>> {
  const params = new URLSearchParams();
  params.append('player_ids[]', playerId);
  appendArrayParam(params, 'seasons[]', [2026]);
  try {
    const rows = await bdlFetchAll<Record<string, unknown>>(
      '/player_match_stats',
      params,
      apiKey,
      { cursor: true, maxPages: 6 }
    );
    return rows as Array<Record<string, any>>;
  } catch {
    return [];
  }
}

async function refreshDashboardPlayerStats(opts: {
  requestedPlayerId: string;
  requestedTeamId: string | null;
  apiKey?: string;
}): Promise<{ playerMatchStats: Array<Record<string, any>>; playerMatches: Array<Record<string, any>>; matches: Array<Record<string, any>> }> {
  const { matches2026, allSeasonMatches } = await loadLineupLookupMatches(opts.apiKey);
  let playerMatchStats: Array<Record<string, any>> = [];

  const cachedStats = await readWcCache<any[]>(WC2026.playerStats(opts.requestedPlayerId));
  if (cachedStats?.length) {
    recordWcSource('playerStatsRefresh', 'supabase-cache', opts.requestedPlayerId);
    playerMatchStats = cachedStats;
  }

  const completed2026Ids = wc2026CompletedMatchIdSet(matches2026);
  const needsTeamFallback =
    !playerHasWc2026Appearance(playerMatchStats, completed2026Ids) &&
    opts.requestedTeamId &&
    /^\d+$/.test(opts.requestedTeamId);

  if (needsTeamFallback) {
    const fromTeam = await loadPlayerStatsFromTeamCompletedMatches({
      teamId: Number(opts.requestedTeamId),
      matches2026,
      playerId: opts.requestedPlayerId,
      apiKey: opts.apiKey,
    });
    if (fromTeam.length) {
      recordWcSource('playerStatsRefresh', 'match-detail-fallback', opts.requestedTeamId!);
      playerMatchStats = mergePlayerStatRows(playerMatchStats, fromTeam);
    }
  }

  if (!playerMatchStats.length && opts.apiKey) {
    const live = await fetchLivePlayerStatsById(opts.requestedPlayerId, opts.apiKey);
    if (live.length) {
      recordWcSource('playerStatsRefresh', 'bdl-live', opts.requestedPlayerId);
      playerMatchStats = live;
    }
  }

  const mergedAll = mergeBdlMatches(allSeasonMatches, matches2026);
  const neededIds = new Set(
    playerMatchStats.map((row) => Number(row.match_id)).filter(Number.isFinite)
  );
  const playerMatches = summarizeMatches(mergedAll.filter((match) => neededIds.has(Number(match.id))));
  const normalizedStats = playerMatchStats.map((row) => ({
    ...row,
    source: 'bdl',
    tournament_slug: 'worldcup',
    player_id: opts.requestedPlayerId,
    player: row.player
      ? { ...row.player, id: opts.requestedPlayerId }
      : { id: opts.requestedPlayerId },
  }));

  return {
    playerMatchStats: normalizedStats,
    playerMatches,
    matches: summarizeMatches(matches2026),
  };
}

async function tryMatchLineupForTeam(
  match: BdlMatch,
  teamId: number,
  apiKey?: string
): Promise<{ match: BdlMatch; teamRows: any[] } | null> {
  if (!match.id) return null;
  const lineups = await loadMatchLineups(match.id, apiKey);
  const teamRows = lineups.filter((row) => String(row?.team_id ?? '') === String(teamId));
  if (countTeamLineupStarters(teamRows, teamId) >= 10) {
    return { match, teamRows };
  }
  return null;
}

async function findRecentLineupForTeam(
  matches2026: BdlMatch[],
  allSeasonMatches: BdlMatch[],
  teamId: number,
  excludeMatchId: number | null,
  apiKey?: string
): Promise<{ match: BdlMatch; teamRows: any[] } | null> {
  const merged = mergeBdlMatches(allSeasonMatches, matches2026);
  const excludeId = resolveLineupExcludeMatchId(merged, excludeMatchId);
  const triedIds = new Set<number>();

  // Prefer the current tournament — today's Türkiye game lives here, not in 2022.
  for (const match of completedMatchesForTeam(matches2026, teamId, excludeId)) {
    if (!match.id) continue;
    triedIds.add(match.id);
    const hit = await tryMatchLineupForTeam(match, teamId, apiKey);
    if (hit) return hit;
  }

  for (const match of completedMatchesForTeam(allSeasonMatches, teamId, excludeId)) {
    if (!match.id || triedIds.has(match.id)) continue;
    const hit = await tryMatchLineupForTeam(match, teamId, apiKey);
    if (hit) return hit;
  }

  return null;
}

async function fillLineupsFromLastCompletedMatches(opts: {
  lineups: any[];
  matches: BdlMatch[];
  allSeasonMatches: BdlMatch[];
  selectedTeamId: number | null;
  opponentTeamId: number | null;
  featureMatchId: number | null;
  apiKey?: string;
}): Promise<{
  lineups: any[];
  meta: {
    source: 'feature' | 'last-match' | 'mixed';
    selectedTeamLastMatchId: number | null;
    selectedTeamLastMatchOpponentId: number | null;
    opponentTeamLastMatchId: number | null;
    opponentTeamLastMatchOpponentId: number | null;
  };
}> {
  const meta = {
    source: 'last-match' as 'feature' | 'last-match' | 'mixed',
    selectedTeamLastMatchId: null as number | null,
    selectedTeamLastMatchOpponentId: null as number | null,
    opponentTeamLastMatchId: null as number | null,
    opponentTeamLastMatchOpponentId: null as number | null,
  };
  const teams: Array<{ id: number; key: 'selectedTeamLastMatchId' | 'opponentTeamLastMatchId' }> = [];
  if (opts.selectedTeamId) teams.push({ id: opts.selectedTeamId, key: 'selectedTeamLastMatchId' });
  if (opts.opponentTeamId && opts.opponentTeamId !== opts.selectedTeamId) {
    teams.push({ id: opts.opponentTeamId, key: 'opponentTeamLastMatchId' });
  }

  // Each side shows its own most recent completed XI — not the upcoming fixture.
  let lineups: any[] = [];
  for (const team of teams) {
    const recent = await findRecentLineupForTeam(
      opts.matches,
      opts.allSeasonMatches,
      team.id,
      opts.featureMatchId,
      opts.apiKey
    );
    if (!recent) continue;
    lineups = lineups.filter((row) => String(row?.team_id ?? '') !== String(team.id));
    lineups.push(...recent.teamRows);
    meta[team.key] = recent.match.id ?? null;
    const otherTeamId = getOtherTeamIdFromMatch(recent.match, team.id);
    if (team.key === 'selectedTeamLastMatchId') {
      meta.selectedTeamLastMatchOpponentId = otherTeamId;
    } else {
      meta.opponentTeamLastMatchOpponentId = otherTeamId;
    }
  }

  return { lineups, meta };
}

function opponentTeamIdFromFeature(
  featureMatch: Record<string, unknown> | null | undefined,
  selectedTeamId: number | null
): number | null {
  if (!featureMatch || selectedTeamId == null) return null;
  const homeId = Number(
    (featureMatch.homeTeam as { id?: number } | undefined)?.id ??
      (featureMatch.raw as { home_team?: { id?: number } } | undefined)?.home_team?.id
  );
  const awayId = Number(
    (featureMatch.awayTeam as { id?: number } | undefined)?.id ??
      (featureMatch.raw as { away_team?: { id?: number } } | undefined)?.away_team?.id
  );
  if (homeId === selectedTeamId) return Number.isFinite(awayId) ? awayId : null;
  if (awayId === selectedTeamId) return Number.isFinite(homeId) ? homeId : null;
  return null;
}

function lineupsCachedOnPayload(payload: Record<string, unknown>): boolean {
  return (
    Array.isArray(payload.lineups) &&
    (payload.lineups as unknown[]).length > 0 &&
    payload.lineupMeta != null &&
    typeof payload.lineupMeta === 'object'
  );
}

async function resolveDashboardLineups(
  payload: Record<string, unknown>,
  requestedTeamId: string | null,
  apiKey?: string
): Promise<{
  lineups: any[];
  lineupMeta: {
    source: 'feature' | 'last-match' | 'mixed';
    selectedTeamId: number | null;
    opponentTeamId: number | null;
    selectedTeamLastMatchId: number | null;
    selectedTeamLastMatchOpponentId: number | null;
    opponentTeamLastMatchId: number | null;
    opponentTeamLastMatchOpponentId: number | null;
  };
  lineupPlayerPhotos: Record<string, string>;
  resolvedSelectedTeam: BdlTeam | null;
}> {
  const rosters = (payload.rosters as Array<Record<string, unknown>>) ?? [];
  const teams =
    ((payload.teams as BdlTeam[] | undefined) ?? (await readWcCache<BdlTeam[]>(WC2026.teams))) ?? [];
  const { matches2026, allSeasonMatches } = await loadLineupLookupMatches(apiKey, { cacheOnly: true });
  const payloadSelected = payload.selectedTeam as BdlTeam | undefined;
  const selectedTeam = resolveRequestedTeam(teams, requestedTeamId, payloadSelected ?? null);
  const selectedTeamId = selectedTeam?.id ?? null;
  const featureMatch = (payload.featureMatch as Record<string, unknown> | null | undefined) ?? null;
  let featureMatchId = Number(featureMatch?.id);
  if (!Number.isFinite(featureMatchId)) featureMatchId = NaN;

  let opponentTeamId = opponentTeamIdFromFeature(featureMatch, selectedTeamId);
  if (opponentTeamId == null && selectedTeamId && matches2026.length) {
    const derivedFeature = findFeatureMatch(matches2026, selectedTeam);
    if (derivedFeature) {
      opponentTeamId = getOtherTeamIdFromMatch(derivedFeature, selectedTeamId);
      if (!Number.isFinite(featureMatchId)) featureMatchId = derivedFeature.id;
    }
  }

  const lineupFill = await fillLineupsFromLastCompletedMatches({
    lineups: [],
    matches: matches2026,
    allSeasonMatches,
    selectedTeamId,
    opponentTeamId,
    featureMatchId: Number.isFinite(featureMatchId) ? featureMatchId : null,
    apiKey,
  });
  const lineupPlayerPhotos = await loadLineupPlayerPhotos(lineupFill.lineups, {
    nameByPlayerId: buildWorldCupPlayerNameById(rosters),
    bdlTeamIds: lineupTeamIdsFromRows(lineupFill.lineups),
  });
  return {
    lineups: lineupFill.lineups,
    lineupMeta: {
      ...lineupFill.meta,
      selectedTeamId,
      opponentTeamId,
    },
    lineupPlayerPhotos,
    resolvedSelectedTeam: selectedTeam,
  };
}

function lineupTeamIdsFromRows(lineups: Array<Record<string, unknown>>): number[] {
  const ids = new Set<number>();
  for (const row of lineups) {
    const teamId = Number(row.team_id);
    if (Number.isFinite(teamId)) ids.add(teamId);
  }
  return Array.from(ids);
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
    const nested = row.player && typeof row.player === 'object' ? (row.player as Record<string, unknown>) : null;
    const playerId = Number(row.player_id ?? nested?.id);
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

/**
 * Defense vs Position aggregated across every international national-team
 * competition (no season/competition scoping). Buckets are GK/DEF/MID/FWD.
 * Served from the precomputed Supabase cache (see
 * scripts/build-world-cup-dvp.ts); falls back to a live compute + cache write
 * if the entry is missing. Stats are canonical per position so the cache key is
 * stable and always matches what the precompute script warms.
 */
type DvpAggregateCached = {
  opponents: string[];
  samples: Record<string, number>;
  teamGames: Record<string, number>;
  totalGames: Record<string, number>;
  names: Record<string, string>;
  metrics: Record<string, Record<string, number>>;
  wcTeamsWithGames?: string[];
};

type DvpBatchApiPayload = {
  success: true;
  position: string;
  wcOnly: boolean;
  wcTeamsWithGames?: string[];
  opponents: string[];
  metrics: Record<string, { values: Record<string, number>; ranks: Record<string, number> }>;
  samples: Record<string, number>;
  teamGames: Record<string, number>;
  totalGames: Record<string, number>;
  names: Record<string, string>;
};

const DVP_BUNDLE_POSITIONS: IntlPositionBucket[] = ['GK', 'DEF', 'MID', 'FWD'];
const DVP_BUNDLE_WINDOWS = [0, 5, 10] as const;

function buildDvpBatchPayload(
  positionRaw: string,
  wcOnly: boolean,
  requestedStats: string[],
  result: DvpAggregateCached,
  wcTeamsWithGames?: Set<string> | string[] | null
): DvpBatchApiPayload {
  const wcSlugs =
    wcOnly && wcTeamsWithGames
      ? Array.from(wcTeamsWithGames instanceof Set ? wcTeamsWithGames : new Set(wcTeamsWithGames))
      : null;
  const rankSlugs = result.opponents?.length ? result.opponents : wcSlugs ?? [];
  return {
    success: true,
    position: positionRaw,
    wcOnly,
    wcTeamsWithGames: wcSlugs ?? undefined,
    opponents: rankSlugs,
    metrics: requestedStats.reduce<
      Record<string, { values: Record<string, number>; ranks: Record<string, number> }>
    >((acc, stat) => {
      const rawValues = result.metrics[stat] ?? {};
      const values: Record<string, number> = {};
      for (const slug of rankSlugs) values[slug] = rawValues[slug] ?? 0;
      const sortedTeams = [...rankSlugs].sort((a, b) => values[a] - values[b]);
      const ranks: Record<string, number> = {};
      sortedTeams.forEach((team, idx) => {
        ranks[team] = idx + 1;
      });
      acc[stat] = { values, ranks };
      return acc;
    }, {}),
    samples: result.samples,
    teamGames: result.teamGames,
    totalGames: result.totalGames,
    names: result.names,
  };
}

async function readAggregateDvpCached(
  position: IntlPositionBucket,
  windowN: number,
  wcOnly: boolean
): Promise<DvpBatchApiPayload | null> {
  const requestedStats = getWorldCupDvpStats(position);

  if (wcOnly) {
    const cachedDvp = await readWcCache<DvpAggregateCached>(WC2026.dvpWc2026ForPosition(position));
    if (!cachedDvp) return null;
    recordWcSource('dvpWc2026', 'supabase-cache', position);
    const wcTeamsWithGames = new Set(cachedDvp.wcTeamsWithGames ?? cachedDvp.opponents);
    return buildDvpBatchPayload(position, true, requestedStats, cachedDvp, wcTeamsWithGames);
  }

  const cacheKey = buildWorldCupDvpCacheKey(position, windowN, requestedStats);
  const cached = await getWorldCupCache<DvpAggregateCached>(cacheKey);
  if (!cached) return null;
  recordWcSource('dvpAggregate', 'supabase-cache', `${position}:w${windowN}`);
  return buildDvpBatchPayload(position, false, requestedStats, cached);
}

/** Pre-warmed DVP payloads bundled on the player dashboard (all positions × L5/L10/All + WC 2026). */
async function loadBundledDvpCaches(): Promise<Record<string, DvpBatchApiPayload>> {
  const entries = await Promise.all([
    ...DVP_BUNDLE_POSITIONS.flatMap((position) =>
      DVP_BUNDLE_WINDOWS.map(async (windowN) => {
        const payload = await readAggregateDvpCached(position, windowN, false);
        if (!payload) return null;
        return [`${position}:w${windowN}`, payload] as const;
      })
    ),
    ...DVP_BUNDLE_POSITIONS.map(async (position) => {
      const payload = await readAggregateDvpCached(position, 0, true);
      if (!payload) return null;
      return [`${position}:w0:wc`, payload] as const;
    }),
  ]);
  const bundles: Record<string, DvpBatchApiPayload> = {};
  for (const entry of entries) {
    if (!entry) continue;
    bundles[entry[0]] = entry[1];
  }
  return bundles;
}

async function handleAggregateDvp(request: NextRequest): Promise<NextResponse> {
  const positionRaw = String(request.nextUrl.searchParams.get('position') || '').toUpperCase();
  if (positionRaw !== 'GK' && positionRaw !== 'DEF' && positionRaw !== 'MID' && positionRaw !== 'FWD') {
    return NextResponse.json({ error: 'position must be GK, DEF, MID, or FWD' }, { status: 400 });
  }
  const position = positionRaw as IntlPositionBucket;
  const requestedStats = getWorldCupDvpStats(position);
  const windowRaw = Number.parseInt(String(request.nextUrl.searchParams.get('window') || '0'), 10);
  const windowN = Number.isFinite(windowRaw) && windowRaw > 0 ? windowRaw : 0;
  const wcOnly = request.nextUrl.searchParams.get('wcOnly') === '1';

  const cachedPayload = await readAggregateDvpCached(position, windowN, wcOnly);
  if (cachedPayload) {
    return NextResponse.json(cachedPayload, {
      headers: { 'Cache-Control': wcOnly ? 'public, s-maxage=600' : 'public, s-maxage=3600' },
    });
  }

  // Cache miss — compute live (slow; run `npm run build:world-cup:dashboard` to pre-warm).
  let result: DvpAggregateCached;
  let wcTeamsWithGames: Set<string> | undefined;
  if (wcOnly) {
    recordWcSource('dvpWc2026', 'bdl-live', position);
    const bdl2026 = await loadBdlWc2026DvpData();
    wcTeamsWithGames = bdl2026.teamsWithGames;
    const matchInfo = new Map(
      bdl2026.matches.map((m) => [`bdl:${m.source_match_id}`, m] as const)
    );
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
    for (const m of bdl2026.matches) {
      const key = `bdl:${m.source_match_id}`;
      if (!matchesWithStats.has(key)) continue;
      const ts = m.kickoff_unix ? m.kickoff_unix * 1000 : m.match_date ? Date.parse(m.match_date) : 0;
      addTeamMatch(m.home_team_name, key, ts);
      addTeamMatch(m.away_team_name, key, ts);
    }
    const wcSrc = { matchInfo, teamMatchesBySlug, slugNames: new Map<string, string>(), statRows: bdl2026.statRows, positionMap };
    result = aggregateInternationalDvp(wcSrc, {
      position,
      requestedStats,
      window: 0,
      positionMode: 'lineupPerMatch',
      restrictSlugs: await loadWorldCupQualifiedSlugs(getBdlApiKey()),
    });
    // Self-warm for subsequent requests (non-blocking).
    setWorldCupCache(WC2026.dvpWc2026ForPosition(position), {
      ...result,
      wcTeamsWithGames: Array.from(bdl2026.teamsWithGames),
    }).catch(() => {});
  } else {
    recordWcSource('dvpAggregate', 'bdl-live', `${position}:w${windowN}`);
    result = await loadInternationalDvpAggregate({
      position,
      requestedStats,
      window: windowN,
      restrictSlugs: await loadWorldCupQualifiedSlugs(getBdlApiKey()),
    });
    if (result.opponents.length) {
      const cacheKey = buildWorldCupDvpCacheKey(position, windowN, requestedStats);
      await setWorldCupCache(cacheKey, result);
    }
  }

  const responsePayload = buildDvpBatchPayload(
    positionRaw,
    wcOnly,
    requestedStats,
    result,
    wcOnly && wcTeamsWithGames ? wcTeamsWithGames : null
  );

  return NextResponse.json(responsePayload, {
    headers: { 'Cache-Control': wcOnly ? 'public, s-maxage=600' : 'public, s-maxage=3600' },
  });
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
    const scoreGoalsFor = isHome ? match.home_score : match.away_score;
    const scoreGoalsAgainst = isHome ? match.away_score : match.home_score;
    const goalsFor = toFiniteOrNull(row.goals) ?? toFiniteOrNull(scoreGoalsFor);
    const goalsAgainst = toFiniteOrNull(row.opp_goals) ?? toFiniteOrNull(scoreGoalsAgainst);
    const oppTeam = isHome ? match.away_team : match.home_team;
    const oppName = oppTeam?.name || getTeamLabel(match, isHome ? 'away' : 'home');
    const oppCode =
      resolveWorldCupFlagCode(oppTeam?.country_code) || resolveWorldCupFlagCode(oppName) || null;
    const statsAgainst = recentFormPickStatsAgainst(row);
    if (statsAgainst.goals == null && goalsAgainst != null) statsAgainst.goals = goalsAgainst;
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
      statsAgainst,
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

  // Try pre-warmed cache first, fall back to live BDL if cold.
  let allMatches: BdlMatch[];
  const cachedAllMatches = await readWcCache<BdlMatch[]>(WC2026.matchesAllSeasons);
  if (cachedAllMatches?.length) {
    allMatches = cachedAllMatches;
  } else {
    if (!apiKey) return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
    const seasonsParam = new URLSearchParams();
    appendArrayParam(seasonsParam, 'seasons[]', [2018, 2022, 2026]);
    allMatches = await bdlFetchAll<BdlMatch>('/matches', seasonsParam, apiKey, {
      cursor: true,
      maxPages: 6,
    });
  }

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

  // Read team stats from cache; fall back to live BDL per-chunk fetching.
  let rawTeamStats: Array<Record<string, unknown>> = [];
  const cachedTeamStats = await readWcCache<Array<Record<string, unknown>>>(WC2026.teamStatsAllSeasons);
  if (cachedTeamStats?.length) {
    const neededIds = new Set(matchIds);
    rawTeamStats = cachedTeamStats.filter((r) => neededIds.has(Number(r.match_id)));
  } else if (apiKey) {
    const matchIdChunks2: number[][] = [];
    for (let i = 0; i < matchIds.length; i += 50) matchIdChunks2.push(matchIds.slice(i, i + 50));
    for (const chunk of matchIdChunks2) {
      const params = new URLSearchParams();
      chunk.forEach((id) => params.append('match_ids[]', String(id)));
      const rows = await bdlFetchAll<Record<string, unknown>>('/team_match_stats', params, apiKey, {
        cursor: true,
        maxPages: 4,
      });
      rawTeamStats.push(...rows);
    }
  }
  const teamMatchStats = rawTeamStats;

  // Cross-source recent form (genuine last 5 games across all competitions) for
  // both the selected team and its opponent, shown side-by-side in the UI.
  const statsByMatchTeam = new Map<string, Record<string, any>>();
  for (const row of teamMatchStats as Array<Record<string, any>>) {
    statsByMatchTeam.set(`${Number(row?.match_id)}:${Number(row?.team_id)}`, row);
  }
  // Resolve full team metadata (name + country_code). Prefer the cached 2026
  // teams list, then fall back to live BDL, then scan the match feed.
  const cachedTeamsList = await readWcCache<BdlTeam[]>(WC2026.teams);
  const teamsList = cachedTeamsList?.length
    ? cachedTeamsList
    : apiKey
      ? await bdlFetchAll<BdlTeam>('/teams', new URLSearchParams([['seasons[]', '2026']]), apiKey)
      : [];
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

const WORLD_CUP_LOGO_FILENAME = WORLD_CUP_LOGO_PUBLIC_FILENAME;

function getWorldCupLogoPublicPath(): string {
  return path.join(process.cwd(), 'public', 'images', WORLD_CUP_LOGO_FILENAME);
}

function getWorldCupLogoDownloadsPath(): string | null {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return null;
  const downloadsDir = path.join(home, 'Downloads');
  for (const ext of WORLD_CUP_LOGO_DOWNLOADS_EXTENSIONS) {
    const candidate = path.join(downloadsDir, `${WORLD_CUP_LOGO_DOWNLOADS_STEM}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function worldCupLogoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function ensureWorldCupLogoInPublic(): string | null {
  const publicPath = getWorldCupLogoPublicPath();
  const downloadsPath = getWorldCupLogoDownloadsPath();
  if (downloadsPath) {
    fs.mkdirSync(path.dirname(publicPath), { recursive: true });
    fs.copyFileSync(downloadsPath, publicPath);
    return publicPath;
  }
  if (fs.existsSync(publicPath)) return publicPath;
  return null;
}

function resolveWorldCupLogoPath(): string | null {
  const publicPath = getWorldCupLogoPublicPath();
  if (fs.existsSync(publicPath)) return publicPath;
  return getWorldCupLogoDownloadsPath();
}

function handleWorldCupLogoGet(): NextResponse {
  ensureWorldCupLogoInPublic();
  const logoPath = resolveWorldCupLogoPath();
  if (!logoPath) {
    return new NextResponse('World Cup logo not found', { status: 404 });
  }

  const body = fs.readFileSync(logoPath);
  return new NextResponse(body, {
    headers: {
      'Content-Type': worldCupLogoContentType(logoPath),
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

async function handleWorldCupPlayerPropsListGet(request: NextRequest): Promise<NextResponse> {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const enrich = request.nextUrl.searchParams.get('enrich') !== 'false';
  const forceRefresh = refresh || request.nextUrl.searchParams.get('forceRefresh') === '1';
  const hasCronAuth = isCronRequestAuthorized(request);
  const shouldFetchLive = forceRefresh && hasCronAuth;
  // Mirror AFL props list: user requests are cache-read only; cron replaces on refresh.
  const cacheOnly = !hasCronAuth;

  try {
    if (enrich && !shouldFetchLive) {
      const enrichedCache = await getWorldCupEnrichedListCache();
      if (enrichedCache?.data?.length) {
        const filtered = filterWorldCupPropsWithPlayerCategoryStats(enrichedCache.games, enrichedCache.data);
        return NextResponse.json(
          {
            success: true,
            games: filtered.games,
            data: filtered.data,
            gamesCount: filtered.games.length,
            propsCount: filtered.data.length,
            season: 2026,
            lastUpdated: enrichedCache.lastUpdated,
            nextUpdate: null,
            noWorldCupOdds: false,
            noAflOdds: false,
            ingestMessage: `Fetched ${filtered.data.length} props for ${filtered.games.length} games`,
          },
          { headers: { 'Cache-Control': 'private, no-store' } }
        );
      }
    }

    const result = await buildWorldCupPlayerPropsList({
      refresh: shouldFetchLive,
      cacheOnly,
    });

    if (!enrich) {
      return NextResponse.json(
        {
          success: true,
          games: result.games,
          data: result.data,
          gamesCount: result.games.length,
          propsCount: result.data.length,
          season: 2026,
          lastUpdated: result.lastUpdated,
          nextUpdate: null,
          noWorldCupOdds: result.noWorldCupOdds,
          noAflOdds: result.noWorldCupOdds,
          ingestMessage: result.ingestMessage,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const enriched = await enrichWorldCupPlayerPropsList(result.data, {
      cacheOnly,
    });
    const filtered = filterWorldCupPropsWithPlayerCategoryStats(result.games, enriched);
    const lastUpdated = result.lastUpdated ?? new Date().toISOString();
    if (filtered.data.length) {
      await setWorldCupEnrichedListCache({ games: filtered.games, data: filtered.data, lastUpdated });
    }

    return NextResponse.json(
      {
        success: true,
        games: filtered.games,
        data: filtered.data,
        gamesCount: filtered.games.length,
        propsCount: filtered.data.length,
        season: 2026,
        lastUpdated,
        nextUpdate: null,
        noWorldCupOdds: filtered.data.length === 0,
        noAflOdds: filtered.data.length === 0,
        ingestMessage: result.ingestMessage,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.warn('[world-cup] player props list failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'World Cup props list failed',
        games: [],
        data: [],
        noWorldCupOdds: true,
        noAflOdds: true,
        ingestMessage: 'No odds available. Come back later.',
      },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

async function handleWorldCupPropsStatsWarmGet(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const origin =
    request.nextUrl?.origin ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;
  const useListApi = request.nextUrl.searchParams.get('useList') === '1';

  const result = await runWorldCupPropsStatsWarm(baseUrl, { useListApi });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, warmed: 0 }, { status: 500 });
  }

  try {
    const list = await buildWorldCupPlayerPropsList();
    const enriched = await enrichWorldCupPlayerPropsList(list.data, { cacheOnly: false });
    const filtered = filterWorldCupPropsWithPlayerCategoryStats(list.games, enriched);
    const lastUpdated = new Date().toISOString();
    await setWorldCupEnrichedListCache({ games: filtered.games, data: filtered.data, lastUpdated });
  } catch (e) {
    console.warn('[WC props-stats/warm] enriched list rebuild failed:', e);
  }

  return NextResponse.json({
    success: true,
    warmed: result.warmed,
    failed: result.failed,
    noData: result.noData,
    coveragePct: result.coveragePct,
    total: result.total,
    skipped: result.skipped,
    rowsFromCache: result.rowsFromCache,
    uniqueProps: result.uniqueProps,
    ...(useListApi ? { source: 'listApi' } : {}),
  });
}

async function handleWorldCupOddsRefreshGet(request: NextRequest): Promise<NextResponse> {
  console.log('[WC cron] /api/world-cup/dashboard?oddsRefresh=1 started');

  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) {
      console.log('[WC cron] 401 Unauthorized - send CRON_SECRET (Bearer / X-Cron-Secret / ?secret=)');
      return auth.response;
    }
  }

  const result = await refreshWorldCupOddsCache();

  if (!result.success) {
    console.log('[WC cron] Refresh failed:', result.error);
    return NextResponse.json(
      {
        success: false,
        error: result.error,
        gamesCount: result.gamesCount,
        propsCount: result.propsCount,
        ingestMessage: result.ingestMessage,
      },
      { status: 502 }
    );
  }

  console.log(
    `[WC cron] OK games=${result.gamesCount} props=${result.propsCount} lastUpdated=${result.lastUpdated}`
  );

  return NextResponse.json({
    success: true,
    gamesCount: result.gamesCount,
    propsCount: result.propsCount,
    lastUpdated: result.lastUpdated,
    ingestMessage: result.ingestMessage,
    message:
      result.propsCount > 0
        ? `World Cup odds refreshed (${result.propsCount} props, ${result.gamesCount} games).`
        : 'World Cup odds refresh completed with no props in the next 36h window.',
  });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('logo') === '1') {
    return handleWorldCupLogoGet();
  }
  if (request.nextUrl.searchParams.get('oddsRefresh') === '1') {
    return handleWorldCupOddsRefreshGet(request);
  }
  if (request.nextUrl.searchParams.get('propsStatsWarm') === '1') {
    return handleWorldCupPropsStatsWarmGet(request);
  }
  if (request.nextUrl.searchParams.get('playerPropsList') === '1') {
    return handleWorldCupPlayerPropsListGet(request);
  }
  const debug = isWcCacheDebug(request);
  return runWithWcCacheDebug(debug, async () => {
    const response = await handleWorldCupDashboardGet(request);
    logWcCacheRequestComplete('dashboard', debug);
    if (debug) {
      const summary = getWcCacheDebugSummary();
      if (summary) {
        response.headers.set('X-WC-Cache-Debug', '1');
        response.headers.set('X-WC-BDL-Live-Count', String(summary.bdlLiveCount));
        response.headers.set('X-WC-Cache-Summary', summary.summary.slice(0, 240));
      }
    }
    return response;
  });
}

async function handleWorldCupPlayerOddsGet(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const playerName = params.get('playerName')?.trim() || params.get('player')?.trim() || '';
  const homeTeam = params.get('homeTeam')?.trim() || params.get('home')?.trim() || '';
  const awayTeam = params.get('awayTeam')?.trim() || params.get('away')?.trim() || '';
  const matchDate = params.get('matchDate')?.trim() || params.get('date')?.trim() || null;
  const statId = params.get('stat')?.trim() || params.get('statId')?.trim() || 'goals';

  if (!playerName) {
    return NextResponse.json({ error: 'playerName is required', books: [] }, { status: 400 });
  }
  if (!homeTeam || !awayTeam) {
    return NextResponse.json({ error: 'homeTeam and awayTeam are required', books: [] }, { status: 400 });
  }

  try {
    if (params.get('debug') === '1') {
      const probe = await probeWorldCupPlayerOddsRaw({
        playerName,
        homeTeam,
        awayTeam,
        matchDate,
      });
      const primaryLine = getPrimaryOddsLineForStat(statId, probe.parsedBooks);
      return NextResponse.json({
        success: true,
        debug: true,
        fixtureId: probe.fixtureId,
        homeTeam: probe.homeTeam,
        awayTeam: probe.awayTeam,
        matchDate: probe.matchDate,
        playerName: probe.playerName,
        statId,
        primaryLine,
        parsedBooks: probe.parsedBooks,
        rawHits: probe.rawHits,
        bareOverUnderInPlayerMarkets: probe.bareOverUnderInPlayerMarkets,
      });
    }

    const result = await fetchWorldCupPlayerOdds({
      playerName,
      homeTeam,
      awayTeam,
      matchDate,
    });
    const primaryLine = getPrimaryOddsLineForStat(statId, result.books);
    return NextResponse.json({
      success: true,
      fixtureId: result.fixtureId,
      books: result.books,
      primaryLine,
      statId,
      generatedAt: result.generatedAt,
      source: result.source,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[world-cup/dashboard] playerOdds failed:', message);
    return NextResponse.json({ success: false, error: message, books: [] }, { status: 500 });
  }
}

async function handleWorldCupDashboardGet(request: NextRequest) {
  const competition = parseCompetition(request.nextUrl.searchParams.get('competition'));
  const apiKey = getBdlApiKey();

  if (request.nextUrl.searchParams.get('playerOdds') === '1') {
    return handleWorldCupPlayerOddsGet(request);
  }

  if (request.nextUrl.searchParams.get('dvpBatch') === '1') {
    try {
      // Defense vs Position is aggregated across every international competition
      // (GK/DEF/MID/FWD), regardless of the selected competition tab. Reads only
      // Supabase — no BDL key or season required.
      return await handleAggregateDvp(request);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to compute DVP' },
        { status }
      );
    }
  }

  if (request.nextUrl.searchParams.get('playerVsPool') === '1') {
    try {
      const scope =
        request.nextUrl.searchParams.get('scope') === 'worldcup' ? 'worldcup' : 'all';

      // worldcup scope: serve the pre-warmed cache written by the ingestion script.
      // Self-warm on first miss so subsequent requests are instant.
      if (scope === 'worldcup') {
        const cached = await readWcCache<Record<string, unknown>>(WC2026.playerVsPoolWc);
        if (cached && Array.isArray(cached.players) && (cached.players as unknown[]).length > 0) {
          recordWcSource('playerVsPool', 'supabase-cache', 'worldcup');
          return NextResponse.json(cached, { headers: { 'Cache-Control': 'public, s-maxage=600' } });
        }

        // Cache cold: compute from BDL, then self-warm.
        recordWcSource('playerVsPool', 'bdl-live', 'worldcup');
        const qualifiedUniverse = await ensureWorldCupQualifiedUniverse(apiKey);
        const payload = await loadWorldCupPlayerPool({
          scope,
          seasonYear: DEFAULT_SEASON,
          qualifiedUniverse,
        });
        if (payload.opponentBreakdown && qualifiedUniverse?.size) {
          payload.opponentBreakdown = expandWorldCupOpponentBreakdownUniverse(
            payload.opponentBreakdown,
            qualifiedUniverse
          );
        }
        if (apiKey) {
          const bdlResult = await computeBdlWorldCupSeason(apiKey, DEFAULT_SEASON, qualifiedUniverse);
          if (bdlResult.opponentBreakdown) payload.opponentBreakdown = bdlResult.opponentBreakdown;
          if (bdlResult.players.length > 0) payload.players = bdlResult.players;
          if (!bdlResult.opponentBreakdown) {
            const opponentTeamIdRaw = request.nextUrl.searchParams.get('opponentTeamId');
            const opponentTeamName = request.nextUrl.searchParams.get('opponentTeamName') || '';
            const opponentCountryCode = request.nextUrl.searchParams.get('opponentCountryCode');
            const opponentTeamId = opponentTeamIdRaw ? Number.parseInt(opponentTeamIdRaw, 10) : NaN;
            if (payload.opponentBreakdown && Number.isFinite(opponentTeamId)) {
              const live = await computeBdlWorldCupOpponentAllowedLive(
                opponentTeamId, opponentTeamName, opponentCountryCode, apiKey, DEFAULT_SEASON
              );
              if (live) {
                payload.opponentBreakdown = mergeWorldCupOpponentAllowedSnapshot(
                  payload.opponentBreakdown, live.slug, live.name, live.games, live.allowed,
                  { qualifiedUniverse }
                );
              }
            }
          }
        }
        // Self-warm so next request is instant.
        setWorldCupCache(WC2026.playerVsPoolWc, payload).catch(() => {});
        return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
      }

      // 'all' scope — unchanged path (already Supabase-backed).
      recordWcSource('playerVsPool', 'supabase-intl', 'all');
      const payload = await loadWorldCupPlayerPool({ scope });
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'public, s-maxage=3600' },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to load player pool' },
        { status: 500 }
      );
    }
  }

  if (request.nextUrl.searchParams.get('oppBreakdown') === '1') {
    try {
      const wcOnly = request.nextUrl.searchParams.get('wcOnly') === '1';
      if (wcOnly) {
        // Cache-first: ingestion script pre-warms this key. Fall back to a fast
        // Supabase-only compute, then live BDL only if blobs are still cold.
        const cached = await readWcCache<Record<string, unknown>>(WC2026.oppBreakdownWc2026);
        if (
          cached &&
          cached.names != null &&
          typeof cached.names === 'object' &&
          Object.keys(cached.names).length > 0
        ) {
          recordWcSource('oppBreakdownWc2026', 'supabase-cache');
          return NextResponse.json(
            { ...cached, wcOnly: true },
            {
              headers: {
                'Cache-Control': 'public, s-maxage=600',
                'X-WC-Opp-Source': 'cache',
              },
            }
          );
        }
        recordWcSource('oppBreakdownWc2026', 'computed');
        let payload = await computeWcOnlyOppBreakdown(apiKey, { allowLiveBdl: false });
        if (!Object.keys(payload.names).length && apiKey) {
          recordWcSource('oppBreakdownWc2026', 'bdl-live');
          payload = await computeWcOnlyOppBreakdown(apiKey, { allowLiveBdl: true });
        }
        if (Object.keys(payload.names).length > 0) {
          setWorldCupCache(WC2026.oppBreakdownWc2026, payload).catch(() => {});
        }
        return NextResponse.json(
          { ...payload, wcOnly: true },
          {
            headers: {
              'Cache-Control': Object.keys(payload.names).length > 0 ? 'public, s-maxage=600' : 'no-store',
              'X-WC-Opp-Source': Object.keys(payload.names).length > 0 ? 'computed' : 'empty',
            },
          }
        );
      }
      // Competition-agnostic: rankings span every nation's last N games across
      // all ingested competitions. Served from the precomputed cache (see
      // scripts/build-world-cup-opponent-breakdown.ts) for an instant response.
      // Default window is 0 = "All games" (each nation averaged over every game).
      const windowN = Number.parseInt(request.nextUrl.searchParams.get('window') || '0', 10);
      const payload = await getOpponentBreakdown(windowN, apiKey);
      const cachedHit = Object.keys(payload.names).length > 0;
      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'public, s-maxage=600',
          'X-WC-Opp-Source': cachedHit ? 'cache' : 'empty',
        },
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

  // Allow serving fully-cached responses without an API key.
  // The key is only required when falling back to live BDL.
  const season = parseSeason(request.nextUrl.searchParams.get('season'));
  const requestedTeamId = request.nextUrl.searchParams.get('teamId');
  const requestedTeamName =
    request.nextUrl.searchParams.get('teamName')?.trim() ||
    request.nextUrl.searchParams.get('team')?.trim() ||
    null;
  const opponentTeamNameHint =
    request.nextUrl.searchParams.get('opponentTeamName')?.trim() ||
    request.nextUrl.searchParams.get('opponent')?.trim() ||
    null;
  const requestedPlayerId = request.nextUrl.searchParams.get('playerId');
  const requestedPlayerNameForKey = request.nextUrl.searchParams.get('playerName');
  const seasonsParam = new URLSearchParams();
  appendArrayParam(seasonsParam, 'seasons[]', [season]);

  // Lightweight teams-only fetch so the Game Props team search can list real
  // BDL national teams (with numeric ids) before any selection is made.
  if (request.nextUrl.searchParams.get('teamsOnly') === '1') {
    const teamsCacheKey = `${WC_DASHBOARD_CACHE_PREFIX}:teams:${season}`;
    // Check the pre-warmed raw cache first, then the legacy dashboard cache.
    const rawTeams = await readWcCache<BdlTeam[]>(WC2026.teams);
    const rawStandings = await readWcCache<unknown[]>(WC2026.standings);
    if (rawTeams?.length) {
      const teamsPayload = { season, teams: rawTeams, standings: rawStandings ?? [] };
      return NextResponse.json(teamsPayload, { headers: { 'Cache-Control': 'no-store' } });
    }
    const cachedTeams = await getWorldCupCache<Record<string, unknown>>(teamsCacheKey);
    if (cachedTeams) {
      return NextResponse.json(cachedTeams, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
    }
    const [teamsOnly, standingsOnly] = await Promise.all([
      bdlFetchAll<BdlTeam>('/teams', seasonsParam, apiKey),
      bdlFetchAll('/group_standings', seasonsParam, apiKey),
    ]);
    const teamsPayload = { season, teams: teamsOnly, standings: standingsOnly };
    await setWorldCupCache(teamsCacheKey, teamsPayload);
    return NextResponse.json(teamsPayload, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (!apiKey && !(await readWcCache<unknown[]>(WC2026.matches2026))?.length) {
    return NextResponse.json({ error: 'BALLDONTLIE_API_KEY is not configured' }, { status: 500 });
  }

  const dashboardCacheKey = buildDashboardCacheKey({
    competition,
    season,
    teamId: requestedTeamId,
    playerId: requestedPlayerId,
    playerName: requestedPlayerNameForKey,
  });

  try {
    const forceRebuildDashboard = request.nextUrl.searchParams.get('rebuildDashboard') === '1';
    if (!forceRebuildDashboard) {
      const cachedDashboard = await getWorldCupCache<Record<string, unknown>>(dashboardCacheKey);
      if (cachedDashboard) {
        let payload = cachedDashboard;
        if (requestedPlayerId || requestedPlayerNameForKey) {
          payload = await mergeTeamSharedDashboardFields(cachedDashboard, {
            competition,
            season,
            teamId: requestedTeamId,
          });
        }
        if (requestedPlayerId && /^\d+$/.test(requestedPlayerId)) {
          const canonicalPlayerMatches = Array.isArray(payload.playerMatches)
            ? (payload.playerMatches as Array<Record<string, any>>)
            : [];
          const shouldRefreshPlayerStats = request.nextUrl.searchParams.get('refreshPlayerStats') === '1';
          const freshPlayer = shouldRefreshPlayerStats
            ? await refreshDashboardPlayerStats({
                requestedPlayerId,
                requestedTeamId,
                apiKey,
              })
            : { playerMatchStats: [], playerMatches: [], matches: [] };
          const existingStats = Array.isArray(payload.playerMatchStats)
            ? (payload.playerMatchStats as Array<Record<string, any>>)
            : [];
          let mergedPlayerMatchStats: Array<Record<string, any>> = mergePlayerStatRows(
            existingStats,
            freshPlayer.playerMatchStats
          ).map((row) => ({
            ...row,
            player_id: requestedPlayerId,
            player: row.player
              ? { ...row.player, id: requestedPlayerId }
              : { id: requestedPlayerId },
          }));

          const resolvedPlayerName = resolveRequestedPlayerName(
            payload,
            requestedPlayerId,
            requestedPlayerNameForKey
          );
          const mergedPlayerMatches = new Map<string, Record<string, any>>();
          for (const match of [...canonicalPlayerMatches, ...freshPlayer.playerMatches] as Array<
            Record<string, any>
          >) {
            const id = String(match.id ?? '');
            if (!id) continue;
            const existing = mergedPlayerMatches.get(id);
            if (!existing || dashboardMatchRichness(match) >= dashboardMatchRichness(existing)) {
              mergedPlayerMatches.set(id, match);
            }
          }
          if (resolvedPlayerName) {
            try {
              const intl = await loadInternationalStatsByPlayerName(resolvedPlayerName, {
                bdlPlayerId: requestedPlayerId,
              });
              mergedPlayerMatchStats = mergePlayerStatRows(
                mergedPlayerMatchStats,
                (intl.playerMatchStats as Array<Record<string, any>>).map((row) => ({
                  ...row,
                  player_id: requestedPlayerId,
                  player: row.player
                    ? { ...row.player, id: requestedPlayerId }
                    : { id: requestedPlayerId },
                }))
              );
              for (const match of intl.matches as Array<Record<string, any>>) {
                const id = String(match.id ?? '');
                if (!id) continue;
                const existing = mergedPlayerMatches.get(id);
                if (!existing || dashboardMatchRichness(match) >= dashboardMatchRichness(existing)) {
                  mergedPlayerMatches.set(id, match);
                }
              }
            } catch {
              /* non-fatal */
            }
          }

          const repairedPlayerMatches = await repairPlayerMatchesFromIntl(
            mergedPlayerMatchStats,
            Array.from(mergedPlayerMatches.values()),
            {
              playerName: resolvedPlayerName,
              playerId: requestedPlayerId,
            }
          );
          payload = {
            ...payload,
            playerMatchStats: attachStatRowMatchContext(
              mergedPlayerMatchStats,
              repairedPlayerMatches
            ),
            playerMatches: repairedPlayerMatches,
          };
        }
        const lineupRefresh = lineupsCachedOnPayload(payload)
          ? {
              lineups: payload.lineups as any[],
              lineupMeta: payload.lineupMeta as {
                source: 'feature' | 'last-match' | 'mixed';
                selectedTeamId?: number | null;
                opponentTeamId?: number | null;
                selectedTeamLastMatchId: number | null;
                selectedTeamLastMatchOpponentId: number | null;
                opponentTeamLastMatchId: number | null;
                opponentTeamLastMatchOpponentId: number | null;
              },
              lineupPlayerPhotos: (payload.lineupPlayerPhotos as Record<string, string> | undefined) ?? {},
              resolvedSelectedTeam: (payload.selectedTeam as BdlTeam | null | undefined) ?? null,
            }
          : await resolveDashboardLineups(
              payload,
              requestedTeamId,
              request.nextUrl.searchParams.get('refreshLineups') === '1' ? apiKey : undefined
            );
        let responseBody: Record<string, unknown> = {
          ...payload,
          lineups: lineupRefresh.lineups,
          lineupMeta: lineupRefresh.lineupMeta,
          lineupPlayerPhotos: lineupRefresh.lineupPlayerPhotos,
          ...(lineupRefresh.resolvedSelectedTeam
            ? { selectedTeam: lineupRefresh.resolvedSelectedTeam }
            : {}),
        };
        if (requestedPlayerId) {
          const resolvedSideTeamId =
            (lineupRefresh.resolvedSelectedTeam as { id?: number } | undefined)?.id ??
            (payload.selectedTeam as { id?: number } | undefined)?.id ??
            null;
          const sideTeamId =
            requestedTeamId ?? (resolvedSideTeamId != null ? String(resolvedSideTeamId) : null);
          if (!playerSidePanelFullyCached(responseBody)) {
            responseBody = await attachPlayerSidePanelData(responseBody, {
              competition,
              season,
              teamId: sideTeamId,
              apiKey: apiKey ?? '',
            });
          } else {
            await attachWc2026OpponentBreakdownIfMissing(responseBody);
            await attachDvpBundlesIfMissing(responseBody);
          }
        } else {
          await attachWc2026OpponentBreakdownIfMissing(responseBody);
        }
        return NextResponse.json(responseBody, {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }

    // Read core 2026 data from the pre-warmed cache only (chart + dashboard).
    let teams: BdlTeam[] = [];
    let stadiums: unknown[] = [];
    let standings: unknown[] = [];
    let matches: BdlMatch[] = [];
    let futures: unknown[] = [];
    const allowLiveLineupRefresh = request.nextUrl.searchParams.get('refreshLineups') === '1';
    const { matches2026: liveMatches2026, allSeasonMatches: dashboardAllSeasonMatches } =
      await loadLineupLookupMatches(apiKey, { cacheOnly: !allowLiveLineupRefresh });

    const cachedTeams2026 = await readWcCache<BdlTeam[]>(WC2026.teams);
    if (cachedTeams2026?.length) {
      recordWcSource('core2026', 'supabase-cache');
      teams = cachedTeams2026;
      stadiums = (await readWcCache<unknown[]>(WC2026.stadiums)) ?? [];
      standings = (await readWcCache<unknown[]>(WC2026.standings)) ?? [];
      matches = mergeBdlMatches(
        (await readWcCache<BdlMatch[]>(WC2026.matches2026)) ?? [],
        liveMatches2026
      );
      futures = (await readWcCache<unknown[]>('wc:raw:odds-futures:2026:v1')) ?? [];
    } else {
      recordWcSource('core2026', 'cache-miss');
      matches = liveMatches2026;
    }

    const selectedTeam =
      resolveRequestedTeam(teams, requestedTeamId, null) ??
      (requestedTeamName ? findBdlTeamByName(teams, requestedTeamName) : null);
    const featureMatch = findFeatureMatchWithOpponentHint(matches, selectedTeam, opponentTeamNameHint);
    const selectedTeamId = selectedTeam?.id ?? null;
    const featureMatchId = featureMatch?.id ?? null;
    const selectedTeamMatches = selectedTeamId
      ? matches.filter((match) => match.home_team?.id === selectedTeamId || match.away_team?.id === selectedTeamId)
      : matches;
    const statMatchIds = selectedTeamId
      ? completedMatchesForTeam(matches, selectedTeamId)
          .map((match) => match.id)
          .filter((id): id is number => Number.isFinite(id))
          .slice(0, 12)
      : featureMatchId
        ? [featureMatchId]
        : [];

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

    // ── Rosters + player profiles — cache-first ───────────────────────────────
    let rostersRaw: any[] = [];
    let squadPlayers: any[] = [];
    if (selectedTeamId) {
      const [cachedRoster, cachedSquad] = await Promise.all([
        readWcCache<any[]>(WC2026.rosterForTeam(selectedTeamId)),
        readWcCache<any[]>(WC2026.playersForTeam(selectedTeamId)),
      ]);
      if (cachedRoster) {
        recordWcSource('rosters', 'supabase-cache', String(selectedTeamId));
        rostersRaw = cachedRoster;
        squadPlayers = cachedSquad ?? [];
        // Also add opponent roster if feature match exists
        if (opponentTeamId && opponentTeamId !== selectedTeamId) {
          const [oppRoster, oppPlayers] = await Promise.all([
            readWcCache<any[]>(WC2026.rosterForTeam(opponentTeamId)),
            readWcCache<any[]>(WC2026.playersForTeam(opponentTeamId)),
          ]);
          rostersRaw = [...rostersRaw, ...(oppRoster ?? [])];
          squadPlayers = [...squadPlayers, ...(oppPlayers ?? [])];
        }
      } else if (apiKey) {
        recordWcSource('rosters', 'bdl-live', String(selectedTeamId));
        [rostersRaw, squadPlayers] = await Promise.all([
          bdlFetchAll('/rosters', teamScopedParams, apiKey, { cursor: true, maxPages: 4 }),
          bdlFetchAll('/players', teamScopedParams, apiKey, { cursor: true, maxPages: 4 }),
        ]);
      }
    }
    const rosters = enrichWorldCupRosters(rostersRaw, squadPlayers);

    // ── Per-match stats: team stats + player stats (cache-first) ─────────────
    let teamMatchStats: any[] = [];
    let playerMatchStats: any[] = [];

    if (statMatchIds.length) {
      // Read team stats for each match from the all-seasons cache, then backfill
      // any missing 2026 completed games from per-match detail blobs.
      const allCachedTeamStats = await readWcCache<any[]>(WC2026.teamStatsAllSeasons);
      if (allCachedTeamStats) {
        const needed = new Set(statMatchIds);
        teamMatchStats = allCachedTeamStats.filter((r) => needed.has(Number(r?.match_id)));
        const covered = new Set(teamMatchStats.map((r) => Number(r?.match_id)).filter(Number.isFinite));
        const missing = statMatchIds.filter((id) => !covered.has(id));
        if (missing.length) {
          const details = await Promise.all(
            missing.map((mid) => readWcCache<{ teamStats?: any[] }>(WC2026.matchDetail(mid)))
          );
          const fromDetails = details.flatMap((d) => d?.teamStats ?? []);
          if (fromDetails.length) {
            recordWcSource('teamMatchStats', 'match-detail-fallback', missing.join(','));
            teamMatchStats = [...teamMatchStats, ...fromDetails];
          }
        }
      } else {
        recordWcSource('teamMatchStats', 'cache-miss', statMatchIds.join(','));
      }
    }

    // Player stats: if a numeric playerId was given, look up by player cache key.
    // Otherwise aggregate from per-match cache blobs.
    let playerStatsFromCache = false;
    const completed2026Ids = wc2026CompletedMatchIdSet(matches);
    if (requestedPlayerId && /^\d+$/.test(requestedPlayerId)) {
      const cachedStats = await readWcCache<any[]>(WC2026.playerStats(requestedPlayerId));
      if (cachedStats?.length) {
        recordWcSource('playerStats', 'supabase-cache', requestedPlayerId);
        playerMatchStats = cachedStats;
        playerStatsFromCache = true;
      } else {
        recordWcSource('playerStats', 'cache-miss', requestedPlayerId);
      }

      const needsTeamFallback =
        !playerHasWc2026Appearance(playerMatchStats, completed2026Ids) && selectedTeamId;
      if (needsTeamFallback) {
        const fromTeam = await loadPlayerStatsFromTeamCompletedMatches({
          teamId: selectedTeamId,
          matches2026: matches,
          playerId: requestedPlayerId,
          apiKey,
        });
        if (fromTeam.length) {
          recordWcSource('playerStats', 'match-detail-fallback', String(selectedTeamId));
          playerMatchStats = mergePlayerStatRows(playerMatchStats, fromTeam);
          playerStatsFromCache = playerMatchStats.length > 0;
        }
      }

      if (!playerMatchStats.length && apiKey && request.nextUrl.searchParams.get('refreshPlayerStats') === '1') {
        const live = await fetchLivePlayerStatsById(requestedPlayerId, apiKey);
        if (live.length) {
          recordWcSource('playerStats', 'bdl-live', requestedPlayerId);
          playerMatchStats = live;
          playerStatsFromCache = true;
        }
      }
    } else if (statMatchIds.length) {
      // Aggregate player stats for selected team's recent matches from per-match cache.
      const matchDetails = await Promise.all(
        statMatchIds.map((mid) => readWcCache<{ playerStats?: any[] }>(WC2026.matchDetail(mid)))
      );
      const fromCache = matchDetails.flatMap((d) => d?.playerStats ?? []);
      if (fromCache.length > 0) {
        playerMatchStats = fromCache;
        playerStatsFromCache = true;
      } else {
        recordWcSource('playerStats', 'cache-miss', statMatchIds.join(','));
      }
    }

    // ── Feature match detail — cache-first (lineups resolved per-team below)
    let events: any[] = [], shots: any[] = [];
    let momentum: any[] = [], bestPlayers: any[] = [], avgPositions: any[] = [];
    let teamForm: any[] = [], odds: any[] = [];
    if (featureMatchId) {
      const cachedDetail = await readWcCache<{
        lineups?: any[]; events?: any[]; shots?: any[]; momentum?: any[];
        bestPlayers?: any[]; avgPositions?: any[]; teamForm?: any[]; odds?: any[];
      }>(WC2026.matchDetail(featureMatchId));
      if (cachedDetail) {
        recordWcSource('featureMatch', 'supabase-cache', String(featureMatchId));
        events = cachedDetail.events ?? [];
        shots = cachedDetail.shots ?? [];
        momentum = cachedDetail.momentum ?? [];
        bestPlayers = cachedDetail.bestPlayers ?? [];
        avgPositions = cachedDetail.avgPositions ?? [];
        teamForm = cachedDetail.teamForm ?? [];
        odds = cachedDetail.odds ?? [];
      }
    }

    const { lineups, lineupMeta, lineupPlayerPhotos } = await resolveDashboardLineups(
      {
        rosters,
        teams,
        selectedTeam: selectedTeam ?? undefined,
        featureMatch: featureMatch
          ? { ...summarizeMatches([featureMatch])[0], raw: featureMatch }
          : null,
      },
      requestedTeamId,
      allowLiveLineupRefresh ? apiKey : undefined
    );

    // ── Player shots (for numeric playerId mode) — cache-first ───────────────
    let playerMatches: BdlMatch[] = [];
    let playerShots: any[] = [];
    if (requestedPlayerId && Array.isArray(playerMatchStats) && playerMatchStats.length) {
      // Try to read player shots from the per-player cache first.
      const cachedPlayerShots = await readWcCache<any[]>(WC2026.playerShots(requestedPlayerId));
      if (cachedPlayerShots) {
        recordWcSource('playerShots', 'supabase-cache', requestedPlayerId);
        playerShots = cachedPlayerShots;
      } else {
        recordWcSource('playerShots', 'cache-miss', requestedPlayerId);
      }

      const neededIds = new Set(
        playerMatchStats
          .map((row: any) => Number(row?.match_id))
          .filter((id) => Number.isFinite(id))
      );
      if (neededIds.size) {
        const mergedLookupMatches = mergeBdlMatches(dashboardAllSeasonMatches, matches);
        playerMatches = mergedLookupMatches.filter((match) => neededIds.has(Number(match.id)));
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
    // Only keep stats that belong to 2026 WC matches — BDL returns all editions
    // (2018/2022/2026) when queried by player_ids[] without a season filter, so
    // we gate on the already-season-filtered `matches` set to avoid historical
    // WC games appearing as "WC GAMES" in the PvT panel.
    const wc2026MatchIds = new Set(matches.map((m) => Number(m.id)));
    const playerRowsWithDerivedShots = (playerMatchStats as Array<Record<string, any>>).map((row) => ({
      ...row,
      ...(derivedShotsByMatch.get(Number(row.match_id)) ?? {}),
    }));
    const wc2026PlayerMatchStats = playerRowsWithDerivedShots.filter((row) =>
      wc2026MatchIds.has(Number(row.match_id))
    );

    // Always merge stats from every source we have for the currently selected
    // player so the main chart shows every game across BDL + Euros + Nations
    // League. This runs whenever a `playerName` is provided.
    let mergedPlayerMatchStats: Array<Record<string, any>> = wc2026PlayerMatchStats.map((row) => ({
      ...row,
      source: 'bdl',
      tournament_slug: 'worldcup',
    }));
    let mergedPlayerMatches: Array<Record<string, any>> = summarizeMatches(playerMatches);
    const requestedPlayerName = request.nextUrl.searchParams.get('playerName') || '';
    if (requestedPlayerName) {
      try {
        recordWcSource('intlStatsByName', 'supabase-intl', requestedPlayerName);
        const intl = await loadInternationalStatsByPlayerName(requestedPlayerName, {
          bdlPlayerId: requestedPlayerId,
        });
        const bdlByName =
          playerStatsFromCache || playerRowsWithDerivedShots.length
            ? { playerMatchStats: [], matches: [] }
            : await fetchBdlStatsForPlayerName(requestedPlayerName, apiKey);

        const statRowKey = (row: Record<string, any>) =>
          `${row.match_id ?? ''}|${row.team_id ?? ''}|${row.player_id ?? ''}`;
        const seenStatKeys = new Set(mergedPlayerMatchStats.map(statRowKey));
        const appendStats = (rows: Array<Record<string, any>>) => {
          for (const row of rows) {
            const key = statRowKey(row);
            if (seenStatKeys.has(key)) continue;
            seenStatKeys.add(key);
            mergedPlayerMatchStats.push(row);
          }
        };

        appendStats(
          bdlByName.playerMatchStats.map((row) => ({
            ...row,
            source: 'bdl',
            tournament_slug: 'worldcup',
          }))
        );
        appendStats(intl.playerMatchStats);

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
    if (requestedPlayerId && /^\d+$/.test(requestedPlayerId) && wc2026PlayerMatchStats.length) {
      const playerTeam = resolveTeamFromPlayerMatchStats(wc2026PlayerMatchStats, teams);
      if (playerTeam) resolvedSelectedTeam = playerTeam;
    }

    const resolvedSelectedTeamId = resolvedSelectedTeam?.id ?? null;
    const resolvedFeatureMatch = findFeatureMatchWithOpponentHint(
      matches,
      resolvedSelectedTeam,
      opponentTeamNameHint
    );
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
    mergedTeamMatchStats = enrichTeamStatRowsWithScoreline(
      mergedTeamMatchStats,
      mergedPlayerMatches
    );
    mergedTeamMatchStats = mergedTeamMatchStats.map(normalizeDerivedTeamStats);
    mergedTeamMatchStats = dedupeCrossSourceTeamStatRows(
      mergedTeamMatchStats,
      mergedPlayerMatches
    ) as Array<Record<string, any>>;
    mergedTeamMatchStats = mergedTeamMatchStats.filter(isRichTeamStatRow);

    const playerMatchStatsWithContext = attachStatRowMatchContext(
      mergedPlayerMatchStats,
      mergedPlayerMatches
    );

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
      playerMatchStats: playerMatchStatsWithContext,
      lineups,
      lineupMeta,
      lineupPlayerPhotos,
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

    let toCache: Record<string, unknown> = responsePayload;

    if (!requestedPlayerId) {
      const teamIdForShare =
        resolvedSelectedTeamId ??
        (requestedTeamId && /^\d+$/.test(requestedTeamId) ? Number(requestedTeamId) : null);
      if (teamIdForShare) {
        const shareFields = await buildTeamShareFieldsForTeamDashboard(teamIdForShare, toCache);
        toCache = { ...toCache, ...shareFields };
      }
      await attachWc2026OpponentBreakdownIfMissing(toCache);
    } else {
      toCache = await attachPlayerSidePanelData(toCache, {
        competition,
        season,
        teamId: String(resolvedSelectedTeamId ?? requestedTeamId ?? ''),
        apiKey: apiKey ?? '',
      });
      const mergeTeamId = resolvedSelectedTeamId ?? requestedTeamId;
      if (mergeTeamId) {
        toCache = await mergeTeamSharedDashboardFields(toCache, {
          competition,
          season,
          teamId: String(mergeTeamId),
        });
      }
    }

    await setWorldCupCache(dashboardCacheKey, toCache);

    return NextResponse.json(toCache, {
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
