import fs from 'fs';
import path from 'path';
import type { AflTopGamePick } from './aflDisposalsModel';

type AflDisposalsHistoryRow = {
  snapshotKey?: string;
  capturedAt?: string;
  gameDate?: string;
  commenceTime?: string | null;
  weekKey?: string;
  playerName?: string;
  homeTeam?: string;
  awayTeam?: string;
  playerTeam?: string;
  opponentTeam?: string;
  bookmaker?: string;
  line?: number;
  overOdds?: string | null;
  underOdds?: string | null;
  modelExpectedDisposals?: number | null;
  modelEdge?: number | null;
  actualDisposals?: number | null;
  actualTog?: number | null;
  differenceLine?: number | null;
  differenceModel?: number | null;
  resultColor?: 'green' | 'red' | null;
};

type AflDisposalsHistoryPayload = {
  generatedAt?: string;
  count?: number;
  rows?: AflDisposalsHistoryRow[];
};

type AflDisposalsProjectionPayload = {
  generatedAt?: string;
  modelVersion?: string;
  rows?: Array<{
    playerName?: string;
    commenceTime?: string | null;
    bookmaker?: string;
    line?: number;
    overOdds?: string | null;
    underOdds?: string | null;
    expectedDisposals?: number | null;
  }>;
};

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeBookmaker(value: string): string {
  return normalizeName(value).replace(/\s+/g, '');
}

function normalizeLine(value: unknown): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n.toFixed(1) : '';
}

function buildRowKey(playerName: string, gameDate: string, bookmaker: string, line: unknown): string {
  return [
    normalizeName(playerName),
    String(gameDate ?? '').trim(),
    normalizeBookmaker(bookmaker),
    normalizeLine(line),
  ].join('|');
}

function readHistoryPayload(): AflDisposalsHistoryPayload | null {
  const filePath = path.join(process.cwd(), 'data', 'afl-model', 'history', 'disposals-line-history.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as AflDisposalsHistoryPayload;
  } catch {
    return null;
  }
}

function readProjectionPayload(filePath: string): AflDisposalsProjectionPayload | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as AflDisposalsProjectionPayload;
  } catch {
    return null;
  }
}

function readProjectionPayloads(): AflDisposalsProjectionPayload[] {
  const baseDir = path.join(process.cwd(), 'data', 'afl-model');
  const out: AflDisposalsProjectionPayload[] = [];

  const latestPath = path.join(baseDir, 'latest-disposals-projections.json');
  const latest = readProjectionPayload(latestPath);
  if (latest) out.push(latest);

  const projectionsDir = path.join(baseDir, 'projections');
  if (!fs.existsSync(projectionsDir)) return out;
  let files: string[] = [];
  try {
    files = fs.readdirSync(projectionsDir)
      .filter((name) => /^disposals-projections-.*\.json$/i.test(name))
      .sort()
      .reverse(); // newest first
  } catch {
    return out;
  }
  for (const name of files) {
    const payload = readProjectionPayload(path.join(projectionsDir, name));
    if (payload) out.push(payload);
  }
  return out;
}

function buildProjectionMap(): Map<string, NonNullable<AflDisposalsProjectionPayload['rows']>[number]> {
  const map = new Map<string, NonNullable<AflDisposalsProjectionPayload['rows']>[number]>();
  const payloads = readProjectionPayloads();
  for (const payload of payloads) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    for (const row of rows) {
      const playerName = String(row?.playerName ?? '').trim();
      const gameDate = String(row?.commenceTime ?? '').slice(0, 10);
      const bookmaker = String(row?.bookmaker ?? '').trim();
      if (!playerName || !gameDate || !bookmaker) continue;
      const key = buildRowKey(playerName, gameDate, bookmaker, row?.line);
      if (!key || map.has(key)) continue;
      map.set(key, row);
    }
  }
  return map;
}

function sortHistoryRows(rows: AflDisposalsHistoryRow[]): AflDisposalsHistoryRow[] {
  return [...rows].sort((a, b) => {
    const aDate = String(a.gameDate ?? '');
    const bDate = String(b.gameDate ?? '');
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return String(a.playerName ?? '').localeCompare(String(b.playerName ?? ''));
  });
}

function enrichRowsWithOdds(rows: AflDisposalsHistoryRow[]): AflDisposalsHistoryRow[] {
  const projectionMap = buildProjectionMap();
  return rows.map((row) => {
    const key = buildRowKey(
      String(row.playerName ?? ''),
      String(row.gameDate ?? ''),
      String(row.bookmaker ?? ''),
      row.line
    );
    const projection = projectionMap.get(key);
    const overOdds = row.overOdds ?? projection?.overOdds ?? null;
    const underOdds = row.underOdds ?? projection?.underOdds ?? null;
    const modelExpectedDisposals =
      row.modelExpectedDisposals ??
      (typeof projection?.expectedDisposals === 'number' && Number.isFinite(projection.expectedDisposals)
        ? projection.expectedDisposals
        : null);
    return {
      ...row,
      overOdds,
      underOdds,
      modelExpectedDisposals,
    };
  });
}

export function getAflDisposalsHistory(limit = 500): AflDisposalsHistoryRow[] {
  const payload = readHistoryPayload();
  const rows = Array.isArray(payload?.rows) ? payload!.rows! : [];
  const enriched = enrichRowsWithOdds(sortHistoryRows(rows));
  return enriched.slice(0, Math.max(1, Math.min(2000, limit)));
}

export function getAflDisposalsHistoryMeta(): { generatedAt: string | null; count: number } {
  const payload = readHistoryPayload();
  const rows = Array.isArray(payload?.rows) ? payload!.rows! : [];
  return {
    generatedAt: payload?.generatedAt ?? null,
    count: rows.length,
  };
}

export function getAflDisposalsHistoryForPlayer(playerName: string, limit = 20): AflDisposalsHistoryRow[] {
  if (!playerName) return [];
  const wanted = normalizeName(playerName);
  const rows = getAflDisposalsHistory(2000);
  const out = rows.filter((row) => normalizeName(String(row.playerName ?? '')) === wanted);
  return out.slice(0, Math.max(1, Math.min(100, limit)));
}

export type AflTopPickSnapshotRecord = {
  gameKey: string;
  finalizedAt: string;
  windowHours: number;
  projectionGeneratedAt: string | null;
  modelVersion: string | null;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string | null;
  weekKey: string | null;
  roundKey: string | null;
  picks: AflTopGamePick[];
};

export type AflTopPickSnapshotPayload = {
  generatedAt: string;
  count: number;
  records: AflTopPickSnapshotRecord[];
};

export const AFL_TOP_PICKS_HISTORY_PATH = path.join(
  process.cwd(),
  'data',
  'afl-model',
  'history',
  'top-picks-history.json'
);

const AFL_TOP_PICKS_BACKFILL_PATH = path.join(
  process.cwd(),
  'data',
  'afl-model',
  'history',
  'backfill-week-2026-06-13.json'
);

type AflTopPicksBackfillRecord = {
  gameKey?: string;
  gameDate?: string;
  finalizedAt?: string;
  windowHours?: number | string;
  projectionGeneratedAt?: string | null;
  modelVersion?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  commenceTime?: string | null;
  weekKey?: string | null;
  roundKey?: string | null;
  picks?: Array<{
    playerName?: string;
    bookmaker?: string | null;
    line?: number | string | null;
    expectedDisposals?: number | string | null;
    side?: string | null;
    recommendedSide?: string | null;
    edge?: number | string | null;
    recommendedEdge?: number | string | null;
    probability?: number | string | null;
    recommendedProb?: number | string | null;
    rank?: number | string | null;
    actualDisposals?: number | string | null;
  }>;
};

function readJsonFileAnyEncoding(filePath: string): unknown {
  const raw = fs.readFileSync(filePath);
  let text: string;
  const looksUtf16Le =
    (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) ||
    (raw.length >= 4 && raw[1] === 0 && raw[3] === 0 && (raw[0] === 0x7b || raw[0] === 0x5b || raw[0] === 0x22));
  if (looksUtf16Le) {
    text = raw.toString('utf16le').replace(/^\uFEFF/, '');
  } else if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const body = raw.subarray(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i < body.length - 1; i += 2) {
      swapped[i] = body[i + 1]!;
      swapped[i + 1] = body[i]!;
    }
    text = swapped.toString('utf16le');
  } else {
    text = raw.toString('utf8').replace(/^\uFEFF/, '');
  }
  return JSON.parse(text);
}

function parseTopPicksNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\+/, '').replace(/%$/, '');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTopPicksRate(value: unknown): number | null {
  const parsed = parseTopPicksNumber(value);
  if (parsed == null) return null;
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

function parseTopPicksSide(value: unknown): 'OVER' | 'UNDER' | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'OVER' || raw === 'O') return 'OVER';
  if (raw === 'UNDER' || raw === 'U') return 'UNDER';
  return null;
}

function readBackfillTopPicksRecords(): AflTopPickSnapshotRecord[] {
  if (!fs.existsSync(AFL_TOP_PICKS_BACKFILL_PATH)) return [];
  try {
    const parsed = readJsonFileAnyEncoding(AFL_TOP_PICKS_BACKFILL_PATH);
    const rows = Array.isArray(parsed) ? (parsed as AflTopPicksBackfillRecord[]) : [];
    return rows.map((record) => {
      const homeTeam = String(record.homeTeam ?? '').trim();
      const awayTeam = String(record.awayTeam ?? '').trim();
      const commenceTime = record.commenceTime != null ? String(record.commenceTime) : record.gameDate ?? null;
      const gameKey = String(record.gameKey ?? '').trim() || buildAflTopPicksGameKey(homeTeam, awayTeam, commenceTime);
      const picks = (record.picks ?? []).map((pick, idx) => ({
        playerName: String(pick.playerName ?? '').trim(),
        bookmaker: pick.bookmaker != null ? String(pick.bookmaker).trim() : null,
        line: parseTopPicksNumber(pick.line),
        expectedDisposals: parseTopPicksNumber(pick.expectedDisposals),
        recommendedSide: parseTopPicksSide(pick.recommendedSide ?? pick.side),
        recommendedEdge: parseTopPicksRate(pick.recommendedEdge ?? pick.edge),
        recommendedProb: parseTopPicksRate(pick.recommendedProb ?? pick.probability),
        rank: parseTopPicksNumber(pick.rank) ?? idx + 1,
        actualDisposals: parseTopPicksNumber(pick.actualDisposals),
      }));
      return normalizeAflTopPickSnapshotRecord({
        gameKey,
        finalizedAt: record.finalizedAt ?? new Date().toISOString(),
        windowHours: parseTopPicksNumber(record.windowHours) ?? 2,
        projectionGeneratedAt: record.projectionGeneratedAt ?? null,
        modelVersion: record.modelVersion ?? 'manual-backfill',
        homeTeam,
        awayTeam,
        commenceTime,
        weekKey: record.weekKey ?? aflTopPicksWeekKeyFromCommenceTime(commenceTime),
        roundKey: record.roundKey ?? null,
        picks,
      });
    });
  } catch {
    return [];
  }
}

function loadTopPicksHistoryRecords(): AflTopPickSnapshotRecord[] {
  if (fs.existsSync(AFL_TOP_PICKS_HISTORY_PATH)) {
    try {
      const parsed = readJsonFileAnyEncoding(AFL_TOP_PICKS_HISTORY_PATH) as AflTopPickSnapshotPayload;
      const records = Array.isArray(parsed.records)
        ? parsed.records.map((record) => normalizeAflTopPickSnapshotRecord(record))
        : [];
      if (records.length > 0) return sortAflTopPickSnapshotRecords(records);
    } catch {
      // fall through
    }
  }

  const backfillRecords = readBackfillTopPicksRecords();
  if (backfillRecords.length > 0) {
    const sorted = sortAflTopPickSnapshotRecords(backfillRecords);
    writeAflTopPicksHistory(sorted);
    return sorted;
  }

  return [];
}

function normalizeTopPicksTeam(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function topPicksIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function buildAflTopPicksGameKey(homeTeam: string, awayTeam: string, commenceTimeOrDate: string | null): string {
  const datePart = String(commenceTimeOrDate ?? '').slice(0, 10);
  return `${normalizeTopPicksTeam(homeTeam)}|${normalizeTopPicksTeam(awayTeam)}|${datePart}`;
}

export function aflTopPicksWeekKeyFromCommenceTime(commenceTime: string | null): string | null {
  if (!commenceTime) return null;
  const parsed = new Date(commenceTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return topPicksIsoWeekKey(parsed);
}

export function parseAflTopPicksRoundKey(roundKey: string | null | undefined): { season: number; round: number } | null {
  const match = String(roundKey ?? '').trim().match(/^(\d{4})-R(\d{1,2})$/i);
  if (!match) return null;
  const season = Number.parseInt(match[1], 10);
  const round = Number.parseInt(match[2], 10);
  if (!Number.isFinite(season) || !Number.isFinite(round)) return null;
  return { season, round };
}

export function sortAflTopPicksRoundKeys(roundKeys: string[]): string[] {
  return [...roundKeys].sort((a, b) => {
    const ar = parseAflTopPicksRoundKey(a);
    const br = parseAflTopPicksRoundKey(b);
    if (!ar && !br) return a.localeCompare(b);
    if (!ar) return 1;
    if (!br) return -1;
    if (ar.season !== br.season) return ar.season - br.season;
    return ar.round - br.round;
  });
}

export function listAflTopPicksRoundKeys(records: AflTopPickSnapshotRecord[]): string[] {
  return sortAflTopPicksRoundKeys(
    Array.from(new Set(records.map((record) => record.roundKey).filter((roundKey): roundKey is string => Boolean(roundKey))))
  );
}

export function normalizeAflTopPickSnapshotRecord(
  record: Omit<Partial<AflTopPickSnapshotRecord>, 'picks'> & { picks?: Partial<AflTopGamePick>[] }
): AflTopPickSnapshotRecord {
  const homeTeam = String(record.homeTeam ?? '').trim();
  const awayTeam = String(record.awayTeam ?? '').trim();
  const commenceTime = record.commenceTime != null ? String(record.commenceTime) : null;
  const gameKey = String(record.gameKey ?? '').trim() || buildAflTopPicksGameKey(homeTeam, awayTeam, commenceTime);
  const weekKey = record.weekKey ?? aflTopPicksWeekKeyFromCommenceTime(commenceTime);
  const roundKey = record.roundKey != null ? String(record.roundKey).trim() || null : null;
  const picks = (record.picks ?? []).slice(0, 3).map((pick, idx) => ({
    playerName: String(pick.playerName ?? '').trim(),
    bookmaker: pick.bookmaker != null ? String(pick.bookmaker) : null,
    line: typeof pick.line === 'number' && Number.isFinite(pick.line) ? pick.line : null,
    expectedDisposals:
      typeof pick.expectedDisposals === 'number' && Number.isFinite(pick.expectedDisposals)
        ? pick.expectedDisposals
        : null,
    recommendedSide: pick.recommendedSide === 'OVER' || pick.recommendedSide === 'UNDER' ? pick.recommendedSide : null,
    recommendedEdge:
      typeof pick.recommendedEdge === 'number' && Number.isFinite(pick.recommendedEdge) ? pick.recommendedEdge : null,
    recommendedProb:
      typeof pick.recommendedProb === 'number' && Number.isFinite(pick.recommendedProb) ? pick.recommendedProb : null,
    rank: typeof pick.rank === 'number' && Number.isFinite(pick.rank) ? pick.rank : idx + 1,
    actualDisposals:
      typeof pick.actualDisposals === 'number' && Number.isFinite(pick.actualDisposals) ? pick.actualDisposals : null,
  }));

  return {
    gameKey,
    finalizedAt: record.finalizedAt ?? new Date().toISOString(),
    windowHours: typeof record.windowHours === 'number' && Number.isFinite(record.windowHours) ? record.windowHours : 2,
    projectionGeneratedAt: record.projectionGeneratedAt ?? null,
    modelVersion: record.modelVersion ?? null,
    homeTeam,
    awayTeam,
    commenceTime,
    weekKey,
    roundKey,
    picks,
  };
}

function sortAflTopPickSnapshotRecords(records: AflTopPickSnapshotRecord[]): AflTopPickSnapshotRecord[] {
  return [...records].sort((a, b) => {
    const ac = String(a.commenceTime ?? '');
    const bc = String(b.commenceTime ?? '');
    if (ac !== bc) return ac.localeCompare(bc);
    return a.gameKey.localeCompare(b.gameKey);
  });
}

export function readAflTopPicksHistory(): AflTopPickSnapshotPayload {
  const records = loadTopPicksHistoryRecords();
  return {
    generatedAt: new Date().toISOString(),
    count: records.length,
    records,
  };
}

export function writeAflTopPicksHistory(records: AflTopPickSnapshotRecord[], generatedAt = new Date().toISOString()): void {
  const sorted = sortAflTopPickSnapshotRecords(records);
  fs.mkdirSync(path.dirname(AFL_TOP_PICKS_HISTORY_PATH), { recursive: true });
  fs.writeFileSync(
    AFL_TOP_PICKS_HISTORY_PATH,
    `${JSON.stringify({ generatedAt, count: sorted.length, records: sorted }, null, 2)}\n`
  );
}

export function upsertAflTopPicksHistoryRecords(
  incomingRecords: AflTopPickSnapshotRecord[],
  opts: { force?: boolean; generatedAt?: string } = {}
): { added: number; replaced: number; skipped: number; records: AflTopPickSnapshotRecord[] } {
  const history = readAflTopPicksHistory();
  const byGame = new Map(history.records.map((record) => [record.gameKey, record]));
  let added = 0;
  let replaced = 0;
  let skipped = 0;

  for (const record of incomingRecords) {
    const normalized = normalizeAflTopPickSnapshotRecord(record);
    if (!normalized.gameKey) continue;
    if (byGame.has(normalized.gameKey) && !opts.force) {
      skipped += 1;
      continue;
    }
    if (byGame.has(normalized.gameKey)) replaced += 1;
    else added += 1;
    byGame.set(normalized.gameKey, normalized);
  }

  const records = sortAflTopPickSnapshotRecords([...byGame.values()]);
  if (added > 0 || replaced > 0) {
    writeAflTopPicksHistory(records, opts.generatedAt);
  }
  return { added, replaced, skipped, records };
}

export function filterAflTopPicksHistory(opts: {
  weekKey?: string | null;
  roundKey?: string | null;
  gameKey?: string | null;
  playerName?: string | null;
  limit?: number;
} = {}): AflTopPickSnapshotRecord[] {
  const history = readAflTopPicksHistory();
  const player = String(opts.playerName ?? '').trim().toLowerCase();
  const rows = history.records.filter((record) => {
    if (opts.weekKey && record.weekKey !== opts.weekKey) return false;
    if (opts.roundKey && record.roundKey !== opts.roundKey) return false;
    if (opts.gameKey && record.gameKey !== opts.gameKey) return false;
    if (player && !record.picks.some((pick) => pick.playerName.toLowerCase() === player)) return false;
    return true;
  });
  return rows.slice(0, Math.max(1, Math.min(opts.limit ?? 500, 2000)));
}

