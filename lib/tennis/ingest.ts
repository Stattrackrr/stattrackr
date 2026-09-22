/**
 * Incremental tennis match ingest: fetch recently finished matches and
 * append only new/richer games onto existing Redis player-log shards.
 * Historical games already in cache are left alone.
 */

import sharedCache from '@/lib/sharedCache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { gunzipSync, gzipSync } from 'zlib';
import {
  API_TENNIS_SINGLES_EVENTS,
  countryToIoc,
  ingestApiFixtures,
  loadApiTennisCache,
  registerTennisOverlayGetter,
  tourFromEventType,
  type ApiPlayerInfo,
  type ApiTennisCache,
  type ApiTennisFixture,
  type ApiTennisPlayer,
  type ApiTennisStanding,
} from '@/lib/tennis/apiTennis';
import { resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';
import type { TennisMatchRow, TennisRankingRow, TennisTour } from '@/lib/tennis/types';

export const TENNIS_OVERLAY_CACHE_KEY = 'tennis_match_overlay_v1';
export const TENNIS_OVERLAY_CACHE_TYPE = 'tennis_overlay';
/** Cold-start API window if Redis player logs are missing. Regular 8h runs use 3 days. */
export const TENNIS_INGEST_LOOKBACK_DAYS = 14;
export const TENNIS_INGEST_REFRESH_DAYS = 3;
export const TENNIS_OVERLAY_KEEP_DAYS = 90;
/** Upstash value limit is 10MB; packed 2026 overlay is ~13MB so Redis is optional. */
const TENNIS_OVERLAY_REDIS_MAX_BYTES = 8 * 1024 * 1024;
/** 10 years — overlay is replaced on successful ingest, same as AFL odds. */
export const TENNIS_OVERLAY_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;
const TENNIS_OVERLAY_SUPABASE_TTL_MINUTES = 60 * 24 * 400;
/** One REST attempt — a second JS-client wait of the same blob is what stacked to ~109s. */
const TENNIS_OVERLAY_READ_TIMEOUT_MS = 25_000;

const API_BASE = 'https://api.api-tennis.com/tennis/';

export type TennisMatchOverlay = {
  fetchedAt: string;
  source: 'api-tennis-incremental';
  matches: TennisMatchRow[];
  players: ApiTennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

type PackedTennisOverlay = {
  v: 1;
  encoding: 'gzip-json';
  payload: string;
};

function isPackedTennisOverlay(value: unknown): value is PackedTennisOverlay {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PackedTennisOverlay).encoding === 'gzip-json' &&
    typeof (value as PackedTennisOverlay).payload === 'string'
  );
}

export function unpackTennisOverlay(stored: unknown): TennisMatchOverlay | null {
  if (!stored || typeof stored !== 'object') return null;
  if (isPackedTennisOverlay(stored)) {
    try {
      const json = gunzipSync(Buffer.from(stored.payload, 'base64')).toString('utf8');
      return unpackTennisOverlay(JSON.parse(json));
    } catch {
      return null;
    }
  }
  const overlay = stored as TennisMatchOverlay;
  return Array.isArray(overlay.matches) ? overlay : null;
}

function packTennisOverlay(overlay: TennisMatchOverlay): PackedTennisOverlay {
  return {
    v: 1,
    encoding: 'gzip-json',
    payload: gzipSync(Buffer.from(JSON.stringify(overlay)), { level: 6 }).toString('base64'),
  };
}

async function readStoredTennisOverlay(): Promise<TennisMatchOverlay | null> {
  try {
    const fromSupabase = await getNBACache(TENNIS_OVERLAY_CACHE_KEY, {
      quiet: true,
      restTimeoutMs: TENNIS_OVERLAY_READ_TIMEOUT_MS,
      skipJsFallback: true,
    });
    const unpacked = unpackTennisOverlay(fromSupabase);
    if (unpacked?.matches?.length) return unpacked;
  } catch {
    /* fall through to Redis */
  }
  return unpackTennisOverlay(await sharedCache.getJSON(TENNIS_OVERLAY_CACHE_KEY));
}

function pruneOverlayMatches(matches: TennisMatchRow[], keepDays = TENNIS_OVERLAY_KEEP_DAYS): TennisMatchRow[] {
  const startDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - keepDays);
  const recentCutoff = ymdUtc(startDate);
  const recent = matches.filter((row) => Boolean(row.date && String(row.date) >= recentCutoff));
  const byId = new Map<string, TennisMatchRow[]>();
  for (const row of recent) {
    const id = String(row.playerId || '').trim();
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(row);
    else byId.set(id, [row]);
  }
  const out: TennisMatchRow[] = [];
  for (const games of byId.values()) {
    const sorted = [...games].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    out.push(...(sorted.length > 80 ? sorted.slice(-80) : sorted));
  }
  return out;
}

export type TennisIngestResult = {
  fetchedAt: string;
  fixtureCount: number;
  matchCount: number;
  added: number;
  updated: number;
  overlayRows: number;
  warmedUpcoming: boolean;
  persistOk?: boolean;
  persistBytes?: number;
  lookbackDays?: number;
  shards?: { players: number; logs: number; skipped: boolean; added?: number; updated?: number };
};

type OverlayRuntime = {
  overlay: TennisMatchOverlay | null;
  fetchedAtMs: number;
  inflight: Promise<TennisMatchOverlay | null> | null;
};

function overlayRuntime(): OverlayRuntime {
  const g = globalThis as typeof globalThis & { __tennisIngestOverlay?: OverlayRuntime };
  if (!g.__tennisIngestOverlay) {
    g.__tennisIngestOverlay = { overlay: null, fetchedAtMs: 0, inflight: null };
  }
  return g.__tennisIngestOverlay;
}

function apiKey(): string {
  return String(process.env.API_TENNIS_KEY || '').trim();
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function ingestLookbackDays(): Promise<number> {
  return TENNIS_INGEST_REFRESH_DAYS;
}

function ingestWindow(now = new Date(), lookbackDays = TENNIS_INGEST_LOOKBACK_DAYS): { start: string; stop: string } {
  const stop = ymdUtc(now);
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - Math.max(1, lookbackDays));
  return { start: ymdUtc(startDate), stop };
}

async function apiTennisCall(params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ APIkey: key, ...params });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${API_BASE}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res) {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!json?.success && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    return json;
  }
  return null;
}

function standingToPlayer(row: ApiTennisStanding, tour: TennisTour): ApiPlayerInfo {
  const playerId = String(row.player_key);
  return {
    playerId,
    name: String(row.player || '').trim() || playerId,
    tour,
    ioc: countryToIoc(row.country),
    rank: Number(row.place) || null,
    rankPoints: Number(row.points) || null,
    imageUrl: null,
  };
}

function toRanking(row: ApiTennisStanding, tour: TennisTour): TennisRankingRow {
  return {
    pos: Number(row.place) || 0,
    playerId: String(row.player_key),
    name: String(row.player || '').trim(),
    tour,
    points: Number(row.points) || null,
    ioc: countryToIoc(row.country),
  };
}

const RICHNESS_KEYS: Array<keyof TennisMatchRow> = [
  'aces',
  'opponentAces',
  'doubleFaults',
  'firstServePct',
  'firstServeWonPct',
  'secondServeWonPct',
  'servicePointsWonPct',
  'breakPointsSaved',
  'breakPointsConverted',
  'breakPointsSavedPct',
  'breakPointsConvertedPct',
  'returnPointsWonPct',
  'pointsWon',
  'winners',
  'unforcedErrors',
  'firstServeSpeed',
  'secondServeSpeed',
  'servePoints',
  'firstServesIn',
];

export function tennisMatchRichness(row: TennisMatchRow | undefined): number {
  if (!row) return 0;
  let n = 0;
  for (const key of RICHNESS_KEYS) {
    if (row[key] != null) n += 1;
  }
  return n;
}

export function pickRicherMatchRow(prev: TennisMatchRow | undefined, next: TennisMatchRow): TennisMatchRow {
  if (!prev) return next;
  return tennisMatchRichness(next) >= tennisMatchRichness(prev) ? next : prev;
}

export function mergeTennisMatchRows(
  primary: TennisMatchRow[],
  extra: TennisMatchRow[]
): { matches: TennisMatchRow[]; added: number; updated: number } {
  const byId = new Map<string, TennisMatchRow>();
  for (const row of primary) {
    if (row?.matchId) byId.set(row.matchId, row);
  }
  let added = 0;
  let updated = 0;
  for (const row of extra) {
    if (!row?.matchId) continue;
    const prev = byId.get(row.matchId);
    if (!prev) {
      byId.set(row.matchId, row);
      added += 1;
      continue;
    }
    const chosen = pickRicherMatchRow(prev, row);
    if (chosen !== prev) {
      byId.set(row.matchId, chosen);
      updated += 1;
    }
  }
  return { matches: [...byId.values()], added, updated };
}

function mergePlayers(primary: ApiTennisPlayer[], extra: ApiTennisPlayer[]): ApiTennisPlayer[] {
  const byId = new Map<string, ApiTennisPlayer>();
  for (const player of primary) {
    if (player?.playerId) byId.set(player.playerId, player);
  }
  for (const player of extra) {
    if (!player?.playerId) continue;
    const prev = byId.get(player.playerId);
    if (!prev) {
      byId.set(player.playerId, player);
      continue;
    }
    byId.set(player.playerId, {
      ...prev,
      ...player,
      imageUrl: player.imageUrl || prev.imageUrl,
      ioc: player.ioc || prev.ioc,
      rank: player.rank ?? prev.rank,
      rankPoints: player.rankPoints ?? prev.rankPoints,
    });
  }
  return [...byId.values()].sort(
    (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name)
  );
}

export function mergeTennisCacheWithOverlay(
  base: ApiTennisCache | null,
  overlay: TennisMatchOverlay | null
): ApiTennisCache | null {
  if (!base && !overlay) return null;
  const mergedRows = mergeTennisMatchRows(base?.matches || [], overlay?.matches || []);
  const standings = overlay?.standings?.ATP?.length || overlay?.standings?.WTA?.length
    ? {
        ATP: overlay?.standings?.ATP?.length ? overlay.standings.ATP : base?.standings?.ATP || [],
        WTA: overlay?.standings?.WTA?.length ? overlay.standings.WTA : base?.standings?.WTA || [],
      }
    : base?.standings || { ATP: [], WTA: [] };
  const fetchedAt = overlay?.fetchedAt || base?.fetchedAt || new Date().toISOString();
  return {
    fetchedAt,
    source: 'api-tennis',
    matches: mergedRows.matches,
    players: mergePlayers(base?.players || [], overlay?.players || []),
    standings,
  };
}

export function getHydratedTennisOverlay(): TennisMatchOverlay | null {
  return overlayRuntime().overlay;
}

export function tennisOverlayGeneration(): number {
  const fetchedAt = overlayRuntime().overlay?.fetchedAt;
  if (!fetchedAt) return 0;
  const ms = Date.parse(fetchedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function rememberOverlay(overlay: TennisMatchOverlay | null) {
  if (!overlay?.matches?.length) return;
  const runtime = overlayRuntime();
  runtime.overlay = overlay;
  runtime.fetchedAtMs = Date.now();
}

async function loadOverlayFromRemote(): Promise<TennisMatchOverlay | null> {
  const overlay = await readStoredTennisOverlay();
  if (overlay?.matches?.length) {
    rememberOverlay(overlay);
    return overlay;
  }
  return overlayRuntime().overlay;
}

function startOverlayRefresh(): Promise<TennisMatchOverlay | null> {
  const runtime = overlayRuntime();
  if (runtime.inflight) return runtime.inflight;
  runtime.inflight = loadOverlayFromRemote().finally(() => {
    runtime.inflight = null;
  });
  return runtime.inflight;
}

export async function hydrateTennisMatchOverlay(opts?: {
  allowRemote?: boolean;
}): Promise<TennisMatchOverlay | null> {
  const runtime = overlayRuntime();
  if (runtime.overlay?.matches?.length) {
    return runtime.overlay;
  }
  if (opts?.allowRemote === false) return null;
  if (runtime.inflight) return runtime.inflight;
  return startOverlayRefresh();
}

/** Process memory only. Dashboard GETs must not pull the overlay blob. */
export async function hydrateTennisOverlayLocal(): Promise<TennisMatchOverlay | null> {
  return hydrateTennisMatchOverlay({ allowRemote: false });
}

export async function fetchTennisIncrementalWindow(
  now = new Date(),
  lookbackDays = TENNIS_INGEST_LOOKBACK_DAYS,
  opts?: { includeLower?: boolean }
): Promise<{
  matches: TennisMatchRow[];
  players: ApiTennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
  fixtureCount: number;
  fixtures: ApiTennisFixture[];
}> {
  const { start, stop } = ingestWindow(now, lookbackDays);
  const mainEvents = API_TENNIS_SINGLES_EVENTS.filter(
    (event) => event.label === 'ATP' || event.label === 'WTA'
  );
  const lowerEvents =
    opts?.includeLower === true
      ? API_TENNIS_SINGLES_EVENTS.filter((event) => event.label !== 'ATP' && event.label !== 'WTA')
      : [];
  const fetchFixtures = (event: (typeof API_TENNIS_SINGLES_EVENTS)[number]) =>
    apiTennisCall({
      method: 'get_fixtures',
      date_start: start,
      date_stop: stop,
      event_type_key: event.eventType,
    });
  const [atpStandingsJson, wtaStandingsJson, ...fixtureBatches] = await Promise.all([
    apiTennisCall({ method: 'get_standings', event_type: 'ATP' }),
    apiTennisCall({ method: 'get_standings', event_type: 'WTA' }),
    ...mainEvents.map(fetchFixtures),
    ...lowerEvents.map(fetchFixtures),
  ]);
  const fixtureEvents = [...mainEvents, ...lowerEvents];

  const atpStandings = (Array.isArray(atpStandingsJson?.result) ? atpStandingsJson.result : []) as ApiTennisStanding[];
  const wtaStandings = (Array.isArray(wtaStandingsJson?.result) ? wtaStandingsJson.result : []) as ApiTennisStanding[];
  const players = new Map<string, ApiPlayerInfo>();
  for (const row of atpStandings) players.set(String(row.player_key), standingToPlayer(row, 'ATP'));
  for (const row of wtaStandings) players.set(String(row.player_key), standingToPlayer(row, 'WTA'));

  const tours: Array<{ tour: TennisTour; fixtures: ApiTennisFixture[] }> = fixtureEvents.map(
    (event, index) => ({
      tour: event.tour,
      fixtures: (Array.isArray((fixtureBatches[index] as { result?: unknown } | null)?.result)
        ? (fixtureBatches[index] as { result: ApiTennisFixture[] }).result
        : []) as ApiTennisFixture[],
    })
  );

  const matches: TennisMatchRow[] = [];
  const seen = new Set<string>();
  const allFixtures: ApiTennisFixture[] = [];
  let fixtureCount = 0;

  for (const { tour, fixtures } of tours) {
    fixtureCount += fixtures.length;
    allFixtures.push(...fixtures);
    matches.push(...ingestApiFixtures(fixtures, players, tour, seen));
  }

  const playerList: ApiTennisPlayer[] = [...players.values()]
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      tour: p.tour,
      ioc: p.ioc,
      hand: null,
      height: null,
      rank: p.rank,
      rankPoints: p.rankPoints,
      imageUrl: clientTennisHeadshotUrl(p.playerId, resolveTennisHeadshotUrl(p.playerId, p.imageUrl)),
    }))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name));

  return {
    matches,
    players: playerList,
    standings: {
      ATP: atpStandings.map((row) => toRanking(row, 'ATP')),
      WTA: wtaStandings.map((row) => toRanking(row, 'WTA')),
    },
    fixtureCount,
    fixtures: allFixtures,
  };
}

export function applyIncrementalTennisFetch(
  base: ApiTennisCache | null,
  incoming: Awaited<ReturnType<typeof fetchTennisIncrementalWindow>>,
  fetchedAt = new Date().toISOString()
): { cache: ApiTennisCache; added: number; updated: number } {
  const merged = mergeTennisMatchRows(base?.matches || [], incoming.matches);
  const cache: ApiTennisCache = {
    fetchedAt,
    source: 'api-tennis',
    matches: merged.matches,
    players: mergePlayers(base?.players || [], incoming.players),
    standings: {
      ATP: incoming.standings.ATP.length ? incoming.standings.ATP : base?.standings?.ATP || [],
      WTA: incoming.standings.WTA.length ? incoming.standings.WTA : base?.standings?.WTA || [],
    },
  };
  return { cache, added: merged.added, updated: merged.updated };
}

async function publishOverlayShards(
  overlay: TennisMatchOverlay | null,
  opts?: { onlyPriority?: boolean }
) {
  const { mergeTennisPlayerLogsIncremental } = await import('@/lib/tennis/dashboardCache');
  return mergeTennisPlayerLogsIncremental(overlay, opts);
}

/**
 * Write finished singles (including ITF/Challenger) from an already-fetched
 * fixture window onto Redis player logs. Upcoming already pays for that API
 * call; without this, live ITF opponents stay on the DVP board with empty samples.
 */
export async function seedTennisLogsFromFixtures(
  fixtures: ApiTennisFixture[],
  playerIds: string[]
): Promise<{ matches: number; added: number; updated: number; logs: number; missing: number }> {
  const empty = { matches: 0, added: 0, updated: 0, logs: 0, missing: 0 };
  const ids = [...new Set(playerIds.map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id)))];
  if (!fixtures.length || !ids.length) return empty;
  const { mergeTennisPlayerLogsIncremental, readTennisPlayerLogsCacheMany } = await import(
    '@/lib/tennis/dashboardCache'
  );
  const existing = await readTennisPlayerLogsCacheMany(ids);
  const missing = ids.filter((id) => !(existing.get(id)?.length));
  if (!missing.length) return { ...empty, missing: 0 };
  const want = new Set(missing);
  const relevant = fixtures.filter(
    (fx) =>
      want.has(String(fx.first_player_key ?? '').trim()) ||
      want.has(String(fx.second_player_key ?? '').trim())
  );
  if (!relevant.length) return { ...empty, missing: missing.length };
  const players = new Map<string, ApiPlayerInfo>();
  const seen = new Set<string>();
  const matches: TennisMatchRow[] = [];
  for (const tour of ['ATP', 'WTA'] as const) {
    const batch = relevant.filter((fx) => tourFromEventType(fx.event_type_type) === tour);
    if (!batch.length) continue;
    matches.push(...ingestApiFixtures(batch, players, tour, seen));
  }
  if (!matches.length) return { ...empty, missing: missing.length };
  const result = await mergeTennisPlayerLogsIncremental(
    {
      fetchedAt: new Date().toISOString(),
      matches,
      players: [...players.values()].map((p) => ({
        playerId: p.playerId,
        name: p.name,
        tour: p.tour,
        ioc: p.ioc,
        hand: null,
        height: null,
        rank: p.rank,
        rankPoints: p.rankPoints,
        imageUrl: p.imageUrl,
      })),
    },
    { onlyPriority: false }
  );
  return {
    matches: matches.length,
    added: result.added,
    updated: result.updated,
    logs: result.logs,
    missing: missing.length,
  };
}

export async function saveTennisMatchOverlay(overlay: TennisMatchOverlay): Promise<boolean> {
  rememberOverlay(overlay);
  const packed = packTennisOverlay(overlay);
  const packedBytes = Buffer.byteLength(JSON.stringify(packed));
  const fits = packedBytes <= TENNIS_OVERLAY_REDIS_MAX_BYTES;
  try {
    if (fits) {
      await sharedCache.setJSON(TENNIS_OVERLAY_CACHE_KEY, packed, TENNIS_OVERLAY_TTL_SECONDS);
    } else {
      await sharedCache.deleteJSON(TENNIS_OVERLAY_CACHE_KEY);
    }
  } catch (err) {
    console.warn('[tennis ingest] overlay Redis write skipped', err);
  }
  if (!fits) {
    console.warn(
      `[tennis ingest] overlay persist skipped (${overlay.matches.length} matches, ${packedBytes} bytes)`
    );
    return false;
  }
  const supabaseOk = await setNBACache(
    TENNIS_OVERLAY_CACHE_KEY,
    TENNIS_OVERLAY_CACHE_TYPE,
    packed,
    TENNIS_OVERLAY_SUPABASE_TTL_MINUTES,
    true
  );
  if (!supabaseOk) {
    console.warn(
      `[tennis ingest] overlay Supabase persist skipped (${overlay.matches.length} matches, ${packedBytes} bytes)`
    );
    return false;
  }
  return true;
}

/** Pull ATP/WTA standings into the Redis roster. Does not rewrite match history. */
export async function refreshTennisStandings(): Promise<{ atp: number; wta: number; fetchedAt: string }> {
  const fetchedAt = new Date().toISOString();
  if (!apiKey()) return { atp: 0, wta: 0, fetchedAt };
  const [atpStandingsJson, wtaStandingsJson] = await Promise.all([
    apiTennisCall({ method: 'get_standings', event_type: 'ATP' }),
    apiTennisCall({ method: 'get_standings', event_type: 'WTA' }),
  ]);
  const atpStandings = (Array.isArray(atpStandingsJson?.result) ? atpStandingsJson.result : []) as ApiTennisStanding[];
  const wtaStandings = (Array.isArray(wtaStandingsJson?.result) ? wtaStandingsJson.result : []) as ApiTennisStanding[];
  const players: ApiTennisPlayer[] = [];
  for (const row of atpStandings) {
    const p = standingToPlayer(row, 'ATP');
    players.push({
      playerId: p.playerId,
      name: p.name,
      tour: p.tour,
      ioc: p.ioc,
      hand: null,
      height: null,
      rank: p.rank,
      rankPoints: p.rankPoints,
      imageUrl: p.imageUrl,
    });
  }
  for (const row of wtaStandings) {
    const p = standingToPlayer(row, 'WTA');
    players.push({
      playerId: p.playerId,
      name: p.name,
      tour: p.tour,
      ioc: p.ioc,
      hand: null,
      height: null,
      rank: p.rank,
      rankPoints: p.rankPoints,
      imageUrl: p.imageUrl,
    });
  }
  const { mergeTennisPlayerLogsIncremental } = await import('@/lib/tennis/dashboardCache');
  await mergeTennisPlayerLogsIncremental({
    fetchedAt,
    matches: [],
    players,
    standings: {
      ATP: atpStandings.map((row) => toRanking(row, 'ATP')),
      WTA: wtaStandings.map((row) => toRanking(row, 'WTA')),
    },
  });
  return { atp: atpStandings.length, wta: wtaStandings.length, fetchedAt };
}

export async function refreshTennisMatchOverlay(): Promise<TennisIngestResult & { fixtures: ApiTennisFixture[] }> {
  if (!apiKey()) {
    throw new Error('API_TENNIS_KEY is not configured');
  }
  const fetchedAt = new Date().toISOString();
  const lookbackDays = await ingestLookbackDays();
  const incoming = await fetchTennisIncrementalWindow(new Date(), lookbackDays, {
    includeLower: true,
  });
  if (!incoming.matches.length && lookbackDays >= TENNIS_INGEST_LOOKBACK_DAYS) {
    throw new Error('Tennis ingest returned 0 matches; Redis logs are empty and the API window was empty');
  }
  const overlay: TennisMatchOverlay = {
    fetchedAt,
    source: 'api-tennis-incremental',
    matches: incoming.matches,
    players: incoming.players,
    standings: incoming.standings,
  };
  rememberOverlay(overlay);
  const shards = await publishOverlayShards(overlay, { onlyPriority: true });

  return {
    fetchedAt,
    fixtureCount: incoming.fixtureCount,
    matchCount: incoming.matches.length,
    added: shards.added || 0,
    updated: shards.updated || 0,
    overlayRows: incoming.matches.length,
    warmedUpcoming: false,
    persistOk: true,
    persistBytes: 0,
    lookbackDays,
    shards,
    fixtures: incoming.fixtures,
  };
}

function loadApiTennisCacheFromDiskOnly(): ApiTennisCache | null {
  return loadApiTennisCache({ diskOnly: true });
}

export async function seedTennisOverlayFromDisk(): Promise<{
  overlayRows: number;
  players: number;
  fetchedAt: string;
}> {
  const disk = loadApiTennisCacheFromDiskOnly();
  if (!disk?.matches?.length) {
    throw new Error('No local data/tennis/api-tennis/cache.json to seed from');
  }
  const matches = pruneOverlayMatches(disk.matches);
  const ids = new Set<string>();
  for (const row of matches) {
    if (row.playerId) ids.add(row.playerId);
    if (row.opponentId) ids.add(row.opponentId);
  }
  const players = (disk.players || [])
    .filter((player) => ids.has(player.playerId))
    .map((player) => ({
      ...player,
      imageUrl: clientTennisHeadshotUrl(player.playerId, resolveTennisHeadshotUrl(player.playerId, player.imageUrl)),
    }));
  const fetchedAt = new Date().toISOString();
  const overlay: TennisMatchOverlay = {
    fetchedAt,
    source: 'api-tennis-incremental',
    matches,
    players,
    standings: {
      ATP: disk.standings?.ATP || [],
      WTA: disk.standings?.WTA || [],
    },
  };
  await saveTennisMatchOverlay(overlay);
  return { overlayRows: matches.length, players: players.length, fetchedAt };
}

registerTennisOverlayGetter(() => overlayRuntime().overlay);
