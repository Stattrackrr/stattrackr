/**
 * Point-in-time context for the NBA prop log (agreed build spec, Part B stage 2):
 *   - injury-status changes, from BallDontLie's live report diffed against the previous pull, each
 *     logged with when we saw it (the feed carries no change time of its own);
 *   - RotoWire lineup versions, one row per change, never overwritten, so each snapshot can say whether
 *     the player was a predicted or confirmed starter at that moment.
 */

import { createHash } from 'crypto';
import { BdlClient } from '@/lib/nba/bdl/client';
import { getNbaClubById } from '@/lib/nba/dash/teams';
import type { RwPage } from '@/lib/nba/rotowireLineups';
import { mapInjury } from '@/lib/nba/sync/mappers';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { diffReports, type LineupVersion, type ReportRow } from './contextRules';

export { lineupGameKey, starterBasis, type LineupVersion } from './contextRules';

const STATE_KEY = 'nba_prop_log_injury_state_v1';
const STATE_TTL_S = 3 * 24 * 60 * 60;
type ReportState = { at: string; players: Record<string, ReportRow> };

async function liveReport(): Promise<ReportRow[]> {
  const bdl = new BdlClient({ apiKey: process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '', perMinute: 120, maxRetries: 1 });
  const raw = await bdl.all<Parameters<typeof mapInjury>[0]>('/v1/player_injuries');
  const rows = raw
    .filter((r) => r.player?.id)
    .map((r) => mapInjury(r))
    .filter((r) => r.status)
    .map((r) => ({ player_id: Number(r.player_id), team_id: r.team_id == null ? null : Number(r.team_id), status: String(r.status), return_date: r.return_date, description: r.description }));
  if (!rows.length) throw new Error('live injury report came back empty');
  return rows;
}

export type StatusResult = {
  /** The live report (null if the pull failed; callers fall back to the stored table). */
  report: ReportRow[] | null;
  reportAt: string | null;
  changes: number;
  /** Team ids with a change this run; their games get an injury_change snapshot. */
  changedTeams: Set<number>;
  error?: string;
};

/**
 * Pulls the live report, logs every change since the last pull, and remembers this pull. The first
 * pull only sets the baseline: there is nothing to diff against, and logging the whole report as
 * "changes" would fake a burst of news.
 */
export async function trackStatusChanges(nowMs: number, nextGameByTeam: Map<number, string>): Promise<StatusResult> {
  const nowIso = new Date(nowMs).toISOString();
  let report: ReportRow[];
  try {
    report = await liveReport();
  } catch (e) {
    return { report: null, reportAt: null, changes: 0, changedTeams: new Set(), error: (e as Error).message };
  }
  const state = await sharedCache.getJSON<ReportState>(STATE_KEY);
  const changes = state ? diffReports(state.players, report) : [];
  if (changes.length) {
    const rows = changes.map((c) => ({
      player_id: c.player_id,
      team: c.team_id == null ? null : getNbaClubById(c.team_id)?.code ?? null,
      game_id: c.team_id == null ? null : nextGameByTeam.get(c.team_id) ?? null,
      from_status: c.from_status,
      to_status: c.to_status,
      designation: c.designation,
      injury_type: c.injury_type,
      return_date: c.return_date,
      source_ts: null,
      captured_at: nowIso,
    }));
    const { error } = await supabaseAdmin.from('nba_status_changes').upsert(rows, { onConflict: 'player_id,to_status,captured_at', ignoreDuplicates: true });
    if (error) throw new Error(`nba_status_changes: ${error.message}`);
  }
  await sharedCache.setJSON(STATE_KEY, { at: nowIso, players: Object.fromEntries(report.map((r) => [String(r.player_id), r])) }, STATE_TTL_S);
  return {
    report,
    reportAt: nowIso,
    changes: changes.length,
    changedTeams: new Set(changes.flatMap((c) => (c.team_id == null ? [] : [c.team_id]))),
  };
}

const lineupHash = (t: { confirmed: boolean; status: string; starters: unknown; mayNotPlay: unknown }) =>
  createHash('sha1').update(JSON.stringify({ c: t.confirmed, s: t.status, st: t.starters, m: t.mayNotPlay })).digest('hex');

/** Each pre-tip team lineup on the page, as a version row; an unchanged lineup is skipped by its hash. */
export async function recordLineupVersions(page: RwPage, nowMs: number): Promise<number> {
  if (!page.date) return 0;
  const fetchedAt = new Date(nowMs).toISOString();
  const rows = page.games
    .filter((g) => !g.tipAt || Date.parse(g.tipAt) > nowMs)
    .flatMap((g) =>
      [g.away, g.home].map((t) => ({
        game_key: `${page.date}|${g.away.team}@${g.home.team}`,
        team: t.team,
        fetched_at: fetchedAt,
        confirmed: t.confirmed,
        starters: t.starters,
        may_not_play: t.mayNotPlay,
        source: 'rotowire',
        content_hash: lineupHash(t),
      }))
    );
  if (!rows.length) return 0;
  const { data, error } = await supabaseAdmin
    .from('nba_lineup_versions')
    .upsert(rows, { onConflict: 'game_key,team,content_hash', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`nba_lineup_versions: ${error.message}`);
  return data?.length ?? 0;
}

/** The latest lineup version per game and team fetched in the last day, keyed `${gameKey}|${team}`. */
export async function latestLineups(teams: string[], nowMs: number): Promise<Map<string, LineupVersion>> {
  const out = new Map<string, LineupVersion>();
  if (!teams.length) return out;
  const { data, error } = await supabaseAdmin
    .from('nba_lineup_versions')
    .select('id, game_key, team, confirmed, starters, may_not_play, fetched_at')
    .in('team', teams)
    .gte('fetched_at', new Date(nowMs - 24 * 60 * 60 * 1000).toISOString())
    .lte('fetched_at', new Date(nowMs).toISOString())
    .order('fetched_at', { ascending: false });
  if (error) throw new Error(`nba_lineup_versions read: ${error.message}`);
  for (const r of data ?? []) {
    const key = `${r.game_key}|${r.team}`;
    if (out.has(key)) continue;
    out.set(key, { id: r.id, gameKey: r.game_key, team: r.team, confirmed: r.confirmed, starters: r.starters ?? [], mayNotPlay: r.may_not_play ?? [] });
  }
  return out;
}
