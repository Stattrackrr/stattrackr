import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { aiPickFromRow, aiPickLegFromRow, type AiPickLegRow, type AiPickRow } from '@/lib/aiPicks/rows';
import type { AiPick, AiPickLeg, AiPickStatus } from '@/lib/aiPicks/types';
import { watchBatches } from '@/lib/aiPicks/decide/watch';

// AI picks tables are not in the generated Supabase schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as any;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function listPendingLegsStartedBefore(iso: string, limit = 300): Promise<AiPickLeg[]> {
  const rows = check<AiPickLegRow[] | null>(
    await db().from('ai_pick_legs').select('*').eq('status', 'pending').lt('starts_at', iso).order('starts_at').limit(limit),
    'pending legs'
  );
  return (rows ?? []).map(aiPickLegFromRow);
}

export async function listLegsMissingClosing(sport: string, startedAfterIso: string, startedBeforeIso: string): Promise<AiPickLeg[]> {
  const rows = check<AiPickLegRow[] | null>(
    await db()
      .from('ai_pick_legs')
      .select('*')
      .eq('sport', sport)
      .is('closing_line', null)
      .gt('starts_at', startedAfterIso)
      .lt('starts_at', startedBeforeIso)
      .limit(300),
    'legs missing closing'
  );
  return (rows ?? []).map(aiPickLegFromRow);
}

export async function listPendingPicks(): Promise<AiPick[]> {
  const rows = check<AiPickRow[] | null>(
    await db().from('ai_picks').select('*, ai_pick_legs(*)').eq('status', 'pending').limit(500),
    'pending picks'
  );
  return (rows ?? []).map(aiPickFromRow);
}

export async function saveLegGrade(
  legId: string,
  grade: { status: Exclude<AiPickStatus, 'pending'>; value: number | null; note: string },
  gradedAtIso: string
): Promise<void> {
  check(
    await db()
      .from('ai_pick_legs')
      .update({ status: grade.status, result_value: grade.value, result_note: grade.note, graded_at: gradedAtIso })
      .eq('id', legId)
      .eq('status', 'pending'),
    'save leg grade'
  );
}

export async function saveLegClosing(legId: string, line: number | null, price: number | null): Promise<void> {
  check(await db().from('ai_pick_legs').update({ closing_line: line, closing_price: price }).eq('id', legId), 'save closing');
}

export async function savePickSettlement(pickId: string, status: AiPickStatus, profitUnits: number | null, settledAtIso: string): Promise<void> {
  check(
    await db()
      .from('ai_picks')
      .update({ status, profit_units: profitUnits, settled_at: settledAtIso })
      .eq('id', pickId)
      .eq('status', 'pending'),
    'save pick settlement'
  );
}

export async function readAiPicksSettings(): Promise<{ paused: boolean; isPublic: boolean }> {
  const row = check<{ paused: boolean; is_public: boolean } | null>(
    await db().from('ai_picks_settings').select('paused, is_public').eq('id', true).maybeSingle(),
    'settings'
  );
  return { paused: Boolean(row?.paused), isPublic: Boolean(row?.is_public) };
}

export async function listPicksPostedSince(iso: string, limit = 500): Promise<AiPick[]> {
  const rows = check<AiPickRow[] | null>(
    await db().from('ai_picks').select('*, ai_pick_legs(*)').gte('posted_at', iso).order('posted_at', { ascending: false }).limit(limit),
    'recent picks'
  );
  return (rows ?? []).map(aiPickFromRow);
}

export async function listPendingLegsStartingBetween(fromIso: string, toIso: string): Promise<AiPickLeg[]> {
  const rows = check<AiPickLegRow[] | null>(
    await db().from('ai_pick_legs').select('*').eq('status', 'pending').gt('starts_at', fromIso).lte('starts_at', toIso).limit(300),
    'legs about to start'
  );
  return (rows ?? []).map(aiPickLegFromRow);
}

export type WatchStatus = 'watching' | 'posted' | 'dropped' | 'expired';

export type WatchRow = {
  candidate_key: string;
  sport: string;
  event_key: string;
  starts_at: string;
  market: string;
  player: string | null;
  side: string;
  line: number | null;
  best_price: number | null;
  bookmaker: string | null;
  model_prob: number | null;
  ev: number | null;
  score: number | null;
  status: WatchStatus;
  reason: string | null;
  history: unknown;
  first_seen_at?: string;
  last_seen_at: string;
  event_label?: string | null;
  market_kind?: string | null;
  player_id?: string | null;
  team?: string | null;
  raw_model_prob?: number | null;
  market_prob?: number | null;
  push_prob?: number | null;
  /** Model alone with game context off / at full strength (see AiCandidate.contextProbs). */
  base_model_prob?: number | null;
  full_model_prob?: number | null;
  result_status?: 'win' | 'loss' | 'push' | 'void' | null;
  result_value?: number | null;
  graded_at?: string | null;
};

/** Watched plays whose games are over and not yet graded. */
export async function listWatchRowsToGrade(startedBeforeIso: string, limit = 400): Promise<WatchRow[]> {
  const rows = check<WatchRow[] | null>(
    await db()
      .from('ai_pick_watchlist')
      .select('*')
      .is('graded_at', null)
      .neq('market', 'multi')
      .lt('starts_at', startedBeforeIso)
      .order('starts_at')
      .limit(limit),
    'watchlist to grade'
  );
  return rows ?? [];
}

export async function saveWatchGrade(
  key: string,
  grade: { status: 'win' | 'loss' | 'push' | 'void'; value: number | null },
  gradedAtIso: string
): Promise<void> {
  check(
    await db()
      .from('ai_pick_watchlist')
      .update({ result_status: grade.status, result_value: grade.value, graded_at: gradedAtIso })
      .eq('candidate_key', key),
    'save watch grade'
  );
}

export async function listGradedWatchRows(sinceIso: string): Promise<WatchRow[]> {
  const out: WatchRow[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = check<WatchRow[] | null>(
      await db()
        .from('ai_pick_watchlist')
        .select('*')
        .not('graded_at', 'is', null)
        .gte('starts_at', sinceIso)
        .order('starts_at')
        .range(from, from + 999),
      'graded watchlist'
    );
    out.push(...(rows ?? []));
    if (!rows || rows.length < 1000 || out.length >= 20000) break;
  }
  return out;
}

export type LearningStateRow = { sport: string; version: number; params: unknown; metrics: unknown; created_at: string };

export async function listActiveLearningStates(): Promise<LearningStateRow[]> {
  const rows = check<LearningStateRow[] | null>(
    await db().from('ai_learning_state').select('sport, version, params, metrics, created_at').eq('is_active', true),
    'learning state'
  );
  return rows ?? [];
}

/** New version for the sport, made active only once it is safely stored. */
export async function saveLearningState(sport: string, params: unknown, metrics: unknown, note: string): Promise<number> {
  const latest = check<Array<{ version: number }> | null>(
    await db().from('ai_learning_state').select('version').eq('sport', sport).order('version', { ascending: false }).limit(1),
    'latest learning version'
  );
  const version = (latest?.[0]?.version ?? 0) + 1;
  check(await db().from('ai_learning_state').insert({ sport, version, is_active: false, params, metrics, note }), 'insert learning state');
  check(await db().from('ai_learning_state').update({ is_active: false }).eq('sport', sport).eq('is_active', true), 'deactivate learning state');
  check(await db().from('ai_learning_state').update({ is_active: true }).eq('sport', sport).eq('version', version), 'activate learning state');
  return version;
}

export async function listSettledPickStats(
  sinceIso: string
): Promise<Array<{ sport: string; status: AiPickStatus; units: number; profitUnits: number | null; postedAt: string }>> {
  const rows = check<Array<{ sport: string; status: AiPickStatus; units: number | string; profit_units: number | string | null; posted_at: string }> | null>(
    await db().from('ai_picks').select('sport, status, units, profit_units, posted_at').neq('status', 'pending').gte('posted_at', sinceIso).limit(5000),
    'settled picks'
  );
  return (rows ?? []).map((r) => ({
    sport: r.sport,
    status: r.status,
    units: Number(r.units),
    profitUnits: r.profit_units == null ? null : Number(r.profit_units),
    postedAt: r.posted_at,
  }));
}

export async function listWatchRows(keys: string[]): Promise<WatchRow[]> {
  const out: WatchRow[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const rows = check<WatchRow[] | null>(
      await db().from('ai_pick_watchlist').select('*').in('candidate_key', keys.slice(i, i + 100)),
      'watchlist'
    );
    out.push(...(rows ?? []));
  }
  return out;
}

export async function listWatchingKeys(): Promise<Array<{ candidate_key: string; starts_at: string }>> {
  const rows = check<Array<{ candidate_key: string; starts_at: string }> | null>(
    await db().from('ai_pick_watchlist').select('candidate_key, starts_at').eq('status', 'watching').limit(2000),
    'watching'
  );
  return rows ?? [];
}

/** Plays turned down on review whose games have not started yet. */
export async function countOpenReviewRejections(nowIso: string): Promise<number> {
  const res = await db()
    .from('ai_pick_watchlist')
    .select('candidate_key', { count: 'exact', head: true })
    .eq('status', 'dropped')
    .like('reason', 'AI review:%')
    .gt('starts_at', nowIso);
  if (res.error) throw new Error(`review rejections: ${res.error.message}`);
  return res.count ?? 0;
}

/** Multis already posted or turned down recently, so the next best pair gets a turn. */
export async function listClosedMultiKeys(sinceIso: string): Promise<string[]> {
  const rows = check<Array<{ candidate_key: string }> | null>(
    await db()
      .from('ai_pick_watchlist')
      .select('candidate_key')
      .eq('market', 'multi')
      .in('status', ['posted', 'dropped'])
      .gte('first_seen_at', sinceIso)
      .limit(500),
    'closed multis'
  );
  return (rows ?? []).map((r) => r.candidate_key);
}

const CONTEXT_COLUMNS = /base_model_prob|full_model_prob/;

export async function upsertWatchRows(rows: WatchRow[]): Promise<void> {
  for (const batch of watchBatches(rows)) {
    // Before migrations/ai_picks_context_learning.sql is run the columns do not exist; keep scanning without them.
    const res = await db().from('ai_pick_watchlist').upsert(batch, { onConflict: 'candidate_key' });
    if (res.error && CONTEXT_COLUMNS.test(res.error.message)) {
      const stripped = batch.map(({ base_model_prob: _b, full_model_prob: _f, ...rest }) => rest);
      check(await db().from('ai_pick_watchlist').upsert(stripped, { onConflict: 'candidate_key' }), 'watchlist upsert');
      continue;
    }
    check(res, 'watchlist upsert');
  }
}

export async function setWatchStatus(keys: string[], status: WatchStatus, reason: string, onlyFrom: WatchStatus = 'watching'): Promise<void> {
  for (let i = 0; i < keys.length; i += 100) {
    check(
      await db()
        .from('ai_pick_watchlist')
        .update({ status, reason })
        .in('candidate_key', keys.slice(i, i + 100))
        .eq('status', onlyFrom),
      'watchlist status'
    );
  }
}

/** Atomically moves a watching row to posted; false when another run got there first. */
export async function claimWatch(key: string): Promise<boolean> {
  const rows = check<Array<{ candidate_key: string }> | null>(
    await db()
      .from('ai_pick_watchlist')
      .update({ status: 'posted', reason: 'Posted' })
      .eq('candidate_key', key)
      .eq('status', 'watching')
      .select('candidate_key'),
    'claim'
  );
  return Boolean(rows?.length);
}

export async function releaseWatch(key: string): Promise<void> {
  await db().from('ai_pick_watchlist').update({ status: 'watching', reason: null }).eq('candidate_key', key).eq('status', 'posted');
}

export type NewPickLeg = Omit<AiPickLegRow, 'id' | 'pick_id' | 'status' | 'result_value' | 'result_note' | 'closing_line' | 'closing_price' | 'graded_at'>;
export type NewPick = {
  kind: 'single' | 'multi';
  sport: string;
  title: string;
  write_up: string;
  units: number;
  price: number;
  bookmaker: string;
  model_prob: number;
  ev: number;
  first_starts_at: string;
  model_version: string;
  context: Record<string, unknown>;
};

export async function insertPick(pick: NewPick, legs: NewPickLeg[]): Promise<string> {
  const created = check<{ id: string }>(await db().from('ai_picks').insert(pick).select('id').single(), 'insert pick');
  const res = await db()
    .from('ai_pick_legs')
    .insert(legs.map((leg) => ({ ...leg, pick_id: created.id })));
  if (res.error) {
    await db().from('ai_picks').delete().eq('id', created.id);
    throw new Error(`insert legs: ${res.error.message}`);
  }
  return created.id;
}

export type AiPickRunType = 'scan' | 'grade' | 'learn';

export async function startRun(runType: AiPickRunType, sport: string | null = null): Promise<string | null> {
  const res = await db().from('ai_pick_runs').insert({ run_type: runType, sport }).select('id').single();
  return res.error ? null : (res.data?.id as string);
}

export async function finishRun(
  id: string | null,
  fields: {
    considered?: number;
    posted?: number;
    graded?: number;
    tokensIn?: number;
    tokensOut?: number;
    summary?: Record<string, unknown>;
    error?: string | null;
  }
): Promise<void> {
  if (!id) return;
  await db()
    .from('ai_pick_runs')
    .update({
      finished_at: new Date().toISOString(),
      considered: fields.considered ?? 0,
      posted: fields.posted ?? 0,
      graded: fields.graded ?? 0,
      tokens_in: fields.tokensIn ?? 0,
      tokens_out: fields.tokensOut ?? 0,
      summary: fields.summary ?? {},
      error: fields.error ?? null,
    })
    .eq('id', id);
}
