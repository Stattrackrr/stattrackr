/**
 * Sync NBA dashboard data from BallDontLie (GOAT) into Supabase nba_* tables.
 *
 *   npx tsx scripts/sync-nba-bdl.ts                       # daily: current season, last 3 days
 *   npx tsx scripts/sync-nba-bdl.ts --seasons=2023,2024,2025 --full
 *   npx tsx scripts/sync-nba-bdl.ts --jobs=injuries,games --dry-run
 *
 * Jobs: teams, players, games, stats, advanced, plays, lineups, injuries, standings, averages,
 *       shotsummary (aggregates stored nba_shots for the dashboard; reads Supabase, not BDL)
 * --full        stats/advanced/lineups for whole seasons instead of the last --days
 * --days=N      incremental window (default 3); --since/--until=YYYY-MM-DD pin it
 * --max-games=N cap play-by-play games per run (default 400)
 * --rpm=N       BDL requests per minute (default 360; the live site shares the key)
 * --dry-run     fetch and map, write nothing
 */
import { createClient } from '@supabase/supabase-js';
import { BdlClient } from '../lib/nba/bdl/client';
import {
  isFieldGoalAttempt,
  mapGame,
  mapInjury,
  mapLineup,
  mapPlay,
  mapPlayer,
  mapPlayerGameAdvanced,
  mapPlayerGameStat,
  mapShot,
  mapStanding,
  mapTeam,
  type GameContext,
} from '../lib/nba/sync/mappers';
import { PLAYER_ID_MAPPINGS } from '../lib/playerIdMapping';
import { buildNbaShotSummary, nbaShotSummaryJob, type NbaShotSummaryRow } from '../lib/nba/dash/shotSummary';

type Obj = Record<string, any>;

const ALL_JOBS = ['teams', 'players', 'games', 'stats', 'advanced', 'plays', 'lineups', 'injuries', 'standings', 'averages', 'shotsummary'] as const;
type Job = (typeof ALL_JOBS)[number];

/** First season BDL has play-by-play for. */
const PLAYS_FIRST_SEASON = 2025;

const PLAYER_AVERAGE_TYPES: Array<[string, string | null]> = [
  ['general', 'base'], ['general', 'advanced'], ['general', 'usage'], ['general', 'scoring'], ['general', 'defense'], ['general', 'misc'],
  ['clutch', 'base'], ['clutch', 'advanced'], ['clutch', 'misc'], ['clutch', 'scoring'], ['clutch', 'usage'],
  ['defense', 'overall'], ['defense', '2_pointers'], ['defense', '3_pointers'], ['defense', 'greater_than_15ft'], ['defense', 'less_than_10ft'], ['defense', 'less_than_6ft'],
  ['shooting', 'by_zone'], ['shooting', '5ft_range'],
  ['playtype', 'cut'], ['playtype', 'handoff'], ['playtype', 'isolation'], ['playtype', 'offrebound'], ['playtype', 'offscreen'], ['playtype', 'postup'],
  ['playtype', 'prballhandler'], ['playtype', 'prrollman'], ['playtype', 'spotup'], ['playtype', 'transition'], ['playtype', 'misc'],
  ['tracking', 'passing'], ['tracking', 'rebounding'], ['tracking', 'drives'], ['tracking', 'painttouch'], ['tracking', 'posttouch'],
  ['tracking', 'elbowtouch'], ['tracking', 'catchshoot'], ['tracking', 'pullupshot'], ['tracking', 'efficiency'], ['tracking', 'speeddistance'],
  ['tracking', 'defense'], ['tracking', 'possessions'],
  ['hustle', null],
  ['shotdashboard', 'overall'], ['shotdashboard', 'pullups'], ['shotdashboard', 'catch_and_shoot'], ['shotdashboard', 'less_than_10_ft'],
];

const TEAM_AVERAGE_TYPES: Array<[string, string | null]> = [
  ['general', 'base'], ['general', 'advanced'], ['general', 'scoring'], ['general', 'misc'], ['general', 'opponent'], ['general', 'defense'], ['general', 'violations'],
  ['clutch', 'base'], ['clutch', 'advanced'], ['clutch', 'misc'], ['clutch', 'scoring'],
  ['shooting', 'by_zone_base'], ['shooting', 'by_zone_opponent'], ['shooting', '5ft_range_base'], ['shooting', '5ft_range_opponent'],
  ['playtype', 'cut'], ['playtype', 'handoff'], ['playtype', 'isolation'], ['playtype', 'offrebound'], ['playtype', 'offscreen'], ['playtype', 'postup'],
  ['playtype', 'prballhandler'], ['playtype', 'prrollman'], ['playtype', 'spotup'], ['playtype', 'transition'], ['playtype', 'misc'],
  ['tracking', 'passing'], ['tracking', 'rebounding'], ['tracking', 'drives'], ['tracking', 'painttouch'], ['tracking', 'posttouch'], ['tracking', 'elbowtouch'],
  ['tracking', 'catchshoot'], ['tracking', 'pullupshot'], ['tracking', 'efficiency'], ['tracking', 'speeddistance'], ['tracking', 'defense'], ['tracking', 'possessions'],
  ['hustle', null],
  ['shotdashboard', 'overall'], ['shotdashboard', 'pullups'], ['shotdashboard', 'catch_and_shoot'], ['shotdashboard', 'less_than_10_ft'],
];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true';
}

/** NBA season start year: Oct-Dec belongs to that year, Jan-Sep to the year before. */
function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const dryRun = arg('dry-run') === 'true';
const full = arg('full') === 'true';
const days = Number(arg('days') ?? 3);
const maxGames = Number(arg('max-games') ?? 400);
const jobs = new Set<Job>((arg('jobs')?.split(',').map((j) => j.trim()) as Job[]) ?? [...ALL_JOBS]);
const seasons = (arg('seasons') ?? String(currentSeason())).split(',').map(Number).filter(Number.isFinite);

const bdl = new BdlClient({
  apiKey: process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '',
  perMinute: Number(arg('rpm') ?? 360),
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!supabaseUrl || !serviceKey)) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run)');
}
const db = dryRun ? null : createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });

const written: Record<string, number> = {};

async function upsert(table: string, rows: Obj[], onConflict: string, opts: { ignoreDuplicates?: boolean } = {}) {
  if (!rows.length) return;
  if (!db && written[table] == null) console.log(`  sample ${table}: ${JSON.stringify(rows[0]).slice(0, 600)}`);
  written[table] = (written[table] ?? 0) + rows.length;
  if (!db) return;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const { error } = await db.from(table).upsert(chunk, { onConflict, ignoreDuplicates: opts.ignoreDuplicates });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

/** Collapse duplicate keys inside one batch (Postgres rejects an upsert that hits a row twice). */
function dedupe<T extends Obj>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

const nbaPersonIdByBdl = new Map(PLAYER_ID_MAPPINGS.map((m) => [Number(m.bdlId), Number(m.nbaId)]));
const rememberedPlayerIds = new Set<number>();

/** Players seen in box scores/lineups who aren't on an active roster (retired, waived). Insert only. */
async function rememberPlayers(players: Obj[]) {
  const fresh = players.filter((p) => p?.id && !rememberedPlayerIds.has(p.id));
  if (!fresh.length) return;
  for (const p of fresh) rememberedPlayerIds.add(p.id);
  const rows = dedupe(
    fresh.map((p) => mapPlayer(p, { active: false, nbaPersonId: nbaPersonIdByBdl.get(p.id) })),
    (r) => String(r.id)
  );
  await upsert('nba_players', rows, 'id', { ignoreDuplicates: true });
}

function dateWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start: arg('since') ?? isoDate(start), end: arg('until') ?? isoDate(end) };
}

// ---------------------------------------------------------------------------

async function syncTeams() {
  const teams = await bdl.all<Obj>('/v1/teams');
  await upsert('nba_teams', teams.filter((t) => t.id <= 30).map(mapTeam), 'id');
}

async function syncPlayers() {
  const active = await bdl.all<Obj>('/v1/players/active');
  const rows = active.map((p) => mapPlayer(p, { active: true, nbaPersonId: nbaPersonIdByBdl.get(p.id) }));
  await upsert('nba_players', rows, 'id');
  if (!db) return;
  const activeIds = new Set(rows.map((r) => r.id));
  const { data, error } = await db.from('nba_players').select('id').eq('is_active', true);
  if (error) throw new Error(`nba_players read: ${error.message}`);
  const gone = (data ?? []).map((r) => r.id as number).filter((id) => !activeIds.has(id));
  for (let i = 0; i < gone.length; i += 500) {
    const { error: e } = await db.from('nba_players').update({ is_active: false }).in('id', gone.slice(i, i + 500));
    if (e) throw new Error(`nba_players deactivate: ${e.message}`);
  }
}

async function syncGames(season: number) {
  const games = await bdl.all<Obj>(`/v1/games?seasons[]=${season}`);
  const rows = games.filter((g) => (g.home_team?.id ?? 99) <= 30 && (g.visitor_team?.id ?? 99) <= 30).map(mapGame);
  await upsert('nba_games', rows, 'id');
}

async function syncStats(season: number) {
  const scope = full ? `seasons[]=${season}` : (() => {
    const { start, end } = dateWindow();
    return `seasons[]=${season}&start_date=${start}&end_date=${end}`;
  })();
  for (const period of [0, 1, 2, 3, 4]) {
    const path = `/v1/stats?${scope}${period ? `&period=${period}` : ''}`;
    await bdl.all<Obj>(path, async (page) => {
      const rows = page.filter((r) => r.game?.id && r.player?.id && r.team?.id).map((r) => mapPlayerGameStat(r, period));
      await rememberPlayers(page.map((r) => r.player));
      await upsert('nba_player_game_stats', dedupe(rows, (r) => `${r.game_id}:${r.player_id}:${r.period}`), 'game_id,player_id,period');
    });
  }
}

async function syncAdvanced(season: number) {
  const scope = full ? `seasons[]=${season}` : (() => {
    const { start, end } = dateWindow();
    return `seasons[]=${season}&start_date=${start}&end_date=${end}`;
  })();
  await bdl.all<Obj>(`/v2/stats/advanced?${scope}&period=0`, async (page) => {
    const rows = page.filter((r) => r.game?.id && r.player?.id && r.team?.id && (r.period ?? 0) === 0).map(mapPlayerGameAdvanced);
    await upsert('nba_player_game_advanced', dedupe(rows, (r) => `${r.game_id}:${r.player_id}`), 'game_id,player_id');
  });
}

async function finalGames(season: number, opts: { needPlays?: boolean; limit?: number; sinceDate?: string } = {}): Promise<GameContext[]> {
  if (!db) {
    const games = await bdl.all<Obj>(`/v1/games?seasons[]=${season}`);
    return games
      .filter((g) => g.status_state === 'final' && (!opts.sinceDate || g.date >= opts.sinceDate))
      .slice(0, opts.limit ?? 5)
      .map((g) => ({ ...mapGame(g) }));
  }
  let q = db
    .from('nba_games')
    .select('id, season, game_date, home_team_id, visitor_team_id')
    .eq('season', season)
    .eq('status_state', 'final')
    .order('game_date', { ascending: true });
  if (opts.needPlays) q = q.is('plays_synced_at', null);
  if (opts.sinceDate) q = q.gte('game_date', opts.sinceDate);
  const out: GameContext[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`nba_games read: ${error.message}`);
    out.push(...((data ?? []) as GameContext[]));
    if (!data || data.length < 1000) break;
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

async function syncPlays(season: number) {
  if (season < PLAYS_FIRST_SEASON) return;
  const games = await finalGames(season, { needPlays: true, limit: maxGames });
  console.log(`  plays: ${games.length} game(s) to fetch for ${season}`);
  let done = 0;
  const worker = async (queue: GameContext[]) => {
    for (let game = queue.shift(); game; game = queue.shift()) {
      const res = await bdl.get<{ data: Obj[] }>(`/v1/plays?game_id=${game.id}`);
      const plays = res.data ?? [];
      await upsert('nba_plays', dedupe(plays.map((p) => mapPlay(p, game!)), (r) => String(r.play_order)), 'game_id,play_order');
      const shots = plays.filter(isFieldGoalAttempt).map((p) => mapShot(p, game!)).filter((s): s is NonNullable<typeof s> => !!s);
      await upsert('nba_shots', dedupe(shots, (r) => String(r.play_order)), 'game_id,play_order');
      if (db && plays.length > 0) {
        const { error } = await db.from('nba_games').update({ plays_synced_at: new Date().toISOString() }).eq('id', game.id);
        if (error) throw new Error(`nba_games plays_synced_at: ${error.message}`);
      }
      if (++done % 50 === 0) console.log(`  plays: ${done}/${games.length}`);
    }
  };
  const queue = [...games];
  await Promise.all(Array.from({ length: 4 }, () => worker(queue)));
}

async function syncLineups(season: number) {
  const games = await finalGames(season, full ? {} : { sinceDate: dateWindow().start });
  for (let i = 0; i < games.length; i += 25) {
    const ids = games.slice(i, i + 25).map((g) => `game_ids[]=${g.id}`).join('&');
    await bdl.all<Obj>(`/v1/lineups?${ids}`, async (page) => {
      await rememberPlayers(page.map((r) => r.player));
      const rows = page.filter((r) => r.game_id && r.player?.id && r.team?.id).map(mapLineup);
      await upsert('nba_lineups', dedupe(rows, (r) => `${r.game_id}:${r.player_id}`), 'game_id,player_id');
    });
  }
}

async function syncInjuries() {
  const rows = dedupe(
    (await bdl.all<Obj>('/v1/player_injuries')).filter((r) => r.player?.id).map(mapInjury),
    (r) => String(r.player_id)
  );
  if (db && rows.length) {
    const { error } = await db.from('nba_injuries').delete().not('player_id', 'in', `(${rows.map((r) => r.player_id).join(',')})`);
    if (error) throw new Error(`nba_injuries clear: ${error.message}`);
  }
  await upsert('nba_injuries', rows, 'player_id');
}

async function syncStandings(season: number) {
  const res = await bdl.get<{ data: Obj[] }>(`/v1/standings?season=${season}`);
  await upsert('nba_standings', (res.data ?? []).filter((r) => r.team?.id <= 30).map(mapStanding), 'season,team_id');
}

async function syncAverages(season: number) {
  const now = new Date().toISOString();
  for (const [category, type] of PLAYER_AVERAGE_TYPES) {
    const q = `season=${season}&season_type=regular${type ? `&type=${type}` : ''}`;
    try {
      await bdl.all<Obj>(`/nba/v1/season_averages/${category}?${q}`, async (page) => {
        const rows = page.filter((r) => r.player?.id && r.stats).map((r) => ({
          season, season_type: 'regular', category, stat_type: type ?? 'default', player_id: r.player.id, stats: r.stats, updated_at: now,
        }));
        await upsert('nba_player_season_averages', dedupe(rows, (r) => String(r.player_id)), 'season,season_type,category,stat_type,player_id');
      });
    } catch (err) {
      console.warn(`  player averages ${category}/${type ?? '-'} ${season}: ${(err as Error).message}`);
    }
  }
  for (const [category, type] of TEAM_AVERAGE_TYPES) {
    const q = `season=${season}&season_type=regular${type ? `&type=${type}` : ''}`;
    try {
      const rows = (await bdl.all<Obj>(`/nba/v1/team_season_averages/${category}?${q}`))
        .filter((r) => r.team?.id <= 30 && r.stats)
        .map((r) => ({ season, season_type: 'regular', category, stat_type: type ?? 'default', team_id: r.team.id, stats: r.stats, updated_at: now }));
      await upsert('nba_team_season_averages', dedupe(rows, (r) => String(r.team_id)), 'season,season_type,category,stat_type,team_id');
    } catch (err) {
      console.warn(`  team averages ${category}/${type ?? '-'} ${season}: ${(err as Error).message}`);
    }
  }
}

async function syncShotSummary(season: number) {
  if (season < PLAYS_FIRST_SEASON || !db) return;
  const rows: NbaShotSummaryRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('nba_shots')
      .select('game_id, shooter_id, assister_id, opponent_team_id, made, zone')
      .eq('season', season)
      .order('game_id')
      .order('play_order')
      .range(from, from + 999);
    if (error) throw new Error(`nba_shots read: ${error.message}`);
    rows.push(...((data ?? []) as NbaShotSummaryRow[]));
    if (!data || data.length < 1000) break;
  }
  const summary = buildNbaShotSummary(season, rows);
  const { error } = await db
    .from('nba_sync_state')
    .upsert({ job: nbaShotSummaryJob(season), state: summary, updated_at: new Date().toISOString() }, { onConflict: 'job' });
  if (error) throw new Error(`shot summary upsert: ${error.message}`);
  written.shot_summary = (written.shot_summary ?? 0) + rows.length;
}

async function recordRun(summary: Obj) {
  if (!db) return;
  await db.from('nba_sync_state').upsert({ job: 'sync-nba-bdl', state: summary, updated_at: new Date().toISOString() }, { onConflict: 'job' });
}

async function main() {
  const started = Date.now();
  console.log(`NBA sync: jobs=${[...jobs].join(',')} seasons=${seasons.join(',')} ${full ? 'full' : `last ${days}d`}${dryRun ? ' (dry run)' : ''}`);
  const failures: string[] = [];
  const run = async (label: string, fn: () => Promise<void>) => {
    const t = Date.now();
    try {
      await fn();
      console.log(`✓ ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      console.error(`✗ ${label}: ${(err as Error).message}`);
    }
  };

  if (jobs.has('teams')) await run('teams', syncTeams);
  if (jobs.has('players')) await run('players', syncPlayers);
  if (jobs.has('injuries')) await run('injuries', syncInjuries);
  for (const season of seasons) {
    if (jobs.has('games')) await run(`games ${season}`, () => syncGames(season));
    if (jobs.has('standings')) await run(`standings ${season}`, () => syncStandings(season));
    if (jobs.has('stats')) await run(`stats ${season}`, () => syncStats(season));
    if (jobs.has('advanced')) await run(`advanced ${season}`, () => syncAdvanced(season));
    if (jobs.has('lineups')) await run(`lineups ${season}`, () => syncLineups(season));
    if (jobs.has('plays')) await run(`plays ${season}`, () => syncPlays(season));
    if (jobs.has('averages')) await run(`averages ${season}`, () => syncAverages(season));
    if (jobs.has('shotsummary')) await run(`shot summary ${season}`, () => syncShotSummary(season));
  }

  const summary = {
    finishedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    seasons,
    jobs: [...jobs],
    full,
    requests: bdl.requests,
    rows: written,
    failures,
  };
  await recordRun(summary).catch(() => {});
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
