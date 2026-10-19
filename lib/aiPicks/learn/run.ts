/**
 * Nightly learning run: gather graded watched plays and settled picks, work out each sport's
 * adjustments and store a new active version only when something changed.
 */

import { subjectId } from '@/lib/aiPicks/decide/select';
import { learnSport, type LearnResult, type LearnSample } from '@/lib/aiPicks/learn/learn';
import { loadActiveParams } from '@/lib/aiPicks/learn/state';
import { modelGroup, type AiSportParams } from '@/lib/aiPicks/params';
import {
  finishRun,
  listGradedWatchRows,
  listPicksPostedSince,
  saveLearningState,
  startRun,
  type WatchRow,
} from '@/lib/aiPicks/server';

/** Results older than this no longer describe how the markets and model behave. */
const LOOKBACK_DAYS = 120;

export function watchSample(row: WatchRow): LearnSample | null {
  if (row.result_status !== 'win' && row.result_status !== 'loss') return null;
  const blended = row.model_prob == null ? NaN : Number(row.model_prob);
  if (!Number.isFinite(blended)) return null;
  return {
    group: modelGroup({ sport: row.sport, market: row.market, marketKind: row.market_kind ?? 'main' }),
    market: row.market,
    side: row.side,
    line: row.line == null ? null : Number(row.line),
    won: row.result_status === 'win' ? 1 : 0,
    model: row.raw_model_prob == null ? null : Number(row.raw_model_prob),
    marketProb: row.market_prob == null ? null : Number(row.market_prob),
    blended,
    contextBase: row.base_model_prob == null ? null : Number(row.base_model_prob),
    contextFull: row.full_model_prob == null ? null : Number(row.full_model_prob),
    cluster: subjectId({
      sport: row.sport,
      eventKey: row.event_key,
      eventLabel: row.event_label ?? row.event_key,
      startsAt: row.starts_at,
      market: row.market,
      player: row.player,
    }),
  };
}

export type AiLearnSummary = {
  ranAt: string;
  sports: Record<string, { version: number | null; samples: number; picks: number; changes: string[] }>;
  errors: string[];
};

export async function runAiLearning(nowMs = Date.now()): Promise<AiLearnSummary> {
  const summary: AiLearnSummary = { ranAt: new Date(nowMs).toISOString(), sports: {}, errors: [] };
  const runId = await startRun('learn');
  try {
    const params = await loadActiveParams(summary.errors);
    const sinceIso = new Date(nowMs - LOOKBACK_DAYS * 86_400_000).toISOString();
    const [rows, picks] = await Promise.all([listGradedWatchRows(sinceIso), listPicksPostedSince(sinceIso, 3000)]);
    const sports = [
      ['nbl', params.nbl],
      ['tennis', params.tennis],
    ] as const;
    for (const [sport, current] of sports) {
      const samples = rows.filter((r) => r.sport === sport).map(watchSample).filter((s): s is LearnSample => s != null);
      const sportPicks = picks.filter((p) => p.sport === sport && p.status !== 'pending');
      const result: LearnResult<AiSportParams> = learnSport(sport, current, samples, sportPicks, (leg) => modelGroup(leg));
      let version: number | null = null;
      if (result.changes.length) {
        version = await saveLearningState(sport, result.params, result.metrics, result.changes.join('; '));
      }
      summary.sports[sport] = { version, samples: samples.length, picks: sportPicks.length, changes: result.changes };
    }
  } catch (e) {
    summary.errors.push((e as Error).message);
  }
  await finishRun(runId, {
    considered: Object.values(summary.sports).reduce((a, s) => a + s.samples, 0),
    posted: 0,
    tokensIn: 0,
    tokensOut: 0,
    summary: { ...summary },
    error: summary.errors.length ? summary.errors.slice(0, 5).join(' | ') : null,
  });
  return summary;
}
