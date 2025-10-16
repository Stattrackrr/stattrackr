// Derivation logic for opening/current lines and movement from snapshots
import { BookmakerLines, OpeningCurrentMovement, OddsSnapshot } from './types';
import { computeMovement, groupByBookmaker, pickCurrentSnapshot, pickOpeningSnapshot, snapLine } from './utils';

// Compute opening/current/movement for a list of snapshots (any bookmaker)
export function deriveOpeningCurrentMovement(snapshots: OddsSnapshot[], snapToIncrement = 0.5): OpeningCurrentMovement {
  const opening = pickOpeningSnapshot(snapshots);
  const current = pickCurrentSnapshot(snapshots);

  const openingLine = opening ? snapLine(opening.line, snapToIncrement) : null;
  const openingAt = opening ? opening.timestamp : null;
  const currentLine = current ? snapLine(current.line, snapToIncrement) : null;
  const currentAt = current ? current.timestamp : null;
  const { movement, direction } = computeMovement(openingLine, currentLine);

  return { openingLine, openingAt, currentLine, currentAt, movement, direction };
}

// Compute opening/current/movement per bookmaker
export function derivePerBookmaker(snapshots: OddsSnapshot[], snapToIncrement = 0.5): BookmakerLines {
  const byBk = groupByBookmaker(snapshots);
  const out: BookmakerLines = {};
  for (const bk of Object.keys(byBk)) {
    out[bk] = deriveOpeningCurrentMovement(byBk[bk], snapToIncrement);
  }
  return out;
}

// Optional helper: filter snapshots for a specific market (e.g., 'player_points')
export function filterByMarket(snapshots: OddsSnapshot[], market: string): OddsSnapshot[] {
  return snapshots.filter(s => s.market === market);
}
