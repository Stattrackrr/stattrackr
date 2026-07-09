import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  filterAflTopPicksHistoryRecords,
  listAflTopPicksRoundKeys,
  readAflTopPicksHistory,
  softLockTopPicksFromProjectionRows,
} from '@/lib/aflDisposalsHistory';
import { getAflDisposalsTopPicksByGame, getAflDisposalsProjectionPayloadMeta } from '@/lib/aflDisposalsModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function softLockMissingGamesFromLatestProjections(): void {
  try {
    const filePath = path.join(process.cwd(), 'data', 'afl-model', 'latest-disposals-projections.json');
    if (!fs.existsSync(filePath)) return;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      generatedAt?: string;
      modelVersion?: string;
      rows?: Array<Record<string, unknown>>;
    };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (rows.length === 0) return;
    softLockTopPicksFromProjectionRows(rows as never, {
      modelVersion: payload.modelVersion ?? null,
      projectionGeneratedAt: payload.generatedAt ?? null,
      write: true,
    });
  } catch {
    /* ignore soft-lock failures on read path */
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Keep Current-round games in history even before the dedicated snapshot cron runs.
  softLockMissingGamesFromLatestProjections();

  if (params.get('history') === '1') {
    const limitRaw = params.get('limit')?.trim() ?? '500';
    const limit = Number.parseInt(limitRaw, 10);
    const history = readAflTopPicksHistory();
    const records = filterAflTopPicksHistoryRecords(history.records, {
      weekKey: params.get('weekKey')?.trim() || null,
      roundKey: params.get('roundKey')?.trim() || null,
      gameKey: params.get('gameKey')?.trim() || null,
      playerName: params.get('playerName')?.trim() || null,
      limit: Number.isFinite(limit) ? limit : 500,
    });
    const weeks = Array.from(
      new Set(history.records.map((record) => record.weekKey).filter((weekKey): weekKey is string => Boolean(weekKey)))
    )
      .sort()
      .reverse();
    const rounds = listAflTopPicksRoundKeys(history.records);

    return NextResponse.json({
      success: true,
      count: records.length,
      totalCount: history.count,
      generatedAt: history.generatedAt,
      weeks,
      rounds,
      records,
    });
  }

  const limitRaw = params.get('limitPerGame')?.trim() ?? '3';
  const limit = Number.parseInt(limitRaw, 10);
  const groups = getAflDisposalsTopPicksByGame(Number.isFinite(limit) ? limit : 3);
  const meta = getAflDisposalsProjectionPayloadMeta();
  const history = readAflTopPicksHistory();
  const rounds = listAflTopPicksRoundKeys(history.records);
  return NextResponse.json({
    success: true,
    groups,
    count: groups.length,
    rounds,
    modelVersion: meta.modelVersion,
    generatedAt: meta.generatedAt,
  });
}

