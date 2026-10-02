/**
 * Client-safe types for the NBL Props Analysis Engine output
 * (`nbl-engine/`, published nightly + every 2h to data/nbl-model/cache/engine-picks/<date>.json).
 * Mirrors nbl_engine/models/records.py — keep in sync.
 */

export type NblEngineTier = 'STRONG' | 'LEAN' | 'NO EDGE' | 'AVOID';
export type NblEngineSide = 'over' | 'under' | null;
export type NblEngineDirection = 'over' | 'under' | 'neutral';
export type NblEngineStatus = 'confirmed' | 'not_confirmed' | 'cannot_determine';

export type NblEngineClaim = {
  id: string;
  category: string;
  subject: string;
  stat: string;
  metric: string;
  value: number | null;
  unit: string;
  sample_n: number | null;
  window: string;
  comparison: number | null;
  source_dataset: string;
  source_as_of: string | null;
  as_text: string;
  flags: string[];
};

export type NblEngineInference = {
  rule_id: string;
  category: string;
  direction: NblEngineDirection;
  status: NblEngineStatus;
  weight: number;
  claim_ids: string[];
  reason: string;
};

export type NblEngineGate = {
  gate: string;
  passed: boolean;
  detail: string;
};

export type NblEngineBookLine = {
  book: string;
  kind: string;
  line: number;
  over_decimal: number | null;
  under_decimal: number | null;
};

export type NblEngineLineSummary = {
  kind: 'ou' | 'milestone' | string;
  consensus_line: number | null;
  books: number;
  best_over_book: string | null;
  best_over_decimal: number | null;
  best_under_book: string | null;
  best_under_decimal: number | null;
  captured_at: string | null;
  best_over_line?: number | null;
  best_over_line_book?: string | null;
  best_over_line_decimal?: number | null;
  best_under_line?: number | null;
  best_under_line_book?: string | null;
  best_under_line_decimal?: number | null;
  best_over_books?: string[];
  best_under_books?: string[];
  book_lines?: NblEngineBookLine[];
};

export type NblEngineVerifier = {
  passed: boolean;
  issues: string[];
  numbers_checked: number;
};

export type NblEnginePick = {
  engine_version: string;
  run_date: string;
  game_key: string;
  game_label: string;
  tipoff_utc: string | null;
  player_id: string;
  player_name: string;
  team_code: string;
  opponent_code: string;
  is_home: boolean;
  stat: string;
  stat_label: string;
  line: number | null;
  side: NblEngineSide;
  tier: NblEngineTier;
  score_over: number;
  score_under: number;
  confirmed_categories: string[];
  gates: NblEngineGate[];
  line_summary: NblEngineLineSummary | null;
  claims: NblEngineClaim[];
  inferences: NblEngineInference[];
  narrative: string;
  verifier: NblEngineVerifier;
  evidence_sha256: string;
  skips: Array<Record<string, unknown>>;
};

/** One committed day file. */
export type NblEnginePublishFile = {
  format: number;
  engine_version: string;
  run_date: string;
  generated_at: string;
  data_as_of: Record<string, string>;
  stats_fresh: boolean;
  games: string[];
  skips: Record<string, number>;
  picks: NblEnginePick[];
};

export const NBL_MIN_MODEL_DECIMAL = 1.5;

export type NblBestQuote = {
  line: number;
  price: number;
  books: string[];
};

function isModelPrice(price: number | null | undefined, allowShort: boolean): price is number {
  if (price == null || !Number.isFinite(price)) return false;
  return allowShort || price >= NBL_MIN_MODEL_DECIMAL - 1e-9;
}

function quoteFromRows(
  rows: NblEngineBookLine[],
  side: 'over' | 'under',
  allowShort: boolean
): NblBestQuote | null {
  const key = side === 'over' ? 'over_decimal' : 'under_decimal';
  const opts = rows
    .map((row) => ({ book: row.book, line: row.line, price: row[key] }))
    .filter((row): row is { book: string; line: number; price: number } => isModelPrice(row.price, allowShort));
  if (!opts.length) return null;
  const bestLine = side === 'over' ? Math.min(...opts.map((o) => o.line)) : Math.max(...opts.map((o) => o.line));
  const at = opts.filter((o) => Math.abs(o.line - bestLine) < 1e-6);
  const bestPrice = Math.max(...at.map((o) => o.price));
  const books = [...new Set(at.filter((o) => Math.abs(o.price - bestPrice) < 1e-6).map((o) => o.book))].sort();
  return { line: bestLine, price: bestPrice, books };
}

export function nblStoredLineQuotes(
  pick: NblEnginePick,
  opts?: { atLine?: number | null; allowShort?: boolean }
): { bestOver: NblBestQuote | null; bestUnder: NblBestQuote | null } {
  const ls = pick.line_summary;
  const rows = ls?.book_lines || [];
  const atLine = opts?.atLine ?? null;
  const allowShort = Boolean(opts?.allowShort) || atLine != null;

  if (atLine != null) {
    const at = rows.filter((row) => Math.abs(row.line - atLine) < 1e-6);
    const over = quoteFromRows(at, 'over', true);
    const under = quoteFromRows(at, 'under', true);
    if (over || under) return { bestOver: over, bestUnder: under };
  }

  const ou = rows.filter((row) => row.kind === 'ou');
  if (ou.length) {
    return {
      bestOver: quoteFromRows(ou, 'over', true),
      bestUnder: quoteFromRows(ou, 'under', true),
    };
  }

  // Milestone-only: quote the consensus number, not the cheapest 1.5/1.04 gimme.
  const consensus = ls?.consensus_line ?? pick.line;
  const atCons =
    consensus != null ? rows.filter((row) => Math.abs(row.line - consensus) < 1e-6) : [];
  const pool = atCons.length ? atCons : rows;
  const overFromBoard = quoteFromRows(pool, 'over', allowShort);
  const underFromBoard = quoteFromRows(pool, 'under', true);
  if (overFromBoard || underFromBoard) {
    return { bestOver: overFromBoard, bestUnder: underFromBoard };
  }

  const overLine = ls?.best_over_line ?? ls?.consensus_line ?? pick.line;
  const overPrice = ls?.best_over_line_decimal ?? ls?.best_over_decimal ?? null;
  const overBooks = [...(ls?.best_over_books || [])].filter(Boolean);
  if (!overBooks.length && ls?.best_over_line_book) overBooks.push(ls.best_over_line_book);
  const underLine = ls?.best_under_line ?? null;
  const underPrice = ls?.best_under_line_decimal ?? ls?.best_under_decimal ?? null;
  const underBooks = [...(ls?.best_under_books || [])].filter(Boolean);
  if (!underBooks.length && ls?.best_under_line_book) underBooks.push(ls.best_under_line_book);
  return {
    bestOver:
      overLine != null && isModelPrice(overPrice, allowShort)
        ? { line: overLine, price: overPrice, books: overBooks }
        : null,
    bestUnder:
      underLine != null && isModelPrice(underPrice, allowShort)
        ? { line: underLine, price: underPrice, books: underBooks }
        : null,
  };
}

/** Compact row for the "other markets" strip. */
export type NblEngineMarketSummary = {
  stat: string;
  stat_label: string;
  line: number | null;
  side: NblEngineSide;
  tier: NblEngineTier;
  kind: string | null;
  bestOver: NblBestQuote | null;
  bestUnder: NblBestQuote | null;
};

export type NblEnginePanelPayload = {
  /** Pick for the requested stat, or null when the engine has no market for it. */
  pick: NblEnginePick | null;
  /** Every market the engine analysed for this player in the same game (requested stat included). */
  markets: NblEngineMarketSummary[];
  /** Game the picks come from (null when nothing matched). */
  game: {
    run_date: string;
    game_key: string;
    game_label: string;
    tipoff_utc: string | null;
    opponent_code: string;
    is_home: boolean;
  } | null;
  generated_at: string | null;
  engine_version: string | null;
  data_as_of: Record<string, string>;
  /** Why nothing matched (player not on a board, opponent mismatch, no file...). */
  reason: string | null;
};

export const NBL_ENGINE_CATEGORY_LABELS: Record<string, string> = {
  form: 'Form',
  hit_rate: 'Hit rate',
  matchup_allowed: 'Matchup',
  pace: 'Pace',
  usage: 'Usage',
  shot_profile: 'Shot profile',
  rebounding: 'Rebounding',
  minutes: 'Minutes',
  home_away: 'Home / away',
  h2h: 'Head to head',
  injury_impact: 'Injury impact',
  line_movement: 'Line movement',
  context: 'Context',
};

export function nblEngineCategoryLabel(category: string): string {
  return NBL_ENGINE_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}
