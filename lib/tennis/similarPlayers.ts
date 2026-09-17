/**
 * Similar tennis players: production peers of the selected player,
 * shown with their most recent result vs the same opponent.
 */

import {
  TENNIS_SIMILAR_STAT_LABELS,
  type TennisSimilarPlayerRow,
  type TennisSimilarPlayersPayload,
  type TennisSimilarStatKey,
} from '@/lib/tennis/similarPlayersShared';
import {
  formatTennisSetScore,
  parseTennisSetsFromPlayerView,
  tennisLastName,
  tennisScoreIsRetired,
} from '@/lib/tennis/chartStats';
import { tennisHandForName, type TennisHand } from '@/lib/tennis/hands';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';
import {
  loadPlayerMatches,
  loadTennisMatches,
  loadTennisPlayers,
  tourForPlayer,
  type TennisMatchRow,
  type TennisPlayer,
  type TennisTour,
} from '@/lib/tennis/data';
import { loadTennisPlayersCached } from '@/lib/tennis/loadCached';
import { readTennisPlayerLogsCacheMany } from '@/lib/tennis/dashboardCache';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import { getHydratedTennisOverlay } from '@/lib/tennis/ingest';

export type {
  TennisSimilarPlayerRow,
  TennisSimilarPlayersPayload,
  TennisSimilarStatKey,
} from '@/lib/tennis/similarPlayersShared';
export { TENNIS_SIMILAR_STAT_LABELS } from '@/lib/tennis/similarPlayersShared';

const PROFILE_WINDOW = 15;
const MIN_PROFILE_MATCHES = 5;

const SIMILAR_STAT_KEYS = new Set<string>(Object.keys(TENNIS_SIMILAR_STAT_LABELS));

type FeatureKey = 'rank' | 'height' | 'winPct' | 'aces' | 'gamesWon' | 'firstServePct' | 'rpw';

type Profile = Record<FeatureKey, number | null>;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

export function normalizeTennisSimilarStat(raw: string | null | undefined): TennisSimilarStatKey {
  const key = String(raw || 'moneyline').trim();
  if (SIMILAR_STAT_KEYS.has(key)) return key as TennisSimilarStatKey;
  return 'moneyline';
}

function resolvePlayerIn(
  players: TennisPlayer[],
  name: string,
  preferredTour: TennisTour,
  playerId?: string | null
): TennisPlayer | null {
  const id = String(playerId || '').trim();
  const key = normName(name);
  if (id) {
    const byId = players.find((p) => p.playerId === id);
    if (
      byId &&
      (!key ||
        normName(byId.name) === key ||
        tennisIdentityMatch(byId.name, name))
    ) {
      return byId;
    }
  }
  if (!key) return null;
  const exactTour = players.find((p) => p.tour === preferredTour && normName(p.name) === key);
  if (exactTour) return exactTour;
  const exactAny = players.find((p) => normName(p.name) === key);
  if (exactAny) return exactAny;
  const identity = players.filter(
    (p) => p.tour === preferredTour && tennisIdentityMatch(p.name, name)
  );
  if (identity.length === 1) return identity[0];
  const last = tennisLastName(key).toLowerCase();
  if (last.length >= 3) {
    const lastHits = players.filter((p) => {
      const parts = normName(p.name).split(/\s+/);
      return parts[parts.length - 1] === last && p.tour === preferredTour;
    });
    const unique = [...new Map(lastHits.map((p) => [p.playerId, p])).values()];
    if (unique.length === 1) return unique[0];
  }
  return null;
}

function resolvePlayer(
  name: string,
  preferredTour: TennisTour,
  playerId?: string | null
): TennisPlayer | null {
  return resolvePlayerIn(loadTennisPlayers(), name, preferredTour, playerId);
}

function playerHand(player: TennisPlayer | null, name: string): TennisHand | null {
  return (player?.hand as TennisHand | null) || tennisHandForName(player?.name || name);
}

function isVsOpponent(row: TennisMatchRow, opponent: TennisPlayer): boolean {
  if (opponent.playerId && row.opponentId && row.opponentId === opponent.playerId) return true;
  if (normName(row.opponent) === normName(opponent.name)) return true;
  return tennisIdentityMatch(row.opponent, opponent.name);
}

function recentRows(rows: TennisMatchRow[], limit = PROFILE_WINDOW): TennisMatchRow[] {
  return [...rows]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .slice(-limit);
}

function buildProfile(
  rows: TennisMatchRow[],
  meta: { rank: number | null; height: number | null }
): Profile | null {
  const window = recentRows(rows);
  if (window.length < MIN_PROFILE_MATCHES) return null;
  const wins = window.filter((row) => row.isWin).length;
  const height =
    meta.height ??
    mean(window.map((row) => num(row.height)).filter((v): v is number => v != null));
  return {
    rank: meta.rank != null && meta.rank > 0 ? meta.rank : null,
    height,
    winPct: (wins / window.length) * 100,
    aces: mean(window.map((row) => num(row.aces)).filter((v): v is number => v != null)),
    gamesWon: mean(window.map((row) => num(row.gamesWon)).filter((v): v is number => v != null)),
    firstServePct: mean(
      window.map((row) => num(row.firstServePct)).filter((v): v is number => v != null)
    ),
    rpw: mean(window.map((row) => num(row.returnPointsWonPct)).filter((v): v is number => v != null)),
  };
}

function inRankBand(targetRank: number | null, candidateRank: number | null, sameHand: boolean): boolean {
  if (targetRank == null || candidateRank == null) return sameHand;
  if (!sameHand && targetRank >= 8 && candidateRank <= 5) return false;
  const span = sameHand ? 55 : 28;
  return Math.abs(candidateRank - targetRank) <= span;
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (!values.length) return { mean: 0, std: 1 };
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / Math.max(values.length, 1);
  return { mean: avg, std: Math.sqrt(variance) || 1 };
}

function formatScore(row: TennisMatchRow): string {
  const sets = parseTennisSetsFromPlayerView(row.score, row.isWin);
  const text = sets.map(formatTennisSetScore).join(' ');
  if (!text) return String(row.score || '—');
  return tennisScoreIsRetired(row.score) ? `${text} RET` : text;
}

function statValue(row: TennisMatchRow, stat: TennisSimilarStatKey): number | null {
  if (stat === 'moneyline') return row.isWin ? 1 : 0;
  return num((row as Record<string, unknown>)[stat]);
}

function slimSide(
  player: TennisPlayer | null,
  fallbackName: string
): TennisSimilarPlayersPayload['player'] {
  if (!player && !fallbackName) return null;
  return {
    playerId: player?.playerId ?? null,
    name: player?.name || fallbackName,
    ioc: player?.ioc ?? null,
    hand: playerHand(player, fallbackName),
    rank: player?.rank ?? null,
  };
}

export function buildTennisSimilarPlayers(opts: {
  playerName: string;
  opponentName: string;
  playerId?: string | null;
  opponentId?: string | null;
  tour?: TennisTour | null;
  stat?: string;
  limit?: number;
}): TennisSimilarPlayersPayload {
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const stat = normalizeTennisSimilarStat(opts.stat);
  const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 12);
  const preferredTour =
    opts.tour || tourForPlayer(opts.playerId || null, playerName) || 'ATP';

  const player = resolvePlayer(playerName, preferredTour, opts.playerId);
  const opponent = resolvePlayer(
    opponentName,
    player?.tour || preferredTour,
    opts.opponentId
  );
  const tour = player?.tour || opponent?.tour || preferredTour;

  const empty: TennisSimilarPlayersPayload = {
    stat,
    statLabel: TENNIS_SIMILAR_STAT_LABELS[stat],
    player: slimSide(player, playerName),
    opponent: opponent
      ? { playerId: opponent.playerId, name: opponent.name, ioc: opponent.ioc }
      : opponentName
        ? { playerId: null, name: opponentName, ioc: null }
        : null,
    similar: [],
  };

  if (!player || !opponent || player.playerId === opponent.playerId) return empty;

  const all = loadTennisMatches().filter((row) => row.tour === tour);
  const targetRows = loadPlayerMatches({
    playerId: player.playerId,
    playerName: player.name,
    tour,
  });
  const targetProfile = buildProfile(targetRows, { rank: player.rank, height: player.height });
  if (!targetProfile) return empty;

  const targetHand = playerHand(player, player.name);
  const playersById = new Map(
    loadTennisPlayers()
      .filter((p) => p.tour === tour)
      .map((p) => [p.playerId, p])
  );

  type VsBundle = { player: TennisPlayer; games: TennisMatchRow[] };
  const vsByPlayer = new Map<string, VsBundle>();
  for (const row of all) {
    if (row.playerId === player.playerId) continue;
    if (!isVsOpponent(row, opponent)) continue;
    const meta = playersById.get(row.playerId);
    if (!meta) continue;
    const existing = vsByPlayer.get(row.playerId);
    if (existing) existing.games.push(row);
    else vsByPlayer.set(row.playerId, { player: meta, games: [row] });
  }
  if (!vsByPlayer.size) return empty;

  const candidates = [...vsByPlayer.values()]
    .map((bundle) => {
      const hand = playerHand(bundle.player, bundle.player.name);
      if (!inRankBand(player.rank, bundle.player.rank, !!(targetHand && hand && targetHand === hand))) {
        return null;
      }
      const rows = loadPlayerMatches({
        playerId: bundle.player.playerId,
        playerName: bundle.player.name,
        tour,
      });
      const profile = buildProfile(rows, { rank: bundle.player.rank, height: bundle.player.height });
      return profile ? { ...bundle, profile, hand } : null;
    })
    .filter((row): row is VsBundle & { profile: Profile; hand: TennisHand | null } => !!row);
  if (!candidates.length) return empty;

  const features: FeatureKey[] = [
    'rank',
    'height',
    'winPct',
    'aces',
    'gamesWon',
    'firstServePct',
    'rpw',
  ];
  const pool = [targetProfile, ...candidates.map((row) => row.profile)];
  const norms = Object.fromEntries(
    features.map((key) => {
      const values = pool.map((p) => p[key]).filter((v): v is number => v != null);
      return [key, meanStd(values)];
    })
  ) as Record<FeatureKey, { mean: number; std: number }>;

  const weights: Record<FeatureKey, number> = {
    rank: 1.8,
    height: 1.1,
    winPct: 1.15,
    aces: 2.4,
    gamesWon: 1.15,
    firstServePct: 1.5,
    rpw: 1.2,
  };

  const scored = candidates
    .map((bundle) => {
      let dist = 0;
      for (const key of features) {
        const a = targetProfile[key];
        const b = bundle.profile[key];
        if (a == null || b == null) continue;
        const zT = (a - norms[key].mean) / norms[key].std;
        const zP = (b - norms[key].mean) / norms[key].std;
        dist += weights[key] * (zT - zP) ** 2;
      }
      if (targetHand && bundle.hand && targetHand !== bundle.hand) dist += 2.4;
      const winGap =
        targetProfile.winPct != null && bundle.profile.winPct != null
          ? Math.abs(targetProfile.winPct - bundle.profile.winPct)
          : 0;
      if (winGap > 16) dist += ((winGap - 16) / 8) ** 2;
      return { ...bundle, distance: Math.sqrt(dist) };
    })
    .sort((a, b) => a.distance - b.distance);

  const similar: TennisSimilarPlayerRow[] = scored.slice(0, limit).map((bundle) => {
    const games = [...bundle.games].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || ''))
    );
    const latest = games[games.length - 1];
    const wins = games.filter((g) => g.isWin).length;
    return {
      matchId: latest.matchId,
      date: latest.date,
      playerId: bundle.player.playerId,
      name: bundle.player.name,
      ioc: bundle.player.ioc,
      imageUrl: clientTennisHeadshotUrl(bundle.player.playerId, bundle.player.imageUrl),
      hand: playerHand(bundle.player, bundle.player.name),
      rank: bundle.player.rank,
      similarity: round1(100 / (1 + bundle.distance)),
      isWin: latest.isWin,
      score: formatScore(latest),
      surface: latest.surface || null,
      h2hWins: wins,
      h2hLosses: games.length - wins,
      value: statValue(latest, stat),
      stats: {
        aces: num(latest.aces),
        opponentAces: num(latest.opponentAces),
        totalGames: num(latest.totalGames),
        gamesWon: num(latest.gamesWon),
        gamesLost: num(latest.gamesLost),
        totalSets: num(latest.totalSets),
        doubleFaults: num(latest.doubleFaults),
        firstServePct: num(latest.firstServePct),
        dominanceRatio: num(latest.dominanceRatio),
        breakPointsConverted: num(latest.breakPointsConverted),
        returnPointsWonPct: num(latest.returnPointsWonPct),
      },
    };
  });

  return { ...empty, similar };
}

const MAX_REDIS_SIMILAR_CANDIDATES = 28;

function overlaySimilarFallback(
  payload: TennisSimilarPlayersPayload,
  opts: {
    playerName: string;
    opponentName: string;
    playerId?: string | null;
    opponentId?: string | null;
    tour?: TennisTour | null;
    stat?: string;
    limit?: number;
  }
): TennisSimilarPlayersPayload {
  if (payload.similar.length) return payload;
  if (!getHydratedTennisOverlay()?.matches?.length) return payload;
  const overlay = buildTennisSimilarPlayers(opts);
  return overlay.similar.length ? overlay : payload;
}

export async function buildTennisSimilarPlayersAsync(opts: {
  playerName: string;
  opponentName: string;
  playerId?: string | null;
  opponentId?: string | null;
  tour?: TennisTour | null;
  stat?: string;
  limit?: number;
}): Promise<TennisSimilarPlayersPayload> {
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const stat = normalizeTennisSimilarStat(opts.stat);
  const limit = Math.min(Math.max(Number(opts.limit) || 8, 1), 12);
  const players = await loadTennisPlayersCached();
  const preferredTour =
    opts.tour ||
    players.find((p) => p.playerId === String(opts.playerId || '').trim())?.tour ||
    'ATP';
  const player = resolvePlayerIn(players, playerName, preferredTour, opts.playerId);
  const opponent = resolvePlayerIn(
    players,
    opponentName,
    player?.tour || preferredTour,
    opts.opponentId
  );
  const tour = player?.tour || opponent?.tour || preferredTour;
  const empty: TennisSimilarPlayersPayload = {
    stat,
    statLabel: TENNIS_SIMILAR_STAT_LABELS[stat],
    player: slimSide(player, playerName),
    opponent: opponent
      ? { playerId: opponent.playerId, name: opponent.name, ioc: opponent.ioc }
      : opponentName
        ? { playerId: null, name: opponentName, ioc: null }
        : null,
    similar: [],
  };
  if (!player || !opponent || player.playerId === opponent.playerId) {
    return overlaySimilarFallback(empty, opts);
  }

  const seedLogs = await readTennisPlayerLogsCacheMany([opponent.playerId, player.playerId]);
  const opponentLogs = seedLogs.get(opponent.playerId) || [];
  const candidateIds = new Set<string>();
  for (const row of opponentLogs) {
    const id = String(row.opponentId || '').trim();
    if (id && id !== player.playerId) candidateIds.add(id);
  }
  const playersById = new Map(players.filter((p) => p.tour === tour).map((p) => [p.playerId, p]));
  const targetHand = playerHand(player, player.name);
  const rankedCandidates = [...candidateIds]
    .map((id) => playersById.get(id))
    .filter((meta): meta is TennisPlayer => Boolean(meta))
    .filter((meta) =>
      inRankBand(player.rank, meta.rank, !!(targetHand && playerHand(meta, meta.name) === targetHand))
    )
    .sort(
      (a, b) =>
        Math.abs((a.rank ?? 999) - (player.rank ?? 999)) -
        Math.abs((b.rank ?? 999) - (player.rank ?? 999))
    )
    .slice(0, MAX_REDIS_SIMILAR_CANDIDATES);

  const logsById = await readTennisPlayerLogsCacheMany([
    player.playerId,
    ...rankedCandidates.map((row) => row.playerId),
  ]);
  const targetRows = logsById.get(player.playerId) || seedLogs.get(player.playerId) || [];
  const targetProfile = buildProfile(targetRows, { rank: player.rank, height: player.height });
  if (!targetProfile) return overlaySimilarFallback(empty, opts);

  type VsBundle = { player: TennisPlayer; games: TennisMatchRow[] };
  const vsByPlayer = new Map<string, VsBundle>();
  for (const meta of rankedCandidates) {
    const rows = logsById.get(meta.playerId) || [];
    const games = rows.filter((row) => isVsOpponent(row, opponent));
    if (!games.length) continue;
    vsByPlayer.set(meta.playerId, { player: meta, games });
  }
  if (!vsByPlayer.size) return overlaySimilarFallback(empty, opts);

  const candidates = [...vsByPlayer.values()]
    .map((bundle) => {
      const hand = playerHand(bundle.player, bundle.player.name);
      if (!inRankBand(player.rank, bundle.player.rank, !!(targetHand && hand && targetHand === hand))) {
        return null;
      }
      const rows = logsById.get(bundle.player.playerId) || bundle.games;
      const profile = buildProfile(rows, { rank: bundle.player.rank, height: bundle.player.height });
      return profile ? { ...bundle, profile, hand } : null;
    })
    .filter((row): row is VsBundle & { profile: Profile; hand: TennisHand | null } => !!row);
  if (!candidates.length) return overlaySimilarFallback(empty, opts);

  const features: FeatureKey[] = [
    'rank',
    'height',
    'winPct',
    'aces',
    'gamesWon',
    'firstServePct',
    'rpw',
  ];
  const pool = [targetProfile, ...candidates.map((row) => row.profile)];
  const norms = Object.fromEntries(
    features.map((key) => {
      const values = pool.map((p) => p[key]).filter((v): v is number => v != null);
      return [key, meanStd(values)];
    })
  ) as Record<FeatureKey, { mean: number; std: number }>;
  const weights: Record<FeatureKey, number> = {
    rank: 1.8,
    height: 1.1,
    winPct: 1.15,
    aces: 2.4,
    gamesWon: 1.15,
    firstServePct: 1.5,
    rpw: 1.2,
  };
  const scored = candidates
    .map((bundle) => {
      let dist = 0;
      for (const key of features) {
        const a = targetProfile[key];
        const b = bundle.profile[key];
        if (a == null || b == null) continue;
        const zT = (a - norms[key].mean) / norms[key].std;
        const zP = (b - norms[key].mean) / norms[key].std;
        dist += weights[key] * (zT - zP) ** 2;
      }
      if (targetHand && bundle.hand && targetHand !== bundle.hand) dist += 2.4;
      const winGap =
        targetProfile.winPct != null && bundle.profile.winPct != null
          ? Math.abs(targetProfile.winPct - bundle.profile.winPct)
          : 0;
      if (winGap > 16) dist += ((winGap - 16) / 8) ** 2;
      return { ...bundle, distance: Math.sqrt(dist) };
    })
    .sort((a, b) => a.distance - b.distance);

  const similar: TennisSimilarPlayerRow[] = scored.slice(0, limit).map((bundle) => {
    const games = [...bundle.games].sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || ''))
    );
    const latest = games[games.length - 1];
    const wins = games.filter((g) => g.isWin).length;
    return {
      matchId: latest.matchId,
      date: latest.date,
      playerId: bundle.player.playerId,
      name: bundle.player.name,
      ioc: bundle.player.ioc,
      imageUrl: clientTennisHeadshotUrl(bundle.player.playerId, bundle.player.imageUrl),
      hand: playerHand(bundle.player, bundle.player.name),
      rank: bundle.player.rank,
      similarity: round1(100 / (1 + bundle.distance)),
      isWin: latest.isWin,
      score: formatScore(latest),
      surface: latest.surface || null,
      h2hWins: wins,
      h2hLosses: games.length - wins,
      value: statValue(latest, stat),
      stats: {
        aces: num(latest.aces),
        opponentAces: num(latest.opponentAces),
        totalGames: num(latest.totalGames),
        gamesWon: num(latest.gamesWon),
        gamesLost: num(latest.gamesLost),
        totalSets: num(latest.totalSets),
        doubleFaults: num(latest.doubleFaults),
        firstServePct: num(latest.firstServePct),
        dominanceRatio: num(latest.dominanceRatio),
        breakPointsConverted: num(latest.breakPointsConverted),
        returnPointsWonPct: num(latest.returnPointsWonPct),
      },
    };
  });

  return overlaySimilarFallback({ ...empty, similar }, opts);
}
