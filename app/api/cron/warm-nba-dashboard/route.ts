import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { runNbaDashWarm } from '@/lib/nba/dash/responseCache';
import { readNbaPlayerPropsListCache } from '@/lib/nba/dash/playerPropsListCache';
import { NBA_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import {
  NBA_CHART_HISTORY_YEARS,
  NBA_CURRENT_SEASON_YEAR,
  NBA_SHOT_CHART_CACHE_YEARS,
  resolveNbaClubName,
} from '@/lib/nba/dash/teams';
import { GET as injuriesGET } from '@/app/api/nba/dash/injuries/route';
import { GET as ladderGET } from '@/app/api/nba/dash/ladder/route';
import { GET as leaguePlayerStatsGET } from '@/app/api/nba/dash/league-player-stats/route';
import { GET as lineupsGET } from '@/app/api/nba/dash/lineups/route';
import { GET as nextGameGET } from '@/app/api/nba/dash/next-game/route';
import { GET as playerGameLogsGET } from '@/app/api/nba/dash/player-game-logs/route';
import { GET as playerRatingsGET } from '@/app/api/nba/dash/player-ratings/route';
import { GET as playTypeMatchupGET } from '@/app/api/nba/dash/play-type-matchup/route';
import { GET as playersGET } from '@/app/api/nba/dash/players/route';
import { GET as shotChartGET } from '@/app/api/nba/dash/shot-chart/route';
import { GET as teamSteStatsGET } from '@/app/api/nba/dash/team-ste-stats/route';
import { GET as teamUsageGET } from '@/app/api/nba/dash/team-usage/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const PLAYER_CONCURRENCY = 6;

type Task = { label: string; run: () => Promise<Response> };

function req(path: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://internal${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

async function runAll(tasks: Task[], concurrency: number) {
  const failed: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const task = tasks[next++]!;
        try {
          const res = await task.run();
          if (!res.ok && res.status !== 404) failed.push(`${task.label} ${res.status}`);
        } catch (err) {
          failed.push(`${task.label} ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })
  );
  return failed;
}

/**
 * Pre-build the NBA dashboard responses (Redis) for every player and team on the props list,
 * with the same params the dashboard sends, so first clicks are served from cache.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  if (!NBA_PUBLIC_ENABLED) return NextResponse.json({ success: true, skipped: 'NBA is not public' });
  const started = Date.now();
  const list = await readNbaPlayerPropsListCache();
  const rows = list?.data ?? [];

  const teams = new Set<string>();
  const players = new Map<string, { name: string; team: string; opponent: string | null }>();
  for (const row of rows) {
    const team = resolveNbaClubName(row.playerTeam ?? row.team);
    const opponent = resolveNbaClubName(row.opponent);
    if (team) teams.add(team);
    if (opponent) teams.add(opponent);
    const id = String(row.playerId ?? '');
    if (team && /^\d+$/.test(id) && !players.has(id)) {
      players.set(id, { name: String(row.playerName), team, opponent: opponent || null });
    }
  }

  const year = String(NBA_CURRENT_SEASON_YEAR);
  const shotYears = NBA_SHOT_CHART_CACHE_YEARS.join(',');
  const shared: Task[] = [
    { label: 'players', run: () => playersGET() },
    { label: 'injuries', run: () => injuriesGET() },
    { label: 'ladder', run: () => ladderGET(req('/api/nba/dash/ladder')) },
    { label: 'player-ratings', run: () => playerRatingsGET(req('/api/nba/dash/player-ratings', { year })) },
    { label: 'league-player-stats', run: () => leaguePlayerStatsGET(req('/api/nba/dash/league-player-stats', { year })) },
    { label: 'team-ste-stats', run: () => teamSteStatsGET(req('/api/nba/dash/team-ste-stats', { year, window: '0' })) },
    // Every player's matchup reads one league table; any playerId builds it.
    {
      label: 'play-type-matchup',
      run: () => playTypeMatchupGET(req('/api/nba/dash/play-type-matchup', { playerId: '0' })),
    },
  ];
  const perTeam: Task[] = [...teams].flatMap((team) => [
    { label: `next-game ${team}`, run: () => nextGameGET(req('/api/nba/dash/next-game', { team, year })) },
    { label: `lineups ${team}`, run: () => lineupsGET(req('/api/nba/dash/lineups', { team })) },
    {
      label: `shot-defense ${team}`,
      run: () => shotChartGET(req('/api/nba/dash/shot-chart', { mode: 'defense', team, years: shotYears, ranks: '1' })),
    },
  ]);
  const perPlayer: Task[] = [...players].flatMap(([playerId, p]) => [
    {
      label: `logs ${p.name}`,
      run: () =>
        playerGameLogsGET(req('/api/nba/dash/player-game-logs', { playerId, years: NBA_CHART_HISTORY_YEARS.join(',') })),
    },
    {
      label: `shot ${p.name}`,
      run: () =>
        shotChartGET(req('/api/nba/dash/shot-chart', { mode: 'player', playerName: p.name, years: shotYears, team: p.team })),
    },
    {
      label: `usage ${p.name}`,
      run: () => teamUsageGET(req('/api/nba/dash/team-usage', { team: p.team, year, tf: 'last10', playerId })),
    },
    {
      label: `play-types ${p.name}`,
      run: () =>
        playTypeMatchupGET(
          req('/api/nba/dash/play-type-matchup', p.opponent ? { playerId, opponent: p.opponent } : { playerId })
        ),
    },
  ]);

  const failed = await runNbaDashWarm(async () => {
    const out = await runAll([...shared, ...perTeam], PLAYER_CONCURRENCY);
    out.push(...(await runAll(perPlayer, PLAYER_CONCURRENCY)));
    return out;
  });

  return NextResponse.json({
    success: failed.length === 0,
    teams: teams.size,
    players: players.size,
    tasks: shared.length + perTeam.length + perPlayer.length,
    failed: failed.slice(0, 20),
    ms: Date.now() - started,
  });
}
