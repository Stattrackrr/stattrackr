import { isNblPropMarket } from '@/lib/aiPicks/markets';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import { playerKeyOf, readNblPlayerPropSnapshotByKeyAsync, type NblSnapLine } from '@/lib/nbl/playerPropSnapshots';

export type ClosingLine = { line: number; price: number | null };

const bookKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function balance(l: NblSnapLine): number {
  if (l.overDecimal == null || l.underDecimal == null) return Number.POSITIVE_INFINITY;
  return Math.abs(l.overDecimal - l.underDecimal);
}

/** The leg's book at tip-off: its main O/U (or the same milestone) and the price on the leg's side. */
export function closingFromSnapLines(leg: AiPickLeg, lines: NblSnapLine[]): ClosingLine | null {
  if (!leg.player || !isNblPropMarket(leg.market)) return null;
  const pk = playerKeyOf(leg.player);
  const book = bookKey(leg.bookmaker);
  const mine = lines.filter((l) => l.playerKey === pk && l.stat === leg.market && bookKey(l.book) === book);
  const pick =
    leg.marketKind === 'milestone'
      ? mine.find((l) => l.kind === 'milestone' && l.line === leg.line)
      : mine.filter((l) => l.kind === 'ou').sort((a, b) => balance(a) - balance(b))[0];
  if (!pick) return null;
  const price = leg.side === 'under' ? pick.underDecimal : pick.overDecimal;
  return { line: pick.line, price: price ?? null };
}

/** Only from a snapshot marked closing (frozen 5 minutes after tip). */
export async function nblClosingLine(leg: AiPickLeg): Promise<ClosingLine | null> {
  if (!isNblPropMarket(leg.market)) return null;
  const snap = await readNblPlayerPropSnapshotByKeyAsync(leg.eventKey);
  if (!snap?.closing) return null;
  return closingFromSnapLines(leg, snap.lines);
}
