import { aiMultiSettledPrice, aiMultiStatus, aiPickProfitUnits, type AiPick, type AiPickLeg, type AiPickStatus } from '@/lib/aiPicks/types';

export type PickSettlement = { status: AiPickStatus; profitUnits: number | null; settledPrice: number | null };

/**
 * Single: the leg's result at the posted price.
 * Multi: void/push legs drop out. When every leg stands the posted multi price is used as-is;
 * otherwise the posted price is scaled down by the dropped legs.
 */
export function settlePick(pick: Pick<AiPick, 'kind' | 'units' | 'price'>, legs: Array<Pick<AiPickLeg, 'status' | 'price'>>): PickSettlement {
  if (!legs.length) return { status: 'pending', profitUnits: null, settledPrice: null };
  const status = pick.kind === 'single' ? legs[0]!.status : aiMultiStatus(legs);
  if (status === 'pending') return { status, profitUnits: null, settledPrice: null };

  let settledPrice = pick.price;
  if (pick.kind === 'multi' && status === 'win') {
    const full = legs.reduce((acc, l) => acc * l.price, 1);
    const kept = aiMultiSettledPrice(legs);
    if (kept !== full && full > 0) settledPrice = Math.round(((pick.price * kept) / full) * 1000) / 1000;
  }
  return { status, profitUnits: aiPickProfitUnits(status, pick.units, settledPrice), settledPrice };
}
