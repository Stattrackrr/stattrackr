import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisDvpProfile } from '@/lib/tennis/data';
import {
  readTennisComputedCache,
  writeTennisComputedCache,
} from '@/lib/tennis/dashboardCache';
import {
  findCachedTennisDvpEvent,
  readTennisDvpLiveStore,
  tennisDvpExtraMatchesForIds,
} from '@/lib/tennis/dvpLiveCache';
import type { TennisDvpStage } from '@/lib/tennis/dvpShared';
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';
import {
  listLiveTennisEventIndex,
  tennisLiveEventPlayerIds,
  tennisLiveEventStage,
} from '@/lib/tennis/nextGame';
import {
  buildTennisPlayerMatchupAsync,
  tennisMatchupComputedKey,
  tennisMatchupPayloadUsable,
} from '@/lib/tennis/playerMatchup';
import type { TennisPlayerMatchupPayload } from '@/lib/tennis/playerMatchupShared';
import type { TennisTour } from '@/lib/tennis/types';

function isNumericTennisId(value: string | null | undefined): boolean {
  return /^\d+$/.test(String(value || '').trim());
}

async function tournamentField(opts: {
  tour: TennisTour | null;
  player: string;
  playerId: string;
  opponent: string;
  opponentId: string;
  tournament: string;
  tournamentKey: string;
  stageParam: string;
}): Promise<{ fieldIds: string[]; fieldSize: number }> {
  const live = await listLiveTennisEventIndex();
  const stage: TennisDvpStage =
    opts.stageParam === 'main' || opts.stageParam === 'qualifying'
      ? opts.stageParam
      : tennisLiveEventStage(live, {
          playerId: opts.playerId || null,
          opponentId: opts.opponentId || null,
          tournamentKey: opts.tournamentKey || null,
          tournamentName: opts.tournament || null,
        });
  const store = await readTennisDvpLiveStore();
  const cachedEvent = findCachedTennisDvpEvent(store, {
    tour: opts.tour || 'ATP',
    tournamentKey: opts.tournamentKey || null,
    tournamentName: opts.tournament || null,
    stage,
  });
  const cachedPlayers =
    cachedEvent?.windows.last10 || cachedEvent?.windows.season || cachedEvent?.windows.last5 || [];
  if (cachedEvent && cachedPlayers.length) {
    return {
      fieldIds: cachedPlayers.map((row) => row.id),
      fieldSize: cachedEvent.fieldSize || cachedPlayers.length,
    };
  }
  const extraPlayerIds = tennisLiveEventPlayerIds(
    live,
    opts.tournamentKey || null,
    opts.tournament || null,
    stage
  );
  const extraMatches = await tennisDvpExtraMatchesForIds(
    [...extraPlayerIds, opts.playerId, opts.opponentId].filter(Boolean)
  );
  const profile = tennisDvpProfile({
    tour: opts.tour || 'ATP',
    opponentName: opts.opponent || null,
    opponentId: opts.opponentId || null,
    playerName: opts.player || null,
    playerId: opts.playerId || null,
    tournamentName: opts.tournament || null,
    tournamentKey: opts.tournamentKey || null,
    stage,
    extraPlayerIds,
    extraMatches,
    liveTournamentKeys: live.keys,
    liveTournamentNames: live.names,
  });
  return {
    fieldIds: (profile.opponents || []).map((row) => row.id),
    fieldSize: profile.fieldSize || (profile.opponents || []).length,
  };
}

export async function GET(request: NextRequest) {
  const playerRaw = String(request.nextUrl.searchParams.get('player') || '').trim();
  const opponentRaw = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const playerIdRaw = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const opponentIdRaw = String(request.nextUrl.searchParams.get('opponentId') || '').trim();
  const player = isNumericTennisId(playerRaw) ? '' : playerRaw;
  const opponent = isNumericTennisId(opponentRaw) ? '' : opponentRaw;
  const playerId = playerIdRaw || (isNumericTennisId(playerRaw) ? playerRaw : '');
  const opponentId = opponentIdRaw || (isNumericTennisId(opponentRaw) ? opponentRaw : '');
  if ((!player && !playerId) || (!opponent && !opponentId)) {
    return NextResponse.json(
      { success: false, error: 'player and opponent are required' },
      { status: 400 }
    );
  }
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour | null = tourParam === 'WTA' || tourParam === 'ATP' ? tourParam : null;
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const windowRaw = Number(request.nextUrl.searchParams.get('window'));
  const windowN = Number.isFinite(windowRaw) ? Math.max(0, windowRaw) : 0;
  const bestOfParam = String(request.nextUrl.searchParams.get('bestOf') || '').trim();
  const bestOf = bestOfParam === '5' ? 5 : bestOfParam === '3' ? 3 : 'all';
  const tournament = String(request.nextUrl.searchParams.get('tournament') || '').trim();
  const tournamentKey = String(request.nextUrl.searchParams.get('tournamentKey') || '').trim();
  const stageParam = String(request.nextUrl.searchParams.get('stage') || '').trim();
  const expectField = Boolean(tournament || tournamentKey);
  const cacheKey = tennisMatchupComputedKey({
    playerId,
    playerName: player,
    opponentId,
    opponentName: opponent,
    tour,
    year,
    tournamentKey,
    tournamentName: tournament,
    stage: stageParam,
    boards: true,
  });
  const cached = await readTennisComputedCache<TennisPlayerMatchupPayload>(cacheKey);
  if (
    cached?.boards &&
    tennisMatchupPayloadUsable(cached, {
      window: windowN,
      year,
      bestOf,
      expectField,
    })
  ) {
    return NextResponse.json(cached);
  }

  await hydrateTennisOverlayLocal();
  const field = await tournamentField({
    tour,
    player,
    playerId,
    opponent,
    opponentId,
    tournament,
    tournamentKey,
    stageParam,
  });
  const payload = await buildTennisPlayerMatchupAsync({
    playerName: player || playerId,
    opponentName: opponent || opponentId,
    playerId: playerId || null,
    opponentId: opponentId || null,
    tour,
    window: windowN,
    year,
    bestOf,
    fieldIds: field.fieldIds,
    fieldSize: field.fieldSize,
  });
  const body = { success: true, ...payload };
  if (
    payload.boards &&
    tennisMatchupPayloadUsable(body, {
      window: windowN,
      year,
      bestOf,
      expectField,
    })
  ) {
    void writeTennisComputedCache(cacheKey, body);
  }
  return NextResponse.json(body);
}
