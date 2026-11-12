/**
 * Closing (or last pre-tip) Aussie-book prop lines for Similar Players rows.
 * Source: nba_prop_snapshots + nba_prop_book_quotes written by the nba-prop-log cron.
 * Uses the Aussie-book consensus line when available, else the logged main line.
 */

import { isAussieBook } from '@/lib/aiPicks/candidates/types';
import { isNblPropMarket } from '@/lib/aiPicks/markets';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type SimilarLineKey = {
  playerId: string;
  gameId: string;
  /** Dashboard / prop-log stat key (points, rebounds, …). */
  stat: string;
  /** Optional display name for unmatched / id-miss fallback. */
  playerName?: string | null;
};

export type SimilarLineHit = {
  line: number;
  book: string | null;
};

const KIND_RANK: Record<string, number> = {
  close: 0,
  t2h: 1,
  t6h: 2,
  first: 3,
  injury_change: 4,
  us_move: 5,
};

type SnapRow = {
  id: string;
  game_id: string;
  player_id: string | null;
  player_name: string | null;
  board_name: string | null;
  unmatched: boolean | null;
  stat: string;
  snapshot_kind: string;
  main_line: number;
  captured_at: string;
  nba_prop_book_quotes?: Array<{ book: string; line: number }> | null;
};

function normName(raw: string | null | undefined): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function pickLine(snap: SnapRow): SimilarLineHit | null {
  const au = (snap.nba_prop_book_quotes ?? [])
    .map((q) => ({ book: String(q.book || ''), line: Number(q.line) }))
    .filter((q) => q.book && Number.isFinite(q.line) && isAussieBook(q.book))
    .sort((a, b) => a.line - b.line);
  if (au.length) {
    const mid = au[Math.floor((au.length - 1) / 2)]!;
    return { line: mid.line, book: mid.book };
  }
  const main = Number(snap.main_line);
  return Number.isFinite(main) ? { line: main, book: null } : null;
}

function betterSnap(a: SnapRow, b: SnapRow): SnapRow {
  const ra = KIND_RANK[a.snapshot_kind] ?? 99;
  const rb = KIND_RANK[b.snapshot_kind] ?? 99;
  if (ra !== rb) return ra < rb ? a : b;
  return String(a.captured_at).localeCompare(String(b.captured_at)) >= 0 ? a : b;
}

/**
 * Batch lookup: one line per player×game×stat. Missing keys are omitted from the map.
 * Matches player_id first, then normalized player / board name on that game.
 */
export async function lookupNbaSimilarPlayerLines(
  keys: SimilarLineKey[]
): Promise<Map<string, SimilarLineHit>> {
  const out = new Map<string, SimilarLineHit>();
  const usable = keys.filter((k) => k.playerId && k.gameId && isNblPropMarket(k.stat));
  if (!usable.length) return out;

  const gameIds = [...new Set(usable.map((k) => k.gameId))];
  const playerIds = [...new Set(usable.map((k) => k.playerId))];
  const stats = [...new Set(usable.map((k) => k.stat))];

  const { data, error } = await supabaseAdmin
    .from('nba_prop_snapshots')
    .select(
      'id, game_id, player_id, player_name, board_name, unmatched, stat, snapshot_kind, main_line, captured_at, nba_prop_book_quotes(book, line)'
    )
    .in('game_id', gameIds)
    .in('stat', stats)
    .in('snapshot_kind', Object.keys(KIND_RANK));

  if (error) {
    console.warn('[NBA similar lines]', error.message);
    return out;
  }

  const byPlayer = new Map<string, SnapRow>();
  const byName = new Map<string, SnapRow>();
  const wantedIds = new Set(playerIds);
  const wantedNames = new Set(
    usable.map((k) => normName(k.playerName)).filter((n) => n.length >= 4)
  );

  for (const row of (data ?? []) as SnapRow[]) {
    if (row.player_id && wantedIds.has(row.player_id)) {
      const key = `${row.game_id}|${row.player_id}|${row.stat}`;
      const prev = byPlayer.get(key);
      byPlayer.set(key, prev ? betterSnap(prev, row) : row);
    }
    for (const label of [row.player_name, row.board_name]) {
      const n = normName(label);
      if (!n || !wantedNames.has(n)) continue;
      const key = `${row.game_id}|${n}|${row.stat}`;
      const prev = byName.get(key);
      byName.set(key, prev ? betterSnap(prev, row) : row);
    }
  }

  for (const k of usable) {
    const idKey = `${k.gameId}|${k.playerId}|${k.stat}`;
    const snap = byPlayer.get(idKey) ?? byName.get(`${k.gameId}|${normName(k.playerName)}|${k.stat}`);
    if (!snap) continue;
    const hit = pickLine(snap);
    if (hit) out.set(idKey, hit);
  }
  return out;
}
