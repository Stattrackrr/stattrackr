import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

export type AflHotPickCard = {
  playerName: string;
  playerTeam: string;
  statType: string;
  line: number;
  last5Avg: number | null;
  l5Hits: number | null;
  l5Total: number | null;
  gameId?: string;
  aflFantasyPosition?: string | null;
  aflDfsRole?: string | null;
};

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function hitRate(hr: unknown): { hits: number; total: number } | null {
  if (!hr || typeof hr !== 'object') return null;
  const o = hr as Record<string, unknown>;
  const hits = num(o.hits);
  const total = num(o.total);
  if (hits == null || total == null || total <= 0) return null;
  return { hits, total };
}

function scoreRow(r: Record<string, unknown>): number {
  const hr = hitRate(r.last5HitRate);
  if (hr) return (hr.hits / hr.total) * 100 + (num(r.last5Avg) ?? 0) * 0.001;
  const l5 = num(r.last5Avg);
  if (l5 != null) return l5;
  return -1;
}

/**
 * Pick other players' best disposal-related lines from AFL list API rows (one card per player).
 */
export function buildAflHotPicksFromListRows(
  rows: unknown[],
  opts: { excludePlayerName: string; limit: number }
): AflHotPickCard[] {
  const ex = normalizeAflPlayerNameForMatch(opts.excludePlayerName);
  const byPlayer = new Map<string, { row: Record<string, unknown>; score: number }>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.playerName === 'string' ? r.playerName.trim() : '';
    if (!name || normalizeAflPlayerNameForMatch(name) === ex) continue;
    const st = typeof r.statType === 'string' ? r.statType : '';
    if (st !== 'disposals' && st !== 'disposals_over') continue;
    const sc = scoreRow(r);
    const nk = normalizeAflPlayerNameForMatch(name);
    const prev = byPlayer.get(nk);
    if (!prev || sc > prev.score) byPlayer.set(nk, { row: r, score: sc });
  }
  return [...byPlayer.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map(({ row: r }) => {
      const hr = hitRate(r.last5HitRate);
      const pt = typeof r.playerTeam === 'string' ? r.playerTeam.trim() : '';
      return {
        playerName: String(r.playerName),
        playerTeam: pt,
        statType: String(r.statType || ''),
        line: num(r.line) ?? 0,
        last5Avg: num(r.last5Avg),
        l5Hits: hr?.hits ?? null,
        l5Total: hr?.total ?? null,
        gameId: typeof r.gameId === 'string' ? r.gameId : undefined,
        aflFantasyPosition: typeof r.aflFantasyPosition === 'string' ? r.aflFantasyPosition : null,
        aflDfsRole: typeof r.aflDfsRole === 'string' ? r.aflDfsRole : null,
      };
    });
}
