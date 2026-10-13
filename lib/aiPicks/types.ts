export type AiPickStatus = 'pending' | 'win' | 'loss' | 'push' | 'void';
export type AiPickKind = 'single' | 'multi';
export type AiPickSide = 'over' | 'under' | 'home' | 'away' | 'yes' | 'no';
export type AiPickMarketKind = 'main' | 'alternate' | 'milestone';

export const AI_PICK_UNITS = [0.5, 1, 1.5, 2, 2.5, 3] as const;
export const AI_PICK_MIN_PRICE = 1.65;
export const AI_PICK_MAX_LEGS = 2;

export type AiPickLeg = {
  id: string;
  pickId: string;
  legIndex: number;
  sport: string;
  eventKey: string;
  eventLabel: string;
  startsAt: string;
  market: string;
  marketKind: AiPickMarketKind;
  player: string | null;
  playerId: string | null;
  team: string | null;
  side: AiPickSide;
  line: number | null;
  price: number;
  bookmaker: string;
  modelProb: number | null;
  status: AiPickStatus;
  resultValue: number | null;
  resultNote: string | null;
  closingLine: number | null;
  closingPrice: number | null;
  gradedAt: string | null;
};

export type AiPick = {
  id: string;
  kind: AiPickKind;
  sport: string;
  title: string;
  writeUp: string | null;
  units: number;
  price: number;
  bookmaker: string;
  modelProb: number | null;
  ev: number | null;
  status: AiPickStatus;
  profitUnits: number | null;
  firstStartsAt: string;
  postedAt: string;
  settledAt: string | null;
  modelVersion: string | null;
  legs: AiPickLeg[];
};

/** Settled profit in units. Push and void return the stake (0). */
export function aiPickProfitUnits(status: AiPickStatus, units: number, price: number): number {
  if (status === 'win') return Math.round(units * (price - 1) * 1000) / 1000;
  if (status === 'loss') return -units;
  return 0;
}

/** A multi wins only if every non-void leg wins; a void leg drops out (price recomputed by the grader). */
export function aiMultiStatus(legs: Array<Pick<AiPickLeg, 'status'>>): AiPickStatus {
  if (legs.some((l) => l.status === 'loss')) return 'loss';
  if (legs.some((l) => l.status === 'pending')) return 'pending';
  const live = legs.filter((l) => l.status !== 'void' && l.status !== 'push');
  if (!live.length) return legs.some((l) => l.status === 'push') ? 'push' : 'void';
  return 'win';
}

/** Multi price after void/push legs drop out (they count as 1.00). */
export function aiMultiSettledPrice(legs: Array<Pick<AiPickLeg, 'status' | 'price'>>): number {
  return legs.reduce((acc, l) => (l.status === 'void' || l.status === 'push' ? acc : acc * l.price), 1);
}
