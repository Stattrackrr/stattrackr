/**
 * Where a player's assists finish, using the shot-chart (x, y) of the made basket.
 * 2026 season only. Dashboard reads the player aggregate; the rebuild script fetches PBP.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  NBL_SHOT_CHART_SEASON_YEAR,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';
import {
  isCompletedGame,
  loadScheduleGames,
  nblShotPlayerAliasKeys,
  nblShotPlayerNamesMatch,
  normalizeNblShotPlayerKey,
  readCachedShotChart,
  fixtureIdOf,
} from '@/lib/nbl/nblShotChartData';
import {
  aggregateZoneStats,
  classifyNblShotZone,
  emptyZoneStats,
  NBL_SHOT_ZONE_IDS,
  type NblShotZoneId,
  type NblZoneStat,
} from '@/lib/nbl/nblShotZones';
import type { NblMatchShotChart, NblRawShot } from '@/lib/nbl/sportRadarShots';
import { fetchNblMatchPbpJson } from '@/lib/nbl/sportRadarPbp';

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'assist-shots');
const PLAYER_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'assist-chart-players');
const DEFENSE_DIR = path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'assist-defense');

export type NblAssistShot = {
  personId: string | null;
  name: string;
  teamName: string | null;
  zone: NblShotZoneId;
  eventId: string | null;
  x: number;
  y: number;
};

export type NblFixtureAssistShots = {
  fixtureId: string;
  year: number;
  assistCount: number;
  located: number;
  shots: NblAssistShot[];
};

export type NblPlayerAssistChart = {
  playerName: string;
  team: string | null;
  year: number;
  gamesUsed: number;
  assistCount: number;
  zones: NblZoneStat[];
  generatedAt?: string;
};

export type NblAssistDefenseRank = NblZoneStat & {
  rank: number | null;
  teamsCompared: number;
  astPerGame: number;
};

export type NblTeamAssistDefense = {
  team: string;
  year: number;
  gamesUsed: number;
  assistCount: number;
  zones: NblZoneStat[];
  ranks: NblAssistDefenseRank[];
  generatedAt?: string;
};

type PbpEvent = {
  clock?: string | null;
  entityId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  name?: string | null;
  periodId?: number | null;
  personId?: string | null;
  success?: boolean | null;
  successString?: string | null;
  x?: number | null;
  y?: number | null;
};

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
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function playerCachePath(nameKey: string): string {
  const safe = nameKey.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  return path.join(PLAYER_DIR, `${safe}.json`);
}

function fixtureCachePath(fixtureId: string): string {
  return path.join(FIXTURE_DIR, `${fixtureId}.json`);
}

function normalizeEventType(ev: PbpEvent): string {
  return String(ev.eventType || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

function isMade(ev: PbpEvent): boolean {
  if (ev.success === true) return true;
  if (ev.success === false) return false;
  return String(ev.successString || '').toLowerCase() === 'made';
}

function isFieldGoal(ev: PbpEvent): boolean {
  const t = normalizeEventType(ev);
  return t === '2pt' || t === '3pt' || t === '2p' || t === '3p' || t === 'threepoint' || t === 'twopoint';
}

function isSkippable(ev: PbpEvent): boolean {
  const t = normalizeEventType(ev);
  return (
    t === 'foul' ||
    t === 'freethrow' ||
    t === 'ft' ||
    t === '1pt' ||
    t === 'substitution' ||
    t === 'timeout'
  );
}

export function flattenPbpEvents(json: unknown): PbpEvent[] {
  const data = (json as { data?: { pbp?: unknown } } | null)?.data;
  const pbp = data?.pbp;
  if (!pbp || typeof pbp !== 'object') return [];
  const keys = Object.keys(pbp as Record<string, unknown>).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const events: PbpEvent[] = [];
  for (const key of keys) {
    const period = (pbp as Record<string, unknown>)[key];
    const evs = Array.isArray(period)
      ? period
      : period && typeof period === 'object'
        ? (period as { events?: unknown }).events
        : null;
    if (Array.isArray(evs)) events.push(...(evs as PbpEvent[]));
  }
  return events;
}

function findMadeBasket(events: PbpEvent[], assistIndex: number): PbpEvent | null {
  const assist = events[assistIndex];
  const teamId = String(assist.entityId || '');
  const clock = String(assist.clock || '');
  const periodId = assist.periodId;

  const scan = (dir: -1 | 1): PbpEvent | null => {
    for (let j = assistIndex + dir; dir < 0 ? j >= 0 : j < events.length; j += dir) {
      const other = events[j];
      if (other.periodId !== periodId) break;
      if (String(other.clock || '') !== clock) break;
      if (isSkippable(other)) continue;
      if (isFieldGoal(other) && isMade(other) && String(other.entityId || '') === teamId) return other;
      break;
    }
    return null;
  };

  return scan(-1) || scan(1);
}

function zoneFromChartShot(shot: NblRawShot): NblShotZoneId | null {
  if (shot.zone) return shot.zone;
  return classifyNblShotZone({
    x: shot.x,
    y: shot.y,
    eventType: shot.eventType,
    desc: shot.desc,
  });
}

/**
 * Pair each assist with the shot-chart point of the basket it created.
 * Coordinates come from the shot chart row with the same event id.
 */
export function locateFixtureAssists(
  chart: NblMatchShotChart,
  pbpJson: unknown,
  year: number = NBL_SHOT_CHART_SEASON_YEAR
): NblFixtureAssistShots {
  const events = flattenPbpEvents(pbpJson);
  const byEvent = new Map<string, NblRawShot>();
  for (const shot of chart.shots) {
    if (shot.eventId) byEvent.set(shot.eventId, shot);
  }

  const shots: NblAssistShot[] = [];
  let assistCount = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const t = normalizeEventType(ev);
    if (t !== 'assist' && t !== 'ast') continue;
    const name = String(ev.name || '').trim();
    if (!name) continue;
    assistCount += 1;
    const basket = findMadeBasket(events, i);
    if (!basket?.eventId) continue;
    const chartShot = byEvent.get(String(basket.eventId));
    if (!chartShot) continue;
    const zone = zoneFromChartShot(chartShot);
    if (!zone) continue;
    shots.push({
      personId: ev.personId ? String(ev.personId) : null,
      name,
      teamName: chartShot.teamName ?? null,
      zone,
      eventId: chartShot.eventId,
      x: chartShot.x,
      y: chartShot.y,
    });
  }

  return {
    fixtureId: chart.fixtureId,
    year,
    assistCount,
    located: shots.length,
    shots,
  };
}

export function readFixtureAssistShots(fixtureId: string): NblFixtureAssistShots | null {
  const cached = readJson<NblFixtureAssistShots>(fixtureCachePath(fixtureId));
  if (!cached || !Array.isArray(cached.shots)) return null;
  return cached;
}

export function writeFixtureAssistShots(payload: NblFixtureAssistShots): void {
  writeJson(fixtureCachePath(payload.fixtureId), payload);
}

type AssistBundle = {
  displayName: string;
  team: string | null;
  fixtures: Set<string>;
  shots: Array<{ zone: NblShotZoneId | null; made: boolean }>;
};

function listFixtureAssistFiles(): NblFixtureAssistShots[] {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  const out: NblFixtureAssistShots[] = [];
  for (const file of fs.readdirSync(FIXTURE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const cached = readFixtureAssistShots(file.replace(/\.json$/, ''));
    if (cached) out.push(cached);
  }
  return out;
}

/** Rebuild per-player assist zones from the 2026 fixture caches. */
export function rebuildPlayerAssistCharts(options?: {
  rosterNames?: string[];
  year?: number;
}): { playersWritten: number; withAssists: number; located: number; assistCount: number } {
  const year = options?.year ?? NBL_SHOT_CHART_SEASON_YEAR;
  const allowed = new Set(
    loadScheduleGames([year])
      .filter(isCompletedGame)
      .map((game) => fixtureIdOf(game))
      .filter((id): id is string => Boolean(id))
  );

  if (fs.existsSync(PLAYER_DIR)) {
    for (const file of fs.readdirSync(PLAYER_DIR)) {
      if (file.endsWith('.json')) fs.unlinkSync(path.join(PLAYER_DIR, file));
    }
  }

  const byKey = new Map<string, AssistBundle>();
  let located = 0;
  let assistCount = 0;

  for (const fixture of listFixtureAssistFiles()) {
    if (fixture.year !== year) continue;
    if (allowed.size > 0 && !allowed.has(fixture.fixtureId)) continue;
    assistCount += fixture.assistCount;
    located += fixture.located;
    for (const shot of fixture.shots) {
      const key = normalizeNblShotPlayerKey(shot.name);
      if (!key) continue;
      let bundle = byKey.get(key);
      if (!bundle) {
        bundle = {
          displayName: shot.name,
          team: shot.teamName ? resolveNblClubName(shot.teamName) || shot.teamName : null,
          fixtures: new Set(),
          shots: [],
        };
        byKey.set(key, bundle);
      }
      bundle.fixtures.add(fixture.fixtureId);
      bundle.shots.push({ zone: shot.zone, made: true });
    }
  }

  const generatedAt = new Date().toISOString();
  let playersWritten = 0;
  let withAssists = 0;

  const writeBundle = (playerName: string, bundle: AssistBundle) => {
    const result: NblPlayerAssistChart = {
      playerName,
      team: bundle.team,
      year,
      gamesUsed: bundle.fixtures.size,
      assistCount: bundle.shots.length,
      zones: aggregateZoneStats(bundle.shots),
      generatedAt,
    };
    writeJson(playerCachePath(normalizeNblShotPlayerKey(playerName)), result);
    playersWritten += 1;
    if (result.assistCount > 0) withAssists += 1;
  };

  for (const bundle of byKey.values()) writeBundle(bundle.displayName, bundle);

  for (const rosterName of options?.rosterNames || []) {
    const name = String(rosterName || '').trim();
    if (!name) continue;
    if (readPlayerAssistChart(name)) continue;
    let best: AssistBundle | null = null;
    for (const bundle of byKey.values()) {
      if (!nblShotPlayerNamesMatch(bundle.displayName, name)) continue;
      if (!best || bundle.shots.length > best.shots.length) best = bundle;
    }
    if (!best || best.shots.length === 0) continue;
    writeBundle(name, best);
  }

  assistChartsMemo = null;
  rebuildAssistDefenseCharts(year);
  return { playersWritten, withAssists, located, assistCount };
}

export function readPlayerAssistChart(playerName: string): NblPlayerAssistChart | null {
  const cached = readJson<NblPlayerAssistChart>(playerCachePath(normalizeNblShotPlayerKey(playerName)));
  if (!cached || !Array.isArray(cached.zones)) return null;
  return cached;
}

let assistChartsMemo: { dirMtime: number; rows: NblPlayerAssistChart[] } | null = null;

function listPlayerAssistCharts(): NblPlayerAssistChart[] {
  if (!fs.existsSync(PLAYER_DIR)) return [];
  const dirMtime = fs.statSync(PLAYER_DIR).mtimeMs;
  if (assistChartsMemo && assistChartsMemo.dirMtime === dirMtime) return assistChartsMemo.rows;
  const rows: NblPlayerAssistChart[] = [];
  for (const file of fs.readdirSync(PLAYER_DIR)) {
    if (!file.endsWith('.json')) continue;
    const cached = readJson<NblPlayerAssistChart>(path.join(PLAYER_DIR, file));
    if (!cached || !Array.isArray(cached.zones)) continue;
    rows.push(cached);
  }
  assistChartsMemo = { dirMtime, rows };
  return rows;
}

/** Dashboard-safe lookup. Empty zones when this player has no located assists. */
export function loadPlayerAssistChartForApi(playerName: string): NblPlayerAssistChart {
  const name = String(playerName || '').trim();
  const exact = name ? readPlayerAssistChart(name) : null;
  if (exact && exact.assistCount > 0) return exact;

  if (name) {
    for (const key of nblShotPlayerAliasKeys(name)) {
      const aliased = readJson<NblPlayerAssistChart>(playerCachePath(key));
      if (aliased && (aliased.assistCount || 0) > 0) return aliased;
    }
    for (const cached of listPlayerAssistCharts()) {
      if ((cached.assistCount || 0) <= 0) continue;
      if (nblShotPlayerNamesMatch(cached.playerName, name)) return cached;
    }
  }

  return {
    playerName: name,
    team: null,
    year: NBL_SHOT_CHART_SEASON_YEAR,
    gamesUsed: 0,
    assistCount: 0,
    zones: emptyZoneStats(),
  };
}

function defenseCachePath(team: string): string {
  const name = resolveNblClubName(team) || team;
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
  return path.join(DEFENSE_DIR, `${safe}.json`);
}

function sameClub(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = resolveNblClubName(a || '');
  const right = resolveNblClubName(b || '');
  return Boolean(left && right && left === right);
}

function emptyAssistDefense(team: string, year: number): NblTeamAssistDefense {
  return {
    team: resolveNblClubName(team) || team,
    year,
    gamesUsed: 0,
    assistCount: 0,
    zones: emptyZoneStats(),
    ranks: emptyZoneStats().map((zone) => ({
      ...zone,
      rank: null,
      teamsCompared: 0,
      astPerGame: 0,
    })),
  };
}

/**
 * Rank each club by assists allowed per game in each shot-chart zone.
 * Rank 1 allows the fewest. Same 1–10 scale as scoring Opp Def Rank.
 */
export function rebuildAssistDefenseCharts(year: number = NBL_SHOT_CHART_SEASON_YEAR): {
  teams: number;
} {
  const allowed = new Map<string, Record<NblShotZoneId, number>>();
  const gamesUsed = new Map<string, number>();
  for (const club of NBL_CLUBS) {
    const zones = {} as Record<NblShotZoneId, number>;
    for (const id of NBL_SHOT_ZONE_IDS) zones[id] = 0;
    allowed.set(club.name, zones);
    gamesUsed.set(club.name, 0);
  }

  for (const game of loadScheduleGames([year]).filter(isCompletedGame)) {
    const fixtureId = fixtureIdOf(game);
    if (!fixtureId) continue;
    const chart = readCachedShotChart(fixtureId);
    const home = resolveNblClubName(chart?.homeTeam || game.homeTeam || '');
    const away = resolveNblClubName(chart?.awayTeam || game.awayTeam || '');
    if (!home || !away || !allowed.has(home) || !allowed.has(away)) continue;
    gamesUsed.set(home, (gamesUsed.get(home) || 0) + 1);
    gamesUsed.set(away, (gamesUsed.get(away) || 0) + 1);

    const fixture = readFixtureAssistShots(fixtureId);
    if (!fixture) continue;
    for (const shot of fixture.shots) {
      if (!shot.zone) continue;
      const offense = resolveNblClubName(shot.teamName || '');
      const defense = sameClub(offense, home) ? away : sameClub(offense, away) ? home : null;
      if (!defense) continue;
      const bucket = allowed.get(defense);
      if (bucket) bucket[shot.zone] += 1;
    }
  }

  const generatedAt = new Date().toISOString();
  let teams = 0;
  for (const club of NBL_CLUBS) {
    const bucket = allowed.get(club.name)!;
    const games = gamesUsed.get(club.name) || 0;
    const shots: Array<{ zone: NblShotZoneId | null; made: boolean }> = [];
    for (const zone of NBL_SHOT_ZONE_IDS) {
      for (let i = 0; i < bucket[zone]; i += 1) shots.push({ zone, made: true });
    }
    const zones = aggregateZoneStats(shots);
    const ranks: NblAssistDefenseRank[] = zones.map((zoneRow) => {
      const scored = NBL_CLUBS.map((other) => {
        const otherGames = gamesUsed.get(other.name) || 0;
        if (otherGames <= 0) return null;
        const count = allowed.get(other.name)?.[zoneRow.zone] || 0;
        return { team: other.name, rate: count / otherGames, count };
      }).filter((row): row is { team: string; rate: number; count: number } => Boolean(row));
      scored.sort((a, b) => a.rate - b.rate || a.count - b.count || a.team.localeCompare(b.team));
      const idx = scored.findIndex((row) => row.team === club.name);
      return {
        ...zoneRow,
        rank: idx >= 0 ? idx + 1 : null,
        teamsCompared: scored.length,
        astPerGame: games > 0 ? zoneRow.fga / games : 0,
      };
    });
    const payload: NblTeamAssistDefense = {
      team: club.name,
      year,
      gamesUsed: games,
      assistCount: shots.length,
      zones,
      ranks,
      generatedAt,
    };
    writeJson(defenseCachePath(club.name), payload);
    teams += 1;
  }
  return { teams };
}

export function loadTeamAssistDefenseForApi(team: string): NblTeamAssistDefense {
  const name = resolveNblClubName(team) || String(team || '').trim();
  const cached = name ? readJson<NblTeamAssistDefense>(defenseCachePath(name)) : null;
  if (cached && Array.isArray(cached.ranks) && cached.ranks.length) return cached;
  return emptyAssistDefense(name, NBL_SHOT_CHART_SEASON_YEAR);
}

/** 2026 completed games that already have a shot chart on disk. */
export function listAssistChartFixtures(year: number = NBL_SHOT_CHART_SEASON_YEAR): string[] {
  return loadScheduleGames([year])
    .filter(isCompletedGame)
    .map((game) => fixtureIdOf(game))
    .filter((id): id is string => Boolean(id && readCachedShotChart(id)));
}

/** Fetch play-by-play for games that do not have an assist file yet, then rebuild players. */
export async function warmSeasonAssistCharts(options?: {
  year?: number;
  rosterNames?: string[];
  force?: boolean;
}): Promise<{ playersWritten: number; withAssists: number; located: number; assistCount: number }> {
  const year = options?.year ?? NBL_SHOT_CHART_SEASON_YEAR;
  for (const fixtureId of listAssistChartFixtures(year)) {
    if (!options?.force && readFixtureAssistShots(fixtureId)) continue;
    const chart = readCachedShotChart(fixtureId);
    if (!chart) continue;
    const json = await fetchNblMatchPbpJson(fixtureId);
    if (!json) continue;
    writeFixtureAssistShots(locateFixtureAssists(chart, json, year));
  }
  return rebuildPlayerAssistCharts({ rosterNames: options?.rosterNames, year });
}
