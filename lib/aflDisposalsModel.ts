import fs from 'fs';
import path from 'path';

type AflDisposalsProjectionRow = {
  projectionKey?: string;
  gameKey?: string;
  playerName?: string;
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string | null;
  bookmaker?: string | null;
  line?: number;
  expectedDisposals?: number;
  sigma?: number;
  pOver?: number;
  pUnder?: number;
  marketPOver?: number | null;
  edgeVsMarket?: number | null;
  edgeVsMarketUnder?: number | null;
  recommendedSide?: 'OVER' | 'UNDER' | null;
  recommendedEdge?: number | null;
  recommendedProb?: number | null;
  isRecommendedPick?: boolean;
  isTop3PickInGame?: boolean;
  recommendedPlayerRankInGame?: number | null;
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
  edgeVsMarketUnder: number | null;
  recommendedSide: 'OVER' | 'UNDER' | null;
  recommendedEdge: number | null;
  recommendedProb: number | null;
  isRecommendedPick: boolean;
  isTop3PickInGame: boolean;
  recommendedPlayerRankInGame: number | null;
  gameKey: string | null;
  modelVersion: string | null;
  scoredAt: string | null;
};

export type AflTopGamePick = {
  playerName: string;
  bookmaker: string | null;
  line: number | null;
  expectedDisposals: number | null;
  recommendedSide: 'OVER' | 'UNDER' | null;
  recommendedEdge: number | null;
  recommendedProb: number | null;
  rank: number | null;
};

export type AflTopPicksGameGroup = {
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  picks: AflTopGamePick[];
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
    edgeVsMarketUnder:
      typeof row.edgeVsMarketUnder === 'number' && Number.isFinite(row.edgeVsMarketUnder) ? row.edgeVsMarketUnder : null,
    recommendedSide: row.recommendedSide === 'OVER' || row.recommendedSide === 'UNDER' ? row.recommendedSide : null,
    recommendedEdge:
      typeof row.recommendedEdge === 'number' && Number.isFinite(row.recommendedEdge) ? row.recommendedEdge : null,
    recommendedProb:
      typeof row.recommendedProb === 'number' && Number.isFinite(row.recommendedProb) ? row.recommendedProb : null,
    isRecommendedPick: Boolean(row.isRecommendedPick),
    isTop3PickInGame: Boolean(row.isTop3PickInGame),
    recommendedPlayerRankInGame:
      typeof row.recommendedPlayerRankInGame === 'number' && Number.isFinite(row.recommendedPlayerRankInGame)
        ? row.recommendedPlayerRankInGame
        : null,
    gameKey: typeof row.gameKey === 'string' && row.gameKey.trim() ? row.gameKey.trim() : null,
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

export function getAflDisposalsTopPicksForGame(gameKey: string, limit = 3): AflTopGamePick[] {
  if (!gameKey) return [];
  const current = getCachedProjectionData();
  const rows = Array.isArray(current.payload?.rows) ? current.payload!.rows! : [];
  const rankedRows = rows
    .filter((row) => String(row.gameKey ?? '').trim() === gameKey && row.isTop3PickInGame === true)
    .sort((a, b) => {
      const ra = typeof a.recommendedPlayerRankInGame === 'number' ? a.recommendedPlayerRankInGame : 999;
      const rb = typeof b.recommendedPlayerRankInGame === 'number' ? b.recommendedPlayerRankInGame : 999;
      if (ra !== rb) return ra - rb;
      const ea = typeof a.recommendedEdge === 'number' && Number.isFinite(a.recommendedEdge) ? a.recommendedEdge : -999;
      const eb = typeof b.recommendedEdge === 'number' && Number.isFinite(b.recommendedEdge) ? b.recommendedEdge : -999;
      if (ea !== eb) return eb - ea;
      return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
    });

  const picks: AflDisposalsProjectionRow[] = [];
  const seenPlayers = new Set<string>();
  for (const row of rankedRows) {
    const playerKey = normalizeName(String(row.playerName ?? ''));
    if (!playerKey || seenPlayers.has(playerKey)) continue;
    seenPlayers.add(playerKey);
    picks.push(row);
    if (picks.length >= Math.max(1, Math.min(10, limit))) break;
  }

  return picks.map((row) => ({
    playerName: String(row.playerName ?? ''),
    bookmaker: row.bookmaker != null ? String(row.bookmaker) : null,
    line: typeof row.line === 'number' && Number.isFinite(row.line) ? row.line : null,
    expectedDisposals:
      typeof row.expectedDisposals === 'number' && Number.isFinite(row.expectedDisposals) ? row.expectedDisposals : null,
    recommendedSide: row.recommendedSide === 'OVER' || row.recommendedSide === 'UNDER' ? row.recommendedSide : null,
    recommendedEdge:
      typeof row.recommendedEdge === 'number' && Number.isFinite(row.recommendedEdge) ? row.recommendedEdge : null,
    recommendedProb:
      typeof row.recommendedProb === 'number' && Number.isFinite(row.recommendedProb) ? row.recommendedProb : null,
    rank:
      typeof row.recommendedPlayerRankInGame === 'number' && Number.isFinite(row.recommendedPlayerRankInGame)
        ? row.recommendedPlayerRankInGame
        : null,
  }));
}

export function getAflDisposalsTopPicksByGame(limitPerGame = 3): AflTopPicksGameGroup[] {
  const current = getCachedProjectionData();
  const rows = Array.isArray(current.payload?.rows) ? current.payload!.rows! : [];
  const byGame = new Map<string, AflDisposalsProjectionRow[]>();

  for (const row of rows) {
    if (row.isTop3PickInGame !== true) continue;
    const gameKey = String(row.gameKey ?? '').trim();
    if (!gameKey) continue;
    const list = byGame.get(gameKey);
    if (list) list.push(row);
    else byGame.set(gameKey, [row]);
  }

  const out: AflTopPicksGameGroup[] = [];
  for (const [gameKey, gameRows] of byGame.entries()) {
    const sorted = [...gameRows].sort((a, b) => {
      const ra = typeof a.recommendedPlayerRankInGame === 'number' ? a.recommendedPlayerRankInGame : 999;
      const rb = typeof b.recommendedPlayerRankInGame === 'number' ? b.recommendedPlayerRankInGame : 999;
      if (ra !== rb) return ra - rb;
      const ea = typeof a.recommendedEdge === 'number' && Number.isFinite(a.recommendedEdge) ? a.recommendedEdge : -999;
      const eb = typeof b.recommendedEdge === 'number' && Number.isFinite(b.recommendedEdge) ? b.recommendedEdge : -999;
      if (ea !== eb) return eb - ea;
      return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
    });

    const uniquePlayers = new Set<string>();
    const picks: AflTopGamePick[] = [];
    for (const row of sorted) {
      const playerKey = normalizeName(String(row.playerName ?? ''));
      if (!playerKey || uniquePlayers.has(playerKey)) continue;
      uniquePlayers.add(playerKey);
      picks.push({
        playerName: String(row.playerName ?? ''),
        bookmaker: row.bookmaker != null ? String(row.bookmaker) : null,
        line: typeof row.line === 'number' && Number.isFinite(row.line) ? row.line : null,
        expectedDisposals:
          typeof row.expectedDisposals === 'number' && Number.isFinite(row.expectedDisposals) ? row.expectedDisposals : null,
        recommendedSide: row.recommendedSide === 'OVER' || row.recommendedSide === 'UNDER' ? row.recommendedSide : null,
        recommendedEdge:
          typeof row.recommendedEdge === 'number' && Number.isFinite(row.recommendedEdge) ? row.recommendedEdge : null,
        recommendedProb:
          typeof row.recommendedProb === 'number' && Number.isFinite(row.recommendedProb) ? row.recommendedProb : null,
        rank:
          typeof row.recommendedPlayerRankInGame === 'number' && Number.isFinite(row.recommendedPlayerRankInGame)
            ? row.recommendedPlayerRankInGame
            : null,
      });
      if (picks.length >= Math.max(1, Math.min(10, limitPerGame))) break;
    }

    if (picks.length === 0) continue;
    const first = sorted[0];
    out.push({
      gameKey,
      homeTeam: String(first?.homeTeam ?? ''),
      awayTeam: String(first?.awayTeam ?? ''),
      commenceTime: first?.commenceTime != null ? String(first.commenceTime) : null,
      picks,
    });
  }

  out.sort((a, b) => {
    const ad = String(a.commenceTime ?? '');
    const bd = String(b.commenceTime ?? '');
    if (ad !== bd) return ad.localeCompare(bd);
    return `${a.homeTeam}|${a.awayTeam}`.localeCompare(`${b.homeTeam}|${b.awayTeam}`);
  });
  return out;
}

export function getAflDisposalsProjectionPayloadMeta(): { modelVersion: string | null; generatedAt: string | null; count: number } {
  const current = getCachedProjectionData();
  return {
    modelVersion: current.payload?.modelVersion ?? null,
    generatedAt: current.payload?.generatedAt ?? null,
    count: Array.isArray(current.payload?.rows) ? current.payload!.rows!.length : 0,
  };
}
