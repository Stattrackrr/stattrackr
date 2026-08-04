/**
 * Pure AFL Top Picks hit/miss grading (client-safe).
 * Mirrors the modal logic in app/afl/page.tsx without pulling in the full UI.
 */

export type AflTopPicksGradeResult = 'Hit' | 'Miss' | '-';

export type AflTopPicksGradePick = {
  playerName?: string | null;
  recommendedSide?: 'OVER' | 'UNDER' | null;
  line?: number | null;
  actualDisposals?: number | null;
  result?: AflTopPicksGradeResult | null;
};

export function gradeAflTopPick(
  side: 'OVER' | 'UNDER' | null | undefined,
  line: number | null | undefined,
  actual: number | null | undefined
): AflTopPicksGradeResult {
  if (!side || line == null || actual == null) return '-';
  if (!Number.isFinite(line) || !Number.isFinite(actual)) return '-';
  if (side === 'OVER') return actual > line ? 'Hit' : 'Miss';
  return actual < line ? 'Hit' : 'Miss';
}

export function gradeAflTopPickFromStored<T extends AflTopPicksGradePick>(
  pick: T
): T & { result: AflTopPicksGradeResult; actualDisposals: number | null } {
  const actual =
    typeof pick.actualDisposals === 'number' && Number.isFinite(pick.actualDisposals)
      ? pick.actualDisposals
      : null;
  return {
    ...pick,
    actualDisposals: actual,
    result: gradeAflTopPick(pick.recommendedSide, pick.line, actual),
  };
}

export function summarizeAflTopPicksGrades(
  picks: Array<{ result?: AflTopPicksGradeResult | null }>
): { hits: number; misses: number; hitRate: number; decided: number } {
  let hits = 0;
  let misses = 0;
  for (const pick of picks) {
    if (pick.result === 'Hit') hits += 1;
    else if (pick.result === 'Miss') misses += 1;
  }
  const decided = hits + misses;
  return {
    hits,
    misses,
    decided,
    hitRate: decided > 0 ? (hits / decided) * 100 : 0,
  };
}

export function formatAflTopPicksRoundLabel(roundKey: string | null | undefined): string {
  const match = String(roundKey ?? '')
    .trim()
    .match(/^(\d{4})-R(\d{1,2})$/i);
  if (!match) return roundKey ? String(roundKey) : 'Last round';
  return `Round ${Number.parseInt(match[2], 10)}, ${match[1]}`;
}
