/**
 * This run's decision snapshots turned into would-be bet rows, one arm at a time. Pure: the same
 * triggers, quotes and price memory feed every arm; an arm that throws loses only its own rows.
 */

import { ARMS, type Arm, type ArmInput, type TriggerKind, type UsMoveInfo } from './arms';
import type { LoggedLine } from './lines';
import { confirmationGaps, priceConfirmed, type PriceMemory } from './shadowRules';

export const memoryKey = (gameId: string, boardName: string, stat: string) => `${gameId}|${boardName}|${stat}`;

export type Trigger = {
  snapshotId: string;
  kind: TriggerKind;
  row: { game_id: string; tip_at: string; player_id: string | null; stat: string; main_line: number; n_books: number; book_dispersion: number | null; features: Record<string, unknown>; model_version: string; feature_version: string };
  line: LoggedLine;
  /** The US books' move behind a us_move snapshot. */
  usMove?: UsMoveInfo | null;
};

/** A row for nba_shadow_bets. `policy` is the trigger family the table knows: main (t2h) or news (events). */
export type ShadowBetRow = {
  policy: 'main' | 'news';
  policy_version: string;
  model_version: string;
  feature_version: string;
  trigger_snapshot_id: string;
  game_id: string;
  player_id: string;
  stat: string;
  side: 'over' | 'under';
  line: number;
  price: number;
  book: string;
  price_confirmed: boolean;
  model_prob: number;
  fair_at_decision: number;
  features: Record<string, unknown>;
  created_at: string;
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** What every arm sees for one trigger. */
export function armInput(t: Trigger, memory: Record<string, PriceMemory>, nowMs: number): ArmInput {
  const previous = memory[memoryKey(t.row.game_id, t.line.boardName, t.line.stat)];
  const gaps = confirmationGaps(Date.parse(t.row.tip_at) - nowMs);
  const quoteFor = (book: string) => t.line.quotes.find((q) => q.book === book && q.line === t.line.mainLine);
  return {
    trigger: t.kind,
    line: { stat: t.row.stat, features: t.row.features, nBooks: t.row.n_books, bookDispersion: t.row.book_dispersion, mainLine: t.line.mainLine, quotes: t.line.quotes },
    best: { over: t.line.bestAuOver, under: t.line.bestAuUnder },
    confirmed: (side, book) => {
      const quote = quoteFor(book);
      return quote ? priceConfirmed({ quote, side, previous, nowMs, ...gaps }) : false;
    },
    seenSince: (side, book) => {
      const quote = quoteFor(book);
      const before = previous?.[book];
      if (!quote || !before || !quote[side] || before[side] !== quote[side]) return null;
      const at = Date.parse(before.seenAt);
      return Number.isFinite(at) ? at : null;
    },
    fairOverUs: t.line.fairOverUs,
    usMove: t.usMove ?? null,
    nowMs,
  };
}

/** Every arm's would-be bets for these triggers. Errors are per arm and never stop another arm. */
export function wouldBeBets(triggers: Trigger[], memory: Record<string, PriceMemory>, nowMs: number, arms: readonly Arm[] = ARMS): { bets: ShadowBetRow[]; errors: string[] } {
  const nowIso = new Date(nowMs).toISOString();
  const inputs = triggers.filter((t) => t.row.player_id).map((t) => ({ t, input: armInput(t, memory, nowMs) }));
  const bets: ShadowBetRow[] = [];
  const errors: string[] = [];
  for (const arm of arms) {
    const mine: ShadowBetRow[] = [];
    try {
      for (const { t, input } of inputs) {
        if (!arm.triggers.includes(t.kind)) continue;
        const bet = arm.decide(input);
        if (!bet) continue;
        mine.push({
          policy: t.kind === 't2h' ? 'main' : 'news',
          policy_version: arm.policyVersion,
          model_version: arm.coefs.version,
          feature_version: t.row.feature_version,
          trigger_snapshot_id: t.snapshotId,
          game_id: t.row.game_id,
          player_id: t.row.player_id!,
          stat: t.row.stat,
          side: bet.side,
          line: t.line.mainLine,
          price: bet.price,
          book: bet.book,
          price_confirmed: bet.confirmed,
          model_prob: r4(bet.prob),
          fair_at_decision: r4(bet.fair),
          features: { ...t.row.features, ev: r4(bet.ev), arm: arm.id, trigger: t.kind, ...bet.tags },
          created_at: nowIso,
        });
      }
      bets.push(...mine);
    } catch (err) {
      errors.push(`arm ${arm.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { bets, errors };
}

const newsLine = (b: { policy_version: string; game_id: string; player_id: string | null; stat: string; side: string }) => `${b.policy_version}|${b.game_id}|${b.player_id}|${b.stat}|${b.side}`;

/**
 * News bets: one per arm, player, stat and side per game. A later report change or US move does not
 * bet the same line again, whether the earlier bet is in the table (`prior`) or earlier in this run.
 */
export function dropRepeatNews(bets: ShadowBetRow[], prior: Array<{ policy_version: string; game_id: string; player_id: string | null; stat: string; side: string }>): ShadowBetRow[] {
  const taken = new Set(prior.map(newsLine));
  return bets.filter((b) => {
    if (b.policy !== 'news') return true;
    const key = newsLine(b);
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
}
