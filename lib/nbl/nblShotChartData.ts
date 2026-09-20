/**
 * Load / cache SportRadar shot charts and aggregate player offense or team defense zones.
 *
 * Live SportRadar fetches are for warm scripts / CI only.
 * Dashboard API paths must use cacheOnly + prebuilt aggregates.
 */

import fs from 'fs';
import path from 'path';
import {
  getNblClubByCode,
  NBL_CLUBS,
  NBL_SHOT_CHART_CACHE_YEARS,
  NBL_SHOT_CHART_SEASON_YEAR,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';
import {
  aggregateZoneStats,
  classifyNblShotZone,
  emptyZoneStats,
  type NblShotZoneId,
  type NblZoneStat,
} from '@/lib/nbl/nblShotZones';
import {
  fetchNblMatchShotChart,
  type NblMatchShotChart,
  type NblRawShot,
} from '@/lib/nbl/sportRadarShots';

/**
 * Min opponent FGA in a zone before a team enters that zone's ranking.
 * 8 was a full-season floor; NBL27 is 1 game, so corners/mid-range almost
 * never reach 8. 4 still drops 1–2 shot luck zones.
 */
const MIN_ZONE_FGA_FOR_RANK = 4;

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

const FIXTURE_CACHE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'shot-charts');
const PLAYER_CACHE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'shot-chart-players');
const DEFENSE_CACHE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'shot-chart-defense');

export function normalizeNblShotPlayerKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|jnr)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GIVEN_NAME_ALIASES: Record<string, string[]> = {
  will: ['william'],
  william: ['will'],
  nick: ['nicholas'],
  nicholas: ['nick'],
  johny: ['johnny', 'john'],
  johnny: ['johny', 'john'],
  dan: ['daniel'],
  daniel: ['dan'],
  joe: ['joseph'],
  joseph: ['joe'],
  chris: ['christopher'],
  christopher: ['chris'],
  josh: ['joshua'],
  joshua: ['josh'],
  sam: ['samuel'],
  samuel: ['sam'],
  matt: ['matthew'],
  matthew: ['matt'],
  alex: ['alexander'],
  alexander: ['alex'],
  tony: ['anthony'],
  anthony: ['tony'],
  mike: ['michael'],
  michael: ['mike'],
  tom: ['thomas'],
  thomas: ['tom'],
};

export function nblShotPlayerAliasKeys(name: string): string[] {
  const full = normalizeNblShotPlayerKey(name);
  if (!full) return [];
  const parts = full.split(' ').filter(Boolean);
  const keys = new Set<string>([full]);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    keys.add(`${first} ${last}`);
    for (const alt of GIVEN_NAME_ALIASES[first] || []) {
      keys.add(`${alt} ${last}`);
      keys.add([alt, ...parts.slice(1)].join(' '));
    }
  }
  return [...keys];
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = resolveNblClubName(a);
  const cb = resolveNblClubName(b);
  if (ca && cb) return normalizeTeamKey(ca) === normalizeTeamKey(cb);
  return normalizeTeamKey(a) === normalizeTeamKey(b);
}

/** Exact, alias (Will/William), or long-name contains (Swaka Lo Buluk). */
export function nblShotPlayerNamesMatch(a: string, b: string): boolean {
  const ka = normalizeNblShotPlayerKey(a);
  const kb = normalizeNblShotPlayerKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const aKeys = new Set(nblShotPlayerAliasKeys(a));
  for (const key of nblShotPlayerAliasKeys(b)) {
    if (aKeys.has(key)) return true;
  }
  if (ka.length >= 10 && kb.length >= 10 && (ka.includes(kb) || kb.includes(ka))) return true;
  return false;
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function fixtureCachePath(fixtureId: string): string {
  return path.join(FIXTURE_CACHE_DIR, `${fixtureId}.json`);
}

function playerCachePath(nameKey: string): string {
  const safe = nameKey.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  return path.join(PLAYER_CACHE_DIR, `${safe}.json`);
}

function defenseCachePath(teamKey: string): string {
  const safe = normalizeTeamKey(teamKey) || 'unknown';
  return path.join(DEFENSE_CACHE_DIR, `${safe}.json`);
}

export function shotChartManifestPath(years: number[]): string {
  const label = [...years].sort((a, b) => b - a).join('-');
  return path.join(process.cwd(), 'data', 'nbl-model', 'cache', `shot-chart-manifest-${label}.json`);
}

export function readCachedShotChart(fixtureId: string): NblMatchShotChart | null {
  const cached = readJson<NblMatchShotChart>(fixtureCachePath(fixtureId));
  if (!cached || !Array.isArray(cached.shots)) return null;
  return withFreshZones(cached);
}

export function writeCachedShotChart(chart: NblMatchShotChart): void {
  try {
    writeJson(fixtureCachePath(chart.fixtureId), chart);
  } catch {
    /* best-effort */
  }
}

export async function getMatchShotChart(
  fixtureId: string,
  options: { forceRefresh?: boolean; cacheOnly?: boolean; signal?: AbortSignal } = {}
): Promise<NblMatchShotChart | null> {
  if (!options.forceRefresh) {
    const cached = readCachedShotChart(fixtureId);
    if (cached && cached.shots.length > 0) return cached;
  }
  if (options.cacheOnly) return null;

  const live = await fetchNblMatchShotChart(fixtureId, { signal: options.signal });
  if (live && live.shots.length > 0) {
    const zoned = withFreshZones(live);
    writeCachedShotChart(zoned);
    return zoned;
  }
  return live;
}

export function loadScheduleGames(years: number[]): Array<ScheduleGame & { year: number }> {
  const out: Array<ScheduleGame & { year: number }> = [];
  for (const year of years) {
    const file = path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`);
    const snap = readJson<{ games?: ScheduleGame[] }>(file);
    const games = Array.isArray(snap?.games) ? snap!.games! : [];
    for (const g of games) out.push({ ...g, year });
  }
  return out;
}

export function isCompletedGame(g: ScheduleGame): boolean {
  const status = String(g.status || '').toLowerCase();
  if (status.includes('complete') || status === 'closed' || status === 'final') return true;
  return g.homeScore != null && g.awayScore != null;
}

export function fixtureIdOf(g: ScheduleGame): string | null {
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
  /** Omitted from disk aggregates to keep cache small. */
  shots?: Array<
    NblRawShot & {
      fixtureId: string;
      opponent: string | null;
      startTime: string | null;
      year: number;
    }
  >;
  generatedAt?: string;
  fromCache?: boolean;
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
  ranks: Array<NblZoneStat & { rank: number | null; teamsCompared: number }>;
  /** Box-score points conceded (includes FTs). */
  pointsAllowed?: number;
  /** Opponent free throws allowed, ranked like other zones (lower FT% = better). */
  ftDefense?: NblFtDefenseStat;
  generatedAt?: string;
  fromCache?: boolean;
};

export type NblFtDefenseStat = {
  ftm: number;
  fta: number;
  ftPct: number;
  games: number;
  rank: number | null;
  teamsCompared: number;
};

type FtBucket = { ftm: number; fta: number; games: Set<string> };

const MIN_FTA_FOR_RANK = MIN_ZONE_FGA_FOR_RANK;
let ftAllowedMemo: { key: string; byTeam: Map<string, FtBucket> } | null = null;

function defenderNameFromLog(opponent: string | null | undefined, opponentCode: string | null | undefined): string | null {
  return (
    resolveNblClubName(opponent) ||
    getNblClubByCode(opponentCode)?.name ||
    null
  );
}

function loadFtAllowedByTeam(years: number[]): Map<string, FtBucket> {
  const key = years.join(',');
  if (ftAllowedMemo?.key === key) return ftAllowedMemo.byTeam;
  const byTeam = new Map<string, FtBucket>();
  for (const club of NBL_CLUBS) byTeam.set(club.name, { ftm: 0, fta: 0, games: new Set() });
  const dir = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs');
  if (fs.existsSync(dir)) {
    for (const year of years) {
      const suffix = `-${year}.json`;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(suffix)) continue;
        try {
          const payload = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as {
            games?: Array<{
              matchId?: string | null;
              date?: string | null;
              team?: string | null;
              opponent?: string | null;
              opponentCode?: string | null;
              ftMade?: number | null;
              ftAttempted?: number | null;
            }>;
          };
          for (const game of payload.games || []) {
            const defender = defenderNameFromLog(game.opponent, game.opponentCode);
            if (!defender) continue;
            const bucket = byTeam.get(defender);
            if (!bucket) continue;
            bucket.ftm += Number(game.ftMade) || 0;
            bucket.fta += Number(game.ftAttempted) || 0;
            bucket.games.add(
              String(game.matchId || `${game.date || ''}|${defender}|${game.team || ''}`)
            );
          }
        } catch {
          /* skip corrupt log */
        }
      }
    }
  }
  ftAllowedMemo = { key, byTeam };
  return byTeam;
}

export function rankFtDefense(team: string, years?: number[]): NblFtDefenseStat {
  const yrs = years?.length ? years : [...NBL_SHOT_CHART_CACHE_YEARS];
  const teamName = resolveNblClubName(team) || team;
  const byTeam = loadFtAllowedByTeam(yrs);
  const own = byTeam.get(teamName) || { ftm: 0, fta: 0, games: new Set<string>() };
  const scored: Array<{ team: string; ftPct: number }> = [];
  for (const [name, bucket] of byTeam) {
    if (bucket.fta < MIN_FTA_FOR_RANK) continue;
    scored.push({ team: name, ftPct: (bucket.ftm / bucket.fta) * 100 });
  }
  scored.sort((a, b) => a.ftPct - b.ftPct);
  const idx = scored.findIndex((s) => teamsMatch(s.team, teamName));
  return {
    ftm: own.ftm,
    fta: own.fta,
    ftPct: own.fta > 0 ? (own.ftm / own.fta) * 100 : 0,
    games: own.games.size,
    rank: idx >= 0 ? idx + 1 : null,
    teamsCompared: scored.length,
  };
}

export function opponentPointsConceded(team: string, years?: number[]): number {
  const teamName = resolveNblClubName(team) || team;
  const yrs = years?.length ? years : [...NBL_SHOT_CHART_CACHE_YEARS];
  const games = loadScheduleGames(yrs)
    .filter(isCompletedGame)
    .filter((g) => teamsMatch(g.homeTeam, teamName) || teamsMatch(g.awayTeam, teamName));
  let points = 0;
  for (const game of games) {
    const isHome = teamsMatch(game.homeTeam, teamName);
    const oppScore = isHome ? game.awayScore : game.homeScore;
    const n = Number(oppScore);
    if (Number.isFinite(n)) points += n;
  }
  return points;
}

export type NblShotChartManifest = {
  years: number[];
  generatedAt: string;
  fixturesTotal: number;
  fixturesCached: number;
  fixturesFetched: number;
  fixturesMissing: number;
  playersCached: number;
  defenseTeamsCached: number;
};

export function readPlayerShotChartCache(playerName: string): NblPlayerShotChartResult | null {
  const cached = readJson<NblPlayerShotChartResult>(playerCachePath(normalizeNblShotPlayerKey(playerName)));
  if (!cached || cached.mode !== 'player' || !Array.isArray(cached.zones)) return null;
  return { ...cached, fromCache: true };
}

export function writePlayerShotChartCache(result: NblPlayerShotChartResult): void {
  const { shots: _shots, ...rest } = result;
  writeJson(playerCachePath(normalizeNblShotPlayerKey(result.playerName)), {
    ...rest,
    generatedAt: result.generatedAt || new Date().toISOString(),
  });
}

export function readTeamDefenseShotChartCache(team: string): NblDefenseShotChartResult | null {
  const resolved = resolveNblClubName(team) || team;
  const cached = readJson<NblDefenseShotChartResult>(defenseCachePath(resolved));
  if (!cached || cached.mode !== 'defense' || !Array.isArray(cached.zones)) return null;
  return { ...cached, fromCache: true };
}

export function writeTeamDefenseShotChartCache(result: NblDefenseShotChartResult): void {
  writeJson(defenseCachePath(result.team), {
    ...result,
    generatedAt: result.generatedAt || new Date().toISOString(),
  });
}

export function writeShotChartManifest(manifest: NblShotChartManifest): void {
  writeJson(shotChartManifestPath(manifest.years), manifest);
}

type FixtureShotBundle = {
  displayName: string;
  team: string | null;
  fixtures: Set<string>;
  shots: Array<{ zone: NblShotZoneId | null; made: boolean }>;
};

function listCachedFixtures(): NblMatchShotChart[] {
  if (!fs.existsSync(FIXTURE_CACHE_DIR)) return [];
  const out: NblMatchShotChart[] = [];
  for (const file of fs.readdirSync(FIXTURE_CACHE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const chart = readCachedShotChart(file.replace(/\.json$/, ''));
    if (chart?.shots?.length) out.push(chart);
  }
  return out;
}

function listPlayerShotChartCaches(): NblPlayerShotChartResult[] {
  if (!fs.existsSync(PLAYER_CACHE_DIR)) return [];
  const out: NblPlayerShotChartResult[] = [];
  for (const file of fs.readdirSync(PLAYER_CACHE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const cached = readJson<NblPlayerShotChartResult>(path.join(PLAYER_CACHE_DIR, file));
    if (!cached || cached.mode !== 'player' || !Array.isArray(cached.zones)) continue;
    out.push({ ...cached, fromCache: true });
  }
  return out;
}

/**
 * Rebuild player aggregates from cached fixtures for the requested seasons only.
 * Writes one file per shooter, then copies onto roster spellings that alias-match.
 */
export function rebuildPlayerShotChartAggregatesFromFixtures(options?: {
  rosterNames?: string[];
  years?: number[];
}): { playersWritten: number; withShots: number } {
  const years = options?.years?.length ? options.years : [...NBL_SHOT_CHART_CACHE_YEARS];
  const allowedFixtureIds = new Set(
    loadScheduleGames(years)
      .filter(isCompletedGame)
      .map((game) => fixtureIdOf(game))
      .filter((id): id is string => Boolean(id))
  );

  if (fs.existsSync(PLAYER_CACHE_DIR)) {
    for (const file of fs.readdirSync(PLAYER_CACHE_DIR)) {
      if (!file.endsWith('.json')) continue;
      fs.unlinkSync(path.join(PLAYER_CACHE_DIR, file));
    }
  }

  const byKey = new Map<string, FixtureShotBundle>();

  for (const chart of listCachedFixtures()) {
    if (allowedFixtureIds.size > 0 && !allowedFixtureIds.has(chart.fixtureId)) continue;
    for (const shot of chart.shots) {
      const name = String(shot.name || '').trim();
      const key = normalizeNblShotPlayerKey(name);
      if (!key) continue;
      let bundle = byKey.get(key);
      if (!bundle) {
        bundle = {
          displayName: name,
          team: shot.teamName ?? null,
          fixtures: new Set(),
          shots: [],
        };
        byKey.set(key, bundle);
      }
      bundle.fixtures.add(chart.fixtureId);
      bundle.shots.push({ zone: shot.zone, made: shot.made });
    }
  }

  let playersWritten = 0;
  let withShots = 0;
  const generatedAt = new Date().toISOString();

  for (const bundle of byKey.values()) {
    const result: NblPlayerShotChartResult = {
      mode: 'player',
      playerName: bundle.displayName,
      team: bundle.team ? resolveNblClubName(bundle.team) || bundle.team : null,
      years,
      gamesUsed: bundle.fixtures.size,
      fixturesFetched: 0,
      fixturesCached: bundle.fixtures.size,
      shotCount: bundle.shots.length,
      zones: aggregateZoneStats(bundle.shots),
      generatedAt,
    };
    writePlayerShotChartCache(result);
    playersWritten += 1;
    if (result.shotCount > 0) withShots += 1;
  }

  for (const rosterName of options?.rosterNames || []) {
    const name = String(rosterName || '').trim();
    if (!name) continue;
    const existing = readPlayerShotChartCache(name);
    if (existing && existing.shotCount > 0) continue;
    let best: FixtureShotBundle | null = null;
    for (const bundle of byKey.values()) {
      if (!nblShotPlayerNamesMatch(bundle.displayName, name)) continue;
      if (!best || bundle.shots.length > best.shots.length) best = bundle;
    }
    if (!best || best.shots.length === 0) continue;
    writePlayerShotChartCache({
      mode: 'player',
      playerName: name,
      team: best.team ? resolveNblClubName(best.team) || best.team : null,
      years,
      gamesUsed: best.fixtures.size,
      fixturesFetched: 0,
      fixturesCached: best.fixtures.size,
      shotCount: best.shots.length,
      zones: aggregateZoneStats(best.shots),
      generatedAt,
    });
    playersWritten += 1;
    withShots += 1;
  }

  return { playersWritten, withShots };
}

export async function buildPlayerShotChart(options: {
  playerName: string;
  team?: string | null;
  years?: number[];
  maxGames?: number;
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}): Promise<NblPlayerShotChartResult> {
  const playerName = String(options.playerName || '').trim();
  const years = options.years?.length ? options.years : [...NBL_SHOT_CHART_CACHE_YEARS];
  const maxGames = options.maxGames ?? 200;
  const cacheOnly = options.cacheOnly === true;

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
  const shots: NonNullable<NblPlayerShotChartResult['shots']> = [];

  await mapPool(schedule, 3, async (game) => {
    const fixtureId = fixtureIdOf(game);
    if (!fixtureId) return;
    const hadCache = Boolean(readCachedShotChart(fixtureId));
    const chart = await getMatchShotChart(fixtureId, {
      forceRefresh: options.forceRefresh,
      cacheOnly,
    });
    if (!chart) return;
    if (hadCache && !options.forceRefresh) fixturesCached += 1;
    else fixturesFetched += 1;

    const opponent = teamsMatch(game.homeTeam, teamName)
      ? game.awayTeam || null
      : game.homeTeam || null;

    for (const shot of chart.shots) {
      if (!nblShotPlayerNamesMatch(shot.name, playerName)) continue;
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
    generatedAt: new Date().toISOString(),
  };
}

export async function buildTeamDefenseShotChart(options: {
  team: string;
  years?: number[];
  maxGames?: number;
  forceRefresh?: boolean;
  cacheOnly?: boolean;
  withLeagueRanks?: boolean;
}): Promise<NblDefenseShotChartResult> {
  const teamName = resolveNblClubName(options.team) || options.team;
  const years = options.years?.length ? options.years : [...NBL_SHOT_CHART_CACHE_YEARS];
  const maxGames = options.maxGames ?? 200;
  const cacheOnly = options.cacheOnly === true;
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
    const chart = await getMatchShotChart(fixtureId, {
      forceRefresh: options.forceRefresh,
      cacheOnly,
    });
    if (!chart) return;
    if (hadCache && !options.forceRefresh) fixturesCached += 1;
    else fixturesFetched += 1;

    for (const shot of chart.shots) {
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
        if (teamsMatch(shooterTeam, home) && away) {
          byTeam.get(away)?.push(shot);
        } else if (teamsMatch(shooterTeam, away) && home) {
          byTeam.get(home)?.push(shot);
        }
      }
    }

    byTeam.set(teamName, against);

    ranks = zones.map((zoneRow) => {
      const scored: Array<{ team: string; fgPct: number; fga: number }> = [];
      for (const [team, shots] of byTeam) {
        const agg = aggregateZoneStats(shots.map((s) => ({ zone: s.zone, made: s.made })));
        const z = agg.find((r) => r.zone === zoneRow.zone);
        if (!z || z.fga < MIN_ZONE_FGA_FOR_RANK) continue;
        scored.push({ team, fgPct: z.fgPct, fga: z.fga });
      }
      scored.sort((a, b) => a.fgPct - b.fgPct);
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
    pointsAllowed: opponentPointsConceded(teamName, years),
    ftDefense: rankFtDefense(teamName, years),
    generatedAt: new Date().toISOString(),
  };
}

/** Dashboard-safe: prebuilt aggregate only. */
export function loadPlayerShotChartForApi(
  playerName: string,
  team?: string | null
): NblPlayerShotChartResult | null {
  void team;
  const exact = readPlayerShotChartCache(playerName);
  if (exact && exact.shotCount > 0) return exact;

  for (const key of nblShotPlayerAliasKeys(playerName)) {
    const aliased = readJson<NblPlayerShotChartResult>(playerCachePath(key));
    if (aliased && aliased.mode === 'player' && (aliased.shotCount || 0) > 0) {
      return { ...aliased, fromCache: true };
    }
  }

  for (const cached of listPlayerShotChartCaches()) {
    if ((cached.shotCount || 0) <= 0) continue;
    if (nblShotPlayerNamesMatch(cached.playerName, playerName)) {
      return cached;
    }
  }

  return exact;
}

/** Dashboard-safe: prebuilt defense aggregate only. */
export function loadTeamDefenseShotChartForApi(team: string): NblDefenseShotChartResult | null {
  const cached = readTeamDefenseShotChartCache(team);
  if (!cached) return null;
  return {
    ...cached,
    pointsAllowed: opponentPointsConceded(cached.team || team, cached.years),
    ftDefense: rankFtDefense(cached.team || team, cached.years),
  };
}

export function emptyPlayerShotChart(playerName: string, years: number[]): NblPlayerShotChartResult {
  return {
    mode: 'player',
    playerName,
    team: null,
    years,
    gamesUsed: 0,
    fixturesFetched: 0,
    fixturesCached: 0,
    shotCount: 0,
    zones: emptyZoneStats(),
    fromCache: true,
  };
}

export { NBL_SHOT_CHART_SEASON_YEAR, NBL_SHOT_CHART_CACHE_YEARS, FIXTURE_CACHE_DIR, PLAYER_CACHE_DIR, DEFENSE_CACHE_DIR };
