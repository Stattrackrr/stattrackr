import sharedCache from '@/lib/sharedCache';
import { tennisEventPlaceCore, tennisLastName } from '@/lib/tennis/chartStats';
import { API_TENNIS_SINGLES_EVENTS, isApiGrandSlam, parseApiRound, tourFromEventType, type ApiTennisFixture } from '@/lib/tennis/apiTennis';
import { loadTennisPlayers, loadTennisRankings } from '@/lib/tennis/data';
import { isTennisQualifyingLabel, type TennisDvpStage } from '@/lib/tennis/dvpShared';
import { tennisAssignDrawRanks } from '@/lib/tennis/seeds';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import { resolveTennisIoc } from '@/lib/tennis/resolveIoc';
import { lookupTennisSurface } from '@/lib/tennis/surfaces';
import type { TennisTour } from '@/lib/tennis/types';

const API_BASE = 'https://api.api-tennis.com/tennis/';
const CACHE_TTL_MS = 2 * 60 * 1000;
const LOOKAHEAD_DAYS = 21;
const FIELD_LOOKBACK_DAYS = 12;
export const TENNIS_UPCOMING_CACHE_KEY = 'tennis_upcoming_v7';
export const TENNIS_UPCOMING_TTL_SECONDS = 20 * 60;
const FETCH_TIMEOUT_MS = 5000;

export type TennisNextGame = {
  opponent: string;
  opponentId: string | null;
  opponentIoc: string | null;
  opponentRank: number | null;
  opponentLogo: string | null;
  tipoff: string | null;
  live: boolean;
  isGrandSlam: boolean;
  tour: TennisTour | null;
  tournamentName: string | null;
  tournamentKey: string | null;
  surface: string | null;
  round: string | null;
  matchId: string | null;
  status: string | null;
  /** API-Tennis Home/Away odds: first player is Home. */
  playerIsHome: boolean;
  homeName: string;
  awayName: string;
  playerSeed: number | null;
  opponentSeed: number | null;
  topSeedName: string | null;
  topSeedId: string | null;
};

export type TennisLiveEvent = {
  tour: TennisTour;
  tournamentKey: string | null;
  tournamentName: string | null;
  playerIds: string[];
  qualifyingPlayerIds: string[];
};

export type TennisLiveEventIndex = {
  keys: Set<string>;
  names: Set<string>;
  playerIdsByKey: Map<string, string[]>;
  playerIdsByName: Map<string, string[]>;
  events: TennisLiveEvent[];
};

type UpcomingWindow = {
  fetchedAt: number;
  byPlayerId: Map<string, TennisNextGame>;
  events: TennisLiveEvent[];
};

type TennisUpcomingStore = {
  fetchedAt: string;
  games: Array<{ playerId: string; game: TennisNextGame }>;
  events?: TennisLiveEvent[];
};

type UpcomingRuntime = {
  window: UpcomingWindow | null;
  inflight: Promise<Map<string, TennisNextGame>> | null;
};

function upcomingRuntime(): UpcomingRuntime {
  const g = globalThis as typeof globalThis & { __tennisUpcomingV8?: UpcomingRuntime };
  if (!g.__tennisUpcomingV8) g.__tennisUpcomingV8 = { window: null, inflight: null };
  return g.__tennisUpcomingV8;
}

function apiKey(): string {
  return String(process.env.API_TENNIS_KEY || '').trim();
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseTipoff(date: string | null | undefined, time: string | null | undefined): Date | null {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = String(time || '00:00').trim();
  const hhmm = /^\d{1,2}:\d{2}/.test(clock) ? clock.slice(0, 5).padStart(5, '0') : '00:00';
  const parsed = new Date(`${day}T${hhmm}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSingles(fx: ApiTennisFixture): boolean {
  const type = String(fx.event_type_type || '').toLowerCase();
  return type.includes('singles') && !type.includes('double');
}

function hasPlayedScore(fx: ApiTennisFixture): boolean {
  const result = String(fx.event_final_result || '').trim();
  if (result && result !== '-' && result !== '0-0' && /\d/.test(result)) return true;
  const scores = Array.isArray(fx.scores) ? fx.scores : [];
  return scores.some((row) => Number(row.score_first) > 0 || Number(row.score_second) > 0);
}

export function tennisFixtureNamesMatch(a: string, b: string): boolean {
  return tennisIdentityMatch(a, b);
}

function namesMatch(a: string, b: string): boolean {
  return tennisFixtureNamesMatch(a, b);
}

function nameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

/** API-Tennis "Set 1" / live can appear hours before first ball. Trust it only near tipoff. */
const LIVE_STATUS_MAX_FUTURE_MS = 2 * 60 * 60 * 1000;

function fixturePhase(
  status: string,
  tipoff: Date | null
): 'finished' | 'live' | 'scheduled' | 'skip' {
  const s = String(status || '').trim().toLowerCase();
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'walkover' ||
    s === 'wo' ||
    s === 'w/o' ||
    s === 'abandoned' ||
    s === 'abd'
  ) {
    return 'skip';
  }
  if (s === 'finished' || s.includes('retir')) {
    // Draw slots are sometimes marked finished before tipoff (e.g. slam finals).
    if (tipoff && tipoff.getTime() > Date.now() + 60 * 60 * 1000) return 'scheduled';
    return 'finished';
  }
  const now = Date.now();
  const started = tipoff ? now >= tipoff.getTime() : false;
  const setOrLive =
    /^(set\s*)?[1-5]$/.test(s) ||
    s.includes('live') ||
    s.includes('progress') ||
    s.includes('playing');
  if (setOrLive) {
    if (!tipoff) return 'live';
    // Not-before times can lag after a match starts, but not by many hours.
    if (tipoff.getTime() - now <= LIVE_STATUS_MAX_FUTURE_MS) return 'live';
    return 'scheduled';
  }
  if (!s || s === 'not started' || s === 'scheduled' || s === 'ns') {
    return started ? 'live' : 'scheduled';
  }
  return started ? 'live' : 'scheduled';
}

async function apiTennisCall(params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ APIkey: key, timezone: 'UTC', ...params });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${API_BASE}?${qs.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
        continue;
      }
      return await res.json();
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return null;
}

function officialPlayer(playerId: string | null, fallback: string): {
  playerId: string | null;
  name: string;
  ioc: string | null;
  rank: number | null;
  imageUrl: string | null;
} {
  const id = String(playerId || '').trim();
  const name = fallback.trim();
  const players = loadTennisPlayers();
  const hit = id ? players.find((p) => p.playerId === id) : null;
  const exact = name
    ? players.filter((p) => p.name.toLowerCase() === name.toLowerCase())
    : [];
  const identity = name ? players.filter((p) => tennisIdentityMatch(p.name, name)) : [];
  const last = name.split(/\s+/).filter(Boolean).pop()?.toLowerCase() || '';
  const lastHits =
    last.length >= 3
      ? players.filter((p) => p.name.toLowerCase().split(/\s+/).pop() === last)
      : [];
  const byName =
    exact.length === 1
      ? exact[0]
      : identity.length === 1
        ? identity[0]
        : lastHits.length === 1
          ? lastHits[0]
          : exact[0] || null;
  const idAgrees =
    Boolean(hit) &&
    (!name ||
      tennisIdentityMatch(hit!.name, name) ||
      hit!.name.toLowerCase() === name.toLowerCase());
  const player = (idAgrees ? hit : null) || byName || (!name ? hit : null);
  return {
    playerId: player?.playerId || (idAgrees ? id : null) || null,
    name: player?.name || name,
    ioc: player?.ioc || resolveTennisIoc(player?.playerId || id, player?.name || fallback),
    rank: player?.rank ?? null,
    imageUrl: player?.imageUrl ?? null,
  };
}

function toNextGame(
  fx: ApiTennisFixture,
  who: { playerId?: string; playerName?: string }
): TennisNextGame | null {
  const firstId = String(fx.first_player_key ?? '').trim();
  const secondId = String(fx.second_player_key ?? '').trim();
  const firstName = String(fx.event_first_player || '').trim();
  const secondName = String(fx.event_second_player || '').trim();
  if (!firstName || !secondName) return null;
  const wantId = String(who.playerId || '').trim();
  const wantName = String(who.playerName || '').trim();
  const playerIsFirst =
    Boolean(wantId && firstId && firstId === wantId) ||
    Boolean(wantName && namesMatch(firstName, wantName));
  const playerIsSecond =
    Boolean(wantId && secondId && secondId === wantId) ||
    Boolean(wantName && namesMatch(secondName, wantName));
  if (!playerIsFirst && !playerIsSecond) return null;
  const opponentId = playerIsFirst ? secondId || null : firstId || null;
  const opponentRaw = playerIsFirst ? secondName : firstName;
  const opponentLogo = playerIsFirst
    ? fx.event_second_player_logo || null
    : fx.event_first_player_logo || null;
  const first = officialPlayer(firstId || null, firstName);
  const second = officialPlayer(secondId || null, secondName);
  const resolved = officialPlayer(opponentId, opponentRaw);
  const tipoff = parseTipoff(fx.event_date, fx.event_time);
  let phase = fixturePhase(String(fx.event_status || ''), tipoff);
  if (phase === 'finished' && !hasPlayedScore(fx)) {
    phase = tipoff && tipoff.getTime() <= Date.now() ? 'live' : 'scheduled';
  }
  if (phase === 'skip' || phase === 'finished') return null;
  const tournamentName = String(fx.tournament_name || '').trim() || null;
  const tournamentKey = fx.tournament_key != null ? String(fx.tournament_key) : null;
  const round = parseApiRound(fx.tournament_round) || null;
  return {
    opponent: resolved.name,
    opponentId: resolved.playerId || opponentId,
    opponentIoc: resolved.ioc,
    opponentRank: resolved.rank,
    opponentLogo: resolved.imageUrl || opponentLogo,
    tipoff: tipoff ? tipoff.toISOString() : fx.event_date || null,
    live: phase === 'live',
    isGrandSlam: isApiGrandSlam(tournamentName),
    tour: tourFromEventType(fx.event_type_type),
    tournamentName,
    tournamentKey,
    surface: lookupTennisSurface(tournamentName, tournamentKey),
    round,
    matchId: fx.event_key != null ? String(fx.event_key) : null,
    status: fx.event_status ? String(fx.event_status) : null,
    playerIsHome: Boolean(playerIsFirst),
    homeName: first.name,
    awayName: second.name,
    playerSeed: null,
    opponentSeed: null,
    topSeedName: null,
    topSeedId: null,
  };
}

function rememberUpcoming(
  ranked: Map<string, { next: TennisNextGame; tip: number }>,
  key: string,
  next: TennisNextGame,
  tip: number
) {
  if (!key) return;
  const prev = ranked.get(key);
  if (!prev || tip < prev.tip) ranked.set(key, { next, tip });
}

function indexUpcoming(fixtures: ApiTennisFixture[]): Map<string, TennisNextGame> {
  const ranked = new Map<string, { next: TennisNextGame; tip: number }>();
  for (const fx of fixtures) {
    const sides = [
      {
        playerId: String(fx.first_player_key ?? '').trim(),
        playerName: String(fx.event_first_player || '').trim(),
      },
      {
        playerId: String(fx.second_player_key ?? '').trim(),
        playerName: String(fx.event_second_player || '').trim(),
      },
    ];
    for (const side of sides) {
      const next = toNextGame(fx, side);
      if (!next) continue;
      const tip = next.tipoff ? new Date(next.tipoff).getTime() : Number.MAX_SAFE_INTEGER;
      rememberUpcoming(ranked, side.playerId, next, tip);
      rememberUpcoming(ranked, nameKey(side.playerName), next, tip);
    }
  }
  const byPlayerId = new Map<string, TennisNextGame>();
  for (const [playerId, row] of ranked) byPlayerId.set(playerId, row.next);
  return byPlayerId;
}

function rememberWindow(
  byPlayerId: Map<string, TennisNextGame>,
  fetchedAt = Date.now(),
  events: TennisLiveEvent[] = []
) {
  upcomingRuntime().window = { fetchedAt, byPlayerId, events };
}

function isFresh(fetchedAt: number): boolean {
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < CACHE_TTL_MS;
}

function storeFromJSON(
  stored: TennisUpcomingStore | null
): { fetchedAt: number; byPlayerId: Map<string, TennisNextGame>; events: TennisLiveEvent[] } | null {
  if (!stored?.games?.length) return null;
  const byPlayerId = new Map<string, TennisNextGame>();
  for (const row of stored.games) {
    if (row?.playerId && row.game) byPlayerId.set(row.playerId, row.game);
  }
  if (!byPlayerId.size) return null;
  const fetchedAt = Date.parse(String(stored.fetchedAt || '')) || 0;
  return { fetchedAt, byPlayerId, events: stored.events || [] };
}

async function readUpcomingFromRedis(): Promise<{
  fetchedAt: number;
  byPlayerId: Map<string, TennisNextGame>;
  events: TennisLiveEvent[];
} | null> {
  const stored = await sharedCache.getJSON<TennisUpcomingStore>(TENNIS_UPCOMING_CACHE_KEY);
  return storeFromJSON(stored);
}

async function writeUpcomingToRedis(
  byPlayerId: Map<string, TennisNextGame>,
  events: TennisLiveEvent[] = []
): Promise<void> {
  if (!byPlayerId.size) return;
  await sharedCache.setJSON(
    TENNIS_UPCOMING_CACHE_KEY,
    {
      fetchedAt: new Date().toISOString(),
      games: [...byPlayerId.entries()].map(([playerId, game]) => ({ playerId, game })),
      events,
    },
    TENNIS_UPCOMING_TTL_SECONDS
  );
}

function indexFixtures(fixtures: ApiTennisFixture[]): {
  byPlayerId: Map<string, TennisNextGame>;
  events: TennisLiveEvent[];
} {
  const singles = fixtures.filter(isSingles);
  return {
    byPlayerId: indexUpcoming(singles),
    events: collectLiveEventsFromFixtures(singles),
  };
}

export function publishTennisUpcomingFixtures(fixtures: ApiTennisFixture[]): Promise<number> {
  const indexed = indexFixtures(fixtures);
  if (!indexed.byPlayerId.size) return Promise.resolve(0);
  const events = unionLiveEvents(upcomingRuntime().window?.events, indexed.events);
  rememberWindow(indexed.byPlayerId, Date.now(), events);
  return writeUpcomingToRedis(indexed.byPlayerId, events).then(() => indexed.byPlayerId.size);
}

async function fetchUpcomingLive(): Promise<{
  byPlayerId: Map<string, TennisNextGame>;
  events: TennisLiveEvent[];
}> {
  if (!apiKey()) return { byPlayerId: new Map(), events: [] };
  const now = new Date();
  const start = ymd(new Date(now.getTime() - FIELD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
  const stop = ymd(new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000));
  const eventKeys = API_TENNIS_SINGLES_EVENTS.map((event) => event.eventType);
  const batches = await Promise.all(
    eventKeys.map((event_type_key) =>
      apiTennisCall({
        method: 'get_fixtures',
        date_start: start,
        date_stop: stop,
        event_type_key,
      })
    )
  );
  const fixtures = batches.flatMap((batch) =>
    ((Array.isArray(batch?.result) ? batch.result : []) as ApiTennisFixture[])
  );
  const indexed = indexFixtures(fixtures);
  return {
    byPlayerId: indexed.byPlayerId,
    events: unionLiveEvents(upcomingRuntime().window?.events, indexed.events),
  };
}

function withSurface(game: TennisNextGame): TennisNextGame {
  const surface = lookupTennisSurface(game.tournamentName, game.tournamentKey);
  if (game.surface === surface && game.tournamentKey != null) return game;
  return { ...game, surface, tournamentKey: game.tournamentKey ?? null };
}

function withDrawSeeds(
  game: TennisNextGame,
  playerId: string | null,
  live: TennisLiveEventIndex
): TennisNextGame {
  const tour = game.tour || 'ATP';
  const stage = tennisLiveEventStage(live, {
    playerId,
    opponentId: game.opponentId,
    tournamentKey: game.tournamentKey,
    tournamentName: game.tournamentName,
    round: game.round,
  });
  const fieldIds = tennisLiveEventPlayerIds(live, game.tournamentKey, game.tournamentName, stage);
  if (!fieldIds.length) return game;
  const ranked = loadTennisRankings(tour, { limit: 500 });
  const roster = loadTennisPlayers();
  const rankedById = new Map(ranked.map((row) => [row.playerId, row]));
  const rosterById = new Map(roster.map((row) => [row.playerId, row]));
  const players = fieldIds.map((id) => ({
    id,
    rankPos: rankedById.get(id)?.pos ?? rosterById.get(id)?.rank ?? null,
    name: rankedById.get(id)?.name || rosterById.get(id)?.name || id,
  }));
  const ranks = tennisAssignDrawRanks(players);
  const top = players.find((row) => ranks.get(row.id) === 1) || null;
  const resolvedPlayerId = String(playerId || '').trim();
  return {
    ...game,
    playerSeed: resolvedPlayerId ? ranks.get(resolvedPlayerId) ?? null : null,
    opponentSeed: game.opponentId ? ranks.get(game.opponentId) ?? null : null,
    topSeedName: top?.name || null,
    topSeedId: top?.id || null,
  };
}

async function loadUpcomingByPlayer(opts?: {
  waitForFresh?: boolean;
}): Promise<Map<string, TennisNextGame>> {
  const runtime = upcomingRuntime();
  if (runtime.window && isFresh(runtime.window.fetchedAt) && runtime.window.byPlayerId.size) {
    return runtime.window.byPlayerId;
  }
  if (runtime.inflight) {
    if (opts?.waitForFresh) return runtime.inflight;
    if (runtime.window?.byPlayerId.size) return runtime.window.byPlayerId;
    return runtime.inflight;
  }

  const cached = runtime.window?.byPlayerId.size
    ? {
        fetchedAt: runtime.window.fetchedAt,
        byPlayerId: runtime.window.byPlayerId,
        events: runtime.window.events || [],
      }
    : await readUpcomingFromRedis();

  const refresh = async () => {
    try {
      const live = await fetchUpcomingLive();
      if (live.byPlayerId.size) {
        await writeUpcomingToRedis(live.byPlayerId, live.events);
        rememberWindow(live.byPlayerId, Date.now(), live.events);
        return live.byPlayerId;
      }
    } catch (err) {
      console.warn('[tennis-next-game] live fetch failed', err);
    }
    if (cached?.byPlayerId.size) {
      rememberWindow(cached.byPlayerId, cached.fetchedAt, cached.events || []);
      return cached.byPlayerId;
    }
    if (runtime.window?.byPlayerId.size) return runtime.window.byPlayerId;
    rememberWindow(new Map());
    return new Map();
  };

  if (cached?.byPlayerId.size) {
    rememberWindow(cached.byPlayerId, cached.fetchedAt, cached.events || []);
    if (isFresh(cached.fetchedAt)) return cached.byPlayerId;
    runtime.inflight = refresh().finally(() => {
      runtime.inflight = null;
    });
    if (opts?.waitForFresh) return runtime.inflight;
    return cached.byPlayerId;
  }

  runtime.inflight = refresh();
  try {
    return await runtime.inflight;
  } finally {
    runtime.inflight = null;
  }
}

export async function warmTennisUpcomingFixtures(opts?: { force?: boolean }): Promise<number> {
  if (opts?.force) {
    const runtime = upcomingRuntime();
    if (runtime.inflight) {
      const live = await runtime.inflight;
      return live.size;
    }
    runtime.inflight = (async () => {
      const live = await fetchUpcomingLive();
      if (live.byPlayerId.size) {
        await writeUpcomingToRedis(live.byPlayerId, live.events);
        rememberWindow(live.byPlayerId, Date.now(), live.events);
        return live.byPlayerId;
      }
      if (runtime.window?.byPlayerId.size) return runtime.window.byPlayerId;
      const redis = await readUpcomingFromRedis();
      if (redis?.byPlayerId.size) {
        rememberWindow(redis.byPlayerId, redis.fetchedAt, redis.events || []);
        return redis.byPlayerId;
      }
      rememberWindow(new Map());
      return new Map();
    })().finally(() => {
      runtime.inflight = null;
    });
    const byPlayerId = await runtime.inflight;
    return byPlayerId.size;
  }
  const byPlayerId = await loadUpcomingByPlayer({ waitForFresh: false });
  return byPlayerId.size;
}

export function tennisCommenceTimeForMatch(
  upcoming: TennisNextGame[],
  opts: { matchId?: string | null; homeName?: string | null; awayName?: string | null }
): string | null {
  const matchId = String(opts.matchId || '').trim();
  const home = String(opts.homeName || '').trim();
  const away = String(opts.awayName || '').trim();
  const named = (game: TennisNextGame) =>
    (namesMatch(game.homeName, home) && namesMatch(game.awayName, away)) ||
    (namesMatch(game.homeName, away) && namesMatch(game.awayName, home));
  const hit =
    (matchId ? upcoming.find((game) => String(game.matchId || '').trim() === matchId) : null) ||
    (home && away ? upcoming.find(named) : null);
  if (!hit) return null;
  if (hit.live) {
    const tipMs = hit.tipoff ? Date.parse(hit.tipoff) : Number.NaN;
    if (!Number.isFinite(tipMs)) return new Date().toISOString();
    const ahead = tipMs - Date.now();
    if (ahead > 0 && ahead <= LIVE_STATUS_MAX_FUTURE_MS) return new Date().toISOString();
  }
  return hit.tipoff || null;
}

function uniqueUpcomingFromMap(byPlayerId: Map<string, TennisNextGame>): TennisNextGame[] {
  const byMatch = new Map<string, TennisNextGame>();
  for (const game of byPlayerId.values()) {
    const id = String(game.matchId || '').trim();
    if (id && !byMatch.has(id)) byMatch.set(id, game);
  }
  return [...byMatch.values()].sort((a, b) => {
    const ta = Date.parse(String(a.tipoff || '')) || Number.POSITIVE_INFINITY;
    const tb = Date.parse(String(b.tipoff || '')) || Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

function liveEventPlace(name: string | null | undefined): string {
  return tennisEventPlaceCore(name);
}

function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id)))];
}

function liveEventId(event: {
  tour: TennisTour;
  tournamentKey: string | null;
  tournamentName: string | null;
}): string {
  return `${event.tour}|${String(event.tournamentKey || '').trim() || liveEventPlace(event.tournamentName) || 'unknown'}`;
}

function unionLiveEvents(prev: TennisLiveEvent[] | undefined, next: TennisLiveEvent[]): TennisLiveEvent[] {
  const liveIds = new Set(next.map(liveEventId));
  const map = new Map<string, TennisLiveEvent>();
  for (const event of [...(prev || []), ...next]) {
    const id = liveEventId(event);
    if (!liveIds.has(id)) continue;
    const cur = map.get(id);
    if (!cur) {
      map.set(id, {
        ...event,
        playerIds: uniqueIds(event.playerIds),
        qualifyingPlayerIds: uniqueIds(event.qualifyingPlayerIds),
      });
      continue;
    }
    cur.playerIds = uniqueIds([...cur.playerIds, ...event.playerIds]);
    cur.qualifyingPlayerIds = uniqueIds([...cur.qualifyingPlayerIds, ...event.qualifyingPlayerIds]);
    if (!cur.tournamentName && event.tournamentName) cur.tournamentName = event.tournamentName;
    if (!cur.tournamentKey && event.tournamentKey) cur.tournamentKey = event.tournamentKey;
  }
  return [...map.values()];
}

function resolveLivePlayerId(
  rawId: string,
  rawName: string,
  roster: ReturnType<typeof loadTennisPlayers>
): string {
  const id = String(rawId || '').trim();
  if (/^\d+$/.test(id)) return id;
  const name = String(rawName || '').trim();
  if (!name) return '';
  const exact = roster.find((player) => player.name.trim().toLowerCase() === name.toLowerCase());
  if (exact) return exact.playerId;
  const hits = roster.filter((player) => namesMatch(player.name, name));
  return hits.length === 1 ? hits[0].playerId : '';
}

function collectLiveEventsFromFixtures(fixtures: ApiTennisFixture[]): TennisLiveEvent[] {
  const roster = loadTennisPlayers();
  const events = new Map<
    string,
    {
      tour: TennisTour;
      tournamentKey: string | null;
      tournamentName: string | null;
      ids: Set<string>;
      qIds: Set<string>;
    }
  >();
  for (const fx of fixtures) {
    const firstId = resolveLivePlayerId(
      String(fx.first_player_key ?? ''),
      String(fx.event_first_player || ''),
      roster
    );
    const secondId = resolveLivePlayerId(
      String(fx.second_player_key ?? ''),
      String(fx.event_second_player || ''),
      roster
    );
    const tournamentName = String(fx.tournament_name || '').trim() || null;
    const tournamentKey = fx.tournament_key != null ? String(fx.tournament_key) : null;
    const tour: TennisTour = tourFromEventType(fx.event_type_type) === 'WTA' ? 'WTA' : 'ATP';
    const round = parseApiRound(fx.tournament_round) || null;
    const qualifying = isTennisQualifyingLabel(round, tournamentName);
    if (!tournamentKey && !liveEventPlace(tournamentName)) continue;
    const eventId = `${tour}|${tournamentKey || liveEventPlace(tournamentName) || 'unknown'}`;
    let event = events.get(eventId);
    if (!event) {
      event = {
        tour,
        tournamentKey: tournamentKey || null,
        tournamentName,
        ids: new Set(),
        qIds: new Set(),
      };
      events.set(eventId, event);
    }
    if (!event.tournamentName && tournamentName) event.tournamentName = tournamentName;
    const bucket = qualifying ? event.qIds : event.ids;
    if (firstId) bucket.add(firstId);
    if (secondId) bucket.add(secondId);
  }
  return [...events.values()].map((event) => ({
    tour: event.tour,
    tournamentKey: event.tournamentKey,
    tournamentName: event.tournamentName,
    playerIds: [...event.ids],
    qualifyingPlayerIds: [...event.qIds],
  }));
}

function indexLiveEvents(
  byPlayerId: Map<string, TennisNextGame>,
  fixtureEvents?: TennisLiveEvent[]
): TennisLiveEventIndex {
  const keys = new Set<string>();
  const names = new Set<string>();
  const idsByKey = new Map<string, Set<string>>();
  const idsByName = new Map<string, Set<string>>();
  const events = new Map<
    string,
    {
      tour: TennisTour;
      tournamentKey: string | null;
      tournamentName: string | null;
      ids: Set<string>;
      qIds: Set<string>;
    }
  >();
  const add = (map: Map<string, Set<string>>, bucket: string, playerId: string) => {
    let set = map.get(bucket);
    if (!set) {
      set = new Set();
      map.set(bucket, set);
    }
    set.add(playerId);
  };
  for (const [playerId, game] of byPlayerId) {
    if (!/^\d+$/.test(playerId)) continue;
    const key = String(game.tournamentKey || '').trim();
    const place = liveEventPlace(game.tournamentName);
    const tour: TennisTour = game.tour === 'WTA' ? 'WTA' : 'ATP';
    const qualifying = isTennisQualifyingLabel(game.round, game.tournamentName);
    if (key) keys.add(key);
    if (place) names.add(place);
    if (!qualifying) {
      if (key) add(idsByKey, key, playerId);
      if (place) add(idsByName, place, playerId);
    }
    const eventId = `${tour}|${key || place || 'unknown'}`;
    if (!key && !place) continue;
    let event = events.get(eventId);
    if (!event) {
      event = {
        tour,
        tournamentKey: key || null,
        tournamentName: game.tournamentName || place || null,
        ids: new Set(),
        qIds: new Set(),
      };
      events.set(eventId, event);
    }
    if (qualifying) event.qIds.add(playerId);
    else event.ids.add(playerId);
    if (!event.tournamentName && game.tournamentName) event.tournamentName = game.tournamentName;
  }
  for (const extra of fixtureEvents || []) {
    const eventId = liveEventId(extra);
    let event = events.get(eventId);
    if (!event) {
      event = {
        tour: extra.tour,
        tournamentKey: extra.tournamentKey,
        tournamentName: extra.tournamentName,
        ids: new Set(),
        qIds: new Set(),
      };
      events.set(eventId, event);
    }
    if (!event.tournamentName && extra.tournamentName) event.tournamentName = extra.tournamentName;
    if (!event.tournamentKey && extra.tournamentKey) event.tournamentKey = extra.tournamentKey;
    for (const id of extra.playerIds) event.ids.add(id);
    for (const id of extra.qualifyingPlayerIds) event.qIds.add(id);
  }
  for (const event of events.values()) {
    const key = String(event.tournamentKey || '').trim();
    const place = liveEventPlace(event.tournamentName);
    if (key) {
      keys.add(key);
      for (const id of event.ids) add(idsByKey, key, id);
    }
    if (place) {
      names.add(place);
      for (const id of event.ids) add(idsByName, place, id);
    }
  }
  return {
    keys,
    names,
    playerIdsByKey: new Map([...idsByKey].map(([k, set]) => [k, [...set]])),
    playerIdsByName: new Map([...idsByName].map(([k, set]) => [k, [...set]])),
    events: [...events.values()].map((event) => ({
      tour: event.tour,
      tournamentKey: event.tournamentKey,
      tournamentName: event.tournamentName,
      playerIds: [...event.ids],
      qualifyingPlayerIds: [...event.qIds],
    })),
  };
}

export async function listLiveTennisEventIndex(): Promise<TennisLiveEventIndex> {
  const byPlayerId = await loadUpcomingByPlayer({ waitForFresh: false });
  return indexLiveEvents(byPlayerId, upcomingRuntime().window?.events);
}

export function peekLiveTennisEventIndex(): TennisLiveEventIndex | null {
  const window = upcomingRuntime().window;
  if (!window?.byPlayerId.size) return null;
  return indexLiveEvents(window.byPlayerId, window.events);
}

export function tennisEventIsLive(
  live: TennisLiveEventIndex,
  tournamentKey?: string | null,
  tournamentName?: string | null
): boolean {
  const key = String(tournamentKey || '').trim();
  if (key && live.keys.has(key)) return true;
  const place = liveEventPlace(tournamentName);
  if (!place) return false;
  if (live.names.has(place)) return true;
  for (const name of live.names) {
    if (name.includes(place) || place.includes(name)) return true;
  }
  return false;
}

export function findLiveTennisEvent(
  live: TennisLiveEventIndex,
  tournamentKey?: string | null,
  tournamentName?: string | null
): TennisLiveEvent | null {
  const key = String(tournamentKey || '').trim();
  const place = liveEventPlace(tournamentName);
  if (key) {
    const byKey = live.events.find((event) => event.tournamentKey === key);
    if (byKey) return byKey;
  }
  if (place) {
    const byName = live.events.find((event) => {
      const eventPlace = liveEventPlace(event.tournamentName);
      return eventPlace === place;
    });
    if (byName) return byName;
  }
  return null;
}

export function tennisLiveEventStage(
  live: TennisLiveEventIndex,
  opts: {
    playerId?: string | null;
    opponentId?: string | null;
    tournamentKey?: string | null;
    tournamentName?: string | null;
    round?: string | null;
  }
): TennisDvpStage {
  if (isTennisQualifyingLabel(opts.round, opts.tournamentName)) return 'qualifying';
  const event = findLiveTennisEvent(live, opts.tournamentKey, opts.tournamentName);
  const q = new Set(event?.qualifyingPlayerIds || []);
  if (opts.playerId && q.has(String(opts.playerId))) return 'qualifying';
  if (opts.opponentId && q.has(String(opts.opponentId))) return 'qualifying';
  return 'main';
}

export function tennisLiveEventPlayerIds(
  live: TennisLiveEventIndex,
  tournamentKey?: string | null,
  tournamentName?: string | null,
  stage: TennisDvpStage = 'main'
): string[] {
  const event = findLiveTennisEvent(live, tournamentKey, tournamentName);
  if (event) {
    return stage === 'qualifying' ? event.qualifyingPlayerIds : event.playerIds;
  }
  const key = String(tournamentKey || '').trim();
  if (stage !== 'qualifying' && key && live.playerIdsByKey.has(key)) return live.playerIdsByKey.get(key) || [];
  const place = liveEventPlace(tournamentName);
  if (stage !== 'qualifying' && place && live.playerIdsByName.has(place)) return live.playerIdsByName.get(place) || [];
  return [];
}

export async function listTennisUpcomingPlayerIdsForEvent(opts: {
  tournamentKey?: string | null;
  tournamentName?: string | null;
}): Promise<string[]> {
  const live = await listLiveTennisEventIndex();
  return tennisLiveEventPlayerIds(live, opts.tournamentKey, opts.tournamentName);
}

export async function listUpcomingTennisByPlayer(opts?: {
  waitForFresh?: boolean;
}): Promise<Map<string, TennisNextGame>> {
  return loadUpcomingByPlayer({ waitForFresh: opts?.waitForFresh });
}

export async function listUniqueUpcomingTennisGames(opts?: {
  waitForFresh?: boolean;
}): Promise<TennisNextGame[]> {
  const byPlayerId = await loadUpcomingByPlayer({ waitForFresh: opts?.waitForFresh });
  return uniqueUpcomingFromMap(byPlayerId);
}

function nextGameInvolvesName(next: TennisNextGame, name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  return namesMatch(next.homeName, n) || namesMatch(next.awayName, n);
}

function pickSoonestNextGame(games: TennisNextGame[]): TennisNextGame | null {
  if (!games.length) return null;
  return [...games].sort((a, b) => {
    const ta = Date.parse(String(a.tipoff || '')) || Number.POSITIVE_INFINITY;
    const tb = Date.parse(String(b.tipoff || '')) || Number.POSITIVE_INFINITY;
    return ta - tb;
  })[0];
}

export async function getTennisNextGame(opts: {
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  tour?: TennisTour | null;
}): Promise<TennisNextGame | null> {
  const playerId = String(opts.playerId || '').trim();
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  if (!playerId && !playerName) return null;
  const byPlayerId = await loadUpcomingByPlayer({ waitForFresh: false });
  const live = indexLiveEvents(byPlayerId, upcomingRuntime().window?.events);
  const finish = (next: TennisNextGame | null) =>
    next ? withDrawSeeds(withSurface(next), playerId || null, live) : null;

  const named: TennisNextGame[] = [];
  if (playerName) {
    const seen = new Set<string>();
    for (const next of byPlayerId.values()) {
      const key = String(next.matchId || `${next.homeName}|${next.awayName}|${next.tipoff}`);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!nextGameInvolvesName(next, playerName) || namesMatch(next.opponent, playerName)) continue;
      named.push(next);
    }
  }
  const withOpponent = opponentName
    ? named.filter((next) => nextGameInvolvesName(next, opponentName))
    : named;

  const byId = playerId ? byPlayerId.get(playerId) || null : null;
  const byIdOk =
    byId &&
    (!playerName || nextGameInvolvesName(byId, playerName)) &&
    (!opponentName || nextGameInvolvesName(byId, opponentName))
      ? byId
      : null;
  const byNameKey = playerName ? byPlayerId.get(nameKey(playerName)) || null : null;
  const byNameKeyOk =
    byNameKey &&
    (!playerName || nextGameInvolvesName(byNameKey, playerName)) &&
    (!opponentName || nextGameInvolvesName(byNameKey, opponentName))
      ? byNameKey
      : null;

  return finish(byIdOk || byNameKeyOk || pickSoonestNextGame(withOpponent) || pickSoonestNextGame(named));
}
