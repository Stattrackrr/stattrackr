/** Time wording shared by every sport's ask AI, so "3 weeks ago" reads the same everywhere. */

export function askAgo(
  date: string | null | undefined,
  now = Date.now()
): { ago: string; days: number; months: number } | null {
  const at = Date.parse(String(date || ''));
  if (!Number.isFinite(at)) return null;
  const days = Math.max(0, Math.floor((now - at) / 86_400_000));
  const months = Math.floor(days / 30.44);
  const ago =
    days === 0
      ? 'today'
      : days === 1
        ? 'yesterday'
        : days < 14
          ? `${days} days ago`
          : days < 60
            ? `${Math.round(days / 7)} weeks ago`
            : months < 24
              ? `${months} months ago`
              : `${Math.floor(days / 365.25)} years ago`;
  return { ago, days, months };
}

/** "January 2024" — how far back the stored history goes. */
export function askMonthYear(date: string | null | undefined): string | null {
  const at = Date.parse(String(date || ''));
  return Number.isFinite(at)
    ? new Date(at).toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
}

/** Run of identical results counting back from the newest; `flags` is oldest first. */
export function askRunFromNewest(flags: boolean[]): { value: boolean; count: number } | null {
  const newest = flags.at(-1);
  if (newest == null) return null;
  let count = 0;
  for (let i = flags.length - 1; i >= 0 && flags[i] === newest; i -= 1) count += 1;
  return { value: newest, count };
}
