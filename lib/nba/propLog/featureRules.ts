/**
 * Pure helpers for the logged model inputs: the US Eastern day of a game, and how fresh the latest
 * injury news about a player or his teammates is. No I/O, so each is unit-tested.
 */

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayCache = new Map<string, string>();

/** The US Eastern calendar day of a time. */
export function etDay(iso: string): string {
  const hit = dayCache.get(iso);
  if (hit) return hit;
  const day = ET_DAY.format(new Date(iso));
  if (dayCache.size > 50_000) dayCache.clear();
  dayCache.set(iso, day);
  return day;
}

/**
 * The US Eastern day a game was played. Game logs carry the tip time in UTC, where an evening game
 * falls on the next calendar day; a bare date is already the game's local day and is kept.
 */
export function gameDayEt(date: string | null | undefined): string {
  const d = String(date || '');
  if (d.length <= 10 || !Number.isFinite(Date.parse(d))) return d.slice(0, 10);
  return etDay(d);
}

/** A news change (see isNewsChange) as first seen by the logger. dir: +1 toward out, -1 toward available. */
export type NewsItem = { playerId: string; at: string; dir: -1 | 0 | 1 };

/** ln(1 + minutes from the news to the snapshot); null when the news is not before the snapshot. */
export function newsAgeLn(newsAtMs: number, capturedMs: number): number | null {
  if (!Number.isFinite(newsAtMs) || !Number.isFinite(capturedMs) || newsAtMs > capturedMs) return null;
  return Math.log1p((capturedMs - newsAtMs) / 60_000);
}

/** The latest news at or before the snapshot among the given players. */
export function freshestNews(items: NewsItem[], capturedMs: number, include: (playerId: string) => boolean): (NewsItem & { ageLn: number }) | null {
  let best: (NewsItem & { ageLn: number }) | null = null;
  for (const item of items) {
    if (!include(item.playerId)) continue;
    const ageLn = newsAgeLn(Date.parse(item.at), capturedMs);
    if (ageLn == null) continue;
    if (!best || ageLn < best.ageLn) best = { ...item, ageLn };
  }
  return best;
}
