import sharedCache from '@/lib/sharedCache';
import { tennisLastName } from '@/lib/tennis/chartStats';
import { API_TENNIS_SINGLES_EVENTS, isApiGrandSlam, parseApiRound, tourFromEventType, type ApiTennisFixture } from '@/lib/tennis/apiTennis';
import { loadTennisPlayers } from '@/lib/tennis/data';
import { lookupTennisSurface } from '@/lib/tennis/surfaces';
import type { TennisTour } from '@/lib/tennis/types';

const API_BASE = 'https://api.api-tennis.com/tennis/';
const CACHE_TTL_MS = 2 * 60 * 1000;
const LOOKAHEAD_DAYS = 21;
export const TENNIS_UPCOMING_CACHE_KEY = 'tennis_upcoming_v4';
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
};

type UpcomingWindow = {
  fetchedAt: number;
  byPlayerId: Map<string, TennisNextGame>;
};

type TennisUpcomingStore = {
  fetchedAt: string;
  games: Array<{ playerId: string; game: TennisNextGame }>;
};

type UpcomingRuntime = {
  window: UpcomingWindow | null;
  inflight: Promise<Map<string, TennisNextGame>> | null;
};

function upcomingRuntime(): UpcomingRuntime {
  const g = globalThis as typeof globalThis & { __tennisUpcomingV4?: UpcomingRuntime };
  if (!g.__tennisUpcomingV4) g.__tennisUpcomingV4 = { window: null, inflight: null };
  return g.__tennisUpcomingV4;
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

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  if (namesEqual(a, b)) return true;
  const lastA = tennisLastName(a).toLowerCase();
  const lastB = tennisLastName(b).toLowerCase();
  if (!lastA || lastA !== lastB) return false;
  const initA = a.trim().replace(/[^a-zA-Z]/g, '').charAt(0).toLowerCase();
  const initB = b.trim().replace(/[^a-zA-Z]/g, '').charAt(0).toLowerCase();
  return Boolean(initA && initA === initB);
}

function nameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

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
  // Order-of-play "not before" times stay in the future after a match starts.
  if (setOrLive) return 'live';
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
  name: string;
  ioc: string | null;
  rank: number | null;
  imageUrl: string | null;
} {
  const id = String(playerId || '').trim();
  const players = loadTennisPlayers();
  const hit = id ? players.find((p) => p.playerId === id) : null;
  const byName = !hit
    ? players.find((p) => p.name.toLowerCase() === fallback.trim().toLowerCase())
    : null;
  const player = hit || byName;
  return {
    name: player?.name || fallback.trim(),
    ioc: player?.ioc ?? null,
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
    opponentId,
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

function rememberWindow(byPlayerId: Map<string, TennisNextGame>, fetchedAt = Date.now()) {
  upcomingRuntime().window = { fetchedAt, byPlayerId };
}

function isFresh(fetchedAt: number): boolean {
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < CACHE_TTL_MS;
}

function storeFromJSON(
  stored: TennisUpcomingStore | null
): { fetchedAt: number; byPlayerId: Map<string, TennisNextGame> } | null {
  if (!stored?.games?.length) return null;
  const byPlayerId = new Map<string, TennisNextGame>();
  for (const row of stored.games) {
    if (row?.playerId && row.game) byPlayerId.set(row.playerId, row.game);
  }
  if (!byPlayerId.size) return null;
  const fetchedAt = Date.parse(String(stored.fetchedAt || '')) || 0;
  return { fetchedAt, byPlayerId };
}

async function readUpcomingFromRedis(): Promise<{
  fetchedAt: number;
  byPlayerId: Map<string, TennisNextGame>;
} | null> {
  const stored = await sharedCache.getJSON<TennisUpcomingStore>(TENNIS_UPCOMING_CACHE_KEY);
  return storeFromJSON(stored);
}

async function writeUpcomingToRedis(byPlayerId: Map<string, TennisNextGame>): Promise<void> {
  if (!byPlayerId.size) return;
  await sharedCache.setJSON(
    TENNIS_UPCOMING_CACHE_KEY,
    {
      fetchedAt: new Date().toISOString(),
      games: [...byPlayerId.entries()].map(([playerId, game]) => ({ playerId, game })),
    },
    TENNIS_UPCOMING_TTL_SECONDS
  );
}

export function publishTennisUpcomingFixtures(fixtures: ApiTennisFixture[]): Promise<number> {
  const byPlayerId = indexUpcoming(fixtures.filter(isSingles));
  if (!byPlayerId.size) return Promise.resolve(0);
  rememberWindow(byPlayerId);
  return writeUpcomingToRedis(byPlayerId).then(() => byPlayerId.size);
}

async function fetchUpcomingLive(): Promise<Map<string, TennisNextGame>> {
  if (!apiKey()) return new Map();
  const now = new Date();
  const start = ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000));
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
  ).filter(isSingles);
  return indexUpcoming(fixtures);
}

function withSurface(game: TennisNextGame): TennisNextGame {
  const surface = lookupTennisSurface(game.tournamentName, game.tournamentKey);
  if (game.surface === surface && game.tournamentKey != null) return game;
  return { ...game, surface, tournamentKey: game.tournamentKey ?? null };
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
    ? { fetchedAt: runtime.window.fetchedAt, byPlayerId: runtime.window.byPlayerId }
    : await readUpcomingFromRedis();

  const refresh = async () => {
    try {
      const live = await fetchUpcomingLive();
      if (live.size) {
        await writeUpcomingToRedis(live);
        rememberWindow(live);
        return live;
      }
    } catch (err) {
      console.warn('[tennis-next-game] live fetch failed', err);
    }
    if (cached?.byPlayerId.size) {
      rememberWindow(cached.byPlayerId, cached.fetchedAt);
      return cached.byPlayerId;
    }
    if (runtime.window?.byPlayerId.size) return runtime.window.byPlayerId;
    rememberWindow(new Map());
    return new Map();
  };

  if (cached?.byPlayerId.size) {
    rememberWindow(cached.byPlayerId, cached.fetchedAt);
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
      if (live.size) {
        await writeUpcomingToRedis(live);
        rememberWindow(live);
        return live;
      }
      if (runtime.window?.byPlayerId.size) return runtime.window.byPlayerId;
      const redis = await readUpcomingFromRedis();
      if (redis?.byPlayerId.size) {
        rememberWindow(redis.byPlayerId, redis.fetchedAt);
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
    if (!Number.isFinite(tipMs) || tipMs > Date.now()) return new Date().toISOString();
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

export async function listUniqueUpcomingTennisGames(opts?: {
  waitForFresh?: boolean;
}): Promise<TennisNextGame[]> {
  const byPlayerId = await loadUpcomingByPlayer({ waitForFresh: opts?.waitForFresh });
  return uniqueUpcomingFromMap(byPlayerId);
}

export async function getTennisNextGame(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
}): Promise<TennisNextGame | null> {
  const playerId = String(opts.playerId || '').trim();
  const playerName = String(opts.playerName || '').trim();
  if (!playerId && !playerName) return null;
  const byPlayerId = await loadUpcomingByPlayer({ waitForFresh: true });
  const found =
    (playerId && byPlayerId.get(playerId)) ||
    (playerName && byPlayerId.get(nameKey(playerName))) ||
    null;
  if (found) return withSurface(found);
  if (playerName) {
    for (const next of byPlayerId.values()) {
      const onThisSide =
        namesMatch(next.homeName, playerName) || namesMatch(next.awayName, playerName);
      if (!onThisSide || namesMatch(next.opponent, playerName)) continue;
      return withSurface(next);
    }
  }
  return null;
}
