import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisDvpProfile, type TennisTour } from '@/lib/tennis/data';
import { TENNIS_DVP_METRICS, type TennisDvpStage, type TennisDvpWindow } from '@/lib/tennis/dvpShared';
import { findCachedTennisDvpEvent, readTennisDvpLiveStore } from '@/lib/tennis/dvpLiveCache';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';
import {
  listLiveTennisEventIndex,
  tennisLiveEventPlayerIds,
  tennisLiveEventStage,
} from '@/lib/tennis/nextGame';

export async function GET(request: NextRequest) {
  await hydrateTennisMatchOverlay();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const opponent = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const opponentId = String(request.nextUrl.searchParams.get('opponentId') || '').trim();
  const player = String(request.nextUrl.searchParams.get('player') || '').trim();
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const tournament = String(request.nextUrl.searchParams.get('tournament') || '').trim();
  const tournamentKey = String(request.nextUrl.searchParams.get('tournamentKey') || '').trim();
  const windowRaw = String(request.nextUrl.searchParams.get('window') || '').trim();
  const window: TennisDvpWindow =
    windowRaw === 'last5' || windowRaw === 'season' ? windowRaw : 'last10';
  const live = await listLiveTennisEventIndex();
  const stageParam = String(request.nextUrl.searchParams.get('stage') || '').trim();
  const stage: TennisDvpStage =
    stageParam === 'main' || stageParam === 'qualifying'
      ? stageParam
      : tennisLiveEventStage(live, {
          playerId: playerId || null,
          opponentId: opponentId || null,
          tournamentKey: tournamentKey || null,
          tournamentName: tournament || null,
        });

  const store = await readTennisDvpLiveStore();
  const cachedEvent = findCachedTennisDvpEvent(store, {
    tour,
    tournamentKey: tournamentKey || null,
    tournamentName: tournament || null,
    stage,
  });
  const cachedPlayers = cachedEvent?.windows[window] || cachedEvent?.windows.last10 || [];
  const name = opponent.toLowerCase();
  const last = name.split(/\s+/).filter(Boolean).pop() || '';
  const cachedPlayer =
    (opponentId ? cachedPlayers.find((row) => row.id === opponentId) : null) ||
    (name ? cachedPlayers.find((row) => row.name.toLowerCase() === name) : null) ||
    (last.length >= 3
      ? cachedPlayers.find((row) => row.name.toLowerCase().split(/\s+/).pop() === last)
      : null);
  if (cachedEvent && (cachedPlayer || (!opponent && !opponentId))) {
    return NextResponse.json({
      success: true,
      tour,
      year,
      window,
      stage: cachedEvent.stage || stage,
      tournamentName: cachedEvent.tournamentName,
      tournamentKey: cachedEvent.tournamentKey,
      fieldSize: cachedEvent.fieldSize,
      topSeed: cachedEvent.topSeed
        ? {
            id: cachedEvent.topSeed.id,
            name: cachedEvent.topSeed.name,
            ioc: cachedEvent.topSeed.ioc,
            rankPos: cachedEvent.topSeed.rankPos,
            seed: cachedEvent.topSeed.seed ?? 1,
            drawRank: cachedEvent.topSeed.drawRank ?? 1,
          }
        : cachedPlayers.find((row) => row.seed === 1) || null,
      opponent: cachedPlayer
        ? {
            id: cachedPlayer.id,
            name: cachedPlayer.name,
            ioc: cachedPlayer.ioc,
            rankPos: cachedPlayer.rankPos,
            seed: cachedPlayer.seed ?? null,
            drawRank: cachedPlayer.drawRank ?? null,
          }
        : null,
      opponents: cachedPlayers.map((row) => ({
        id: row.id,
        name: row.name,
        ioc: row.ioc,
        rankPos: row.rankPos,
        seed: row.seed ?? null,
        drawRank: row.drawRank ?? null,
      })),
      metrics: cachedPlayer?.metrics?.length
        ? cachedPlayer.metrics
        : TENNIS_DVP_METRICS.map((metric) => ({
            key: metric.key,
            label: metric.label,
            pct: metric.pct,
            value: null,
            rank: null,
            matches: 0,
            fieldSize: cachedEvent.fieldSize,
          })),
    });
  }

  const extraPlayerIds = tennisLiveEventPlayerIds(live, tournamentKey || null, tournament || null, stage);
  const profile = tennisDvpProfile({
    tour,
    year,
    opponentName: opponent,
    opponentId: opponentId || null,
    playerName: player || null,
    playerId: playerId || null,
    tournamentName: tournament || null,
    tournamentKey: tournamentKey || null,
    window,
    stage,
    extraPlayerIds,
    liveTournamentKeys: live.keys,
    liveTournamentNames: live.names,
  });
  return NextResponse.json({ success: true, ...profile });
}
