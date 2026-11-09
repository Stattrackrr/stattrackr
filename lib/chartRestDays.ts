/**
 * Rest days between consecutive games for chart Advanced filters.
 * 0 = back-to-back (played the previous calendar day), 1 = one day off, etc.
 */

export type ChartRestDaysMode = 'all' | '0' | '1' | '2plus';

export function parseGameDateMs(raw: string | null | undefined): number | null {
  const s = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Calendar days between prev and next, minus 1 (so consecutive days → 0 rest). */
export function restDaysBetween(
  prevDate: string | null | undefined,
  nextDate: string | null | undefined
): number | null {
  const a = parseGameDateMs(prevDate);
  const b = parseGameDateMs(nextDate);
  if (a == null || b == null) return null;
  const days = Math.round((b - a) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.max(0, days - 1);
}

/**
 * Attach `__restDays` using chronological order within the provided list.
 * Expects newest-or-mixed order; sorts a copy by date ascending for pairing.
 */
export function restDaysBySourceIndex(
  games: Array<{ date?: string | null; game_date?: string | null }>
): Map<number, number | null> {
  const indexed = games.map((g, index) => ({
    index,
    date: String(g.date ?? g.game_date ?? '').trim().slice(0, 10) || null,
  }));
  indexed.sort((a, b) => {
    const am = parseGameDateMs(a.date) ?? 0;
    const bm = parseGameDateMs(b.date) ?? 0;
    if (am !== bm) return am - bm;
    return a.index - b.index;
  });
  const out = new Map<number, number | null>();
  for (let i = 0; i < indexed.length; i++) {
    const prev = i > 0 ? indexed[i - 1].date : null;
    out.set(indexed[i].index, i === 0 ? null : restDaysBetween(prev, indexed[i].date));
  }
  return out;
}

export function matchesRestDaysMode(
  restDays: number | null | undefined,
  mode: ChartRestDaysMode
): boolean {
  if (mode === 'all') return true;
  if (restDays == null || !Number.isFinite(restDays)) return false;
  if (mode === '0') return restDays === 0;
  if (mode === '1') return restDays === 1;
  return restDays >= 2;
}
