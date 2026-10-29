export type SnapshotKind = 'first' | 't6h' | 't2h' | 'close';

export type ExistingSnapshot = { id: string; kind: SnapshotKind; capturedAt: string };

const H = 60 * 60 * 1000;
const T6H_MS = 6 * H;
const T2H_MS = 2 * H;
/** The cron runs every 5 minutes, so at least one capture lands in this window before tip. */
export const CLOSE_MS = 10 * 60 * 1000;

/**
 * Snapshots due for one line now. t6h only for lines first seen more than 6h out (a later first
 * sighting is already the earliest look); t2h is always taken, since it is the main policy's decision
 * point; close is refreshed on every run inside the last CLOSE_MS.
 */
export function dueKinds(existing: ExistingSnapshot[], tipMs: number, nowMs: number): SnapshotKind[] {
  const toTip = tipMs - nowMs;
  if (!(toTip > 0)) return [];
  const has = (k: SnapshotKind) => existing.some((e) => e.kind === k);
  const first = existing.find((e) => e.kind === 'first');
  const out: SnapshotKind[] = [];
  if (!first) out.push('first');
  const firstAt = first ? Date.parse(first.capturedAt) : nowMs;
  if (toTip <= T6H_MS && toTip > T2H_MS && !has('t6h') && tipMs - firstAt > T6H_MS) out.push('t6h');
  if (toTip <= T2H_MS && !has('t2h')) out.push('t2h');
  if (toTip <= CLOSE_MS) out.push('close');
  return out;
}
