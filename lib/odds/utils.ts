// Pure helpers for odds calculations and snapshot selection
import { OddsSnapshot, MovementDirection } from './types';

// Convert American odds to implied probability (0..100)
export function impliedProbabilityFromAmerican(odds: number): number {
  if (!Number.isFinite(odds)) return 0;
  if (odds < 0) {
    return (Math.abs(odds) / (Math.abs(odds) + 100)) * 100;
  }
  return (100 / (odds + 100)) * 100;
}

// Compute movement and direction from opening/current
export function computeMovement(opening: number | null, current: number | null): { movement: number | null; direction: MovementDirection } {
  if (!Number.isFinite(opening as number) || !Number.isFinite(current as number)) {
    return { movement: null, direction: null };
  }
  const mv = (current as number) - (opening as number);
  const direction: MovementDirection = mv > 0 ? 'up' : mv < 0 ? 'down' : 'flat';
  return { movement: mv, direction };
}

// Snap a line to a given increment (e.g., 0.5 steps)
export function snapLine(line: number, step = 0.5): number {
  if (!Number.isFinite(line)) return line;
  return Math.round(line / step) * step;
}

// Pick earliest snapshot by timestamp (with finite line)
export function pickOpeningSnapshot(snapshots: OddsSnapshot[]): OddsSnapshot | null {
  const valid = snapshots.filter(s => Number.isFinite(s?.line) && Number.isFinite(s?.timestamp));
  if (valid.length === 0) return null;
  return valid.reduce((earliest, s) => (s.timestamp < earliest.timestamp ? s : earliest));
}

// Pick latest snapshot by timestamp (with finite line)
export function pickCurrentSnapshot(snapshots: OddsSnapshot[]): OddsSnapshot | null {
  const valid = snapshots.filter(s => Number.isFinite(s?.line) && Number.isFinite(s?.timestamp));
  if (valid.length === 0) return null;
  return valid.reduce((latest, s) => (s.timestamp > latest.timestamp ? s : latest));
}

// Group snapshots by bookmaker
export function groupByBookmaker(snapshots: OddsSnapshot[]): Record<string, OddsSnapshot[]> {
  return snapshots.reduce<Record<string, OddsSnapshot[]>>((acc, s) => {
    const key = s.bookmaker || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});
}
