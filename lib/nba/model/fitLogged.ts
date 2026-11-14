import { CLEAN_FEATURE_VERSIONS } from '@/lib/nba/propLog/versions';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { testCandidates, type CandidateResult } from './candidates';
import { BASE_STATS, CANDIDATE_FEATURES, type ModelLine } from './design';
import { COMBO_STATS, fitLines, toModelLine, type LoggedFit, type SnapshotRow } from './fitLines';

const PAGE = 1000;

/** Graded lines of one snapshot kind from the prop log (base stats, plus combos when asked). */
export async function loadModelLines(kind: 't2h' | 'close', since?: string, opts: { combos?: boolean } = {}): Promise<ModelLine[]> {
  const stats = opts.combos ? [...BASE_STATS, ...COMBO_STATS] : [...BASE_STATS];
  const out: ModelLine[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin
      .from('nba_prop_snapshots')
      .select('game_id, player_id, stat, tip_at, fair_over_all, n_books, book_dispersion, features, result_over, feature_version')
      .eq('snapshot_kind', kind)
      .not('player_id', 'is', null)
      .in('result_over', ['win', 'loss'])
      .in('stat', stats)
      .order('tip_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (since) q = q.gte('tip_at', since);
    const { data, error } = await q;
    if (error) throw new Error(`nba_prop_snapshots: ${error.message}`);
    for (const r of (data ?? []) as SnapshotRow[]) {
      const line = toModelLine(r, opts);
      if (line) out.push(line);
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

export type LoggedFits = {
  /** Every graded line since logging began: the residual experiment's unbroken record. */
  fit: LoggedFit;
  candidates: CandidateResult[];
  /**
   * The same fit and tests on lines whose inputs are sound (CLEAN_FEATURE_VERSIONS). Lines logged
   * before inputs-v6 carry wrong minutes, usage, rest and news inputs, so coefficients are only
   * promoted from this fit.
   */
  clean: { featureVersions: readonly string[]; fit: LoggedFit; candidates: CandidateResult[] };
};

/** The v1 fit and every feature-library test, from one read of the logged lines. */
export async function fitLoggedLines(since?: string): Promise<LoggedFits> {
  const [t2h, closeLines] = await Promise.all([loadModelLines('t2h', since, { combos: true }), loadModelLines('close', since)]);
  const isBase = (l: ModelLine) => (BASE_STATS as readonly string[]).includes(l.stat);
  const isClean = (l: ModelLine) => l.featureVersion != null && CLEAN_FEATURE_VERSIONS.includes(l.featureVersion);
  const cleanT2h = t2h.filter(isClean);
  const day = new Date().toISOString().slice(0, 10);
  return {
    fit: fitLines(t2h.filter(isBase), closeLines),
    candidates: testCandidates(t2h, CANDIDATE_FEATURES),
    clean: {
      featureVersions: CLEAN_FEATURE_VERSIONS,
      fit: fitLines(cleanT2h.filter(isBase), closeLines.filter(isClean), `v1c-${day}`),
      candidates: testCandidates(cleanT2h, CANDIDATE_FEATURES),
    },
  };
}
