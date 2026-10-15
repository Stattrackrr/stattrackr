import { nblClosingLine } from '@/lib/aiPicks/grade/closing';
import { gradeNblLeg, NblResultsSource } from '@/lib/aiPicks/grade/nbl';
import type { LegGrade } from '@/lib/aiPicks/grade/rules';
import { gradeTennisLeg, loadTennisLogs, loadTennisLogsWithFreshResults } from '@/lib/aiPicks/grade/tennis';
import {
  finishRun,
  listLegsMissingClosing,
  listPendingLegsStartedBefore,
  listPendingPicks,
  listWatchRowsToGrade,
  saveLegClosing,
  saveLegGrade,
  savePickSettlement,
  saveWatchGrade,
  startRun,
  type WatchRow,
} from '@/lib/aiPicks/server';
import { settlePick } from '@/lib/aiPicks/settle';
import { isNblGameMarket } from '@/lib/aiPicks/markets';
import type { AiPickLeg } from '@/lib/aiPicks/types';

/** Shortest a leg can be in play before results are worth checking. */
const MIN_PLAY_MS = 75 * 60 * 1000;
const CLOSING_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

export type GradeRunSummary = {
  legsChecked: number;
  legsGraded: number;
  picksSettled: number;
  closingCaptured: number;
  watchGraded: number;
  errors: string[];
};

async function gradeLeg(
  leg: AiPickLeg,
  ctx: { nbl: NblResultsSource; tennisLogs: Awaited<ReturnType<typeof loadTennisLogs>>; nowMs: number }
): Promise<LegGrade | null> {
  if (leg.sport === 'nbl') return gradeNblLeg(leg, ctx.nbl, ctx.nowMs);
  if (leg.sport === 'tennis') return gradeTennisLeg(leg, ctx.tennisLogs, ctx.nowMs);
  return null;
}

async function captureClosingLines(nowMs: number, summary: GradeRunSummary): Promise<void> {
  const legs = await listLegsMissingClosing(
    'nbl',
    new Date(nowMs - CLOSING_LOOKBACK_MS).toISOString(),
    new Date(nowMs - 10 * 60 * 1000).toISOString()
  );
  for (const leg of legs) {
    try {
      const close = await nblClosingLine(leg);
      if (!close) continue;
      await saveLegClosing(leg.id, close.line, close.price);
      summary.closingCaptured += 1;
    } catch (e) {
      summary.errors.push(`closing ${leg.id}: ${(e as Error).message}`);
    }
  }
}

/** A watched play in leg form, so the same graders score it. */
export function watchAsLeg(row: WatchRow): AiPickLeg | null {
  if (!row.event_label) return null;
  if (!row.player_id && !(row.sport === 'nbl' && isNblGameMarket(row.market))) return null;
  return {
    id: row.candidate_key,
    pickId: '',
    legIndex: 0,
    sport: row.sport,
    eventKey: row.event_key,
    eventLabel: row.event_label,
    startsAt: row.starts_at,
    market: row.market,
    marketKind: (row.market_kind ?? 'main') as AiPickLeg['marketKind'],
    player: row.player,
    playerId: row.player_id ?? null,
    team: row.team ?? null,
    side: row.side as AiPickLeg['side'],
    line: row.line == null ? null : Number(row.line),
    price: Number(row.best_price ?? 0),
    bookmaker: row.bookmaker ?? '',
    modelProb: row.model_prob == null ? null : Number(row.model_prob),
    status: 'pending',
    resultValue: null,
    resultNote: null,
    closingLine: null,
    closingPrice: null,
    gradedAt: null,
  };
}

/** Grade watched plays (posted or not) so learning sees every result, not just the posted few. */
async function gradeWatchlist(ctx: { nbl: NblResultsSource; nowMs: number }, summary: GradeRunSummary): Promise<void> {
  const rows = await listWatchRowsToGrade(new Date(ctx.nowMs - MIN_PLAY_MS).toISOString());
  const nowIso = new Date(ctx.nowMs).toISOString();
  const legs: AiPickLeg[] = [];
  for (const row of rows) {
    const leg = watchAsLeg(row);
    if (leg) legs.push(leg);
    // Rows without the ids to grade them (older rows) are closed out as void.
    else await saveWatchGrade(row.candidate_key, { status: 'void', value: null }, nowIso);
  }
  const tennisLogs = await loadTennisLogs(legs.filter((l) => l.sport === 'tennis'));
  for (const leg of legs) {
    try {
      const grade = await gradeLeg(leg, { nbl: ctx.nbl, tennisLogs, nowMs: ctx.nowMs });
      if (!grade) continue;
      await saveWatchGrade(leg.id, { status: grade.status, value: grade.value }, nowIso);
      summary.watchGraded += 1;
    } catch (e) {
      summary.errors.push(`watch ${leg.id}: ${(e as Error).message}`);
    }
  }
}

/** Grade every started pending leg, settle picks whose legs are done, and log the run. */
export async function gradeAiPicks(nowMs = Date.now()): Promise<GradeRunSummary> {
  const summary: GradeRunSummary = { legsChecked: 0, legsGraded: 0, picksSettled: 0, closingCaptured: 0, watchGraded: 0, errors: [] };
  const runId = await startRun('grade');
  const nowIso = new Date(nowMs).toISOString();
  try {
    const legs = await listPendingLegsStartedBefore(new Date(nowMs - MIN_PLAY_MS).toISOString());
    summary.legsChecked = legs.length;
    const ctx = {
      nbl: new NblResultsSource(),
      tennisLogs: await loadTennisLogsWithFreshResults(legs, nowMs),
      nowMs,
    };
    for (const leg of legs) {
      try {
        const grade = await gradeLeg(leg, ctx);
        if (!grade) continue;
        await saveLegGrade(leg.id, grade, nowIso);
        summary.legsGraded += 1;
      } catch (e) {
        summary.errors.push(`leg ${leg.id}: ${(e as Error).message}`);
      }
    }

    for (const pick of await listPendingPicks()) {
      const settled = settlePick(pick, pick.legs);
      if (settled.status === 'pending') continue;
      await savePickSettlement(pick.id, settled.status, settled.profitUnits, nowIso);
      summary.picksSettled += 1;
    }

    await captureClosingLines(nowMs, summary);
    try {
      await gradeWatchlist({ nbl: ctx.nbl, nowMs }, summary);
    } catch (e) {
      summary.errors.push(`watchlist: ${(e as Error).message}`);
    }
    await finishRun(runId, {
      considered: summary.legsChecked,
      graded: summary.legsGraded,
      summary: { ...summary },
      error: summary.errors.length ? summary.errors.slice(0, 5).join(' | ') : null,
    });
    return summary;
  } catch (e) {
    const message = (e as Error).message;
    summary.errors.push(message);
    await finishRun(runId, { considered: summary.legsChecked, graded: summary.legsGraded, summary: { ...summary }, error: message });
    return summary;
  }
}
