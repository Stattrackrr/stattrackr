/**
 * Full-universe NBA prop log (agreed build spec, Part B stage 1). Every few minutes: snapshot every
 * main-line prop on the board when a snapshot is due (first seen, 6h, 2h, close), with each book's
 * quote and its own source time, and the injury report as it stood. After games: grade every logged
 * line, both sides, with the AI picks' NBA rules. Rows are never deleted.
 */

import { gradeNbaLeg, NbaResultsSource } from '@/lib/aiPicks/grade/nba';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import { getNbaOddsCache } from '@/lib/nba/dash/odds';
import type { NbaGameOdds } from '@/lib/nba/dash/oddsTypes';
import { getNbaClubById, resolveNbaClub } from '@/lib/nba/dash/teams';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { latestLineups, lineupGameKey, starterBasis, trackStatusChanges, type LineupVersion } from './context';
import { gameLines, gameMarket, impliedTeamTotal, type LoggedLine, type PropLogPlayer } from './lines';
import { dueKinds, type ExistingSnapshot as Existing, type SnapshotKind } from './schedule';

type RowKind = SnapshotKind | 'injury_change';

/** Frozen with the start of forward logging; any change bumps a version and starts a new sample. */
export const PROP_LOG_VERSIONS = { model: 'none', feature: 'inputs-v1', policy: 'log-v1' } as const;

const H = 60 * 60 * 1000;
const HORIZON_MS = 36 * H;
const BOARD_MAX_AGE_MS = 45 * 60 * 1000;
/** Games are graded once they've had time to finish and sync. */
const GRADE_AFTER_MS = 3 * H;
const INSERT_BATCH = 400;
const GRADE_GROUPS_PER_RUN = 400;

const lineKey = (boardName: string, stat: string) => `${boardName}|${stat}`;

async function existingSnapshots(gameIds: string[]): Promise<Map<string, Map<string, Existing[]>>> {
  const out = new Map<string, Map<string, Existing[]>>();
  if (!gameIds.length) return out;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('nba_prop_snapshots')
      .select('id, game_id, board_name, stat, snapshot_kind, captured_at')
      .in('game_id', gameIds)
      .in('snapshot_kind', ['first', 't6h', 't2h', 'close'])
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`nba_prop_snapshots read: ${error.message}`);
    for (const r of data ?? []) {
      const game = out.get(r.game_id) ?? new Map<string, Existing[]>();
      const key = lineKey(r.board_name, r.stat);
      game.set(key, [...(game.get(key) ?? []), { id: r.id, kind: r.snapshot_kind, capturedAt: r.captured_at }]);
      out.set(r.game_id, game);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function rosters(teamIds: string[]): Promise<Map<string, PropLogPlayer[]>> {
  const { data, error } = await supabaseAdmin.from('nba_players').select('id, full_name, team_id').eq('is_active', true).in('team_id', teamIds.map(Number));
  if (error) throw new Error(`nba_players: ${error.message}`);
  const out = new Map<string, PropLogPlayer[]>();
  for (const r of data ?? []) {
    const club = getNbaClubById(r.team_id);
    if (!club || !r.full_name) continue;
    out.set(club.code, [...(out.get(club.code) ?? []), { id: String(r.id), name: String(r.full_name), teamCode: club.code }]);
  }
  return out;
}

type InjuryRow = { player_id: number; team_id: number | null; status: string; return_date: string | null; description: string | null; updated_at?: string | null };

async function injuryReport(): Promise<InjuryRow[]> {
  const { data, error } = await supabaseAdmin.from('nba_injuries').select('player_id, team_id, status, return_date, description, updated_at');
  if (error) throw new Error(`nba_injuries: ${error.message}`);
  return (data ?? []) as InjuryRow[];
}

type GameCtx = {
  homeCode: string;
  awayCode: string;
  market: ReturnType<typeof gameMarket>;
  injuries: InjuryRow[];
  injuriesAt: string | null;
  lineups: Map<string, LineupVersion | undefined>;
  rosters: Map<string, PropLogPlayer[]>;
};

function snapshotRow(odds: NbaGameOdds, line: LoggedLine, kind: RowKind, nowIso: string, ctx: GameCtx) {
  const team = line.player?.teamCode ?? null;
  const isHome = team === ctx.homeCode;
  const lineup = team ? ctx.lineups.get(team) : undefined;
  return {
    game_id: odds.gameId,
    tip_at: odds.commenceTime,
    player_id: line.player?.id ?? null,
    player_name: line.player?.name ?? line.boardName,
    board_name: line.boardName,
    unmatched: !line.player,
    team,
    opponent: team ? (isHome ? ctx.awayCode : ctx.homeCode) : null,
    stat: line.stat,
    snapshot_kind: kind,
    captured_at: nowIso,
    main_line: line.mainLine,
    n_books: line.nBooks,
    book_dispersion: line.bookDispersion,
    fair_over_all: line.fairOverAll,
    fair_over_all_mult: line.fairOverAllMult,
    fair_over_us: line.fairOverUs,
    fair_over_pinnacle: line.fairOverPinnacle,
    fair_over_au: line.fairOverAu,
    best_au_over: line.bestAuOver?.price ?? null,
    best_au_over_book: line.bestAuOver?.book ?? null,
    best_au_under: line.bestAuUnder?.price ?? null,
    best_au_under_book: line.bestAuUnder?.book ?? null,
    market_spread: ctx.market.homeSpread == null ? null : team ? (isHome ? ctx.market.homeSpread : -ctx.market.homeSpread) : ctx.market.homeSpread,
    market_total: ctx.market.total,
    implied_team_total: team ? impliedTeamTotal(ctx.market, isHome) : null,
    injury_report: ctx.injuries,
    injury_source_ts: ctx.injuriesAt,
    lineup_version_id: lineup?.id ?? null,
    starter_basis: team ? starterBasis(line.player, lineup, ctx.rosters.get(team) ?? []) : null,
    model_version: PROP_LOG_VERSIONS.model,
    feature_version: PROP_LOG_VERSIONS.feature,
    policy_version: PROP_LOG_VERSIONS.policy,
  };
}

function quoteRows(snapshotId: string, line: LoggedLine, nowIso: string) {
  return line.quotes.map((q) => ({
    snapshot_id: snapshotId,
    book: q.book,
    line: q.line,
    over_price: q.over,
    under_price: q.under,
    source_ts: q.sourceTs,
    captured_at: nowIso,
    coherent: q.coherent,
  }));
}

export type PropLogSummary = {
  games: number;
  lines: number;
  inserted: Record<RowKind, number>;
  closeUpdated: number;
  quotes: number;
  unmatched: number;
  statusChanges: number;
  lineupsLinked: number;
  graded: number;
  skipped: string[];
};

export async function logNbaPropSnapshots(nowMs = Date.now()): Promise<PropLogSummary> {
  const nowIso = new Date(nowMs).toISOString();
  const summary: PropLogSummary = {
    games: 0,
    lines: 0,
    inserted: { first: 0, t6h: 0, t2h: 0, close: 0, injury_change: 0 },
    closeUpdated: 0,
    quotes: 0,
    unmatched: 0,
    statusChanges: 0,
    lineupsLinked: 0,
    graded: 0,
    skipped: [],
  };
  const board = await getNbaOddsCache();
  if (!board) {
    summary.skipped.push('No NBA board stored');
    return summary;
  }
  if (!(nowMs - Date.parse(board.lastUpdated) <= BOARD_MAX_AGE_MS)) {
    summary.skipped.push(`Board is stale (${board.lastUpdated})`);
    return summary;
  }
  const games = board.games.filter((g) => {
    const tip = Date.parse(g.commenceTime);
    return g.playerProps && tip > nowMs && tip - nowMs <= HORIZON_MS;
  });
  summary.games = games.length;
  if (!games.length) return summary;

  const nextGameByTeam = new Map<number, string>();
  for (const g of [...board.games].sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime))) {
    if (!(Date.parse(g.commenceTime) > nowMs)) continue;
    for (const club of [resolveNbaClub(g.homeTeam), resolveNbaClub(g.awayTeam)]) {
      if (club && !nextGameByTeam.has(Number(club.id))) nextGameByTeam.set(Number(club.id), g.gameId);
    }
  }
  const clubs = games.flatMap((g) => [resolveNbaClub(g.homeTeam), resolveNbaClub(g.awayTeam)]).filter((c) => c != null);
  const [existing, players, status, lineups] = await Promise.all([
    existingSnapshots(games.map((g) => g.gameId)),
    rosters([...new Set(clubs.map((c) => c.id))]),
    trackStatusChanges(nowMs, nextGameByTeam),
    latestLineups([...new Set(clubs.map((c) => c.code))], nowMs),
  ]);
  summary.statusChanges = status.changes;
  if (status.error) summary.skipped.push(`Live injury report failed, using the stored one: ${status.error}`);
  const stored = status.report ? null : await injuryReport();
  const injuries: InjuryRow[] = status.report ?? stored ?? [];
  const injuriesAt = status.reportAt ?? (stored ?? []).reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null);

  const inserts: Array<{ row: ReturnType<typeof snapshotRow>; line: LoggedLine }> = [];
  const closeUpdates: Array<{ id: string; row: ReturnType<typeof snapshotRow>; line: LoggedLine }> = [];
  for (const odds of games) {
    const home = resolveNbaClub(odds.homeTeam);
    const away = resolveNbaClub(odds.awayTeam);
    if (!home || !away) {
      summary.skipped.push(`Unknown teams ${odds.awayTeam} @ ${odds.homeTeam}`);
      continue;
    }
    const teamIds = new Set([Number(home.id), Number(away.id)]);
    const gameKey = lineupGameKey(odds.commenceTime, away.code, home.code);
    const ctx: GameCtx = {
      homeCode: home.code,
      awayCode: away.code,
      market: gameMarket(odds),
      injuries: injuries.filter((r) => teamIds.has(Number(r.team_id))),
      injuriesAt,
      lineups: new Map([home.code, away.code].map((code) => [code, lineups.get(`${gameKey}|${code}`)])),
      rosters: players,
    };
    summary.lineupsLinked += [...ctx.lineups.values()].filter(Boolean).length;
    const news = [...teamIds].some((id) => status.changedTeams.has(id));
    const lines = gameLines(odds, [...(players.get(home.code) ?? []), ...(players.get(away.code) ?? [])]);
    summary.lines += lines.length;
    const tipMs = Date.parse(odds.commenceTime);
    const prior = existing.get(odds.gameId);
    for (const line of lines) {
      const seen = prior?.get(lineKey(line.boardName, line.stat)) ?? [];
      const kinds: RowKind[] = dueKinds(seen, tipMs, nowMs);
      if (news) kinds.push('injury_change');
      for (const kind of kinds) {
        const row = snapshotRow(odds, line, kind, nowIso, ctx);
        const close = kind === 'close' ? seen.find((e) => e.kind === 'close') : undefined;
        if (close) closeUpdates.push({ id: close.id, row, line });
        else inserts.push({ row, line });
        if (!line.player && kind === 'first') summary.unmatched += 1;
      }
    }
  }

  for (let i = 0; i < inserts.length; i += INSERT_BATCH) {
    const batch = inserts.slice(i, i + INSERT_BATCH);
    const { data, error } = await supabaseAdmin
      .from('nba_prop_snapshots')
      .insert(batch.map((b) => b.row))
      .select('id, game_id, board_name, stat, snapshot_kind');
    if (error) throw new Error(`nba_prop_snapshots insert: ${error.message}`);
    const key = (r: { game_id: string; board_name: string; stat: string; snapshot_kind: string }) => `${r.game_id}|${r.board_name}|${r.stat}|${r.snapshot_kind}`;
    const ids = new Map((data ?? []).map((r) => [key(r), r.id as string]));
    const quotes = batch.flatMap((b) => {
      const id = ids.get(key(b.row));
      return id ? quoteRows(id, b.line, nowIso) : [];
    });
    for (let j = 0; j < quotes.length; j += 2000) {
      const { error: qError } = await supabaseAdmin.from('nba_prop_book_quotes').insert(quotes.slice(j, j + 2000));
      if (qError) throw new Error(`nba_prop_book_quotes insert: ${qError.message}`);
    }
    summary.quotes += quotes.length;
    for (const b of batch) summary.inserted[b.row.snapshot_kind] += 1;
  }

  for (const u of closeUpdates) {
    const { error } = await supabaseAdmin.from('nba_prop_snapshots').update(u.row).eq('id', u.id);
    if (error) throw new Error(`close update: ${error.message}`);
    await supabaseAdmin.from('nba_prop_book_quotes').delete().eq('snapshot_id', u.id);
    const quotes = quoteRows(u.id, u.line, nowIso);
    const { error: qError } = await supabaseAdmin.from('nba_prop_book_quotes').insert(quotes);
    if (qError) throw new Error(`close quotes: ${qError.message}`);
    summary.closeUpdated += 1;
    summary.quotes += quotes.length;
  }
  return summary;
}

type Ungraded = { id: string; game_id: string; tip_at: string; player_id: string | null; stat: string; main_line: number };

/** Grades both sides of every logged line whose game is over, with the AI picks' NBA rules. */
export async function gradeNbaPropSnapshots(nowMs = Date.now()): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('nba_prop_snapshots')
    .select('id, game_id, tip_at, player_id, stat, main_line')
    .is('graded_at', null)
    .lt('tip_at', new Date(nowMs - GRADE_AFTER_MS).toISOString())
    .order('tip_at')
    .limit(5000);
  if (error) throw new Error(`ungraded snapshots: ${error.message}`);
  const groups = new Map<string, Ungraded[]>();
  for (const r of (data ?? []) as Ungraded[]) {
    const key = `${r.game_id}|${r.player_id ?? ''}|${r.stat}|${r.main_line}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const source = new NbaResultsSource();
  const gradedAt = new Date(nowMs).toISOString();
  let graded = 0;
  for (const rows of [...groups.values()].slice(0, GRADE_GROUPS_PER_RUN)) {
    const r = rows[0]!;
    const ids = rows.map((x) => x.id);
    let update: Record<string, unknown>;
    if (!r.player_id) {
      update = { result_over: 'void', result_under: 'void', result_note: 'Unmatched name', graded_at: gradedAt };
    } else {
      const leg = (side: 'over' | 'under') =>
        ({ eventKey: r.game_id, startsAt: r.tip_at, market: r.stat, playerId: r.player_id, side, line: Number(r.main_line) }) as AiPickLeg;
      const [over, under] = await Promise.all([gradeNbaLeg(leg('over'), source, nowMs), gradeNbaLeg(leg('under'), source, nowMs)]);
      if (!over || !under) continue;
      const box = (await source.box(r.game_id)).find((b) => String(b.player_id) === r.player_id);
      const minutes = box?.minutes == null ? null : Number(box.minutes);
      const played = minutes != null && minutes > 0;
      const secondHalf = played && minutes! <= 24 ? await source.secondHalf?.(r.game_id) : null;
      update = {
        played,
        result_value: over.value,
        result_minutes: played ? minutes : 0,
        early_exit: !played ? null : minutes! > 24 ? false : secondHalf ? !secondHalf.has(r.player_id) : null,
        result_over: over.status,
        result_under: under.status,
        result_note: over.note,
        graded_at: gradedAt,
      };
    }
    const { error: uError } = await supabaseAdmin.from('nba_prop_snapshots').update(update).in('id', ids);
    if (uError) throw new Error(`grade update: ${uError.message}`);
    graded += ids.length;
  }
  return graded;
}
