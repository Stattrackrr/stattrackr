/**
 * League-wide NBA dashboard cards built from the cached season dataset:
 * similar players, team usage (scoring-mix pie), player ratings.
 */
import { normalizeTeamKey, resolveNbaClub, resolveNbaClubName } from './teams';
import { getNbaSeasonDataset, type NbaSeasonDataset } from './season';
import { resolveNbaSteTeamCode } from './teamSteStatsShared';
import type { NbaGameLogRow, NbaLeaguePlayerStatRow } from './types';
import {
  NBA_SIMILAR_STAT_LABELS,
  type NbaSimilarPlayerRow,
  type NbaSimilarPlayersPayload,
  type NbaSimilarStatKey,
} from './similarPlayersShared';

const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};
const num = (v: unknown): number => numOrNull(v) ?? 0;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Similar players
// ---------------------------------------------------------------------------

const STAT_FROM_LOG: Record<NbaSimilarStatKey, (g: NbaGameLogRow) => number | null> = {
  points: (g) => numOrNull(g.points),
  rebounds: (g) => numOrNull(g.rebounds),
  assists: (g) => numOrNull(g.assists),
  steals: (g) => numOrNull(g.steals),
  blocks: (g) => numOrNull(g.blocks),
  turnovers: (g) => numOrNull(g.turnovers),
  fouls: (g) => numOrNull(g.fouls),
  threeMade: (g) => numOrNull(g.threeMade),
  minutes: (g) => numOrNull(g.minutes),
  pra: (g) => numOrNull(g.pra),
  pr: (g) => numOrNull(g.pr),
  pa: (g) => numOrNull(g.pa),
  ra: (g) => numOrNull(g.ra),
};

const STAT_FROM_SEASON: Record<NbaSimilarStatKey, (p: NbaLeaguePlayerStatRow) => number | null> = {
  points: (p) => numOrNull(p.points),
  rebounds: (p) => numOrNull(p.rebounds),
  assists: (p) => numOrNull(p.assists),
  steals: (p) => numOrNull(p.steals),
  blocks: (p) => numOrNull(p.blocks),
  turnovers: (p) => numOrNull(p.turnovers),
  fouls: (p) => numOrNull(p.fouls),
  threeMade: (p) => numOrNull(p.threeMade),
  minutes: (p) => numOrNull(p.minutes),
  pra: (p) => numOrNull(p.pra),
  pr: (p) => num(p.points) + num(p.rebounds),
  pa: (p) => num(p.points) + num(p.assists),
  ra: (p) => num(p.rebounds) + num(p.assists),
};

export function normalizeNbaSimilarStat(raw: string | null | undefined): NbaSimilarStatKey {
  const key = String(raw || 'points').trim().toLowerCase();
  const aliases: Record<string, NbaSimilarStatKey> = {
    pts: 'points', point: 'points', points: 'points',
    reb: 'rebounds', rebound: 'rebounds', rebounds: 'rebounds',
    ast: 'assists', assist: 'assists', assists: 'assists',
    stl: 'steals', steals: 'steals', blk: 'blocks', blocks: 'blocks',
    tov: 'turnovers', to: 'turnovers', turnovers: 'turnovers', fouls: 'fouls', pf: 'fouls',
    threes: 'threeMade', threemade: 'threeMade', '3pm': 'threeMade', fg3m: 'threeMade',
    pra: 'pra', pr: 'pr', pa: 'pa', ra: 'ra', minutes: 'minutes', mins: 'minutes', min: 'minutes',
  };
  return aliases[key] || (key in STAT_FROM_LOG ? (key as NbaSimilarStatKey) : 'points');
}

function positionFamily(pos: string | null | undefined): string {
  const raw = String(pos || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!raw) return 'U';
  if (raw.includes('G') && raw.includes('F')) return 'G';
  if (raw.includes('F') && raw.includes('C')) return 'F';
  return raw[0] || 'U';
}

function similarProduction(t: NbaLeaguePlayerStatRow, p: NbaLeaguePlayerStatRow): boolean {
  const tMin = num(t.minutes), pMin = num(p.minutes);
  if (tMin >= 18 && pMin < Math.max(15, tMin * 0.65)) return false;
  const tPts = num(t.points), pPts = num(p.points);
  if (tPts >= 12 && pPts < tPts * 0.55) return false;
  const tAst = num(t.assists), pAst = num(p.assists);
  if (tAst >= 4 && pAst < tAst * 0.4) return false;
  return true;
}

type FeatureKey = 'minutes' | 'points' | 'rebounds' | 'assists';
const FEATURES: FeatureKey[] = ['minutes', 'points', 'rebounds', 'assists'];

function meanStd(values: number[]) {
  if (!values.length) return { mean: 0, std: 1 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

export async function buildNbaSimilarPlayers(options: {
  playerId: string;
  opponent: string;
  stat?: string;
  years: number[];
  limit?: number;
}): Promise<NbaSimilarPlayersPayload> {
  const [season, ...older] = options.years;
  const stat = normalizeNbaSimilarStat(options.stat);
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 12);
  const opponentCode = resolveNbaSteTeamCode(options.opponent);
  const opponentName = resolveNbaClubName(options.opponent) || String(options.opponent || '').trim() || null;
  const data = await getNbaSeasonDataset(season!);
  const olderSets = await Promise.all(older.map((y) => getNbaSeasonDataset(y)));
  const players = data.league;
  const target = players.find((p) => p.playerId === options.playerId) ?? null;

  const empty: NbaSimilarPlayersPayload = {
    year: season!,
    stat,
    statLabel: NBA_SIMILAR_STAT_LABELS[stat],
    player: target
      ? { playerId: target.playerId, name: target.name, team: target.team, position: target.position }
      : null,
    opponent: { code: opponentCode, name: opponentName },
    similar: [],
  };
  if (!target || !opponentCode) return empty;

  const family = positionFamily(target.position);
  const pool = players.filter(
    (p) =>
      p.playerId !== target.playerId &&
      p.games >= 5 &&
      positionFamily(p.position) === family &&
      p.teamCode !== target.teamCode &&
      p.teamCode !== opponentCode &&
      similarProduction(target, p)
  );
  if (!pool.length) return empty;

  const vec = (p: NbaLeaguePlayerStatRow): Record<FeatureKey, number> => ({
    minutes: num(p.minutes), points: num(p.points), rebounds: num(p.rebounds), assists: num(p.assists),
  });
  const norms = Object.fromEntries(
    FEATURES.map((f) => [f, meanStd(pool.concat(target).map((p) => vec(p)[f]))])
  ) as Record<FeatureKey, { mean: number; std: number }>;
  const targetVec = vec(target);
  const selectedKey: FeatureKey = (FEATURES as string[]).includes(stat) ? (stat as FeatureKey) : 'points';

  const scored = pool
    .map((p) => {
      const v = vec(p);
      let dist = 0;
      for (const f of FEATURES) {
        const w = f === selectedKey || f === 'minutes' ? 2 : 1;
        dist += w * (((targetVec[f] - norms[f].mean) - (v[f] - norms[f].mean)) / norms[f].std) ** 2;
      }
      const selT = STAT_FROM_SEASON[stat](target);
      const selP = STAT_FROM_SEASON[stat](p);
      if (selT != null && selP != null) dist += 2.5 * ((selT - selP) / Math.max(Math.abs(selT), 1)) ** 2;
      return { player: p, distance: Math.sqrt(dist) };
    })
    .sort((a, b) => a.distance - b.distance);

  const out: Array<NbaSimilarPlayerRow & { distance: number }> = [];
  for (const { player, distance } of scored.slice(0, Math.max(limit * 3, 20))) {
    if (out.length >= limit) break;
    const logs = [data, ...olderSets].flatMap((d) => d.logsByPlayer.get(player.playerId) ?? []);
    const g = logs
      .filter((x) => x.opponentCode === opponentCode && (numOrNull(x.minutes) ?? 0) >= 8)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
    if (!g) continue;
    const value = STAT_FROM_LOG[stat](g);
    out.push({
      matchId: g.matchId,
      date: g.date,
      playerId: player.playerId,
      name: player.name,
      team: g.team,
      teamCode: g.teamCode,
      position: player.position,
      imageUrl: player.imageUrl,
      similarity: round1(100 / (1 + distance)),
      minutes: g.minutes != null ? Math.round(g.minutes) : null,
      value: value != null ? round1(value) : null,
      line: null,
      book: null,
      distance,
    });
  }
  return {
    ...empty,
    similar: out.sort((a, b) => a.distance - b.distance).map(({ distance: _d, ...row }) => row),
  };
}

// ---------------------------------------------------------------------------
// Team usage (scoring-mix pie)
// ---------------------------------------------------------------------------

export type NbaTeamUsagePlayer = {
  playerId: string;
  name: string;
  usgPct: number;
  minutes: number;
  games: number;
  stats: Record<string, number>;
};

const MIN_GAME_MINUTES = 5;
const MIN_AVG_MINUTES = 8;
const RATE_STATS = new Set(['usgPct', 'tsPct', 'trebPct', 'orebPct', 'drebPct', 'pace', 'fgPct', 'threePct', 'twoPct', 'ftPct']);
const RATIO_FROM_TOTALS = new Set(['ptsPerPoss', 'astPerPoss']);

export const NBA_TEAM_PIE_STAT_KEYS = [
  'usgPct', 'possUsed', 'ptsPerPoss', 'astPerPoss', 'tsPct', 'trebPct', 'orebPct', 'drebPct', 'pace',
  'points', 'rebounds', 'assists', 'pra', 'pr', 'pa', 'ra', 'minutes',
  'threeMade', 'threeAttempted', 'threePct', 'fgMade', 'fgAttempted', 'fgPct',
  'twoMade', 'twoAttempted', 'twoPct', 'ftMade', 'ftAttempted', 'ftPct',
  'steals', 'blocks', 'offensiveRebounds', 'defensiveRebounds', 'turnovers', 'fouls', 'efficiency',
  'stocks', 'potentialRebounds', 'touches', 'passes', 'secondaryAssists', 'deflections',
  'pointsPaint', 'pointsFastBreak', 'pointsSecondChance',
] as const;

const possUsed = (g: NbaGameLogRow) => num(g.fgAttempted) + 0.44 * num(g.ftAttempted) + num(g.turnovers);

function readStat(g: NbaGameLogRow, key: string): number | null {
  if (key === 'possUsed') return possUsed(g);
  const raw = (g as unknown as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function aggregateNbaTeamUsageStats(games: NbaGameLogRow[]) {
  const sum: Record<string, number> = {};
  const weight: Record<string, number> = {};
  const count: Record<string, number> = {};
  let minuteSum = 0;
  let n = 0;
  for (const g of games) {
    const mp = num(g.minutes);
    if (mp < MIN_GAME_MINUTES) continue;
    minuteSum += mp;
    n += 1;
    for (const key of NBA_TEAM_PIE_STAT_KEYS) {
      if (RATIO_FROM_TOTALS.has(key)) continue;
      const val = readStat(g, key);
      if (val == null) continue;
      if (RATE_STATS.has(key)) {
        sum[key] = (sum[key] || 0) + val * mp;
        weight[key] = (weight[key] || 0) + mp;
      } else {
        sum[key] = (sum[key] || 0) + val;
        count[key] = (count[key] || 0) + 1;
      }
    }
  }
  if (n <= 0 || minuteSum <= 0) return null;
  const stats: Record<string, number> = {};
  for (const key of NBA_TEAM_PIE_STAT_KEYS) {
    if (RATIO_FROM_TOTALS.has(key)) continue;
    if (RATE_STATS.has(key)) {
      if (weight[key]) stats[key] = round1(sum[key]! / weight[key]!);
    } else if (count[key]) {
      stats[key] = round1(sum[key]! / count[key]!);
    }
  }
  const poss = sum.possUsed || 0;
  if (poss > 0) {
    stats.ptsPerPoss = round2((sum.points || 0) / poss);
    stats.astPerPoss = round2((sum.assists || 0) / poss);
  }
  return { minutes: round1(minuteSum / n), games: n, stats };
}

function applyLastN(games: NbaGameLogRow[], lastN: number | null) {
  return lastN != null && lastN > 0 ? games.slice(-lastN) : games;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export async function loadNbaTeamUsage(opts: {
  team: string;
  year: number;
  lastN?: number | null;
  includePlayerId?: string | null;
  teammatePlayerId?: string | null;
  teammateName?: string | null;
  teammateMode?: 'with' | 'without' | null;
}): Promise<{ players: NbaTeamUsagePlayer[]; sampleGames: number | null }> {
  const club = resolveNbaClub(opts.team);
  if (!club) return { players: [], sampleGames: null };
  const data = await getNbaSeasonDataset(opts.year);

  const teamLogs = (id: string) =>
    (data.logsByPlayer.get(id) ?? []).filter((g) => g.teamCode === club.code && !g.postseason);
  const rosterIds = [...data.players.values()]
    .filter((p) => String(p.currentTeamId) === club.id && p.active)
    .map((p) => p.playerId);
  // Fall back to who played for the club this season (traded players, stale rosters).
  const ids = new Set(rosterIds.filter((id) => teamLogs(id).length > 0));
  if (ids.size < 5) {
    for (const [id, logs] of data.logsByPlayer) if (logs.some((g) => g.teamCode === club.code)) ids.add(id);
  }

  const includePlayerId = String(opts.includePlayerId || '').trim();
  const teammateId =
    String(opts.teammatePlayerId || '').trim() ||
    (opts.teammateName
      ? [...data.players.values()].find((p) => normName(p.name) === normName(opts.teammateName!))?.playerId ?? ''
      : '');
  const mode = opts.teammateMode ?? null;
  const useFilter = Boolean(teammateId && mode && teammateId !== includePlayerId);

  const toPlayer = (id: string, agg: NonNullable<ReturnType<typeof aggregateNbaTeamUsageStats>>): NbaTeamUsagePlayer => ({
    playerId: id,
    name: data.players.get(id)?.name ?? id,
    usgPct: agg.stats.usgPct ?? 0,
    minutes: agg.minutes,
    games: agg.games,
    stats: agg.stats,
  });

  const baseline: NbaTeamUsagePlayer[] = [];
  for (const id of ids) {
    const agg = aggregateNbaTeamUsageStats(applyLastN(teamLogs(id), opts.lastN ?? null));
    if (!agg) continue;
    if (includePlayerId !== id && agg.minutes < MIN_AVG_MINUTES) continue;
    baseline.push(toPlayer(id, agg));
  }
  baseline.sort((a, b) => (b.stats.usgPct ?? 0) - (a.stats.usgPct ?? 0));
  if (!useFilter) return { players: baseline, sampleGames: null };

  const teammateGames = new Set(teamLogs(teammateId).map((g) => g.matchId));
  const focus = includePlayerId ? applyLastN(teamLogs(includePlayerId), opts.lastN ?? null) : [];
  const matched = focus.filter((g) => (mode === 'with') === teammateGames.has(g.matchId));
  const sampleGames = includePlayerId ? matched.length : teammateGames.size;
  const focusKeys = includePlayerId ? new Set(matched.map((g) => g.matchId)) : teammateGames;
  if (sampleGames <= 0) {
    return { players: baseline.map((p) => ({ ...p, usgPct: 0, minutes: 0, games: 0, stats: {} })), sampleGames: 0 };
  }
  const filtered = baseline.map((p) => {
    const games = teamLogs(p.playerId).filter((g) => {
      const inFocus = focusKeys.has(g.matchId);
      return includePlayerId ? inFocus : mode === 'with' ? inFocus : !inFocus;
    });
    const agg = aggregateNbaTeamUsageStats(games);
    return agg ? toPlayer(p.playerId, agg) : { ...p, usgPct: 0, minutes: 0, games: 0, stats: {} };
  });
  return { players: filtered.sort((a, b) => (b.stats.usgPct ?? 0) - (a.stats.usgPct ?? 0)), sampleGames };
}

// ---------------------------------------------------------------------------
// Player ratings (on-court ORtg / DRtg, minutes-weighted)
// ---------------------------------------------------------------------------

export async function loadNbaPlayerRatings(year: number) {
  const data: NbaSeasonDataset = await getNbaSeasonDataset(year);
  const players = [];
  for (const [id, logs] of data.logsByPlayer) {
    let mins = 0, off = 0, offW = 0, def = 0, defW = 0, games = 0;
    for (const g of logs) {
      const mp = num(g.minutes);
      if (mp < MIN_GAME_MINUTES) continue;
      games += 1;
      mins += mp;
      if (g.offRtg != null) { off += g.offRtg * mp; offW += mp; }
      if (g.defRtg != null) { def += g.defRtg * mp; defW += mp; }
    }
    if (!games) continue;
    const last = logs[logs.length - 1]!;
    players.push({
      playerId: id,
      name: data.players.get(id)?.name ?? id,
      team: last.team,
      games,
      minutes: round1(mins / games),
      offRtg: offW > 0 ? round1(off / offW) : null,
      defRtg: defW > 0 ? round1(def / defW) : null,
    });
  }
  return { year, generatedAt: new Date().toISOString(), players };
}

export function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = resolveNbaClubName(a);
  const cb = resolveNbaClubName(b);
  if (ca && cb) return normalizeTeamKey(ca) === normalizeTeamKey(cb);
  return normalizeTeamKey(a) === normalizeTeamKey(b);
}
