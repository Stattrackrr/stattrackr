/**
 * Props-page NBL DVP. Cache only.
 *
 *   3PT shooters  → player's main 3PT zone vs opponent zone defense rank
 *   Primary / 2nd BH → play-type matrix rank (same cell as the dashboard)
 *   Interior      → shot-chart restricted/paint (player's main rim zone)
 *   Stretch       → 3PT zone for PTS/3PM (spacing identity); paint for REB
 *   Slasher       → restricted/paint (rim attacks; slasher matrix is a leftover bucket)
 */

import {
  loadPlayerShotChartForApi,
  loadTeamDefenseShotChartForApi,
} from '@/lib/nbl/nblShotChartData';
import type { NblShotZoneId, NblZoneStat } from '@/lib/nbl/nblShotZones';
import {
  buildNblPlayTypesPayload,
  lookupNblPlayerPlayType,
  normalizeNblPlayTypeStat,
  parseNblPlayTypeStat,
  type NblPlayTypeCell,
  type NblPlayTypeId,
  type NblPlayTypeStatKey,
} from '@/lib/nbl/playTypes';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';

export type NblPropDvp = {
  dvpRating: number | null;
  dvpStatValue: number | null;
  dvpFieldSize: number | null;
};

const THREE_ZONES: readonly NblShotZoneId[] = ['leftCorner3', 'rightCorner3', 'aboveBreak3'];
const INTERIOR_ZONES: readonly NblShotZoneId[] = ['restricted', 'paint'];
const EMPTY: NblPropDvp = { dvpRating: null, dvpStatValue: null, dvpFieldSize: null };

export type NblPropDvpIndex = {
  typeByPlayerId: Map<string, NblPlayTypeId>;
  typeByName: Map<string, NblPlayTypeId>;
  matrix: Record<NblPlayTypeStatKey, ReturnType<typeof buildNblPlayTypesPayload>>;
};

export function buildNblPropDvpIndex(): NblPropDvpIndex {
  const points = buildNblPlayTypesPayload({ stat: 'points' });
  const assists = buildNblPlayTypesPayload({ stat: 'assists' });
  const rebounds = buildNblPlayTypesPayload({ stat: 'rebounds' });
  const typeByPlayerId = new Map<string, NblPlayTypeId>();
  const typeByName = new Map<string, NblPlayTypeId>();
  for (const row of points.players) {
    typeByPlayerId.set(row.playerId, row.type);
    typeByName.set(row.name.toLowerCase(), row.type);
  }
  return {
    typeByPlayerId,
    typeByName,
    matrix: { points, assists, rebounds },
  };
}

function playTypeOf(
  index: NblPropDvpIndex,
  playerId: string | null | undefined,
  playerName: string | null | undefined
): NblPlayTypeId | null {
  const id = String(playerId || '').trim();
  if (id && index.typeByPlayerId.has(id)) return index.typeByPlayerId.get(id)!;
  const name = String(playerName || '').trim().toLowerCase();
  if (name && index.typeByName.has(name)) return index.typeByName.get(name)!;
  return lookupNblPlayerPlayType({ playerId, playerName });
}

function matrixCell(
  index: NblPropDvpIndex,
  type: NblPlayTypeId,
  opponent: string,
  stat: NblPlayTypeStatKey
): NblPlayTypeCell | null {
  const code = resolveNblSteTeamCode(opponent);
  if (!code) return null;
  const row = index.matrix[stat].rows.find((r) => r.type === type);
  const cell = row?.cells[code];
  if (!cell || cell.rank == null || cell.rank <= 0) return null;
  return cell;
}

function fromMatrix(cell: NblPlayTypeCell): NblPropDvp {
  return {
    dvpRating: cell.rank,
    dvpStatValue: cell.allowed,
    dvpFieldSize: cell.fieldSize || 10,
  };
}

function mainZone(
  zones: NblZoneStat[] | undefined,
  candidates: readonly NblShotZoneId[],
  minFga = 1
): NblShotZoneId | null {
  const rows = (zones || []).filter((z) => candidates.includes(z.zone) && z.fga >= minFga);
  if (!rows.length) return null;
  rows.sort((a, b) => b.fga - a.fga || b.share - a.share);
  return rows[0].zone;
}

function fromShotChart(playerName: string, opponent: string, zones: readonly NblShotZoneId[]): NblPropDvp {
  const player = loadPlayerShotChartForApi(playerName);
  const zone = mainZone(player?.zones, zones);
  if (!zone) return EMPTY;
  const defense = loadTeamDefenseShotChartForApi(opponent);
  const ranked = defense?.ranks?.find((row) => row.zone === zone);
  if (!ranked || ranked.rank == null || ranked.rank <= 0) return EMPTY;
  return {
    dvpRating: ranked.rank,
    dvpStatValue: Number.isFinite(ranked.fgPct) ? Math.round(ranked.fgPct * 10) / 10 : null,
    dvpFieldSize: ranked.teamsCompared || 10,
  };
}

function sourceFor(
  type: NblPlayTypeId | null,
  stat: string
): 'matrix' | 'three' | 'interior' | 'none' {
  const key = String(stat || '').toLowerCase();
  if (key === 'threemade' || key === 'threes' || key === '3pm') return 'three';

  if (type === 'primary_bh' || type === 'secondary_bh') {
    return parseNblPlayTypeStat(stat) ? 'matrix' : 'none';
  }
  if (type === 'three_shooter') {
    if (key === 'rebounds') return 'matrix';
    if (key === 'assists') return 'matrix';
    return 'three';
  }
  if (type === 'stretch_four') {
    if (key === 'rebounds') return 'interior';
    if (key === 'assists') return 'matrix';
    return 'three';
  }
  if (type === 'post_up' || type === 'slasher') {
    if (key === 'assists') return 'matrix';
    return 'interior';
  }
  if (key === 'points') return 'three';
  if (key === 'rebounds') return 'interior';
  return 'none';
}

export function lookupNblPropDvp(
  index: NblPropDvpIndex,
  opts: {
    playerId?: string | null;
    playerName: string;
    opponent: string;
    stat: string;
  }
): NblPropDvp {
  const type = playTypeOf(index, opts.playerId, opts.playerName);
  const source = sourceFor(type, opts.stat);
  if (source === 'none') return EMPTY;

  if (source === 'matrix') {
    const matrixStat = parseNblPlayTypeStat(opts.stat);
    if (type && matrixStat) {
      const cell = matrixCell(index, type, opts.opponent, matrixStat);
      if (cell) return fromMatrix(cell);
    }
    // 3PT / stretch / slasher assists with no matrix cell stay blank.
    if (opts.stat !== 'points' && opts.stat !== 'rebounds') return EMPTY;
    if (type === 'three_shooter' || type === 'stretch_four') {
      return fromShotChart(opts.playerName, opts.opponent, THREE_ZONES);
    }
    return fromShotChart(opts.playerName, opts.opponent, INTERIOR_ZONES);
  }

  if (source === 'three') {
    const hit = fromShotChart(opts.playerName, opts.opponent, THREE_ZONES);
    if (hit.dvpRating != null) return hit;
    if (opts.stat === 'threeMade') {
      if (type) {
        const cell = matrixCell(index, type, opts.opponent, 'points');
        if (cell) return fromMatrix(cell);
      }
      return EMPTY;
    }
    const rim = fromShotChart(opts.playerName, opts.opponent, INTERIOR_ZONES);
    if (rim.dvpRating != null) return rim;
    const matrixStat = normalizeNblPlayTypeStat(opts.stat);
    if (type) {
      const cell = matrixCell(index, type, opts.opponent, matrixStat);
      if (cell) return fromMatrix(cell);
    }
    return EMPTY;
  }

  const hit = fromShotChart(opts.playerName, opts.opponent, INTERIOR_ZONES);
  if (hit.dvpRating != null) return hit;
  const matrixStat = parseNblPlayTypeStat(opts.stat);
  if (type && matrixStat) {
    const cell = matrixCell(index, type, opts.opponent, matrixStat);
    if (cell) return fromMatrix(cell);
  }
  return EMPTY;
}
