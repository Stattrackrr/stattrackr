/**
 * NBA dashboard server loaders: Supabase nba_* tables (filled by scripts/sync-nba-bdl.ts)
 * shaped like the NBL dashboard APIs. Stored data only; nothing calls BallDontLie here.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getNbaClubById, NBA_CHART_HISTORY_YEARS, NBA_CLUBS, nbaTeamLogoUrl, resolveNbaClub } from './teams';
import type { NbaGameLogRow } from './types';
import {
  ADV_COLUMNS,
  BOX_COLUMNS,
  GAME_COLUMNS,
  nbaHeadshotUrl,
  resultLabel,
  selectAllParallel,
  toNbaGameLogRow,
} from './season';

export { nbaHeadshotUrl } from './season';

type Row = Record<string, any>;

async function gamesByIds(ids: number[]): Promise<Map<number, Row>> {
  const out = new Map<number, Row>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabaseAdmin.from('nba_games').select(GAME_COLUMNS).in('id', chunk);
      if (error) throw new Error(error.message);
      for (const g of data ?? []) out.set(Number(g.id), g);
    })
  );
  return out;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export type NbaRosterPlayer = {
  playerId: string | null;
  name: string;
  team: string;
  teamCode: string | null;
  teamId: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
};

export async function loadNbaRoster(): Promise<NbaRosterPlayer[]> {
  const rows = await selectAllParallel(() =>
    supabaseAdmin
      .from('nba_players')
      .select('id, full_name, team_id, position, jersey_number, nba_person_id')
      .eq('is_active', true)
      .not('team_id', 'is', null)
      .order('id')
  );
  return rows
    .map((p): NbaRosterPlayer | null => {
      const club = getNbaClubById(p.team_id);
      if (!club) return null;
      return {
        playerId: String(p.id),
        name: String(p.full_name),
        team: club.name,
        teamCode: club.code,
        teamId: club.id,
        position: p.position || null,
        jersey: p.jersey_number || null,
        imageUrl: nbaHeadshotUrl(p.nba_person_id),
      };
    })
    .filter((p): p is NbaRosterPlayer => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function nbaLogoMaps() {
  const logoByTeam: Record<string, string> = {};
  const logoByCode: Record<string, string> = {};
  for (const club of NBA_CLUBS) {
    const url = nbaTeamLogoUrl(club.code)!;
    logoByTeam[club.name] = url;
    logoByTeam[club.shortName] = url;
    logoByCode[club.code] = url;
  }
  return { logoByTeam, logoByCode };
}

// ---------------------------------------------------------------------------
// Player game logs
// ---------------------------------------------------------------------------

export async function loadNbaPlayerGameLogs(
  playerId: string | number,
  years: readonly number[] = NBA_CHART_HISTORY_YEARS
): Promise<NbaGameLogRow[]> {
  const pid = Number(playerId);
  if (!Number.isFinite(pid)) return [];
  const seasons = [...years];

  const [boxRows, advRows] = await Promise.all([
    selectAllParallel(() =>
      supabaseAdmin
        .from('nba_player_game_stats')
        .select(BOX_COLUMNS)
        .eq('player_id', pid)
        .in('season', seasons)
        .order('game_id')
        .order('period')
    ),
    selectAllParallel(() =>
      supabaseAdmin
        .from('nba_player_game_advanced')
        .select(ADV_COLUMNS)
        .eq('player_id', pid)
        .in('season', seasons)
        .order('game_id')
    ),
  ]);

  const full = boxRows.filter((r) => r.period === 0 && (Number(r.minutes) || 0) > 0);
  const quarters = new Map<string, Row>();
  for (const r of boxRows) if (r.period > 0) quarters.set(`${r.game_id}:${r.period}`, r);
  const adv = new Map<number, Row>(advRows.map((r) => [Number(r.game_id), r]));
  const games = await gamesByIds([...new Set(full.map((r) => Number(r.game_id)))]);

  const rows = full.map((r) =>
    toNbaGameLogRow(r, games.get(Number(r.game_id)), adv.get(Number(r.game_id)), (period, key) => {
      const q = quarters.get(`${r.game_id}:${period}`);
      if (!q) return null;
      const v = Number(q[key]);
      return Number.isFinite(v) ? v : 0;
    })
  );
  return rows.sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
}

export async function loadNbaPlayerMeta(playerId: string | number) {
  const { data } = await supabaseAdmin
    .from('nba_players')
    .select('id, full_name, team_id, position, jersey_number, nba_person_id')
    .eq('id', Number(playerId))
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// Team game logs (Game Props)
// ---------------------------------------------------------------------------

export type NbaTeamGameLogRow = {
  matchId: string;
  date: string | null;
  season: number;
  round: string | number | null;
  postseason: boolean;
  opponent: string;
  opponentCode: string | null;
  isHome: boolean;
  team: string;
  teamCode: string | null;
  result: string | null;
  venue: string | null;
  teamScore: number;
  oppScore: number;
  homeScore: number;
  awayScore: number;
  hasPeriodScores: boolean;
  moneyline: number;
  spread: number;
  total_pts: number;
  home_total: number;
  away_total: number;
  first_half_total: number | null;
  second_half_total: number | null;
  q1_moneyline: number | null;
  q1_total: number | null;
  q2_moneyline: number | null;
  q2_total: number | null;
  q3_moneyline: number | null;
  q3_total: number | null;
  q4_moneyline: number | null;
  q4_total: number | null;
  home_q1: number | null;
  home_q2: number | null;
  home_q3: number | null;
  home_q4: number | null;
  visitor_q1: number | null;
  visitor_q2: number | null;
  visitor_q3: number | null;
  visitor_q4: number | null;
};

const num = (v: unknown): number | null =>
  v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const qTotal = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);
const qMoneyline = (t: number | null, o: number | null) => (t == null || o == null ? null : t > o ? 1 : 0);

export function buildNbaTeamGameLogRow(g: Row, teamId: number): NbaTeamGameLogRow | null {
  const homeScore = num(g.home_score);
  const awayScore = num(g.visitor_score);
  if (g.status_state !== 'final' || homeScore == null || awayScore == null) return null;
  const isHome = Number(g.home_team_id) === teamId;
  const team = getNbaClubById(teamId);
  const opp = getNbaClubById(isHome ? g.visitor_team_id : g.home_team_id);
  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  const hq = [num(g.home_q1), num(g.home_q2), num(g.home_q3), num(g.home_q4)];
  const vq = [num(g.visitor_q1), num(g.visitor_q2), num(g.visitor_q3), num(g.visitor_q4)];
  const tq = isHome ? hq : vq;
  const oq = isHome ? vq : hq;
  return {
    matchId: String(g.id),
    date: g.tipoff_at ?? g.game_date,
    season: g.season,
    round: null,
    postseason: !!g.postseason,
    opponent: opp?.name ?? '',
    opponentCode: opp?.code ?? null,
    isHome,
    team: team?.name ?? '',
    teamCode: team?.code ?? null,
    result: resultLabel(teamScore, oppScore),
    venue: null,
    teamScore,
    oppScore,
    homeScore,
    awayScore,
    hasPeriodScores: [...hq, ...vq].every((v) => v != null),
    moneyline: teamScore > oppScore ? 1 : 0,
    spread: oppScore - teamScore,
    total_pts: homeScore + awayScore,
    home_total: homeScore,
    away_total: awayScore,
    first_half_total: qTotal(qTotal(hq[0], hq[1]), qTotal(vq[0], vq[1])),
    second_half_total: qTotal(qTotal(hq[2], hq[3]), qTotal(vq[2], vq[3])),
    q1_moneyline: qMoneyline(tq[0], oq[0]),
    q1_total: qTotal(hq[0], vq[0]),
    q2_moneyline: qMoneyline(tq[1], oq[1]),
    q2_total: qTotal(hq[1], vq[1]),
    q3_moneyline: qMoneyline(tq[2], oq[2]),
    q3_total: qTotal(hq[2], vq[2]),
    q4_moneyline: qMoneyline(tq[3], oq[3]),
    q4_total: qTotal(hq[3], vq[3]),
    home_q1: hq[0], home_q2: hq[1], home_q3: hq[2], home_q4: hq[3],
    visitor_q1: vq[0], visitor_q2: vq[1], visitor_q3: vq[2], visitor_q4: vq[3],
  };
}

export async function loadNbaTeamGameLogs(
  teamInput: string,
  years: readonly number[] = NBA_CHART_HISTORY_YEARS
): Promise<NbaTeamGameLogRow[]> {
  const club = resolveNbaClub(teamInput);
  if (!club) return [];
  const teamId = Number(club.id);
  const games = await selectAllParallel(() =>
    supabaseAdmin
      .from('nba_games')
      .select(GAME_COLUMNS)
      .in('season', [...years])
      .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
      .eq('status_state', 'final')
      .order('game_date')
      .order('id')
  );
  return games
    .map((g) => buildNbaTeamGameLogRow(g, teamId))
    .filter((r): r is NbaTeamGameLogRow => !!r);
}

// ---------------------------------------------------------------------------
// Next game
// ---------------------------------------------------------------------------

export async function loadNbaNextGame(teamInput: string) {
  const club = resolveNbaClub(teamInput);
  if (!club) return null;
  const teamId = Number(club.id);
  // Keep a game "next" until ~3h after tipoff so the LIVE badge has something to show.
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('nba_games')
    .select('id, season, tipoff_at, game_date, status_state, home_team_id, visitor_team_id')
    .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
    .neq('status_state', 'final')
    .gte('tipoff_at', since)
    .order('tipoff_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const g = data?.[0];
  if (!g) return null;
  const isHome = Number(g.home_team_id) === teamId;
  const opp = getNbaClubById(isHome ? g.visitor_team_id : g.home_team_id);
  const home = getNbaClubById(g.home_team_id);
  const away = getNbaClubById(g.visitor_team_id);
  return {
    team: club.name,
    year: g.season as number,
    opponent: opp?.name ?? null,
    tipoff: g.tipoff_at as string | null,
    matchId: String(g.id),
    opponentLogo: opp ? nbaTeamLogoUrl(opp.code) : null,
    venue: null,
    isHome,
    homeTeam: home?.name ?? null,
    awayTeam: away?.name ?? null,
    source: 'nba_games',
  };
}

// ---------------------------------------------------------------------------
// Ladder (standings from final regular-season games)
// ---------------------------------------------------------------------------

export async function loadNbaLadder(season: number) {
  const games = await selectAllParallel(() =>
    supabaseAdmin
      .from('nba_games')
      .select('id, home_team_id, visitor_team_id, home_score, visitor_score')
      .eq('season', season)
      .eq('status_state', 'final')
      .eq('postseason', false)
      .order('id')
  );
  const rows = new Map<string, { played: number; win: number; loss: number; pf: number; pa: number }>();
  for (const club of NBA_CLUBS) rows.set(club.code, { played: 0, win: 0, loss: 0, pf: 0, pa: 0 });
  for (const g of games) {
    const home = getNbaClubById(g.home_team_id);
    const away = getNbaClubById(g.visitor_team_id);
    const hs = num(g.home_score);
    const as = num(g.visitor_score);
    if (!home || !away || hs == null || as == null) continue;
    for (const [code, pf, pa] of [[home.code, hs, as], [away.code, as, hs]] as const) {
      const r = rows.get(code)!;
      r.played += 1;
      r.pf += pf;
      r.pa += pa;
      if (pf > pa) r.win += 1;
      else r.loss += 1;
    }
  }
  const teams = NBA_CLUBS.map((club) => {
    const r = rows.get(club.code)!;
    return {
      pos: null as number | null,
      team: club.name,
      teamCode: club.code,
      teamLogo: nbaTeamLogoUrl(club.code),
      played: r.played,
      win: r.win,
      loss: r.loss,
      points_for: r.pf,
      points_against: r.pa,
      points_percentage: r.pa > 0 ? r.pf / r.pa : null,
    };
  })
    .sort(
      (a, b) =>
        b.win / Math.max(1, b.played) - a.win / Math.max(1, a.played) ||
        (b.points_percentage ?? 0) - (a.points_percentage ?? 0)
    )
    .map((t, i) => ({ ...t, pos: i + 1 }));
  return { teams, played: games.length };
}

// ---------------------------------------------------------------------------
// Injuries
// ---------------------------------------------------------------------------

function formatReturn(status: string | null, returnDate: string | null): string {
  if (/season/i.test(status || '')) return 'Season';
  if (!returnDate) return status || '—';
  const d = new Date(`${returnDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return returnDate;
  return `Est. ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export async function loadNbaInjuries() {
  const { data, error } = await supabaseAdmin
    .from('nba_injuries')
    .select('player_id, team_id, status, return_date, description, updated_at');
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => Number(r.player_id)))];
  const names = new Map<number, Row>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: players } = await supabaseAdmin
      .from('nba_players')
      .select('id, full_name, team_id')
      .in('id', ids.slice(i, i + 200));
    for (const p of players ?? []) names.set(Number(p.id), p);
  }
  const injuries = rows
    .map((r) => {
      const p = names.get(Number(r.player_id));
      const club = getNbaClubById(r.team_id ?? p?.team_id);
      if (!p || !club) return null;
      return {
        team: club.name,
        player: String(p.full_name),
        playerId: String(r.player_id),
        injury: String(r.status || ''),
        returning: formatReturn(r.status, r.return_date),
        description: r.description ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.team.localeCompare(b.team) || a.player.localeCompare(b.player));
  const generatedAt = rows.reduce<string | null>(
    (max, r) => (!max || String(r.updated_at) > max ? String(r.updated_at) : max),
    null
  );
  return { generatedAt, source: 'balldontlie', injuries };
}

// ---------------------------------------------------------------------------
// Lineups (starters + bench from the team's latest completed game)
// ---------------------------------------------------------------------------

const SLOT_ORDER: Record<string, number> = { G: 0, PG: 0, SG: 1, F: 2, SF: 2, PF: 3, C: 4 };

export async function loadNbaLineups(teamInput: string) {
  const club = resolveNbaClub(teamInput);
  if (!club) return null;
  const teamId = Number(club.id);
  const { data: recent, error } = await supabaseAdmin
    .from('nba_games')
    .select('id, season, tipoff_at, home_team_id, visitor_team_id, home_score, visitor_score')
    .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`)
    .eq('status_state', 'final')
    .order('tipoff_at', { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  const gameIds = (recent ?? []).map((g) => Number(g.id));
  if (!gameIds.length) return null;
  const { data: lineupRows } = await supabaseAdmin
    .from('nba_lineups')
    .select('game_id, player_id, team_id, starter, position')
    .in('game_id', gameIds);
  const byGame = new Map<number, Row[]>();
  for (const r of lineupRows ?? []) byGame.set(Number(r.game_id), [...(byGame.get(Number(r.game_id)) ?? []), r]);
  const game = (recent ?? []).find((g) =>
    (byGame.get(Number(g.id)) ?? []).some((r) => Number(r.team_id) === teamId && r.starter)
  );
  if (!game) return null;
  const rows = byGame.get(Number(game.id))!;
  const ids = [...new Set(rows.map((r) => Number(r.player_id)))];
  const { data: players } = await supabaseAdmin
    .from('nba_players')
    .select('id, full_name, jersey_number, position, nba_person_id')
    .in('id', ids);
  const info = new Map((players ?? []).map((p) => [Number(p.id), p]));

  const side = (sideTeamId: number) => {
    const sideClub = getNbaClubById(sideTeamId)!;
    const isHome = Number(game.home_team_id) === sideTeamId;
    const opp = getNbaClubById(isHome ? game.visitor_team_id : game.home_team_id);
    const mine = rows.filter((r) => Number(r.team_id) === sideTeamId);
    const toPlayer = (r: Row) => {
      const p = info.get(Number(r.player_id));
      const pos = String(r.position || p?.position || '').toUpperCase() || null;
      return {
        playerId: String(r.player_id),
        name: String(p?.full_name ?? r.player_id),
        jersey: p?.jersey_number ?? null,
        position: pos,
        positionLabel: pos || '–',
        slot: pos || '–',
        imageUrl: nbaHeadshotUrl(p?.nba_person_id),
      };
    };
    const starters = mine
      .filter((r) => r.starter)
      .map(toPlayer)
      .sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9));
    const bench = mine
      .filter((r) => !r.starter)
      .map(toPlayer)
      .map(({ slot: _s, positionLabel: _p, ...p }) => p);
    return {
      team: sideClub.name,
      lineup: { starters, bench },
      match: {
        fixtureId: String(game.id),
        opponent: opp?.name ?? '',
        isHome,
        tipoff: game.tipoff_at,
        homeTeam: getNbaClubById(game.home_team_id)?.name ?? '',
        awayTeam: getNbaClubById(game.visitor_team_id)?.name ?? '',
        homeScore: game.home_score != null ? String(game.home_score) : null,
        awayScore: game.visitor_score != null ? String(game.visitor_score) : null,
        matchSlug: null,
        year: game.season,
      },
    };
  };
  const oppId = Number(game.home_team_id) === teamId ? Number(game.visitor_team_id) : Number(game.home_team_id);
  const opponent = side(oppId);
  return {
    year: game.season as number,
    team: side(teamId),
    opponent: opponent.lineup.starters.length ? opponent : null,
  };
}

/** Upcoming games in the next `days` (for play-type picks / props). */
export async function loadNbaUpcomingGames(days = 2) {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('nba_games')
    .select('id, tipoff_at, status_state, home_team_id, visitor_team_id')
    .neq('status_state', 'final')
    .gte('tipoff_at', now)
    .lte('tipoff_at', until)
    .order('tipoff_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((g) => {
    const home = getNbaClubById(g.home_team_id);
    const away = getNbaClubById(g.visitor_team_id);
    return {
      id: String(g.id),
      tipoff: g.tipoff_at as string,
      homeTeam: home?.name ?? '',
      homeTeamCode: home?.code ?? null,
      awayTeam: away?.name ?? '',
      awayTeamCode: away?.code ?? null,
    };
  });
}
