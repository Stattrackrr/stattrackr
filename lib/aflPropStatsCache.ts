/**
 * Server-side cache for AFL prop stats (L5, L10, H2H, Season, Streak, hit rates).
 * Used by /api/afl/props-stats/batch so the props page gets fast, cached stats.
 * We only set entries when we have computed stats; never overwrite with empty (24h TTL).
 */

import { opponentToOfficialTeamName, rosterTeamToInjuryTeam, canonicalTeamForStatsKey } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import sharedCache from '@/lib/sharedCache';

const CACHE_PREFIX = 'afl_prop_stats_v1';
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours so stats persist until next warm (cron runs every ~3h)

export type AflPropStatsPayload = {
  last5Avg: number | null;
  last10Avg: number | null;
  h2hAvg: number | null;
  seasonAvg: number | null;
  streak: number | null;
  last5HitRate: { hits: number; total: number } | null;
  last10HitRate: { hits: number; total: number } | null;
  h2hHitRate: { hits: number; total: number } | null;
  seasonHitRate: { hits: number; total: number } | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
};

/** Same key used for getAflPropStats cache store/lookup. Use in list API so statsByKey matches. */
export function getAflPropStatsCacheKey(playerName: string, team: string, opponent: string, statType: string, line: number): string {
  const normalizedName = normalizeAflPlayerNameForMatch(playerName);
  const teamCanon = canonicalTeamForStatsKey(team);
  const oppCanon = canonicalTeamForStatsKey(opponent);
  const s = `${normalizedName}|${teamCanon}|${oppCanon}|${statType}|${line}`;
  return `${CACHE_PREFIX}:${Buffer.from(s, 'utf8').toString('base64url')}`;
}

function cacheKey(playerName: string, team: string, opponent: string, statType: string, line: number): string {
  return getAflPropStatsCacheKey(playerName, team, opponent, statType, line);
}

function getStatValue(game: Record<string, unknown>, statType: string): number | null {
  if (statType === 'disposals' || statType === 'disposals_over') {
    const v = game.disposals;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  if (statType === 'goals_over') {
    const v = game.goals;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return null;
}

/** Normalize opponent to official name (same as dashboard H2H so props page matches). */
function resolveOpponentForH2H(opp: string): string {
  const s = (opp ?? '').replace(/^vs\.?\s*/i, '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return opponentToOfficialTeamName(s) ?? rosterTeamToInjuryTeam(s) ?? s;
}

export function computeAflPropStatsFromGames(
  games: Record<string, unknown>[],
  statType: string,
  opponent: string,
  line: number
): Omit<AflPropStatsPayload, 'dvpRating' | 'dvpStatValue'> {
  const propOpponentOfficial = resolveOpponentForH2H(opponent);
  const gamesWithValue: { value: number; opponent: string }[] = [];
  for (const g of games) {
    const v = getStatValue(g, statType);
    const opp = (g.opponent as string) || '';
    if (v !== null) gamesWithValue.push({ value: v, opponent: opp });
  }
  // API returns games most-recent first (FootyWire table order). Use first N = last N games.
  const last5 = gamesWithValue.slice(0, 5).map((x) => x.value);
  const last10 = gamesWithValue.slice(0, 10).map((x) => x.value);
  const seasonValues = gamesWithValue.map((x) => x.value);
  // H2H: match by official name (same as dashboard) so "Kangaroos" / "North Melbourne" / "North Melbourne Kangaroos" all match, and we never match "Melbourne" when we want "North Melbourne"
  const h2hValues = gamesWithValue
    .filter((x) => {
      if (!propOpponentOfficial) return false;
      const rowOppOfficial = resolveOpponentForH2H(x.opponent);
      return rowOppOfficial !== '' && rowOppOfficial === propOpponentOfficial;
    })
    .slice(0, 6)
    .map((x) => x.value);
  const last5Avg = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length : null;
  const last10Avg = last10.length > 0 ? last10.reduce((a, b) => a + b, 0) / last10.length : null;
  const seasonAvg = seasonValues.length > 0 ? seasonValues.reduce((a, b) => a + b, 0) / seasonValues.length : null;
  const h2hAvg = h2hValues.length > 0 ? h2hValues.reduce((a, b) => a + b, 0) / h2hValues.length : null;
  let streak: number | null = null;
  if (Number.isFinite(line) && gamesWithValue.length > 0) {
    streak = 0;
    for (const x of gamesWithValue) {
      if (x.value > line) streak++;
      else break;
    }
  }
  const hit = (vals: number[]) => ({ hits: vals.filter((v) => v > line).length, total: vals.length });
  return {
    last5Avg,
    last10Avg,
    h2hAvg,
    seasonAvg,
    streak,
    last5HitRate: last5.length > 0 ? hit(last5) : null,
    last10HitRate: last10.length > 0 ? hit(last10) : null,
    h2hHitRate: h2hValues.length > 0 ? hit(h2hValues) : null,
    seasonHitRate: seasonValues.length > 0 ? hit(seasonValues) : null,
  };
}

async function fetchGameLogs(
  baseUrl: string,
  playerName: string,
  team: string,
  season: number,
  cronSecret?: string
): Promise<Record<string, unknown>[]> {
  const url = `${baseUrl}/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(playerName)}&team=${encodeURIComponent(team)}&include_both=1`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cronSecret) {
    headers['Authorization'] = `Bearer ${cronSecret}`;
    headers['x-cron-secret'] = cronSecret;
  }
  const r = await fetch(url, { cache: 'no-store', headers });
  if (!r.ok) return [];
  const data = (await r.json()) as { games?: unknown[] };
  return Array.isArray(data?.games) ? (data.games as Record<string, unknown>[]) : [];
}

export type AflPropStatsDebug = { fromCache: boolean; gamesCount: number };

/**
 * Get AFL prop stats from cache or compute. When cacheOnly is true, returns null on cache miss (no computation).
 * Pass cronSecret when called from props-stats/warm so player-game-logs will fetch from FootyWire instead of cache-only.
 * Pass resolvedPlayerTeam (player's actual team from league data) so we fetch game logs by that team first when it differs from game home/away.
 * If debugOut is provided, it is filled with { fromCache, gamesCount } for debugging N/A on the props page.
 */
export async function getAflPropStats(
  playerName: string,
  team: string,
  opponent: string,
  statType: string,
  line: number,
  baseUrl: string,
  dvpLookup?: { rank: number; value: number } | null,
  cacheOnly?: boolean,
  cronSecret?: string,
  resolvedPlayerTeam?: string,
  debugOut?: AflPropStatsDebug
): Promise<AflPropStatsPayload | null> {
  const key = cacheKey(playerName, team, opponent, statType, line);
  const cached = await sharedCache.getJSON<AflPropStatsPayload>(key);
  if (cached && typeof cached === 'object') {
    // Don't use cached entry when it has no stats (warm may have stored 0-game result). Treat as miss and recompute.
    const hasAnyStat = cached.last5Avg != null || cached.last10Avg != null || cached.seasonAvg != null;
    if (hasAnyStat) {
      if (debugOut) {
        debugOut.fromCache = true;
        debugOut.gamesCount = -1; // not stored in cache
      }
      if (dvpLookup != null && (cached.dvpRating == null || cached.dvpStatValue == null)) {
        return { ...cached, dvpRating: dvpLookup.rank, dvpStatValue: dvpLookup.value };
      }
      return cached;
    }
    // Cached but empty: fall through so list API will recompute in phase 2, or return null here if cacheOnly
    if (cacheOnly && debugOut) {
      debugOut.fromCache = true;
      debugOut.gamesCount = -1; // so debug shows "cached_but_empty" not "computed_0_games"
    }
  }
  if (cacheOnly) {
    if (debugOut && debugOut.gamesCount !== -1) {
      debugOut.fromCache = false;
      debugOut.gamesCount = 0;
    }
    return null;
  }
  const currentSeason = new Date().getFullYear();
  const prevSeason = currentSeason - 1;
  // Fetch both current and previous season so we have 2025 + 2026 stats (most recent first).
  const fetchForSeason = async (season: number): Promise<Record<string, unknown>[]> => {
    let list: Record<string, unknown>[] = [];
    if (resolvedPlayerTeam?.trim()) {
      list = await fetchGameLogs(baseUrl, playerName, resolvedPlayerTeam.trim(), season, cronSecret);
    }
    if (list.length === 0) list = await fetchGameLogs(baseUrl, playerName, team, season, cronSecret);
    if (list.length === 0) list = await fetchGameLogs(baseUrl, playerName, opponent, season, cronSecret);
    return list;
  };
  const [gamesCurrent, gamesPrev] = await Promise.all([
    fetchForSeason(currentSeason),
    fetchForSeason(prevSeason),
  ]);
  // Merge: current season first (most recent), then previous season so L5/L10/season use both years.
  const games = [...gamesCurrent, ...gamesPrev];
  if (debugOut) {
    debugOut.fromCache = false;
    debugOut.gamesCount = games.length;
  }
  const stats = computeAflPropStatsFromGames(games, statType, opponent, line);
  const payload: AflPropStatsPayload = {
    ...stats,
    dvpRating: dvpLookup?.rank ?? null,
    dvpStatValue: dvpLookup?.value ?? null,
  };
  // Don't cache empty stats (0 games) so we don't pollute Redis and next request can retry
  if (games.length > 0) {
    await sharedCache.setJSON(key, payload, CACHE_TTL_SECONDS);
    // Store under reverse key (playerName, opponent, team) so list API finds stats whether row has (home, away) or (away, home)
    const keyReverse = cacheKey(playerName, opponent, team, statType, line);
    if (keyReverse !== key) {
      await sharedCache.setJSON(keyReverse, payload, CACHE_TTL_SECONDS);
    }
  }
  return payload;
}

export function buildAflPropStatKey(playerName: string, team: string, opponent: string, statType: string, line: number): string {
  return `${playerName}|${statType}|${team}|${opponent}|${line}`;
}

/** Clear all AFL prop stats cache entries. Returns number of keys deleted. */
export async function clearAflPropStatsCache(): Promise<number> {
  return sharedCache.clearKeysByPrefix(CACHE_PREFIX);
}
