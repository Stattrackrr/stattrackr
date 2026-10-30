import { getNbaClubById, resolveNbaClub } from '@/lib/nba/dash/teams';
import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { parseAssignments } from './rules';

const ASSIGNMENTS_URL = 'https://official.nba.com/referee-assignments/';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
/** Last season and this one: enough games per official for the shrunk tendencies. */
const SEASONS = [2025, 2026];
const DATES_PER_RUN = 8;
const MAX_TRIES = 3;
const TRIED_KEY = 'nba_officials_tried_v1';

const etToday = (nowMs: number) => new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

type GameRow = { id: number; game_date: string; home_team_id: number; visitor_team_id: number };

async function gamesOn(dates: string[]): Promise<GameRow[]> {
  if (!dates.length) return [];
  const { data, error } = await supabaseAdmin.from('nba_games').select('id, game_date, home_team_id, visitor_team_id').in('game_date', dates);
  if (error) throw new Error(`nba_games: ${error.message}`);
  return (data ?? []) as GameRow[];
}

const codeOf = (teamId: number) => getNbaClubById(teamId)?.code ?? null;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Tonight's crews from the NBA's assignments page; never replaces a crew already filled from ESPN. */
export async function syncAssignments(nowMs = Date.now()): Promise<{ date: string | null; saved: number }> {
  const res = await fetch(ASSIGNMENTS_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`assignments ${res.status}`);
  const page = parseAssignments(await res.text());
  if (!page.date || page.date < etToday(nowMs) || !page.games.length) return { date: page.date, saved: 0 };
  const games = await gamesOn([page.date]);
  const { data: done } = await supabaseAdmin.from('nba_game_officials').select('game_id').eq('game_date', page.date).eq('source', 'espn');
  const espn = new Set((done ?? []).map((r) => r.game_id));
  const rows = page.games.flatMap((a) => {
    const g = games.find((x) => codeOf(x.home_team_id) === a.home && codeOf(x.visitor_team_id) === a.away);
    return g && !espn.has(String(g.id)) ? [{ game_id: String(g.id), game_date: page.date!, home: a.home, away: a.away, officials: a.officials, source: 'nba_assignments', captured_at: new Date(nowMs).toISOString() }] : [];
  });
  if (rows.length) {
    const { error } = await supabaseAdmin.from('nba_game_officials').upsert(rows, { onConflict: 'game_id' });
    if (error) throw new Error(`nba_game_officials: ${error.message}`);
  }
  return { date: page.date, saved: rows.length };
}

/** Crews that actually worked finished games, from ESPN, a few dates per run, newest first. */
export async function backfillEspnOfficials(nowMs = Date.now()): Promise<{ dates: string[]; saved: number }> {
  const today = etToday(nowMs);
  const { data: all, error } = await supabaseAdmin.from('nba_games').select('id, game_date').in('season', SEASONS).lt('game_date', today).order('game_date', { ascending: false }).limit(5000);
  if (error) throw new Error(`nba_games: ${error.message}`);
  const have = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('nba_game_officials').select('game_id').eq('source', 'espn').range(from, from + 999);
    for (const r of data ?? []) have.add(r.game_id);
    if ((data?.length ?? 0) < 1000) break;
  }
  const tried = (await sharedCache.getJSON<Record<string, number>>(TRIED_KEY)) ?? {};
  const dates = [...new Set((all ?? []).filter((g) => !have.has(String(g.id))).map((g) => g.game_date as string))].filter((d) => (tried[d] ?? 0) < MAX_TRIES).slice(0, DATES_PER_RUN);
  const games = await gamesOn(dates);
  let saved = 0;
  for (const date of dates) {
    tried[date] = (tried[date] ?? 0) + 1;
    const board = await getJson(`${ESPN}/scoreboard?dates=${date.replace(/-/g, '')}`).catch(() => null);
    const rows: Array<Record<string, unknown>> = [];
    for (const evt of board?.events ?? []) {
      const comp = evt?.competitions?.[0];
      if (comp?.status?.type?.state !== 'post') continue;
      const side = (s: string) => resolveNbaClub(comp?.competitors?.find((c: any) => c.homeAway === s)?.team?.abbreviation)?.code ?? null;
      const home = side('home');
      const away = side('away');
      const g = games.find((x) => x.game_date === date && codeOf(x.home_team_id) === home && codeOf(x.visitor_team_id) === away);
      if (!g || have.has(String(g.id))) continue;
      const summary = await getJson(`${ESPN}/summary?event=${evt.id}`).catch(() => null);
      const officials: string[] = (summary?.gameInfo?.officials ?? []).map((o: any) => String(o?.displayName ?? '').trim()).filter(Boolean);
      if (officials.length) rows.push({ game_id: String(g.id), game_date: date, home, away, officials, source: 'espn', captured_at: new Date(nowMs).toISOString() });
    }
    if (rows.length) {
      const { error: uError } = await supabaseAdmin.from('nba_game_officials').upsert(rows, { onConflict: 'game_id' });
      if (uError) throw new Error(`nba_game_officials: ${uError.message}`);
      saved += rows.length;
    }
  }
  await sharedCache.setJSON(TRIED_KEY, tried, 60 * 24 * 60 * 60);
  return { dates, saved };
}

export type OfficialsRow = { game_id: string; game_date: string; officials: string[] };

/** Every stored crew (a couple of seasons: a few thousand rows). */
export async function loadOfficials(): Promise<OfficialsRow[]> {
  const out: OfficialsRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from('nba_game_officials').select('game_id, game_date, officials').order('game_id').range(from, from + 999);
    if (error) throw new Error(`nba_game_officials: ${error.message}`);
    out.push(...((data ?? []) as OfficialsRow[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}
