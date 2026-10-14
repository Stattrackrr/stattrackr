/**
 * NBA dashboard shot zones (client + server). Zones are classified at sync time
 * (`lib/nba/shotZones.ts`); this maps them onto the chart's zone ids and holds
 * the half-court geometry (feet) the heat map draws.
 */

export type NbaShotZoneId =
  | 'restricted'
  | 'paint'
  | 'midRange'
  | 'leftCorner3'
  | 'rightCorner3'
  | 'aboveBreak3';

/** Ordered like the NBA ShotChart distributions array. */
export const NBA_SHOT_ZONE_IDS: readonly NbaShotZoneId[] = [
  'restricted',
  'paint',
  'midRange',
  'leftCorner3',
  'rightCorner3',
  'aboveBreak3',
] as const;

export const NBA_SHOT_ZONE_LABELS: Record<NbaShotZoneId, string> = {
  restricted: 'Restricted',
  paint: 'Paint',
  midRange: 'Mid-Range',
  leftCorner3: 'Left Corner 3',
  rightCorner3: 'Right Corner 3',
  aboveBreak3: 'Above Break 3',
};

const DB_ZONE_TO_ID: Record<string, NbaShotZoneId> = {
  restricted: 'restricted',
  paint: 'paint',
  mid_range: 'midRange',
  left_corner_3: 'leftCorner3',
  right_corner_3: 'rightCorner3',
  above_break_3: 'aboveBreak3',
};

/** `nba_shots.zone` → chart zone id (backcourt heaves are left out). */
export function nbaZoneFromDb(zone: string | null | undefined): NbaShotZoneId | null {
  return zone ? DB_ZONE_TO_ID[zone] ?? null : null;
}

export function nbaZoneIsThree(zone: NbaShotZoneId): boolean {
  return zone === 'leftCorner3' || zone === 'rightCorner3' || zone === 'aboveBreak3';
}

/** NBA half court in feet: 50 ft wide, rim centre 5.25 ft off the baseline. */
export const NBA_COURT = {
  widthFt: 50,
  rimFromBaselineFt: 5.25,
} as const;

/** BDL rim sits at y ≈ 1, so feet from the baseline = y + 4.25. */
const BDL_RIM_Y = 1;

/** Shot spot for the heat map: `across` 0–50 ft (left corner side first), `depth` ft from the baseline. */
export function nbaShotCourtFeet(x: number, y: number): { across: number; depth: number } {
  return { across: x, depth: y - BDL_RIM_Y + NBA_COURT.rimFromBaselineFt };
}

export type NbaZoneStat = {
  zone: NbaShotZoneId;
  label: string;
  fga: number;
  fgm: number;
  fgPct: number;
  share: number;
};

export function emptyZoneStats(): NbaZoneStat[] {
  return NBA_SHOT_ZONE_IDS.map((zone) => ({
    zone,
    label: NBA_SHOT_ZONE_LABELS[zone],
    fga: 0,
    fgm: 0,
    fgPct: 0,
    share: 0,
  }));
}

/** Zone rows from [fga, fgm] counts. */
export function zoneStatsFromCounts(counts: Partial<Record<NbaShotZoneId, readonly [number, number]>>): NbaZoneStat[] {
  const totalFga = NBA_SHOT_ZONE_IDS.reduce((s, id) => s + (counts[id]?.[0] ?? 0), 0);
  return NBA_SHOT_ZONE_IDS.map((zone) => {
    const [fga, fgm] = counts[zone] ?? [0, 0];
    return {
      zone,
      label: NBA_SHOT_ZONE_LABELS[zone],
      fga,
      fgm,
      fgPct: fga > 0 ? (fgm / fga) * 100 : 0,
      share: totalFga > 0 ? (fga / totalFga) * 100 : 0,
    };
  });
}

export function aggregateZoneStats(
  shots: Array<{ zone: NbaShotZoneId | null; made: boolean }>
): NbaZoneStat[] {
  const counts: Partial<Record<NbaShotZoneId, [number, number]>> = {};
  for (const shot of shots) {
    if (!shot.zone) continue;
    const row = (counts[shot.zone] ??= [0, 0]);
    row[0] += 1;
    if (shot.made) row[1] += 1;
  }
  return zoneStatsFromCounts(counts);
}
