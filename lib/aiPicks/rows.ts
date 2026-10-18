import { alternateBooks, type AltBook } from '@/lib/aiPicks/books';
import type { CandidateQuote } from '@/lib/aiPicks/candidates/types';
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
  context?: { altBooks?: unknown; legs?: Array<{ quotes?: unknown }> } | null;
  ai_pick_legs: AiPickLegRow[] | null;
};

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

const isQuote = (q: unknown): q is CandidateQuote =>
  !!q && typeof (q as CandidateQuote).book === 'string' && typeof (q as CandidateQuote).price === 'number';

/** Stored list when the pick has one; older picks rebuild it from the top quotes saved per leg. */
function altBooksFromRow(row: AiPickRow, legCount: number): AltBook[] {
  const stored = row.context?.altBooks;
  if (Array.isArray(stored)) {
    return stored.filter(
      (a): a is AltBook => isQuote(a) && Array.isArray((a as AltBook).legs) && (a as AltBook).legs.every((p) => typeof p === 'number')
    );
  }
  const legs = row.context?.legs;
  if (!Array.isArray(legs) || !legs.length || legs.length !== legCount) return [];
  return alternateBooks(
    legs.map((l) => (Array.isArray(l?.quotes) ? l.quotes.filter(isQuote) : [])),
    row.bookmaker
  );
}

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
    altBooks: altBooksFromRow(row, (row.ai_pick_legs ?? []).length),
  };
}
