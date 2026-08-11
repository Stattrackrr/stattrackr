/**
 * NBL similar-players: find production peers and aggregate their games vs an opponent.
 * Bookmaker lines are reserved for a future odds feed (returned as null for now).
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_SHOT_CHART_SEASON_YEAR,
  resolveNblClubName,
  normalizeTeamKey,
} from '@/lib/nblTeamCanonical';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';
import type { NblGameLogRow, NblLeaguePlayerStatRow } from '@/lib/nbl/rosettaTypes';
import {
  NBL_SIMILAR_STAT_LABELS,
  type NblSimilarPlayerRow,
  type NblSimilarPlayersPayload,
  type NblSimilarStatKey,
} from '@/lib/nbl/similarPlayersShared';

export type {
  NblSimilarPlayerRow,
  NblSimilarPlayersPayload,
  NblSimilarStatKey,
} from '@/lib/nbl/similarPlayersShared';
export { NBL_SIMILAR_STAT_LABELS } from '@/lib/nbl/similarPlayersShared';

const STAT_FROM_LOG: Record<NblSimilarStatKey, (g: NblGameLogRow) => number | null> = {
  points: (g) => numOrNull(g.points),
  rebounds: (g) => numOrNull(g.rebounds),
  assists: (g) => numOrNull(g.assists),
  steals: (g) => numOrNull(g.steals),
  blocks: (g) => numOrNull(g.blocks),
  turnovers: (g) => numOrNull(g.turnovers),
  fouls: (g) => numOrNull(g.fouls),
  threeMade: (g) => numOrNull(g.threeMade),
  minutes: (g) => numOrNull(g.minutes),
  pra: (g) => {
    if (g.pra != null && Number.isFinite(Number(g.pra))) return Number(g.pra);
    const p = numOrNull(g.points) ?? 0;
    const r = numOrNull(g.rebounds) ?? 0;
    const a = numOrNull(g.assists) ?? 0;
    return p + r + a;
  },
  pr: (g) => {
    if (g.pr != null && Number.isFinite(Number(g.pr))) return Number(g.pr);
    return (numOrNull(g.points) ?? 0) + (numOrNull(g.rebounds) ?? 0);
  },
  pa: (g) => {
    if (g.pa != null && Number.isFinite(Number(g.pa))) return Number(g.pa);
    return (numOrNull(g.points) ?? 0) + (numOrNull(g.assists) ?? 0);
  },
  ra: (g) => {
    if (g.ra != null && Number.isFinite(Number(g.ra))) return Number(g.ra);
    return (numOrNull(g.rebounds) ?? 0) + (numOrNull(g.assists) ?? 0);
  },
};

const STAT_FROM_SEASON: Record<NblSimilarStatKey, (p: NblLeaguePlayerStatRow) => number | null> = {
  points: (p) => numOrNull(p.points),
  rebounds: (p) => numOrNull(p.rebounds),
  assists: (p) => numOrNull(p.assists),
  steals: (p) => numOrNull(p.steals),
  blocks: (p) => numOrNull(p.blocks),
  turnovers: (p) => numOrNull(p.turnovers),
  fouls: (p) => numOrNull(p.fouls),
  threeMade: (p) => numOrNull(p.threeMade),
  minutes: (p) => numOrNull(p.minutes),
  pra: (p) => {
    if (p.pra != null && Number.isFinite(Number(p.pra))) return Number(p.pra);
    return (numOrNull(p.points) ?? 0) + (numOrNull(p.rebounds) ?? 0) + (numOrNull(p.assists) ?? 0);
  },
  pr: (p) => (numOrNull(p.points) ?? 0) + (numOrNull(p.rebounds) ?? 0),
  pa: (p) => (numOrNull(p.points) ?? 0) + (numOrNull(p.assists) ?? 0),
  ra: (p) => (numOrNull(p.rebounds) ?? 0) + (numOrNull(p.assists) ?? 0),
};

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function normalizeNblSimilarStat(raw: string | null | undefined): NblSimilarStatKey {
  const key = String(raw || 'points').trim().toLowerCase();
  const aliases: Record<string, NblSimilarStatKey> = {
    pts: 'points',
    point: 'points',
    points: 'points',
    reb: 'rebounds',
    rebound: 'rebounds',
    rebounds: 'rebounds',
    ast: 'assists',
    assist: 'assists',
    assists: 'assists',
    stl: 'steals',
    steals: 'steals',
    blk: 'blocks',
    blocks: 'blocks',
    tov: 'turnovers',
    turnovers: 'turnovers',
    fouls: 'fouls',
    threes: 'threeMade',
    threemade: 'threeMade',
    '3pm': 'threeMade',
    pra: 'pra',
    pr: 'pr',
    pa: 'pa',
    ra: 'ra',
    minutes: 'minutes',
    mins: 'minutes',
    min: 'minutes',
  };
  return aliases[key] || (key in STAT_FROM_LOG ? (key as NblSimilarStatKey) : 'points');
}

function positionFamily(pos: string | null | undefined): string {
  const raw = String(pos || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!raw) return 'U';
  if (raw.includes('G') && raw.includes('F')) return 'G';
  if (raw.includes('F') && raw.includes('C')) return 'F';
  if (raw.startsWith('G')) return 'G';
  if (raw.startsWith('C')) return 'C';
  if (raw.startsWith('F')) return 'F';
  return raw[0] || 'U';
}

function loadLeaguePlayers(year: number): NblLeaguePlayerStatRow[] {
  const file = path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      players?: NblLeaguePlayerStatRow[];
    };
    return Array.isArray(data.players) ? data.players : [];
  } catch {
    return [];
  }
}

function loadPlayerGames(playerId: string, year: number): NblGameLogRow[] {
  const file = path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${playerId}-${year}.json`
  );
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { games?: NblGameLogRow[] };
    return Array.isArray(data.games) ? data.games : [];
  } catch {
    return [];
  }
}

function opponentMatches(
  game: NblGameLogRow,
  opponentCode: string | null,
  opponentName: string | null
): boolean {
  if (opponentCode) {
    const code = resolveNblSteTeamCode(game.opponentCode || game.opponent);
    if (code && code === opponentCode) return true;
  }
  if (opponentName) {
    const a = resolveNblClubName(game.opponent);
    const b = resolveNblClubName(opponentName);
    if (a && b && normalizeTeamKey(a) === normalizeTeamKey(b)) return true;
  }
  return false;
}

type FeatureKey = 'minutes' | 'points' | 'rebounds' | 'assists';

function featureVector(p: NblLeaguePlayerStatRow): Record<FeatureKey, number> {
  return {
    minutes: numOrNull(p.minutes) ?? 0,
    points: numOrNull(p.points) ?? 0,
    rebounds: numOrNull(p.rebounds) ?? 0,
    assists: numOrNull(p.assists) ?? 0,
  };
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (!values.length) return { mean: 0, std: 1 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length, 1);
  const std = Math.sqrt(variance) || 1;
  return { mean, std };
}

/**
 * Find similar players and how they performed vs the given opponent for `stat`.
 */
export function buildNblSimilarPlayers(options: {
  playerId: string;
  opponent: string;
  stat?: string;
  year?: number;
  limit?: number;
}): NblSimilarPlayersPayload {
  const year =
    options.year && Number.isFinite(options.year)
      ? Number(options.year)
      : NBL_SHOT_CHART_SEASON_YEAR;
  const stat = normalizeNblSimilarStat(options.stat);
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 12);
  const opponentCode = resolveNblSteTeamCode(options.opponent);
  const opponentName =
    resolveNblClubName(options.opponent) || String(options.opponent || '').trim() || null;

  const players = loadLeaguePlayers(year).filter((p) => (p.games ?? 0) >= 5);
  const target =
    players.find((p) => p.playerId === options.playerId) ||
    players.find(
      (p) => String(p.playerId).toLowerCase() === String(options.playerId).toLowerCase()
    ) ||
    null;

  const empty: NblSimilarPlayersPayload = {
    year,
    stat,
    statLabel: NBL_SIMILAR_STAT_LABELS[stat],
    player: target
      ? {
          playerId: target.playerId,
          name: target.name,
          team: target.team,
          position: target.position,
        }
      : null,
    opponent: { code: opponentCode, name: opponentName },
    similar: [],
  };

  if (!target || (!opponentCode && !opponentName)) return empty;

  const family = positionFamily(target.position);
  const pool = players.filter(
    (p) => p.playerId !== target.playerId && positionFamily(p.position) === family
  );
  if (!pool.length) return empty;

  const features: FeatureKey[] = ['minutes', 'points', 'rebounds', 'assists'];
  const norms = Object.fromEntries(
    features.map((f) => {
      const { mean, std } = meanStd(pool.concat(target).map((p) => featureVector(p)[f]));
      return [f, { mean, std }];
    })
  ) as Record<FeatureKey, { mean: number; std: number }>;

  const targetVec = featureVector(target);
  const selectedSeasonKey: FeatureKey =
    stat === 'points' || stat === 'rebounds' || stat === 'assists' || stat === 'minutes'
      ? stat
      : 'points';

  const scored = pool
    .map((p) => {
      const vec = featureVector(p);
      let dist = 0;
      for (const f of features) {
        const weight = f === selectedSeasonKey || f === 'minutes' ? 2 : 1;
        const zT = (targetVec[f] - norms[f].mean) / norms[f].std;
        const zP = (vec[f] - norms[f].mean) / norms[f].std;
        dist += weight * (zT - zP) ** 2;
      }
      const selT = STAT_FROM_SEASON[stat](target);
      const selP = STAT_FROM_SEASON[stat](p);
      if (selT != null && selP != null && Number.isFinite(selT) && Number.isFinite(selP)) {
        const scale = Math.max(Math.abs(selT), 1);
        dist += 2.5 * ((selT - selP) / scale) ** 2;
      }
      return { player: p, distance: Math.sqrt(dist) };
    })
    .sort((a, b) => a.distance - b.distance);

  type CandidateGame = NblSimilarPlayerRow & { distance: number };
  const byPlayerId = new Map<string, CandidateGame>();

  // One line per player for the season: closest peers who faced this opponent,
  // each shown once using their most recent game vs that team.
  for (const { player, distance } of scored) {
    if (byPlayerId.size >= limit) break;
    if (byPlayerId.has(player.playerId)) continue;

    const games = loadPlayerGames(player.playerId, year)
      .filter((g) => opponentMatches(g, opponentCode, opponentName))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const g = games[0];
    if (!g) continue;

    const matchId = String(g.matchId || '').trim();
    if (!matchId) continue;
    const mins = numOrNull(g.minutes);
    const value = STAT_FROM_LOG[stat](g);
    byPlayerId.set(player.playerId, {
      matchId,
      date: g.date,
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      teamCode: player.teamCode,
      position: player.position,
      imageUrl: player.imageUrl,
      similarity: round1(100 / (1 + distance)),
      minutes: mins != null ? Math.round(mins) : null,
      value: value != null ? Math.round(value * 10) / 10 : null,
      line: null,
      book: null,
      distance,
    });
  }

  const similar: NblSimilarPlayerRow[] = [...byPlayerId.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ distance: _distance, ...row }) => row);

  return { ...empty, similar };
}
