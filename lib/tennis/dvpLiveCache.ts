import sharedCache from '@/lib/sharedCache';
import { TENNIS_CURRENT_YEAR, tennisDvpProfile, type TennisDvpMetricRow, type TennisTour } from '@/lib/tennis/data';
import { tennisEventPlaceCore } from '@/lib/tennis/chartStats';
import { TENNIS_DVP_WINDOWS, type TennisDvpStage, type TennisDvpWindow } from '@/lib/tennis/dvpShared';
import { readTennisPlayerLogsCacheMany, readTennisRosterCache } from '@/lib/tennis/dashboardCache';
import {
  listLiveTennisEventIndex,
  type TennisLiveEventIndex,
} from '@/lib/tennis/nextGame';
import type { TennisMatchRow } from '@/lib/tennis/types';

export const TENNIS_DVP_LIVE_CACHE_KEY = 'tennis_dvp_live_v10';
const TENNIS_DVP_LIVE_TTL_SECONDS = 2 * 60 * 60;

export type TennisCachedDvpPlayer = {
  id: string;
  name: string;
  ioc: string | null;
  rankPos: number | null;
  seed: number | null;
  drawRank: number | null;
  metrics: TennisDvpMetricRow[];
};

export type TennisCachedDvpEvent = {
  tour: TennisTour;
  stage: TennisDvpStage;
  tournamentKey: string | null;
  tournamentName: string | null;
  fieldSize: number;
  topSeed: TennisCachedDvpPlayer | null;
  windows: Partial<Record<TennisDvpWindow, TennisCachedDvpPlayer[]>>;
};

export type TennisDvpLiveStore = {
  builtAt: string;
  events: TennisCachedDvpEvent[];
};

type Runtime = { store: TennisDvpLiveStore | null; loadedAt: number };
function runtime(): Runtime {
  const g = globalThis as typeof globalThis & { __tennisDvpLiveV9?: Runtime };
  if (!g.__tennisDvpLiveV9) g.__tennisDvpLiveV9 = { store: null, loadedAt: 0 };
  return g.__tennisDvpLiveV9;
}

function placeKey(name: string | null | undefined): string {
  return tennisEventPlaceCore(name);
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

export function rememberTennisDvpLiveStore(store: TennisDvpLiveStore | null) {
  const mem = runtime();
  mem.store = store;
  mem.loadedAt = Date.now();
}

export async function readTennisDvpLiveStore(): Promise<TennisDvpLiveStore | null> {
  const mem = runtime();
  if (mem.store?.events?.length && Date.now() - mem.loadedAt < 60_000) return mem.store;
  const stored = await sharedCache.getJSON<TennisDvpLiveStore>(TENNIS_DVP_LIVE_CACHE_KEY);
  if (stored?.events?.length) {
    rememberTennisDvpLiveStore(stored);
    return stored;
  }
  return mem.store;
}

export function tennisDvpEventCacheKey(opts: {
  tour: TennisTour;
  stage?: TennisDvpStage;
  tournamentKey?: string | null;
  tournamentName?: string | null;
}): string | null {
  const stage: TennisDvpStage = opts.stage === 'qualifying' ? 'qualifying' : 'main';
  const key = String(opts.tournamentKey || '').trim();
  if (key) return `${TENNIS_DVP_LIVE_CACHE_KEY}:evt:${opts.tour}:${stage}:${key}`;
  const place = placeKey(opts.tournamentName);
  if (place) return `${TENNIS_DVP_LIVE_CACHE_KEY}:name:${opts.tour}:${stage}:${place}`;
  return null;
}

function rememberTennisDvpLiveEvent(event: TennisCachedDvpEvent) {
  const mem = runtime();
  if (!mem.store) {
    rememberTennisDvpLiveStore({ builtAt: new Date().toISOString(), events: [event] });
    return;
  }
  const stage = event.stage || 'main';
  const idx = mem.store.events.findIndex((row) => {
    if (row.tour !== event.tour || (row.stage || 'main') !== stage) return false;
    if (event.tournamentKey && row.tournamentKey === event.tournamentKey) return true;
    return namesMatch(placeKey(row.tournamentName), placeKey(event.tournamentName));
  });
  if (idx >= 0) mem.store.events[idx] = event;
  else mem.store.events.push(event);
  mem.loadedAt = Date.now();
}

function dvpEventRedisEntries(event: TennisCachedDvpEvent): Array<{
  key: string;
  value: TennisCachedDvpEvent;
  ttlSeconds: number;
}> {
  const byKey = tennisDvpEventCacheKey({
    tour: event.tour,
    stage: event.stage,
    tournamentKey: event.tournamentKey,
  });
  const byName = tennisDvpEventCacheKey({
    tour: event.tour,
    stage: event.stage,
    tournamentName: event.tournamentName,
  });
  const entries: Array<{ key: string; value: TennisCachedDvpEvent; ttlSeconds: number }> = [];
  if (byKey) entries.push({ key: byKey, value: event, ttlSeconds: TENNIS_DVP_LIVE_TTL_SECONDS });
  if (byName && byName !== byKey) {
    entries.push({ key: byName, value: event, ttlSeconds: TENNIS_DVP_LIVE_TTL_SECONDS });
  }
  return entries;
}

export async function writeTennisDvpLiveEvent(event: TennisCachedDvpEvent): Promise<void> {
  rememberTennisDvpLiveEvent(event);
  const entries = dvpEventRedisEntries(event);
  if (entries.length) await sharedCache.setJSONMany(entries);
}

export async function readTennisDvpLiveEvent(opts: {
  tour: TennisTour;
  tournamentKey?: string | null;
  tournamentName?: string | null;
  stage?: TennisDvpStage;
}): Promise<TennisCachedDvpEvent | null> {
  const mem = runtime();
  const fromMem = findCachedTennisDvpEvent(mem.store, opts);
  if (fromMem && Date.now() - mem.loadedAt < 60_000) return fromMem;
  const eventKey = tennisDvpEventCacheKey(opts);
  if (eventKey) {
    const stored = await sharedCache.getJSON<TennisCachedDvpEvent>(eventKey);
    if (isPlausibleTennisDvpField(stored)) {
      rememberTennisDvpLiveEvent(stored);
      return stored;
    }
    return fromMem;
  }
  const store = await readTennisDvpLiveStore();
  return findCachedTennisDvpEvent(store, opts);
}

function isPlausibleTennisDvpField(event: TennisCachedDvpEvent | null | undefined): event is TennisCachedDvpEvent {
  const n = Number(event?.fieldSize) || 0;
  return (
    n === 8 ||
    n === 16 ||
    n === 24 ||
    n === 28 ||
    n === 32 ||
    n === 48 ||
    n === 56 ||
    n === 64 ||
    n === 96 ||
    n === 128
  );
}

export function findCachedTennisDvpEvent(
  store: TennisDvpLiveStore | null | undefined,
  opts: {
    tour: TennisTour;
    tournamentKey?: string | null;
    tournamentName?: string | null;
    stage?: TennisDvpStage;
  }
): TennisCachedDvpEvent | null {
  if (!store?.events?.length) return null;
  const stage: TennisDvpStage = opts.stage === 'qualifying' ? 'qualifying' : 'main';
  const key = String(opts.tournamentKey || '').trim();
  const place = placeKey(opts.tournamentName);
  const sameTour = store.events.filter(
    (event) => event.tour === opts.tour && (event.stage || 'main') === stage
  );
  const accept = (event: TennisCachedDvpEvent | undefined) =>
    isPlausibleTennisDvpField(event) ? event : null;
  if (key) {
    return accept(sameTour.find((event) => event.tournamentKey === key));
  }
  if (place) {
    return accept(sameTour.find((event) => namesMatch(placeKey(event.tournamentName), place)));
  }
  return null;
}

export async function tennisDvpExtraMatchesForIds(playerIds: string[]): Promise<TennisMatchRow[]> {
  const logs = await readTennisPlayerLogsCacheMany(playerIds);
  const out: TennisMatchRow[] = [];
  for (const games of logs.values()) {
    if (games?.length) out.push(...games);
  }
  return out;
}

export function tennisCachedDvpPlayerHasSample(
  player: TennisCachedDvpPlayer | null | undefined
): boolean {
  return Boolean(player?.metrics?.some((row) => typeof row.value === 'number' && Number.isFinite(row.value)));
}

export async function buildTennisDvpLiveStore(live?: TennisLiveEventIndex): Promise<TennisDvpLiveStore> {
  const index = live || (await listLiveTennisEventIndex());
  const extraMatches = await tennisDvpExtraMatchesForIds(
    index.events.flatMap((event) => [...event.playerIds, ...event.qualifyingPlayerIds])
  );
  const events: TennisCachedDvpEvent[] = [];
  for (const event of index.events) {
    const boards: Array<{ stage: TennisDvpStage; extraPlayerIds: string[] }> = [];
    if (event.playerIds.length) boards.push({ stage: 'main', extraPlayerIds: event.playerIds });
    if (event.qualifyingPlayerIds.length) {
      boards.push({ stage: 'qualifying', extraPlayerIds: event.qualifyingPlayerIds });
    }
    for (const board of boards) {
      const windows: TennisCachedDvpEvent['windows'] = {};
      let fieldSize = 0;
      let tournamentName = event.tournamentName;
      let tournamentKey = event.tournamentKey;
      for (const window of TENNIS_DVP_WINDOWS) {
        const profile = tennisDvpProfile({
          tour: event.tour,
          year: TENNIS_CURRENT_YEAR,
          tournamentName: event.tournamentName,
          tournamentKey: event.tournamentKey,
          extraPlayerIds: board.extraPlayerIds,
          extraMatches,
          liveTournamentKeys: index.keys,
          liveTournamentNames: index.names,
          window,
          includeField: true,
          stage: board.stage,
        });
        fieldSize = profile.fieldSize;
        tournamentName = profile.tournamentName || tournamentName;
        tournamentKey = profile.tournamentKey || tournamentKey;
        windows[window] = (profile.field || []).map((row) => ({
          id: row.id,
          name: row.name,
          ioc: row.ioc,
          rankPos: row.rankPos,
          seed: row.seed ?? null,
          drawRank: row.drawRank ?? null,
          metrics: row.metrics,
        }));
      }
      const last10 = windows.last10 || [];
      events.push({
        tour: event.tour,
        stage: board.stage,
        tournamentKey,
        tournamentName,
        fieldSize,
        topSeed: last10.find((row) => row.seed === 1) || null,
        windows,
      });
    }
  }
  const store: TennisDvpLiveStore = {
    builtAt: new Date().toISOString(),
    events,
  };
  rememberTennisDvpLiveStore(store);
  await sharedCache.setJSONMany([
    { key: TENNIS_DVP_LIVE_CACHE_KEY, value: store, ttlSeconds: TENNIS_DVP_LIVE_TTL_SECONDS },
    ...events.flatMap((event) => dvpEventRedisEntries(event)),
  ]);
  return store;
}

export async function buildTennisDvpWindowsFromRedis(opts: {
  tour: TennisTour;
  year?: number;
  opponentName?: string | null;
  opponentId?: string | null;
  playerName?: string | null;
  playerId?: string | null;
  tournamentName?: string | null;
  tournamentKey?: string | null;
  extraPlayerIds: string[];
  live: TennisLiveEventIndex;
  stage: TennisDvpStage;
}): Promise<TennisCachedDvpEvent | null> {
  const extraPlayerIds = [
    ...new Set(opts.extraPlayerIds.map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  if (!extraPlayerIds.length) return null;
  const [extraMatches, roster] = await Promise.all([
    tennisDvpExtraMatchesForIds([
      ...extraPlayerIds,
      String(opts.playerId || '').trim(),
      String(opts.opponentId || '').trim(),
    ]),
    readTennisRosterCache(),
  ]);
  const windows: TennisCachedDvpEvent['windows'] = {};
  let fieldSize = 0;
  let tournamentName = opts.tournamentName || null;
  let tournamentKey = opts.tournamentKey || null;
  for (const window of TENNIS_DVP_WINDOWS) {
    const profile = tennisDvpProfile({
      tour: opts.tour,
      year: opts.year || TENNIS_CURRENT_YEAR,
      opponentName: opts.opponentName,
      opponentId: opts.opponentId,
      playerName: opts.playerName,
      playerId: opts.playerId,
      tournamentName: opts.tournamentName,
      tournamentKey: opts.tournamentKey,
      extraPlayerIds,
      extraMatches,
      extraPlayers: roster?.players || [],
      liveTournamentKeys: opts.live.keys,
      liveTournamentNames: opts.live.names,
      window,
      includeField: true,
      stage: opts.stage,
      skipOverlay: true,
    });
    fieldSize = profile.fieldSize;
    tournamentName = profile.tournamentName || tournamentName;
    tournamentKey = profile.tournamentKey || tournamentKey;
    windows[window] = (profile.field || []).map((row) => ({
      id: row.id,
      name: row.name,
      ioc: row.ioc,
      rankPos: row.rankPos,
      seed: row.seed ?? null,
      drawRank: row.drawRank ?? null,
      metrics: row.metrics,
    }));
  }
  const last10 = windows.last10 || [];
  const event: TennisCachedDvpEvent = {
    tour: opts.tour,
    stage: opts.stage,
    tournamentKey,
    tournamentName,
    fieldSize,
    topSeed: last10.find((row) => row.seed === 1) || null,
    windows,
  };
  void writeTennisDvpLiveEvent(event);
  return event;
}
