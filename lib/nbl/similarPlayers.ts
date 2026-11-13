/**
 * NBL similar-players: find production peers and their games vs an opponent.
 * Only peers with a logged Aussie-book prop line for the selected game/stat are returned.
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
import { lookupNblSimilarPlayerLines } from '@/lib/nbl/similarPlayerLines';
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

function similarProduction(target: NblLeaguePlayerStatRow, peer: NblLeaguePlayerStatRow): boolean {
  const tMin = numOrNull(target.minutes) ?? 0;
  const pMin = numOrNull(peer.minutes) ?? 0;
  if (tMin >= 18 && pMin < Math.max(15, tMin * 0.65)) return false;
  const tPts = numOrNull(target.points) ?? 0;
  const pPts = numOrNull(peer.points) ?? 0;
  if (tPts >= 12 && pPts < tPts * 0.55) return false;
  const tAst = numOrNull(target.assists) ?? 0;
  const pAst = numOrNull(peer.assists) ?? 0;
  if (tAst >= 4 && pAst < tAst * 0.4) return false;
  return true;
}

function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = resolveNblClubName(String(a || ''));
  const cb = resolveNblClubName(String(b || ''));
  if (ca && cb) return normalizeTeamKey(ca) === normalizeTeamKey(cb);
  return normalizeTeamKey(String(a || '')) === normalizeTeamKey(String(b || ''));
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
 * Only returns peers whose selected vs-opponent game has a logged prop line.
 */
export async function buildNblSimilarPlayers(options: {
  playerId: string;
  opponent: string;
  stat?: string;
  year?: number;
  years?: number[];
  limit?: number;
}): Promise<NblSimilarPlayersPayload> {
  const year =
    options.year && Number.isFinite(options.year)
      ? Number(options.year)
      : NBL_SHOT_CHART_SEASON_YEAR;
  const years =
    options.years?.filter((y) => Number.isFinite(y)) ??
    [year, year - 1].filter((y) => Number.isFinite(y));
  const [season, ...older] = years.length ? years : [year];
  const stat = normalizeNblSimilarStat(options.stat);
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 12);
  const opponentCode = resolveNblSteTeamCode(options.opponent);
  const opponentName =
    resolveNblClubName(options.opponent) || String(options.opponent || '').trim() || null;

  const players = loadLeaguePlayers(season!);
  const target =
    players.find((p) => p.playerId === options.playerId) ||
    players.find(
      (p) => String(p.playerId).toLowerCase() === String(options.playerId).toLowerCase()
    ) ||
    null;

  const empty: NblSimilarPlayersPayload = {
    year: season!,
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
    (p) =>
      p.playerId !== target.playerId &&
      (p.games ?? 0) >= 1 &&
      positionFamily(p.position) === family &&
      !sameTeam(p.team, target.team) &&
      similarProduction(target, p)
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

  /** Recent vs-opponent games so we can prefer one that has a logged line. */
  const GAME_CANDIDATES = 4;
  type PeerGames = {
    player: (typeof scored)[number]['player'];
    distance: number;
    games: NblGameLogRow[];
  };
  const peers: PeerGames[] = [];
  for (const { player, distance } of scored.slice(0, Math.max(limit * 6, 24))) {
    const logs = [season!, ...older].flatMap((y) => loadPlayerGames(player.playerId, y));
    const games = logs
      .filter((g) => opponentMatches(g, opponentCode, opponentName))
      .filter((g) => (numOrNull(g.minutes) ?? 0) >= 8)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, GAME_CANDIDATES);
    if (!games.length) continue;
    peers.push({ player, distance, games });
  }

  const lineKey = (matchId: string, playerId: string) => `${matchId}|${playerId}|${stat}`;
  const toLineKeys = (rows: Array<{ player: PeerGames['player']; games: NblGameLogRow[] }>) =>
    rows.flatMap(({ player, games }) =>
      games.map((g) => ({
        playerId: player.playerId,
        matchId: String(g.matchId || '').trim(),
        stat,
        playerName: player.name,
        date: g.date,
        team: g.team || player.team,
        opponent: g.opponent,
        isHome: Boolean(g.isHome),
      }))
    );

  const lines = await lookupNblSimilarPlayerLines(
    toLineKeys(peers.map((p) => ({ player: p.player, games: p.games.slice(0, 1) })))
  );
  const needMore = peers.filter(
    (p) => !lines.has(lineKey(String(p.games[0]!.matchId || '').trim(), p.player.playerId))
  );
  if (needMore.length) {
    const extra = await lookupNblSimilarPlayerLines(
      toLineKeys(needMore.map((p) => ({ player: p.player, games: p.games.slice(1) })))
    );
    for (const [k, v] of extra) lines.set(k, v);
  }

  const out: Array<NblSimilarPlayerRow & { distance: number }> = [];
  for (const { player, distance, games } of peers) {
    if (out.length >= limit) break;
    const g = games.find((game) =>
      lines.has(lineKey(String(game.matchId || '').trim(), player.playerId))
    );
    if (!g) continue;
    const matchId = String(g.matchId || '').trim();
    const hit = lines.get(lineKey(matchId, player.playerId))!;
    const value = STAT_FROM_LOG[stat](g);
    out.push({
      matchId,
      date: g.date,
      playerId: player.playerId,
      name: player.name,
      team: g.team || player.team,
      teamCode: g.teamCode || player.teamCode,
      position: player.position,
      imageUrl: player.imageUrl,
      similarity: round1(100 / (1 + distance)),
      minutes: g.minutes != null ? Math.round(g.minutes) : null,
      value: value != null ? round1(value) : null,
      line: hit.line,
      book: hit.book,
      distance,
    });
  }

  return {
    ...empty,
    similar: out
      .sort((a, b) => a.distance - b.distance)
      .map(({ distance: _d, ...row }) => row),
  };
}
