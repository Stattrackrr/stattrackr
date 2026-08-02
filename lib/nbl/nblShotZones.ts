/**
 * Map SportRadar full-court shot (x,y) percentages into NBA-style zones.
 *
 * SportRadar coords: x along length (0–100), y along width (0–100).
 * Baskets near (≈5.6, 50) and (≈94.4, 50). We flip to a half-court with the
 * rim on the left so zones are stable regardless of which way the team attacked.
 */

export type NblShotZoneId =
  | 'restricted'
  | 'paint'
  | 'midRange'
  | 'leftCorner3'
  | 'rightCorner3'
  | 'aboveBreak3';

/** Ordered like the NBA ShotChart distributions array. */
export const NBL_SHOT_ZONE_IDS: readonly NblShotZoneId[] = [
  'restricted',
  'paint',
  'midRange',
  'leftCorner3',
  'rightCorner3',
  'aboveBreak3',
] as const;

export const NBL_SHOT_ZONE_LABELS: Record<NblShotZoneId, string> = {
  restricted: 'Restricted',
  paint: 'Paint',
  midRange: 'Mid-Range',
  leftCorner3: 'Left Corner 3',
  rightCorner3: 'Right Corner 3',
  aboveBreak3: 'Above Break 3',
};

/** FIBA court metres. */
const COURT_LENGTH_M = 28;
const COURT_WIDTH_M = 15;
const RIM_FROM_BASELINE_M = 1.575;
const RESTRICTED_RADIUS_M = 1.25;
/** FIBA key / paint (slightly padded — SportRadar points sit just outside chalk). */
const PAINT_DEPTH_M = 6.2;
const PAINT_HALF_WIDTH_M = 2.7;

export type HalfCourtPoint = {
  x: number;
  y: number;
};

/**
 * Normalize to offense half with the rim on the left (small x).
 * When the attack is toward the right basket, flip X and Y so the
 * shooter's left/right corners stay consistent across ends.
 */
export function toOffenseHalfCourt(x: number, y: number): HalfCourtPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 50, y: 50 };
  if (x <= 50) return { x, y };
  return { x: 100 - x, y: 100 - y };
}

function pctToMetres(half: HalfCourtPoint): { xm: number; ym: number } {
  return {
    xm: (half.x / 100) * COURT_LENGTH_M,
    ym: (half.y / 100) * COURT_WIDTH_M,
  };
}

export function distanceFromRimMetres(half: HalfCourtPoint): number {
  const { xm, ym } = pctToMetres(half);
  const dx = xm - RIM_FROM_BASELINE_M;
  const dy = ym - COURT_WIDTH_M / 2;
  return Math.hypot(dx, dy);
}

function inPaint(half: HalfCourtPoint): boolean {
  const { xm, ym } = pctToMetres(half);
  const dy = Math.abs(ym - COURT_WIDTH_M / 2);
  return xm <= PAINT_DEPTH_M + 0.15 && dy <= PAINT_HALF_WIDTH_M + 0.15;
}

/**
 * Classify a shot. Prefer SportRadar `eventType` for 2pt vs 3pt when present.
 */
export function classifyNblShotZone(input: {
  x: number | null | undefined;
  y: number | null | undefined;
  eventType?: string | null;
  desc?: string | null;
}): NblShotZoneId | null {
  const x = input.x;
  const y = input.y;
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const half = toOffenseHalfCourt(x, y);
  const type = String(input.eventType || '').toLowerCase();
  const desc = String(input.desc || '').toLowerCase();
  const isThree = type === '3pt' || type.includes('3pt') || desc.includes('3pt');

  if (isThree) {
    // Corner pocket = near baseline on half-court.
    // NBA-style chart has rim at bottom: SVG-left ← low y, SVG-right ← high y
    // (half-court rim-left coords rotated so rim sits on the baseline).
    const nearBaseline = half.x <= 28;
    if (nearBaseline && half.y <= 18) return 'leftCorner3';
    if (nearBaseline && half.y >= 82) return 'rightCorner3';
    return 'aboveBreak3';
  }

  const dist = distanceFromRimMetres(half);
  if (dist <= RESTRICTED_RADIUS_M + 0.15) return 'restricted';
  if (inPaint(half)) return 'paint';
  return 'midRange';
}

export type NblZoneStat = {
  zone: NblShotZoneId;
  label: string;
  fga: number;
  fgm: number;
  fgPct: number;
  share: number;
};

export function emptyZoneStats(): NblZoneStat[] {
  return NBL_SHOT_ZONE_IDS.map((zone) => ({
    zone,
    label: NBL_SHOT_ZONE_LABELS[zone],
    fga: 0,
    fgm: 0,
    fgPct: 0,
    share: 0,
  }));
}

export function aggregateZoneStats(
  shots: Array<{ zone: NblShotZoneId | null; made: boolean }>
): NblZoneStat[] {
  const map = new Map<NblShotZoneId, { fga: number; fgm: number }>();
  for (const id of NBL_SHOT_ZONE_IDS) map.set(id, { fga: 0, fgm: 0 });

  for (const shot of shots) {
    if (!shot.zone) continue;
    const row = map.get(shot.zone);
    if (!row) continue;
    row.fga += 1;
    if (shot.made) row.fgm += 1;
  }

  const totalFga = [...map.values()].reduce((s, r) => s + r.fga, 0);
  return NBL_SHOT_ZONE_IDS.map((zone) => {
    const row = map.get(zone)!;
    return {
      zone,
      label: NBL_SHOT_ZONE_LABELS[zone],
      fga: row.fga,
      fgm: row.fgm,
      fgPct: row.fga > 0 ? (row.fgm / row.fga) * 100 : 0,
      share: totalFga > 0 ? (row.fga / totalFga) * 100 : 0,
    };
  });
}
