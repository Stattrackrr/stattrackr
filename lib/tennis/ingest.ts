/**
 * Incremental tennis match ingest: last 16 days of finished ATP/WTA singles
 * merged onto the disk cache + a sharedCache overlay (AFL-style replace-on-success).
 */

import sharedCache from '@/lib/sharedCache';
import {
  API_TENNIS_EVENT,
  countryToIoc,
  loadApiTennisCache,
  mapApiFixtureToRows,
  registerTennisOverlayGetter,
  type ApiPlayerInfo,
  type ApiTennisCache,
  type ApiTennisFixture,
  type ApiTennisPlayer,
  type ApiTennisStanding,
} from '@/lib/tennis/apiTennis';
import type { TennisMatchRow, TennisRankingRow, TennisTour } from '@/lib/tennis/types';

export const TENNIS_OVERLAY_CACHE_KEY = 'tennis_match_overlay_v1';
export const TENNIS_INGEST_LOOKBACK_DAYS = 16;
/** 10 years — overlay is replaced on successful ingest, same as AFL odds. */
export const TENNIS_OVERLAY_TTL_SECONDS = 365 * 24 * 60 * 60 * 10;

const API_BASE = 'https://api.api-tennis.com/tennis/';

export type TennisMatchOverlay = {
  fetchedAt: string;
  source: 'api-tennis-incremental';
  matches: TennisMatchRow[];
  players: ApiTennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
};

export type TennisIngestResult = {
  fetchedAt: string;
  fixtureCount: number;
  matchCount: number;
  added: number;
  updated: number;
  overlayRows: number;
  warmedUpcoming: boolean;
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

function ingestWindow(now = new Date()): { start: string; stop: string } {
  const stop = ymdUtc(now);
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - TENNIS_INGEST_LOOKBACK_DAYS);
  return { start: ymdUtc(startDate), stop };
}

async function apiTennisCall(params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ APIkey: key, ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${API_BASE}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!json?.success && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
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
  const runtime = overlayRuntime();
  runtime.overlay = overlay;
  runtime.fetchedAtMs = Date.now();
}

export async function hydrateTennisMatchOverlay(): Promise<TennisMatchOverlay | null> {
  const runtime = overlayRuntime();
  if (runtime.overlay && Date.now() - runtime.fetchedAtMs < 60_000) return runtime.overlay;
  if (runtime.inflight) return runtime.inflight;
  runtime.inflight = (async () => {
    const stored = await sharedCache.getJSON<TennisMatchOverlay>(TENNIS_OVERLAY_CACHE_KEY);
    const overlay =
      stored && typeof stored === 'object' && Array.isArray(stored.matches) ? stored : null;
    rememberOverlay(overlay);
    return overlay;
  })();
  try {
    return await runtime.inflight;
  } finally {
    runtime.inflight = null;
  }
}

export async function fetchTennisIncrementalWindow(now = new Date()): Promise<{
  matches: TennisMatchRow[];
  players: ApiTennisPlayer[];
  standings: { ATP: TennisRankingRow[]; WTA: TennisRankingRow[] };
  fixtureCount: number;
}> {
  const { start, stop } = ingestWindow(now);
  const [atpStandingsJson, wtaStandingsJson, atpFixturesJson, wtaFixturesJson] = await Promise.all([
    apiTennisCall({ method: 'get_standings', event_type: 'ATP' }),
    apiTennisCall({ method: 'get_standings', event_type: 'WTA' }),
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

  const atpStandings = (Array.isArray(atpStandingsJson?.result) ? atpStandingsJson.result : []) as ApiTennisStanding[];
  const wtaStandings = (Array.isArray(wtaStandingsJson?.result) ? wtaStandingsJson.result : []) as ApiTennisStanding[];
  const players = new Map<string, ApiPlayerInfo>();
  for (const row of atpStandings) players.set(String(row.player_key), standingToPlayer(row, 'ATP'));
  for (const row of wtaStandings) players.set(String(row.player_key), standingToPlayer(row, 'WTA'));

  const tours: Array<{ tour: TennisTour; fixtures: ApiTennisFixture[] }> = [
    {
      tour: 'ATP',
      fixtures: (Array.isArray(atpFixturesJson?.result) ? atpFixturesJson.result : []) as ApiTennisFixture[],
    },
    {
      tour: 'WTA',
      fixtures: (Array.isArray(wtaFixturesJson?.result) ? wtaFixturesJson.result : []) as ApiTennisFixture[],
    },
  ];

  const matches: TennisMatchRow[] = [];
  const seen = new Set<string>();
  let fixtureCount = 0;

  for (const { tour, fixtures } of tours) {
    fixtureCount += fixtures.length;
    for (const fx of fixtures) {
      const firstId = String(fx.first_player_key ?? '');
      const secondId = String(fx.second_player_key ?? '');
      if (firstId && fx.event_first_player_logo) {
        const existing = players.get(firstId);
        if (existing && !existing.imageUrl) existing.imageUrl = fx.event_first_player_logo;
        if (!existing) {
          players.set(firstId, {
            playerId: firstId,
            name: String(fx.event_first_player || firstId),
            tour,
            ioc: null,
            rank: null,
            rankPoints: null,
            imageUrl: fx.event_first_player_logo || null,
          });
        }
      }
      if (secondId && fx.event_second_player_logo) {
        const existing = players.get(secondId);
        if (existing && !existing.imageUrl) existing.imageUrl = fx.event_second_player_logo;
        if (!existing) {
          players.set(secondId, {
            playerId: secondId,
            name: String(fx.event_second_player || secondId),
            tour,
            ioc: null,
            rank: null,
            rankPoints: null,
            imageUrl: fx.event_second_player_logo || null,
          });
        }
      }
      for (const row of mapApiFixtureToRows(fx, players)) {
        if (seen.has(row.matchId)) continue;
        seen.add(row.matchId);
        matches.push(row);
      }
    }
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
      imageUrl: p.imageUrl,
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

export async function saveTennisMatchOverlay(overlay: TennisMatchOverlay): Promise<void> {
  await sharedCache.setJSON(TENNIS_OVERLAY_CACHE_KEY, overlay, TENNIS_OVERLAY_TTL_SECONDS);
  rememberOverlay(overlay);
}

export async function refreshTennisMatchOverlay(): Promise<TennisIngestResult> {
  if (!apiKey()) {
    throw new Error('API_TENNIS_KEY is not configured');
  }
  const fetchedAt = new Date().toISOString();
  const incoming = await fetchTennisIncrementalWindow();
  const existingOverlay = (await sharedCache.getJSON<TennisMatchOverlay>(TENNIS_OVERLAY_CACHE_KEY)) || getHydratedTennisOverlay();
  const disk = loadApiTennisCacheFromDiskOnly();
  const prior = mergeTennisCacheWithOverlay(disk, existingOverlay);
  const applied = applyIncrementalTennisFetch(prior, incoming, fetchedAt);
  const overlay: TennisMatchOverlay = {
    fetchedAt,
    source: 'api-tennis-incremental',
    matches: incoming.matches,
    players: incoming.players,
    standings: incoming.standings,
  };
  await saveTennisMatchOverlay(overlay);

  return {
    fetchedAt,
    fixtureCount: incoming.fixtureCount,
    matchCount: incoming.matches.length,
    added: applied.added,
    updated: applied.updated,
    overlayRows: overlay.matches.length,
    warmedUpcoming: false,
  };
}

function loadApiTennisCacheFromDiskOnly(): ApiTennisCache | null {
  return loadApiTennisCache({ diskOnly: true });
}

registerTennisOverlayGetter(() => overlayRuntime().overlay);
