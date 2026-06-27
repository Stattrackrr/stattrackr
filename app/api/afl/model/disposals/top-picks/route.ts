import { NextRequest, NextResponse } from 'next/server';
import {
  filterAflTopPicksHistoryRecords,
  listAflTopPicksRoundKeys,
  readAflTopPicksHistory,
} from '@/lib/aflDisposalsHistory';
import { getAflDisposalsTopPicksByGame, getAflDisposalsProjectionPayloadMeta } from '@/lib/aflDisposalsModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
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

