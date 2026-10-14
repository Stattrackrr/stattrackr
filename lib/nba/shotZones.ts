/**
 * BallDontLie play-by-play shot coordinates are feet on a half court:
 * x runs sideline to sideline (0-50, rim at 25) and y runs away from the rim
 * (rim at about y = 1, so the baseline sits near y = -4.25).
 */

export const NBA_RIM_X = 25;
export const NBA_RIM_Y = 1;
const BASELINE_TO_RIM_FT = 5.25;

export type NbaShotZone =
  | 'restricted'
  | 'paint'
  | 'mid_range'
  | 'left_corner_3'
  | 'right_corner_3'
  | 'above_break_3'
  | 'backcourt';

export const NBA_SHOT_ZONE_LABELS: Record<NbaShotZone, string> = {
  restricted: 'Restricted Area',
  paint: 'In The Paint (Non-RA)',
  mid_range: 'Mid-Range',
  left_corner_3: 'Left Corner 3',
  right_corner_3: 'Right Corner 3',
  above_break_3: 'Above the Break 3',
  backcourt: 'Backcourt',
};

export function nbaShotDistanceFt(x: number, y: number): number {
  return Math.hypot(x - NBA_RIM_X, y - NBA_RIM_Y);
}

/** Feet from the baseline, for the paint (19 ft) and corner-three (14 ft) cut-offs. */
function feetFromBaseline(y: number): number {
  return y - NBA_RIM_Y + BASELINE_TO_RIM_FT;
}

export function nbaShotZone(x: number, y: number, isThree: boolean): NbaShotZone {
  const fromBaseline = feetFromBaseline(y);
  if (fromBaseline > 47) return 'backcourt';
  if (isThree) {
    if (fromBaseline <= 14) return x < NBA_RIM_X ? 'left_corner_3' : 'right_corner_3';
    return 'above_break_3';
  }
  if (nbaShotDistanceFt(x, y) <= 4) return 'restricted';
  if (Math.abs(x - NBA_RIM_X) <= 8 && fromBaseline <= 19) return 'paint';
  return 'mid_range';
}
