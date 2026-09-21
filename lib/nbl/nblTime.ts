/**
 * Rosetta NBL timestamps are UTC with the Z omitted
 * (`2026-09-22T09:30:00` = 7:30pm AEST). JS otherwise treats that as local.
 */

const HAS_TZ = /[zZ]$|[+-]\d{2}:?\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export function parseNblUtcMs(raw: string | null | undefined): number {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  if (HAS_TZ.test(s)) return Date.parse(s);
  if (DATE_ONLY.test(s)) return Date.parse(`${s}T00:00:00Z`);
  if (NAIVE_DATETIME.test(s)) return Date.parse(`${s.replace(' ', 'T')}Z`);
  return Date.parse(s);
}

export function nblUtcIso(raw: string | null | undefined): string | null {
  const ms = parseNblUtcMs(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}
