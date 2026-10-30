import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { BASE_STATS, type ModelLine } from './design';
import { fitLines, toModelLine, type LoggedFit, type SnapshotRow } from './fitLines';

const PAGE = 1000;

/** Graded base-stat lines of one snapshot kind from the prop log. */
export async function loadModelLines(kind: 't2h' | 'close', since?: string): Promise<ModelLine[]> {
  const out: ModelLine[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin
      .from('nba_prop_snapshots')
      .select('game_id, player_id, stat, tip_at, fair_over_all, n_books, book_dispersion, features, result_over')
      .eq('snapshot_kind', kind)
      .not('player_id', 'is', null)
      .in('result_over', ['win', 'loss'])
      .in('stat', [...BASE_STATS])
      .order('tip_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (since) q = q.gte('tip_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`nba_prop_snapshots: ${error.message}`);
    for (const r of (data ?? []) as SnapshotRow[]) {
      const line = toModelLine(r);
      if (line) out.push(line);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

export async function fitLoggedLines(since?: string): Promise<LoggedFit> {
  const [lines, closeLines] = await Promise.all([loadModelLines('t2h', since), loadModelLines('close', since)]);
  return fitLines(lines, closeLines);
}
