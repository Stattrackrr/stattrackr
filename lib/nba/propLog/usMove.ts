/**
 * Event-driven prop-log snapshots when DraftKings and FanDuel both move the same way
 * (agreed build spec Part B). Detection lives in lib/nba/lag; this writes nba_prop_snapshots
 * with snapshot_kind = us_move so the residual sample can see the board at those moments.
 */

import { getNbaOddsCache } from '@/lib/nba/dash/odds';
import type { NbaGameOdds } from '@/lib/nba/dash/oddsTypes';
import { getNbaClubById, resolveNbaClub } from '@/lib/nba/dash/teams';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { latestLineups, lineupGameKey, starterBasis, type LineupVersion } from './context';
import { addModelFeatures } from './features';
import { gameLines, gameMarket, impliedTeamTotal, type LoggedLine, type PropLogPlayer } from './lines';
import { PROP_LOG_VERSIONS } from './versions';

const BOARD_MAX_AGE_MS = 45 * 60 * 1000;
const DEBOUNCE_MS = 5 * 60 * 1000;
const INSERT_BATCH = 200;

export type UsMoveTrigger = {
  gameId: string;
  playerId: string;
  stat: string;
  movedAt: string;
};

type InjuryRow = { player_id: number; team_id: number | null; status: string; return_date: string | null; description: string | null; updated_at?: string | null };

async function rosters(teamIds: string[]): Promise<Map<string, PropLogPlayer[]>> {
  const { data, error } = await supabaseAdmin.from('nba_players').select('id, full_name, team_id, position').eq('is_active', true).in('team_id', teamIds.map(Number));
  if (error) throw new Error(`nba_players: ${error.message}`);
  const byTeam = new Map<string, PropLogPlayer[]>();
  for (const r of data ?? []) {
    const club = getNbaClubById(r.team_id);
    if (!club || !r.full_name) continue;
    byTeam.set(club.code, [...(byTeam.get(club.code) ?? []), { id: String(r.id), name: String(r.full_name), teamCode: club.code }]);
  }
  return byTeam;
}

async function injuryReport(): Promise<InjuryRow[]> {
  const { data, error } = await supabaseAdmin.from('nba_injuries').select('player_id, team_id, status, return_date, description, updated_at');
  if (error) throw new Error(`nba_injuries: ${error.message}`);
  return (data ?? []) as InjuryRow[];
}

/** Skip moves we already snapped in the debounce window. */
async function recentUsMoves(keys: Array<{ gameId: string; playerId: string; stat: string }>, sinceIso: string): Promise<Set<string>> {
  const gameIds = [...new Set(keys.map((k) => k.gameId))];
  if (!gameIds.length) return new Set();
  const { data, error } = await supabaseAdmin
    .from('nba_prop_snapshots')
    .select('game_id, player_id, stat')
    .in('game_id', gameIds)
    .eq('snapshot_kind', 'us_move')
    .gte('captured_at', sinceIso);
  if (error) throw new Error(`us_move dedup: ${error.message}`);
  return new Set((data ?? []).map((r) => `${r.game_id}|${r.player_id}|${r.stat}`));
}

function snapshotRow(odds: NbaGameOdds, line: LoggedLine, nowIso: string, ctx: {
  homeCode: string;
  awayCode: string;
  market: ReturnType<typeof gameMarket>;
  injuries: InjuryRow[];
  injuriesAt: string | null;
  lineups: Map<string, LineupVersion | undefined>;
  rosters: Map<string, PropLogPlayer[]>;
}) {
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
    snapshot_kind: 'us_move' as const,
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
    role_changed_recently: null as boolean | null,
    features: (team ? { home: isHome } : {}) as Record<string, unknown>,
    model_version: PROP_LOG_VERSIONS.model,
    feature_version: PROP_LOG_VERSIONS.feature,
    policy_version: PROP_LOG_VERSIONS.policy,
  };
}

/**
 * Insert us_move snapshots for the moved player×stat lines on the current AU board.
 * Returns how many snapshot rows were written (0 when board stale / no match).
 */
export async function logUsMoveSnapshots(moves: UsMoveTrigger[], nowMs = Date.now()): Promise<number> {
  if (!moves.length) return 0;
  const nowIso = new Date(nowMs).toISOString();
  const board = await getNbaOddsCache();
  if (!board || !(nowMs - Date.parse(board.lastUpdated) <= BOARD_MAX_AGE_MS)) return 0;

  const byGame = new Map<string, UsMoveTrigger[]>();
  for (const m of moves) {
    const list = byGame.get(m.gameId) ?? [];
    list.push(m);
    byGame.set(m.gameId, list);
  }

  const taken = await recentUsMoves(
    moves.map((m) => ({ gameId: m.gameId, playerId: m.playerId, stat: m.stat })),
    new Date(nowMs - DEBOUNCE_MS).toISOString()
  );

  const games = (board.games ?? []).filter((g) => byGame.has(g.gameId) && g.playerProps);
  if (!games.length) return 0;

  const clubs = games.flatMap((g) => [resolveNbaClub(g.homeTeam), resolveNbaClub(g.awayTeam)]).filter((c) => c != null);
  const [players, injuries, lineups] = await Promise.all([
    rosters([...new Set(clubs.map((c) => c.id))]),
    injuryReport(),
    latestLineups([...new Set(clubs.map((c) => c.code))], nowMs),
  ]);
  const injuriesAt = injuries.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null);

  const inserts: Array<{ row: ReturnType<typeof snapshotRow>; line: LoggedLine }> = [];
  const currentLines = new Map<string, LoggedLine>();

  for (const odds of games) {
    const home = resolveNbaClub(odds.homeTeam);
    const away = resolveNbaClub(odds.awayTeam);
    if (!home || !away) continue;
    const teamIds = new Set([Number(home.id), Number(away.id)]);
    const gameKey = lineupGameKey(odds.commenceTime, away.code, home.code);
    const ctx = {
      homeCode: home.code,
      awayCode: away.code,
      market: gameMarket(odds),
      injuries: injuries.filter((r) => teamIds.has(Number(r.team_id))),
      injuriesAt,
      lineups: new Map([home.code, away.code].map((code) => [code, lineups.get(`${gameKey}|${code}`)])),
      rosters: players,
    };
    const lines = gameLines(odds, [...(players.get(home.code) ?? []), ...(players.get(away.code) ?? [])]);
    for (const line of lines) {
      if (line.player) currentLines.set(`${odds.gameId}|${line.player.id}|${line.stat}`, line);
    }
    for (const move of byGame.get(odds.gameId) ?? []) {
      const key = `${move.gameId}|${move.playerId}|${move.stat}`;
      if (taken.has(key)) continue;
      const line = currentLines.get(key);
      if (!line) continue;
      inserts.push({ row: snapshotRow(odds, line, move.movedAt || nowIso, ctx), line });
      taken.add(key);
    }
  }

  if (!inserts.length) return 0;
  await addModelFeatures(
    inserts.map((x) => x.row),
    {
      partLine: (gameId, playerId, stat) => {
        const l = currentLines.get(`${gameId}|${playerId}|${stat}`);
        return l ? { line: l.mainLine, fairOver: l.fairOverAll } : null;
      },
    }
  ).catch(() => ({ computed: 0, skipped: inserts.length }));

  let written = 0;
  for (let i = 0; i < inserts.length; i += INSERT_BATCH) {
    const batch = inserts.slice(i, i + INSERT_BATCH);
    const { data, error } = await supabaseAdmin.from('nba_prop_snapshots').insert(batch.map((b) => b.row)).select('id');
    if (error) throw new Error(`us_move snapshots: ${error.message}`);
    const ids = (data ?? []).map((r) => r.id as string);
    const quotes = batch.flatMap((b, j) => {
      const id = ids[j];
      if (!id) return [];
      return b.line.quotes.map((q) => ({
        snapshot_id: id,
        book: q.book,
        line: q.line,
        over_price: q.over,
        under_price: q.under,
        source_ts: q.sourceTs,
        captured_at: nowIso,
        coherent: q.coherent,
      }));
    });
    for (let j = 0; j < quotes.length; j += 2000) {
      const { error: qError } = await supabaseAdmin.from('nba_prop_book_quotes').insert(quotes.slice(j, j + 2000));
      if (qError) throw new Error(`us_move quotes: ${qError.message}`);
    }
    written += ids.length;
  }
  return written;
}
