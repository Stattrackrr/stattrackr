import type { TennisDvpStage } from '@/lib/tennis/dvpShared';

export function tennisDrawSeedCount(
  fieldSize: number,
  opts?: { slam?: boolean; stage?: TennisDvpStage }
): number {
  const n = Math.max(0, Math.round(Number(fieldSize) || 0));
  if (n <= 0) return 0;
  if (opts?.slam || n >= 96) return Math.min(32, n);
  if (n >= 48) return Math.min(16, n);
  return Math.min(8, n);
}

export function tennisAssignDrawRanks(
  players: Array<{ id: string; rankPos?: number | null }>
): Map<string, number> {
  const sorted = [...players]
    .filter((row) => String(row.id || '').trim())
    .sort(
      (a, b) =>
        (a.rankPos ?? 9999) - (b.rankPos ?? 9999) ||
        String(a.id).localeCompare(String(b.id))
    );
  const out = new Map<string, number>();
  sorted.forEach((row, index) => {
    out.set(String(row.id), index + 1);
  });
  return out;
}

export function tennisAssignDrawSeeds(
  players: Array<{ id: string; rankPos?: number | null }>,
  opts?: { slam?: boolean; stage?: TennisDvpStage; fieldSize?: number }
): Map<string, number> {
  const fieldSize = opts?.fieldSize ?? players.length;
  const slots = tennisDrawSeedCount(fieldSize, opts);
  const ranked = [...players]
    .filter((row) => String(row.id || '').trim() && Number(row.rankPos) > 0)
    .sort(
      (a, b) =>
        (a.rankPos ?? 9999) - (b.rankPos ?? 9999) ||
        String(a.id).localeCompare(String(b.id))
    );
  const out = new Map<string, number>();
  for (let i = 0; i < Math.min(slots, ranked.length); i += 1) {
    out.set(String(ranked[i].id), i + 1);
  }
  return out;
}

export function tennisSeedBadge(seed?: number | null): string {
  return seed != null && Number.isFinite(seed) && seed > 0 ? `[${Math.round(seed)}]` : '';
}
