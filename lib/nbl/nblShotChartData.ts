/**
 * Load / cache SportRadar shot charts and aggregate player offense or team defense zones.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  NBL_SHOT_CHART_SEASON_YEAR,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';
import {
  aggregateZoneStats,
  classifyNblShotZone,
  type NblZoneStat,
} from '@/lib/nbl/nblShotZones';
import {
  fetchNblMatchShotChart,
  type NblMatchShotChart,
  type NblRawShot,
} from '@/lib/nbl/sportRadarShots';

/** Re-run zone math so older caches pick up classifier updates (e.g. Paint). */
function withFreshZones(chart: NblMatchShotChart): NblMatchShotChart {
  return {
    ...chart,
    shots: chart.shots.map((shot) => ({
      ...shot,
      zone: classifyNblShotZone({
        x: shot.x,
        y: shot.y,
        eventType: shot.eventType,
        desc: shot.desc,
      }),
    })),
  };
}

type ScheduleGame = {
  id?: string;
  externalId?: string | null;
  startTime?: string | null;
  status?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

const CACHE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'shot-charts');

function normalizeNameKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = resolveNblClubName(a);
  const cb = resolveNblClubName(b);
  if (ca && cb) return normalizeTeamKey(ca) === normalizeTeamKey(cb);
  return normalizeTeamKey(a) === normalizeTeamKey(b);
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function cachePath(fixtureId: string): string {
  return path.join(CACHE_DIR, `${fixtureId}.json`);
}

export function readCachedShotChart(fixtureId: string): NblMatchShotChart | null {
  const cached = readJson<NblMatchShotChart>(cachePath(fixtureId));
  if (!cached || !Array.isArray(cached.shots)) return null;
  return withFreshZones(cached);
}

export function writeCachedShotChart(chart: NblMatchShotChart): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(chart.fixtureId), JSON.stringify(chart, null, 2));
  } catch {
    /* best-effort */
  }
}

export async function getMatchShotChart(
  fixtureId: string,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<NblMatchShotChart | null> {
  if (!options.forceRefresh) {
    const cached = readCachedShotChart(fixtureId);
    if (cached && cached.shots.length > 0) return cached;
  }
  const live = await fetchNblMatchShotChart(fixtureId, { signal: options.signal });
  if (live && live.shots.length > 0) {
    const zoned = withFreshZones(live);
    writeCachedShotChart(zoned);
    return zoned;
  }
  return live;
}

function loadScheduleGames(years: number[]): Array<ScheduleGame & { year: number }> {
  const out: Array<ScheduleGame & { year: number }> = [];
  for (const year of years) {
    const file = path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`);
    const snap = readJson<{ games?: ScheduleGame[] }>(file);
    const games = Array.isArray(snap?.games) ? snap!.games! : [];
    for (const g of games) out.push({ ...g, year });
  }
  return out;
}

function isCompletedGame(g: ScheduleGame): boolean {
  const status = String(g.status || '').toLowerCase();
  if (status.includes('complete') || status === 'closed' || status === 'final') return true;
  return g.homeScore != null && g.awayScore != null;
}

function fixtureIdOf(g: ScheduleGame): string | null {
  const id = String(g.externalId || g.id || '').trim();
  return id || null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export type NblPlayerShotChartResult = {
  mode: 'player';
  playerName: string;
  team: string | null;
  years: number[];
  gamesUsed: number;
  fixturesFetched: number;
  fixturesCached: number;
  shotCount: number;
  zones: NblZoneStat[];
  shots: Array<
    NblRawShot & {
      fixtureId: string;
      opponent: string | null;
      startTime: string | null;
      year: number;
    }
  >;
};

export type NblDefenseShotChartResult = {
  mode: 'defense';
  team: string;
  years: number[];
  gamesUsed: number;
  fixturesFetched: number;
  fixturesCached: number;
  shotCount: number;
  zones: NblZoneStat[];
  /** Lower fgPct / fewer makes = more restrictive; rank 1 = stingiest in that zone among clubs with data. */
  ranks: Array<NblZoneStat & { rank: number | null; teamsCompared: number }>;
};

export async function buildPlayerShotChart(options: {
  playerName: string;
  team?: string | null;
  years?: number[];
  maxGames?: number;
  forceRefresh?: boolean;
}): Promise<NblPlayerShotChartResult> {
  const playerName = String(options.playerName || '').trim();
  const nameKey = normalizeNameKey(playerName);
  const years = options.years?.length ? options.years : [NBL_SHOT_CHART_SEASON_YEAR];
  /** Full season by default (NBL ~28–40 games incl. finals). */
  const maxGames = options.maxGames ?? 80;

  const teamName = options.team ? resolveNblClubName(options.team) || options.team : null;
  const schedule = loadScheduleGames(years)
    .filter(isCompletedGame)
    .filter((g) => {
      if (!teamName) return true;
      return teamsMatch(g.homeTeam, teamName) || teamsMatch(g.awayTeam, teamName);
    })
    .sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')))
    .slice(0, maxGames);

  let fixturesFetched = 0;
  let fixturesCached = 0;
  const shots: NblPlayerShotChartResult['shots'] = [];

  await mapPool(schedule, 3, async (game) => {
    const fixtureId = fixtureIdOf(game);
    if (!fixtureId) return;
    const hadCache = Boolean(readCachedShotChart(fixtureId));
    const chart = await getMatchShotChart(fixtureId, { forceRefresh: options.forceRefresh });
    if (!chart) return;
    if (hadCache && !options.forceRefresh) fixturesCached += 1;
    else fixturesFetched += 1;

    const opponent = teamsMatch(game.homeTeam, teamName)
      ? game.awayTeam || null
      : game.homeTeam || null;

    for (const shot of chart.shots) {
      if (normalizeNameKey(shot.name) !== nameKey) continue;
      shots.push({
        ...shot,
        fixtureId,
        opponent,
        startTime: game.startTime ?? null,
        year: game.year,
      });
    }
  });

  return {
    mode: 'player',
    playerName,
    team: teamName,
    years,
    gamesUsed: schedule.length,
    fixturesFetched,
    fixturesCached,
    shotCount: shots.length,
    zones: aggregateZoneStats(shots.map((s) => ({ zone: s.zone, made: s.made }))),
    shots,
  };
}

/**
 * Opponent shots against `team`, zoned — plus league ranks (1 = most restrictive FG%).
 */
export async function buildTeamDefenseShotChart(options: {
  team: string;
  years?: number[];
  maxGames?: number;
  forceRefresh?: boolean;
  /** If true, also scrape every club's games to compute ranks (heavier). */
  withLeagueRanks?: boolean;
}): Promise<NblDefenseShotChartResult> {
  const teamName = resolveNblClubName(options.team) || options.team;
  const years = options.years?.length ? options.years : [NBL_SHOT_CHART_SEASON_YEAR];
  const maxGames = options.maxGames ?? 80;
  const withRanks = options.withLeagueRanks !== false;

  const schedule = loadScheduleGames(years)
    .filter(isCompletedGame)
    .filter((g) => teamsMatch(g.homeTeam, teamName) || teamsMatch(g.awayTeam, teamName))
    .sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')))
    .slice(0, maxGames);

  let fixturesFetched = 0;
  let fixturesCached = 0;
  const against: NblRawShot[] = [];

  await mapPool(schedule, 3, async (game) => {
    const fixtureId = fixtureIdOf(game);
    if (!fixtureId) return;
    const hadCache = Boolean(readCachedShotChart(fixtureId));
    const chart = await getMatchShotChart(fixtureId, { forceRefresh: options.forceRefresh });
    if (!chart) return;
    if (hadCache && !options.forceRefresh) fixturesCached += 1;
    else fixturesFetched += 1;

    for (const shot of chart.shots) {
      // Shots taken by the opponent (= against this team's defense)
      if (teamsMatch(shot.teamName, teamName)) continue;
      against.push(shot);
    }
  });

  const zones = aggregateZoneStats(against.map((s) => ({ zone: s.zone, made: s.made })));

  let ranks: NblDefenseShotChartResult['ranks'] = zones.map((z) => ({
    ...z,
    rank: null,
    teamsCompared: 0,
  }));

  if (withRanks) {
    // Use cached charts league-wide for ranks (no extra network unless missing).
    const byTeam = new Map<string, NblRawShot[]>();
    for (const club of NBL_CLUBS) byTeam.set(club.name, []);

    const allGames = loadScheduleGames(years).filter(isCompletedGame);
    for (const game of allGames) {
      const fixtureId = fixtureIdOf(game);
      if (!fixtureId) continue;
      const chart = readCachedShotChart(fixtureId);
      if (!chart) continue;
      const home = resolveNblClubName(game.homeTeam || '') || game.homeTeam || '';
      const away = resolveNblClubName(game.awayTeam || '') || game.awayTeam || '';
      for (const shot of chart.shots) {
        const shooterTeam = resolveNblClubName(shot.teamName || '') || shot.teamName || '';
        // Defense team is the other side
        if (teamsMatch(shooterTeam, home) && away) {
          byTeam.get(away)?.push(shot);
        } else if (teamsMatch(shooterTeam, away) && home) {
          byTeam.get(home)?.push(shot);
        }
      }
    }

    // Ensure current team includes freshly fetched shots even if cache walk missed some
    byTeam.set(teamName, against);

    ranks = zones.map((zoneRow) => {
      const scored: Array<{ team: string; fgPct: number; fga: number }> = [];
      for (const [team, shots] of byTeam) {
        const agg = aggregateZoneStats(shots.map((s) => ({ zone: s.zone, made: s.made })));
        const z = agg.find((r) => r.zone === zoneRow.zone);
        if (!z || z.fga < 8) continue; // need volume
        scored.push({ team, fgPct: z.fgPct, fga: z.fga });
      }
      scored.sort((a, b) => a.fgPct - b.fgPct); // lower FG% allowed = better D
      const idx = scored.findIndex((s) => teamsMatch(s.team, teamName));
      return {
        ...zoneRow,
        rank: idx >= 0 ? idx + 1 : null,
        teamsCompared: scored.length,
      };
    });
  }

  return {
    mode: 'defense',
    team: teamName,
    years,
    gamesUsed: schedule.length,
    fixturesFetched,
    fixturesCached,
    shotCount: against.length,
    zones,
    ranks,
  };
}
