/**
 * Match-day ATP/WTA ranking overlay.
 * API-Tennis standings are current-only; weekly history is compiled by
 * scripts/cache-tennis-rankings.ts into data/tennis/rank-history.json
 * (Sackmann ranking archives, TML official ATP CSVs, ATP weeks API,
 * Tennis Explorer, current standings dated to the ranking-week Monday).
 */

import fs from 'fs';
import path from 'path';
import type { TennisMatchRow } from '@/lib/tennis/types';

export type TennisRankPoint = { rank: number; points: number | null };

export type TennisRankHistoryCache = {
  fetchedAt: string;
  source: string;
  mapped: number;
  byPlayerId: Record<string, number[]>;
};

type RankRuntime = {
  file: TennisRankHistoryCache | null;
  mtime: number;
};

function rankRuntime(): RankRuntime {
  const g = globalThis as typeof globalThis & { __tennisRanks?: RankRuntime };
  if (!g.__tennisRanks) g.__tennisRanks = { file: null, mtime: 0 };
  return g.__tennisRanks;
}

export function tennisRankHistoryPath(): string {
  return path.join(process.cwd(), 'data', 'tennis', 'rank-history.json');
}

export function tennisRankHistoryMtime(): number {
  try {
    return fs.statSync(tennisRankHistoryPath()).mtimeMs;
  } catch {
    return 0;
  }
}

function loadRankHistory(): TennisRankHistoryCache | null {
  const runtime = rankRuntime();
  const file = tennisRankHistoryPath();
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  if (runtime.file && runtime.mtime === mtime) return runtime.file;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TennisRankHistoryCache;
    if (!parsed?.byPlayerId) return null;
    runtime.file = parsed;
    runtime.mtime = mtime;
    return parsed;
  } catch {
    return null;
  }
}

function dateToInt(date: string | null | undefined): number | null {
  const digits = String(date || '').replace(/-/g, '').slice(0, 8);
  if (!/^\d{8}$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function tennisRankOnDate(playerId: string, date: string | null | undefined): TennisRankPoint | null {
  const day = dateToInt(date);
  if (!playerId || day == null) return null;
  const series = loadRankHistory()?.byPlayerId?.[playerId];
  if (!series?.length) return null;
  let lo = 0;
  let hi = Math.floor(series.length / 3) - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = series[mid * 3];
    if (d <= day) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const rank = series[best * 3 + 1];
  const points = series[best * 3 + 2];
  if (!Number.isFinite(rank) || rank <= 0) return null;
  return { rank, points: Number.isFinite(points) && points > 0 ? points : null };
}

export function hasTennisRankHistory(): boolean {
  return loadRankHistory() != null;
}

export function withTennisMatchDayRanks(row: TennisMatchRow): TennisMatchRow {
  if (!hasTennisRankHistory()) return row;
  const mine = tennisRankOnDate(row.playerId, row.date);
  const opp = tennisRankOnDate(row.opponentId, row.date);
  return {
    ...row,
    playerRank: mine?.rank ?? null,
    rankPoints: mine?.points ?? null,
    opponentRank: opp?.rank ?? null,
    opponentRankPoints: opp?.points ?? null,
  };
}
