/**
 * Y scale for the supporting-stats bars: up to the tallest bar plus room for its value label, like the
 * main chart, instead of Recharts' rounded-up default that leaves the top third empty. Goes below zero
 * only when a value does (plus/minus); percentages stop at 100.
 */
export function supportingYDomain(values: Array<number | null | undefined>, isPercent: boolean): [number, number] {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!finite.length) return [0, 1];
  const top = Math.max(Math.max(...finite), 0.5) * 1.12;
  const low = Math.min(...finite, 0);
  return [low < 0 ? low * 1.12 : 0, isPercent ? Math.min(100, top) : top];
}
