import fs from 'fs';
import path from 'path';

type AflDisposalsProjectionRow = {
  projectionKey?: string;
  playerName?: string;
  homeTeam?: string;
  awayTeam?: string;
  line?: number;
  expectedDisposals?: number;
  sigma?: number;
  pOver?: number;
  pUnder?: number;
  marketPOver?: number | null;
  edgeVsMarket?: number | null;
  modelVersion?: string;
};

type AflDisposalsProjectionPayload = {
  generatedAt?: string;
  modelVersion?: string;
  modelType?: string;
  rows?: AflDisposalsProjectionRow[];
  count?: number;
};

type AflProjectionLookupResult = {
  expectedDisposals: number;
  sigma: number;
  pOver: number;
  pUnder: number;
  marketPOver: number | null;
  edgeVsMarket: number | null;
  modelVersion: string | null;
  scoredAt: string | null;
};

const PROJECTION_TTL_MS = 60 * 1000;
let cache:
  | {
      expiresAt: number;
      payload: AflDisposalsProjectionPayload | null;
      byKey: Map<string, AflDisposalsProjectionRow>;
    }
  | null = null;

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeTeam(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeLine(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function buildProjectionKey(playerName: string, homeTeam: string, awayTeam: string, line: number): string {
  return [
    normalizeName(playerName),
    normalizeTeam(homeTeam),
    normalizeTeam(awayTeam),
    normalizeLine(line),
  ].join('|');
}

function readLatestProjectionPayload(): { payload: AflDisposalsProjectionPayload | null; byKey: Map<string, AflDisposalsProjectionRow> } {
  const filePath = path.join(process.cwd(), 'data', 'afl-model', 'latest-disposals-projections.json');
  if (!fs.existsSync(filePath)) return { payload: null, byKey: new Map() };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const payload = JSON.parse(raw) as AflDisposalsProjectionPayload;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const byKey = new Map<string, AflDisposalsProjectionRow>();
    for (const row of rows) {
      const lineNum = typeof row.line === 'number' ? row.line : null;
      if (!row?.playerName || !row?.homeTeam || !row?.awayTeam || lineNum == null) continue;
      const key = buildProjectionKey(row.playerName, row.homeTeam, row.awayTeam, lineNum);
      byKey.set(key, row);
      // Also index reversed teams for resilience.
      const reverseKey = buildProjectionKey(row.playerName, row.awayTeam, row.homeTeam, lineNum);
      if (!byKey.has(reverseKey)) byKey.set(reverseKey, row);
    }
    return { payload, byKey };
  } catch {
    return { payload: null, byKey: new Map() };
  }
}

function getCachedProjectionData() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache;
  const loaded = readLatestProjectionPayload();
  cache = {
    expiresAt: now + PROJECTION_TTL_MS,
    payload: loaded.payload,
    byKey: loaded.byKey,
  };
  return cache;
}

function toLookupResult(row: AflDisposalsProjectionRow, payload: AflDisposalsProjectionPayload | null): AflProjectionLookupResult | null {
  const expected = row.expectedDisposals;
  const sigma = row.sigma;
  const pOver = row.pOver;
  const pUnder = row.pUnder;
  if (
    typeof expected !== 'number' ||
    !Number.isFinite(expected) ||
    typeof sigma !== 'number' ||
    !Number.isFinite(sigma) ||
    typeof pOver !== 'number' ||
    !Number.isFinite(pOver) ||
    typeof pUnder !== 'number' ||
    !Number.isFinite(pUnder)
  ) {
    return null;
  }
  return {
    expectedDisposals: expected,
    sigma,
    pOver,
    pUnder,
    marketPOver: typeof row.marketPOver === 'number' && Number.isFinite(row.marketPOver) ? row.marketPOver : null,
    edgeVsMarket: typeof row.edgeVsMarket === 'number' && Number.isFinite(row.edgeVsMarket) ? row.edgeVsMarket : null,
    modelVersion: row.modelVersion ?? payload?.modelVersion ?? null,
    scoredAt: payload?.generatedAt ?? null,
  };
}

export function getAflDisposalsProjection(params: {
  playerName: string;
  homeTeam: string;
  awayTeam: string;
  line: number;
}): AflProjectionLookupResult | null {
  const { playerName, homeTeam, awayTeam, line } = params;
  if (!playerName || !homeTeam || !awayTeam || !Number.isFinite(line)) return null;
  const current = getCachedProjectionData();
  if (!current.payload) return null;
  const key = buildProjectionKey(playerName, homeTeam, awayTeam, line);
  const exact = current.byKey.get(key);
  if (exact) return toLookupResult(exact, current.payload);

  // Fallback tolerance for line formatting differences.
  const roundedLine = Math.round(line * 2) / 2;
  const altKey = buildProjectionKey(playerName, homeTeam, awayTeam, roundedLine);
  const alt = current.byKey.get(altKey);
  return alt ? toLookupResult(alt, current.payload) : null;
}

export function getAflDisposalsProjectionPayloadMeta(): { modelVersion: string | null; generatedAt: string | null; count: number } {
  const current = getCachedProjectionData();
  return {
    modelVersion: current.payload?.modelVersion ?? null,
    generatedAt: current.payload?.generatedAt ?? null,
    count: Array.isArray(current.payload?.rows) ? current.payload!.rows!.length : 0,
  };
}
