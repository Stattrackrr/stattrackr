/**
 * Server-side cache for AFL prop stats (L5, L10, H2H, Season, Streak, hit rates).
 * Used by /api/afl/props-stats/batch so the props page gets fast, cached stats.
 * We only set entries when we have computed stats; never overwrite with empty (24h TTL).
 */

import {
  opponentToFootywireTeam,
  opponentToOfficialTeamName,
  rosterTeamToInjuryTeam,
  canonicalTeamForStatsKey,
  toOfficialAflTeamDisplayName,
} from '@/lib/aflTeamMapping';
import { footyinfoAbbrevToOfficial } from '@/lib/afl/footyinfoTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';
import { aflGamesIncludeSeason, resolveAflGameSeason } from '@/lib/aflGameDedupe';
import sharedCache from '@/lib/sharedCache';

// Bump schema version when stats computation inputs change (e.g. season-scoped streak/L5).
// v8: H2H uses dashboard opponent matching and the matchup team that actually appears in logs
// (fixes N/A when the list defaulted to awayTeam / the player's own side).
const CACHE_PREFIX = 'afl_prop_stats_v8';
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

function toStatNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getStatValue(game: Record<string, unknown>, statType: string): number | null {
  if (statType === 'disposals' || statType === 'disposals_over') {
    return toStatNumber(game.disposals);
  }
  if (statType === 'goals_over') {
    return toStatNumber(game.goals);
  }
  return null;
}

function gameOpponentName(game: Record<string, unknown>): string {
  const raw =
    game.opponent ?? game.opp ?? game.opposition ?? game.opp_abbrev ?? game.opponentName ?? '';
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'name' in (raw as { name?: unknown })) {
    return String((raw as { name?: unknown }).name ?? '');
  }
  return String(raw ?? '');
}

/** Same resolution as AflStatsChart H2H so "Swans" / "SYD" / "Sydney Swans" match. */
function resolveOpponentForH2H(opp: string): string {
  const s = (opp ?? '').replace(/^vs\.?\s*/i, '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return (
    opponentToOfficialTeamName(s) ||
    rosterTeamToInjuryTeam(s) ||
    footyinfoAbbrevToOfficial(s) ||
    toOfficialAflTeamDisplayName(s) ||
    s
  );
}

function opponentsMatchForH2H(rowOpponent: string, targetOpponent: string): boolean {
  const target = (targetOpponent ?? '').trim();
  const row = (rowOpponent ?? '').trim();
  if (!target || !row) return false;
  if (row.toLowerCase() === target.toLowerCase()) return true;
  const rowOfficial = resolveOpponentForH2H(row);
  const targetOfficial = resolveOpponentForH2H(target);
  if (rowOfficial && targetOfficial && rowOfficial === targetOfficial) return true;
  const rowNick = opponentToFootywireTeam(rowOfficial || row);
  const targetNick = opponentToFootywireTeam(targetOfficial || target);
  return Boolean(rowNick && targetNick && rowNick.toLowerCase() === targetNick.toLowerCase());
}

/**
 * List API passes (homeTeam, awayTeam) as (team, opponent). H2H must use the player's
 * upcoming opponent, not always awayTeam (wrong when the player is away).
 */
function resolveMatchupOpponentForH2H(
  team: string,
  opponent: string,
  resolvedPlayerTeam?: string
): string {
  if (!resolvedPlayerTeam?.trim()) return opponent;
  const player = toOfficialAflTeamDisplayName(resolvedPlayerTeam.trim());
  const teamA = toOfficialAflTeamDisplayName((team ?? '').trim());
  const teamB = toOfficialAflTeamDisplayName((opponent ?? '').trim());
  if (player && teamA && player === teamA) return teamB || opponent;
  if (player && teamB && player === teamB) return teamA || team;
  return opponent;
}

/** Form stats the props page paints (LS / L10 / Season). H2H can still be missing. */
export function aflPropStatsHaveForm(payload: AflPropStatsPayload | null | undefined): boolean {
  if (!payload) return false;
  return payload.last5Avg != null || payload.seasonAvg != null;
}

function cachedStatsAreUsable(cached: AflPropStatsPayload): boolean {
  return aflPropStatsHaveForm(cached);
}

export function computeAflPropStatsFromGames(
  games: Record<string, unknown>[],
  statType: string,
  opponent: string,
  line: number,
  targetSeason?: number,
  alternateOpponent?: string
): Omit<AflPropStatsPayload, 'dvpRating' | 'dvpStatValue'> {
  const gamesWithValue: { value: number; opponent: string; season: number | null }[] = [];
  for (const g of games) {
    const v = getStatValue(g, statType);
    const opp = gameOpponentName(g);
    const season = resolveAflGameSeason(g);
    if (v !== null) gamesWithValue.push({ value: v, opponent: opp, season });
  }
  // Form stats (L5/L10/Season/Streak) use the target season only so 2025 rows never bleed into 2026.
  // H2H keeps the full history across seasons for deeper opponent matchups.
  const formGames =
    targetSeason != null
      ? gamesWithValue.filter((x) => x.season === targetSeason)
      : gamesWithValue;
  // API returns games most-recent first (FootyWire table order). Use first N = last N games.
  const last5 = formGames.slice(0, 5).map((x) => x.value);
  const last10 = formGames.slice(0, 10).map((x) => x.value);
  const seasonValues = formGames.map((x) => x.value);
  const h2hValuesFor = (target: string): number[] => {
    const official = resolveOpponentForH2H(target);
    if (!target.trim() && !official) return [];
    return gamesWithValue
      .filter(
        (x) =>
          opponentsMatchForH2H(x.opponent, target) ||
          (official ? opponentsMatchForH2H(x.opponent, official) : false)
      )
      .map((x) => x.value);
  };
  // Prefer the resolved upcoming opponent. If that side never appears in logs (often the
  // player's own team when the list defaulted to awayTeam), use the other matchup team.
  let h2hSource = h2hValuesFor(opponent);
  if (h2hSource.length === 0 && alternateOpponent?.trim()) {
    const alternate = h2hValuesFor(alternateOpponent);
    if (alternate.length > 0) h2hSource = alternate;
  }
  const h2hValues = h2hSource.slice(0, 6);
  const last5Avg = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length : null;
  const last10Avg = last10.length > 0 ? last10.reduce((a, b) => a + b, 0) / last10.length : null;
  const seasonAvg = seasonValues.length > 0 ? seasonValues.reduce((a, b) => a + b, 0) / seasonValues.length : null;
  const h2hAvg = h2hValues.length > 0 ? h2hValues.reduce((a, b) => a + b, 0) / h2hValues.length : null;
  let streak: number | null = null;
  if (Number.isFinite(line) && formGames.length > 0) {
    streak = 0;
    for (const x of formGames) {
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
    h2hHitRate: hit(h2hValues),
    seasonHitRate: seasonValues.length > 0 ? hit(seasonValues) : null,
  };
}

async function fetchGameLogs(
  baseUrl: string,
  playerName: string,
  team: string,
  season: number,
  cronSecret?: string,
  extraQuery = ''
): Promise<Record<string, unknown>[]> {
  const url = `${baseUrl}/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(playerName)}&team=${encodeURIComponent(team)}&include_both=1${extraQuery}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cronSecret) {
    headers['Authorization'] = `Bearer ${cronSecret}`;
    headers['x-cron-secret'] = cronSecret;
  }
  const r = await fetch(url, { cache: 'no-store', headers });
  if (!r.ok) return [];
  const data = (await r.json()) as { games?: unknown[]; season?: number };
  let games = Array.isArray(data?.games) ? (data.games as Record<string, unknown>[]) : [];
  const responseSeason =
    typeof data?.season === 'number' && Number.isFinite(data.season) ? data.season : season;
  if (games.length > 0) {
    games = games.map((g) => {
      const resolved = resolveAflGameSeason(g);
      return resolved != null ? g : { ...g, season: responseSeason };
    });
  }
  const currentYear = new Date().getFullYear();
  const looksLikeStale2025Fallback =
    season === currentYear &&
    !aflGamesIncludeSeason(games, season) &&
    games.length > 0 &&
    (data.season === season - 1 || aflGamesIncludeSeason(games, season - 1));
  if (looksLikeStale2025Fallback) games = [];
  return games;
}

async function fetchGameLogsForSeason(
  baseUrl: string,
  playerName: string,
  team: string,
  season: number,
  cronSecret?: string
): Promise<Record<string, unknown>[]> {
  const currentYear = new Date().getFullYear();
  const warmCurrentSeason = season === currentYear && !!cronSecret;
  const initialQuery = warmCurrentSeason ? '&strict_season=1&force_fetch=1' : '';
  let games = await fetchGameLogs(baseUrl, playerName, team, season, cronSecret, initialQuery);
  if (season === currentYear && !aflGamesIncludeSeason(games, season)) {
    // Cron force-fetch often 403s from GitHub/Vercel IPs. Keep last warmed season logs.
    const cached = await fetchGameLogs(baseUrl, playerName, team, season, cronSecret, '&strict_season=1');
    if (aflGamesIncludeSeason(cached, season) || cached.length > games.length) games = cached;
    if (!aflGamesIncludeSeason(games, season) && cronSecret) {
      const retry = await fetchGameLogs(
        baseUrl,
        playerName,
        team,
        season,
        cronSecret,
        '&strict_season=1&force_fetch=1'
      );
      if (aflGamesIncludeSeason(retry, season)) games = retry;
    }
  }
  return games;
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
    // Prefer last5/season so the props page can paint even if H2H is still warming.
    if (cachedStatsAreUsable(cached)) {
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
  const olderSeason = currentSeason - 2;
  // Fetch current + previous two seasons (e.g. 2026/2025/2024) for better H2H depth.
  const fetchForSeason = async (season: number): Promise<Record<string, unknown>[]> => {
    const tryFetch = async (teamForRequest: string) =>
      fetchGameLogsForSeason(baseUrl, playerName, teamForRequest, season, cronSecret);
    let list: Record<string, unknown>[] = [];
    if (resolvedPlayerTeam?.trim()) list = await tryFetch(resolvedPlayerTeam.trim());
    if (list.length === 0 && team.trim()) list = await tryFetch(team);
    if (list.length === 0 && opponent.trim()) list = await tryFetch(opponent);
    // Last resort: omit team so API resolves from league stats (moved players / wrong matchup row).
    if (list.length === 0) list = await tryFetch('');
    return list;
  };
  const [gamesCurrent, gamesPrev, gamesOlder] = await Promise.all([
    fetchForSeason(currentSeason),
    fetchForSeason(prevSeason),
    fetchForSeason(olderSeason),
  ]);
  // Merge newest to oldest so L5/L10 still use recent form, with 2024 available for deeper H2H.
  const games = [...gamesCurrent, ...gamesPrev, ...gamesOlder];
  if (debugOut) {
    debugOut.fromCache = false;
    debugOut.gamesCount = games.length;
  }
  const matchupOpponent = resolveMatchupOpponentForH2H(team, opponent, resolvedPlayerTeam);
  const otherMatchupTeam = opponentsMatchForH2H(matchupOpponent, opponent) ? team : opponent;
  const stats = computeAflPropStatsFromGames(
    games,
    statType,
    matchupOpponent,
    line,
    currentSeason,
    otherMatchupTeam
  );
  const payload: AflPropStatsPayload = {
    ...stats,
    dvpRating: dvpLookup?.rank ?? null,
    dvpStatValue: dvpLookup?.value ?? null,
  };
  // Don't cache empty stats (0 games) so we don't pollute Redis and next request can retry.
  // For the current season, require at least one row tagged as that year so stale 2025-only
  // payloads are not persisted as 2026 season averages.
  const hasCurrentSeasonGames = aflGamesIncludeSeason(games, currentSeason);
  if (aflPropStatsHaveForm(payload) && (hasCurrentSeasonGames || !cached)) {
    await sharedCache.setJSON(key, payload, CACHE_TTL_SECONDS);
    // Store under reverse key (playerName, opponent, team) so list API finds stats whether row has (home, away) or (away, home)
    const keyReverse = cacheKey(playerName, opponent, team, statType, line);
    if (keyReverse !== key) {
      await sharedCache.setJSON(keyReverse, payload, CACHE_TTL_SECONDS);
    }
  } else if (cached && aflPropStatsHaveForm(cached) && !aflPropStatsHaveForm(payload)) {
    // Live logs failed; keep last good form stats instead of returning all-N/A.
    return dvpLookup != null && (cached.dvpRating == null || cached.dvpStatValue == null)
      ? { ...cached, dvpRating: dvpLookup.rank, dvpStatValue: dvpLookup.value }
      : cached;
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
