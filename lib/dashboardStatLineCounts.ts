/** Count selector rows: every posted book/line, even if the number repeats. */
export function countPostedOddsLines(
  raw: Array<string | number | null | undefined>
): number {
  let n = 0;
  for (const value of raw) {
    if (value == null || value === '' || value === 'N/A') continue;
    const parsed = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(parsed)) continue;
    n += 1;
  }
  return n;
}

export function countMoneylineBooks(
  books: Array<{ H2H?: { home?: string | null; away?: string | null } } | null | undefined>
): number {
  let n = 0;
  for (const book of books) {
    const home = book?.H2H?.home;
    const away = book?.H2H?.away;
    if (home && home !== 'N/A' && away && away !== 'N/A') n += 1;
  }
  return n;
}
