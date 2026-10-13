import type { AiPick, AiPickLeg, AiPickStatus } from '@/lib/aiPicks/types';

export type AiPickLegRow = {
  id: string;
  pick_id: string;
  leg_index: number;
  sport: string;
  event_key: string;
  event_label: string;
  starts_at: string;
  market: string;
  market_kind: AiPickLeg['marketKind'];
  player: string | null;
  player_id: string | null;
  team: string | null;
  side: AiPickLeg['side'];
  line: number | string | null;
  price: number | string;
  bookmaker: string;
  model_prob: number | string | null;
  status: AiPickStatus;
  result_value: number | string | null;
  result_note: string | null;
  closing_line: number | string | null;
  closing_price: number | string | null;
  graded_at: string | null;
};

export type AiPickRow = {
  id: string;
  kind: AiPick['kind'];
  sport: string;
  title: string;
  write_up: string | null;
  units: number | string;
  price: number | string;
  bookmaker: string;
  model_prob: number | string | null;
  ev: number | string | null;
  status: AiPickStatus;
  profit_units: number | string | null;
  first_starts_at: string;
  posted_at: string;
  settled_at: string | null;
  model_version: string | null;
  ai_pick_legs: AiPickLegRow[] | null;
};

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

export function aiPickLegFromRow(row: AiPickLegRow): AiPickLeg {
  return {
    id: row.id,
    pickId: row.pick_id,
    legIndex: row.leg_index,
    sport: row.sport,
    eventKey: row.event_key,
    eventLabel: row.event_label,
    startsAt: row.starts_at,
    market: row.market,
    marketKind: row.market_kind,
    player: row.player,
    playerId: row.player_id,
    team: row.team,
    side: row.side,
    line: num(row.line),
    price: Number(row.price),
    bookmaker: row.bookmaker,
    modelProb: num(row.model_prob),
    status: row.status,
    resultValue: num(row.result_value),
    resultNote: row.result_note,
    closingLine: num(row.closing_line),
    closingPrice: num(row.closing_price),
    gradedAt: row.graded_at,
  };
}

export function aiPickFromRow(row: AiPickRow): AiPick {
  return {
    id: row.id,
    kind: row.kind,
    sport: row.sport,
    title: row.title,
    writeUp: row.write_up,
    units: Number(row.units),
    price: Number(row.price),
    bookmaker: row.bookmaker,
    modelProb: num(row.model_prob),
    ev: num(row.ev),
    status: row.status,
    profitUnits: num(row.profit_units),
    firstStartsAt: row.first_starts_at,
    postedAt: row.posted_at,
    settledAt: row.settled_at,
    modelVersion: row.model_version,
    legs: (row.ai_pick_legs ?? []).map(aiPickLegFromRow).sort((a, b) => a.legIndex - b.legIndex),
  };
}
