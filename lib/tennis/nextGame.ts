import {
  API_TENNIS_EVENT,
  isApiGrandSlam,
  tourFromEventType,
  type ApiTennisFixture,
} from '@/lib/tennis/apiTennis';
import { loadTennisPlayers } from '@/lib/tennis/data';
import type { TennisTour } from '@/lib/tennis/types';

const API_BASE = 'https://api.api-tennis.com/tennis/';
const CACHE_TTL_MS = 5 * 60 * 1000;
const LOOKAHEAD_DAYS = 14;

export type TennisNextGame = {
  opponent: string;
  opponentId: string | null;
  opponentIoc: string | null;
  opponentLogo: string | null;
  tipoff: string | null;
  live: boolean;
  isGrandSlam: boolean;
  tour: TennisTour | null;
  tournamentName: string | null;
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

type UpcomingRuntime = {
  window: UpcomingWindow | null;
  inflight: Promise<Map<string, TennisNextGame>> | null;
};

function upcomingRuntime(): UpcomingRuntime {
  const g = globalThis as typeof globalThis & { __tennisUpcoming?: UpcomingRuntime };
  if (!g.__tennisUpcoming) g.__tennisUpcoming = { window: null, inflight: null };
  return g.__tennisUpcoming;
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
  if (s === 'finished' || s.includes('retir')) return 'finished';
  const now = Date.now();
  const started = tipoff ? now >= tipoff.getTime() : false;
  const setOrLive =
    /^(set\s*)?[1-5]$/.test(s) ||
    s.includes('live') ||
    s.includes('progress') ||
    s.includes('playing');
  if (setOrLive) return started ? 'live' : 'scheduled';
  if (!s || s === 'not started' || s === 'scheduled' || s === 'ns') {
    return started ? 'live' : 'scheduled';
  }
  return started ? 'live' : 'scheduled';
}

async function apiTennisCall(params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ APIkey: key, timezone: 'UTC', ...params });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${API_BASE}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      continue;
    }
    return res.json();
  }
  return null;
}

function officialPlayer(playerId: string | null, fallback: string): {
  name: string;
  ioc: string | null;
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
    imageUrl: player?.imageUrl ?? null,
  };
}

function toNextGame(fx: ApiTennisFixture, playerId: string): TennisNextGame | null {
  const firstId = String(fx.first_player_key ?? '').trim();
  const secondId = String(fx.second_player_key ?? '').trim();
  const firstName = String(fx.event_first_player || '').trim();
  const secondName = String(fx.event_second_player || '').trim();
  if (!firstName || !secondName) return null;
  const playerIsFirst = firstId && firstId === playerId;
  const playerIsSecond = secondId && secondId === playerId;
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
  const phase = fixturePhase(String(fx.event_status || ''), tipoff);
  if (phase === 'skip' || phase === 'finished') return null;
  const tournamentName = String(fx.tournament_name || '').trim() || null;
  return {
    opponent: resolved.name,
    opponentId,
    opponentIoc: resolved.ioc,
    opponentLogo: resolved.imageUrl || opponentLogo,
    tipoff: tipoff ? tipoff.toISOString() : fx.event_date || null,
    live: phase === 'live',
    isGrandSlam: isApiGrandSlam(tournamentName),
    tour: tourFromEventType(fx.event_type_type),
    tournamentName,
    matchId: fx.event_key != null ? String(fx.event_key) : null,
    status: fx.event_status ? String(fx.event_status) : null,
    playerIsHome: Boolean(playerIsFirst),
    homeName: first.name,
    awayName: second.name,
  };
}

function indexUpcoming(fixtures: ApiTennisFixture[]): Map<string, TennisNextGame> {
  const ranked = new Map<string, { next: TennisNextGame; tip: number }>();
  for (const fx of fixtures) {
    const ids = [String(fx.first_player_key ?? '').trim(), String(fx.second_player_key ?? '').trim()].filter(Boolean);
    for (const playerId of ids) {
      const next = toNextGame(fx, playerId);
      if (!next) continue;
      const tip = next.tipoff ? new Date(next.tipoff).getTime() : Number.MAX_SAFE_INTEGER;
      const prev = ranked.get(playerId);
      if (!prev || tip < prev.tip) ranked.set(playerId, { next, tip });
    }
  }
  const byPlayerId = new Map<string, TennisNextGame>();
  for (const [playerId, row] of ranked) byPlayerId.set(playerId, row.next);
  return byPlayerId;
}

async function loadUpcomingByPlayer(): Promise<Map<string, TennisNextGame>> {
  const runtime = upcomingRuntime();
  if (runtime.window && Date.now() - runtime.window.fetchedAt < CACHE_TTL_MS) {
    return runtime.window.byPlayerId;
  }
  if (runtime.inflight) return runtime.inflight;
  runtime.inflight = (async () => {
    const now = new Date();
    const start = ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const stop = ymd(new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000));
    const [atp, wta] = await Promise.all([
      apiTennisCall({
        method: 'get_fixtures',
        date_start: start,
        date_stop: stop,
        event_type_key: API_TENNIS_EVENT.ATP_SINGLES,
      }),
      apiTennisCall({
        method: 'get_fixtures',
        date_start: start,
        date_stop: stop,
        event_type_key: API_TENNIS_EVENT.WTA_SINGLES,
      }),
    ]);
    const fixtures = [
      ...((Array.isArray(atp?.result) ? atp.result : []) as ApiTennisFixture[]),
      ...((Array.isArray(wta?.result) ? wta.result : []) as ApiTennisFixture[]),
    ].filter(isSingles);
    const byPlayerId = indexUpcoming(fixtures);
    runtime.window = { fetchedAt: Date.now(), byPlayerId };
    return byPlayerId;
  })();
  try {
    return await runtime.inflight;
  } finally {
    runtime.inflight = null;
  }
}

export async function warmTennisUpcomingFixtures(): Promise<void> {
  if (!apiKey()) return;
  await loadUpcomingByPlayer();
}

export async function getTennisNextGame(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
}): Promise<TennisNextGame | null> {
  const playerId = String(opts.playerId || '').trim();
  if (!playerId || !apiKey()) return null;
  const byPlayerId = await loadUpcomingByPlayer();
  return byPlayerId.get(playerId) ?? null;
}
