import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisDvpProfile, type TennisTour } from '@/lib/tennis/data';
import { TENNIS_DVP_METRICS, type TennisDvpStage, type TennisDvpWindow } from '@/lib/tennis/dvpShared';
import {
  findCachedTennisDvpEvent,
  readTennisDvpLiveStore,
  tennisCachedDvpPlayerHasSample,
  tennisDvpExtraMatchesForIds,
  type TennisCachedDvpPlayer,
} from '@/lib/tennis/dvpLiveCache';
import { hydrateTennisOverlayLocal } from '@/lib/tennis/ingest';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import {
  listLiveTennisEventIndex,
  tennisLiveEventPlayerIds,
  tennisLiveEventStage,
} from '@/lib/tennis/nextGame';

function isNumericTennisId(value: string | null | undefined): boolean {
  return /^\d+$/.test(String(value || '').trim());
}

function humanTennisName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name && !isNumericTennisId(name)) return name;
  }
  return '';
}

function findCachedDvpPlayer(
  players: TennisCachedDvpPlayer[],
  opponentId: string,
  opponentName: string
): TennisCachedDvpPlayer | null {
  if (opponentId) {
    const byId = players.find((row) => row.id === opponentId);
    if (byId) return byId;
  }
  const name = opponentName.trim();
  if (!name) return null;
  const exact = players.find(
    (row) => humanTennisName(row.name).toLowerCase() === name.toLowerCase()
  );
  if (exact) return exact;
  const identity = players.filter(
    (row) => tennisIdentityMatch(row.name, name) && !isNumericTennisId(row.name)
  );
  if (identity.length === 1) return identity[0];
  const last = name.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length < 3) return null;
  const lastHits = players.filter((row) => {
    const label = humanTennisName(row.name);
    if (!label) return false;
    return label.toLowerCase().split(/\s+/).pop() === last.toLowerCase();
  });
  return lastHits.length === 1 ? lastHits[0] : null;
}

export async function GET(request: NextRequest) {
  const overlay = await hydrateTennisOverlayLocal();
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
  const opponentRaw = String(request.nextUrl.searchParams.get('opponent') || '').trim();
  const opponentIdRaw = String(request.nextUrl.searchParams.get('opponentId') || '').trim();
  const opponent = isNumericTennisId(opponentRaw) ? '' : opponentRaw;
  const opponentId = opponentIdRaw || (isNumericTennisId(opponentRaw) ? opponentRaw : '');
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
  const overlayAt = overlay?.fetchedAt || '';
  const storeStale = Boolean(
    overlayAt && store?.builtAt && Date.parse(store.builtAt) < Date.parse(overlayAt)
  );
  const cachedEvent = storeStale
    ? null
    : findCachedTennisDvpEvent(store, {
        tour,
        tournamentKey: tournamentKey || null,
        tournamentName: tournament || null,
        stage,
      });
  const cachedPlayers = cachedEvent?.windows[window] || cachedEvent?.windows.last10 || [];
  const cachedPlayer = findCachedDvpPlayer(cachedPlayers, opponentId, opponent);
  const cachedUsable =
    Boolean(cachedEvent) &&
    (cachedPlayer
      ? tennisCachedDvpPlayerHasSample(cachedPlayer) &&
        Boolean(humanTennisName(cachedPlayer.name, opponent))
      : !opponent && !opponentId);
  if (cachedEvent && cachedUsable) {
    const selectedName = cachedPlayer
      ? humanTennisName(cachedPlayer.name, cachedPlayer.id === opponentId ? opponent : null) ||
        cachedPlayer.name
      : '';
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
            name: humanTennisName(cachedEvent.topSeed.name) || cachedEvent.topSeed.name,
            ioc: cachedEvent.topSeed.ioc,
            rankPos: cachedEvent.topSeed.rankPos,
            seed: cachedEvent.topSeed.seed ?? 1,
            drawRank: cachedEvent.topSeed.drawRank ?? 1,
          }
        : cachedPlayers.find((row) => row.seed === 1) || null,
      opponent: cachedPlayer
        ? {
            id: cachedPlayer.id,
            name: selectedName,
            ioc: cachedPlayer.ioc,
            rankPos: cachedPlayer.rankPos,
            seed: cachedPlayer.seed ?? null,
            drawRank: cachedPlayer.drawRank ?? null,
          }
        : null,
      opponents: cachedPlayers.map((row) => ({
        id: row.id,
        name: humanTennisName(row.name) || row.name,
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

  const liveIds = tennisLiveEventPlayerIds(live, tournamentKey || null, tournament || null, stage);
  const extraPlayerIds =
    opponent || opponentId
      ? [
          ...new Set(
            [...liveIds, playerId, opponentId]
              .map((id) => String(id || '').trim())
              .filter((id) => /^\d+$/.test(id))
          ),
        ]
      : liveIds;
  const extraMatches = await tennisDvpExtraMatchesForIds(extraPlayerIds);
  const profile = tennisDvpProfile({
    tour,
    year,
    opponentName: opponent || null,
    opponentId: opponentId || null,
    playerName: player || null,
    playerId: playerId || null,
    tournamentName: tournament || null,
    tournamentKey: tournamentKey || null,
    window,
    stage,
    extraPlayerIds,
    extraMatches,
    liveTournamentKeys: live.keys,
    liveTournamentNames: live.names,
  });
  return NextResponse.json({ success: true, ...profile });
}
