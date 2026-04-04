import fs from 'fs';
import path from 'path';

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

