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
  modelLine: number | null;
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

function rankedRecommendedRows(rows: AflDisposalsProjectionRow[]): AflDisposalsProjectionRow[] {
  return [...rows]
    .filter((row) => {
      const side = row.recommendedSide;
      const edge = row.recommendedEdge;
      const prob = row.recommendedProb;
      return Boolean(row.isRecommendedPick) &&
        (side === 'OVER' || side === 'UNDER') &&
        typeof edge === 'number' && Number.isFinite(edge) &&
        typeof prob === 'number' && Number.isFinite(prob);
    })
    .sort((a, b) => {
      const ea = typeof a.recommendedEdge === 'number' && Number.isFinite(a.recommendedEdge) ? a.recommendedEdge : -999;
      const eb = typeof b.recommendedEdge === 'number' && Number.isFinite(b.recommendedEdge) ? b.recommendedEdge : -999;
      if (ea !== eb) return eb - ea;
      const pa = typeof a.recommendedProb === 'number' && Number.isFinite(a.recommendedProb) ? a.recommendedProb : -999;
      const pb = typeof b.recommendedProb === 'number' && Number.isFinite(b.recommendedProb) ? b.recommendedProb : -999;
      if (pa !== pb) return pb - pa;
      return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
    });
}

function rankedFallbackRows(rows: AflDisposalsProjectionRow[]): AflDisposalsProjectionRow[] {
  return [...rows]
    .filter((row) => {
      const expected = row.expectedDisposals;
      const line = row.line;
      return (
        typeof expected === 'number' &&
        Number.isFinite(expected) &&
        typeof line === 'number' &&
        Number.isFinite(line)
      );
    })
    .sort((a, b) => {
      const edgeA = typeof a.edgeVsMarket === 'number' && Number.isFinite(a.edgeVsMarket)
        ? Math.abs(a.edgeVsMarket)
        : Math.abs((a.expectedDisposals ?? 0) - (a.line ?? 0));
      const edgeB = typeof b.edgeVsMarket === 'number' && Number.isFinite(b.edgeVsMarket)
        ? Math.abs(b.edgeVsMarket)
        : Math.abs((b.expectedDisposals ?? 0) - (b.line ?? 0));
      if (edgeA !== edgeB) return edgeB - edgeA;
      return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
    });
}

/** Matches `score_upcoming.py` default `--top3-max-same-side` (max picks on one side of the line per game). */
const TOP_PICKS_MAX_SAME_SIDE = 2;

function selectTopRowsWithSideAnchors(rows: AflDisposalsProjectionRow[], limit: number): AflDisposalsProjectionRow[] {
  const cappedLimit = Math.max(1, Math.min(10, limit));
  const maxSame = Math.max(1, TOP_PICKS_MAX_SAME_SIDE);
  const ranked = rankedRecommendedRows(rows);
  if (ranked.length === 0) return [];

  const selected: AflDisposalsProjectionRow[] = [];
  const selectedPlayers = new Set<string>();
  let overCount = 0;
  let underCount = 0;

  const canTakeSide = (side: 'OVER' | 'UNDER') =>
    side === 'OVER' ? overCount < maxSame : underCount < maxSame;

  const tryAdd = (row: AflDisposalsProjectionRow): boolean => {
    const side = row.recommendedSide;
    if (side !== 'OVER' && side !== 'UNDER') return false;
    const playerKey = normalizeName(String(row.playerName ?? ''));
    if (!playerKey || selectedPlayers.has(playerKey)) return false;
    if (!canTakeSide(side)) return false;
    selected.push(row);
    selectedPlayers.add(playerKey);
    if (side === 'OVER') overCount += 1;
    else underCount += 1;
    return true;
  };

  // Anchor: best OVER and best UNDER by rank order (when caps allow).
  const bestOver = ranked.find((row) => row.recommendedSide === 'OVER');
  if (bestOver) tryAdd(bestOver);
  const bestUnder = ranked.find((row) => row.recommendedSide === 'UNDER');
  if (bestUnder) tryAdd(bestUnder);

  // Fill remaining slots in rank order, but never exceed maxSame on one side (avoids 3× UNDER when model leans under).
  for (const row of ranked) {
    if (selected.length >= cappedLimit) break;
    tryAdd(row);
  }

  return selected.slice(0, cappedLimit);
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
    modelLine: typeof row.line === 'number' && Number.isFinite(row.line) ? row.line : null,
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
  if (alt) return toLookupResult(alt, current.payload);

  // Final fallback: nearest available line for this player/game (still same matchup).
  const playerNorm = normalizeName(playerName);
  const homeNorm = normalizeTeam(homeTeam);
  const awayNorm = normalizeTeam(awayTeam);
  let bestRow: AflDisposalsProjectionRow | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  const requestedLine = Number.isFinite(line) ? line : roundedLine;
  const rows = Array.isArray(current.payload?.rows) ? current.payload!.rows! : [];
  for (const row of rows) {
    if (!row?.playerName || !row?.homeTeam || !row?.awayTeam || typeof row.line !== 'number') continue;
    const rowPlayer = normalizeName(row.playerName);
    if (rowPlayer !== playerNorm) continue;
    const rowHome = normalizeTeam(row.homeTeam);
    const rowAway = normalizeTeam(row.awayTeam);
    const sameMatchup =
      (rowHome === homeNorm && rowAway === awayNorm) ||
      (rowHome === awayNorm && rowAway === homeNorm);
    if (!sameMatchup) continue;
    const delta = Math.abs((row.line || 0) - requestedLine);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestRow = row;
    }
  }
  return bestRow ? toLookupResult(bestRow, current.payload) : null;
}

export function getAflDisposalsTopPicksForGame(gameKey: string, limit = 3): AflTopGamePick[] {
  if (!gameKey) return [];
  const current = getCachedProjectionData();
  const rows = Array.isArray(current.payload?.rows) ? current.payload!.rows! : [];
  const gameRows = rows.filter((row) => String(row.gameKey ?? '').trim() === gameKey);
  const picks = selectTopRowsWithSideAnchors(gameRows, limit);
  return picks.map((row, idx) => ({
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
    rank: idx + 1,
  }));
}

export function getAflDisposalsTopPicksByGame(limitPerGame = 3): AflTopPicksGameGroup[] {
  const current = getCachedProjectionData();
  const rows = Array.isArray(current.payload?.rows) ? current.payload!.rows! : [];
  const byGame = new Map<string, AflDisposalsProjectionRow[]>();

  for (const row of rows) {
    const gameKey = String(row.gameKey ?? '').trim();
    if (!gameKey) continue;
    const list = byGame.get(gameKey);
    if (list) list.push(row);
    else byGame.set(gameKey, [row]);
  }

  const out: AflTopPicksGameGroup[] = [];
  for (const [gameKey, gameRows] of byGame.entries()) {
    let selected = selectTopRowsWithSideAnchors(gameRows, limitPerGame);
    if (selected.length === 0) {
      // Keep game visible even when no row passes recommendation thresholds.
      // Fallback to strongest model rows by absolute edge for that matchup.
      const fallbackRanked = rankedFallbackRows(gameRows);
      const cap = Math.max(1, Math.min(10, limitPerGame));
      const maxSame = TOP_PICKS_MAX_SAME_SIDE;
      const seen = new Set<string>();
      let overCt = 0;
      let underCt = 0;
      selected = [];
      for (const row of fallbackRanked) {
        if (selected.length >= cap) break;
        const key = normalizeName(String(row.playerName ?? ''));
        if (!key || seen.has(key)) continue;
        const side: 'OVER' | 'UNDER' =
          row.recommendedSide === 'OVER' || row.recommendedSide === 'UNDER'
            ? row.recommendedSide
            : ((row.expectedDisposals ?? 0) - (row.line ?? 0) >= 0 ? 'OVER' : 'UNDER');
        if (side === 'OVER' && overCt >= maxSame) continue;
        if (side === 'UNDER' && underCt >= maxSame) continue;
        seen.add(key);
        if (side === 'OVER') overCt += 1;
        else underCt += 1;
        selected.push({
          ...row,
          recommendedSide: side,
          recommendedEdge:
            typeof row.recommendedEdge === 'number' && Number.isFinite(row.recommendedEdge)
              ? row.recommendedEdge
              : Math.abs((row.expectedDisposals ?? 0) - (row.line ?? 0)),
          recommendedProb:
            typeof row.recommendedProb === 'number' && Number.isFinite(row.recommendedProb)
              ? row.recommendedProb
              : null,
        });
      }
    }
    if (selected.length === 0) continue;

    const picks: AflTopGamePick[] = [];
    for (const [idx, row] of selected.entries()) {
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
        rank: idx + 1,
      });
    }

    if (picks.length === 0) continue;
    const first = selected[0];
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
