import sharedCache from '@/lib/sharedCache';
import { TENNIS_CURRENT_YEAR, tennisDvpProfile, type TennisDvpMetricRow, type TennisTour } from '@/lib/tennis/data';
import { tennisEventPlaceCore } from '@/lib/tennis/chartStats';
import { TENNIS_DVP_WINDOWS, type TennisDvpStage, type TennisDvpWindow } from '@/lib/tennis/dvpShared';
import {
  listLiveTennisEventIndex,
  type TennisLiveEventIndex,
} from '@/lib/tennis/nextGame';

export const TENNIS_DVP_LIVE_CACHE_KEY = 'tennis_dvp_live_v9';
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
  if (key) {
    const byKey = sameTour.find((event) => event.tournamentKey === key);
    if (byKey) return byKey;
    return null;
  }
  if (place) {
    const byName = sameTour.find((event) => namesMatch(placeKey(event.tournamentName), place));
    if (byName) return byName;
  }
  return null;
}

export async function buildTennisDvpLiveStore(live?: TennisLiveEventIndex): Promise<TennisDvpLiveStore> {
  const index = live || (await listLiveTennisEventIndex());
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
  await sharedCache.setJSON(TENNIS_DVP_LIVE_CACHE_KEY, store, TENNIS_DVP_LIVE_TTL_SECONDS);
  return store;
}
