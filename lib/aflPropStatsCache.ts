/**
 * Server-side cache for AFL prop stats (L5, L10, H2H, Season, Streak, hit rates).
 * Used by /api/afl/props-stats/batch so the props page gets fast, cached stats.
 */

import { opponentToFootywireTeam, canonicalTeamForStatsKey } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import sharedCache from '@/lib/sharedCache';

const CACHE_PREFIX = 'afl_prop_stats_v1';
const CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours

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

export function computeAflPropStatsFromGames(
  games: Record<string, unknown>[],
  statType: string,
  opponent: string,
  line: number
): Omit<AflPropStatsPayload, 'dvpRating' | 'dvpStatValue'> {
  const propOpponentNorm = opponentToFootywireTeam(opponent) || opponent.replace(/^vs\s*/i, '').trim().toLowerCase();
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
  const h2hValues = gamesWithValue
    .filter((x) => {
      const oppNorm = opponentToFootywireTeam(x.opponent) || x.opponent.replace(/^vs\s*/i, '').trim().toLowerCase();
      return (
        oppNorm === propOpponentNorm ||
        (x.opponent && opponent.toLowerCase().includes(x.opponent.toLowerCase())) ||
        (opponent && x.opponent.toLowerCase().includes(opponent.toLowerCase()))
      );
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
  const url = `${baseUrl}/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(playerName)}&team=${encodeURIComponent(team)}`;
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

/**
 * Get AFL prop stats from cache or compute. When cacheOnly is true, returns null on cache miss (no computation).
 * Pass cronSecret when called from props-stats/warm so player-game-logs will fetch from FootyWire instead of cache-only.
 * Pass resolvedPlayerTeam (player's actual team from league data) so we fetch game logs by that team first when it differs from game home/away.
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
  resolvedPlayerTeam?: string
): Promise<AflPropStatsPayload | null> {
  const key = cacheKey(playerName, team, opponent, statType, line);
  const cached = await sharedCache.getJSON<AflPropStatsPayload>(key);
  if (cached && typeof cached === 'object') {
    if (dvpLookup != null && (cached.dvpRating == null || cached.dvpStatValue == null)) {
      return { ...cached, dvpRating: dvpLookup.rank, dvpStatValue: dvpLookup.value };
    }
    return cached;
  }
  if (cacheOnly) return null;
  const season = new Date().getFullYear();
  let games: Record<string, unknown>[] = [];
  if (resolvedPlayerTeam?.trim()) {
    games = await fetchGameLogs(baseUrl, playerName, resolvedPlayerTeam.trim(), season, cronSecret);
  }
  if (games.length === 0) games = await fetchGameLogs(baseUrl, playerName, team, season, cronSecret);
  if (games.length === 0) games = await fetchGameLogs(baseUrl, playerName, opponent, season, cronSecret);
  const stats = computeAflPropStatsFromGames(games, statType, opponent, line);
  const payload: AflPropStatsPayload = {
    ...stats,
    dvpRating: dvpLookup?.rank ?? null,
    dvpStatValue: dvpLookup?.value ?? null,
  };
  await sharedCache.setJSON(key, payload, CACHE_TTL_SECONDS);
  return payload;
}

export function buildAflPropStatKey(playerName: string, team: string, opponent: string, statType: string, line: number): string {
  return `${playerName}|${statType}|${team}|${opponent}|${line}`;
}

/** Clear all AFL prop stats cache entries. Returns number of keys deleted. */
export async function clearAflPropStatsCache(): Promise<number> {
  return sharedCache.clearKeysByPrefix(CACHE_PREFIX);
}
