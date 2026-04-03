import fs from 'fs';
import path from 'path';

type AflDisposalsHistoryRow = {
  snapshotKey?: string;
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

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ');
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

export function getAflDisposalsHistoryForPlayer(playerName: string, limit = 20): AflDisposalsHistoryRow[] {
  const payload = readHistoryPayload();
  const rows = Array.isArray(payload?.rows) ? payload!.rows! : [];
  if (!playerName) return [];
  const wanted = normalizeName(playerName);
  const out = rows
    .filter((row) => normalizeName(String(row.playerName ?? '')) === wanted)
    .sort((a, b) => String(b.gameDate ?? '').localeCompare(String(a.gameDate ?? '')));
  return out.slice(0, Math.max(1, Math.min(100, limit)));
}

