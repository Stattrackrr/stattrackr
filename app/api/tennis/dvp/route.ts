import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisDvpProfile, loadTennisPlayers, type TennisTour } from '@/lib/tennis/data';
import {
  TENNIS_DVP_METRICS,
  TENNIS_DVP_WINDOWS,
  type TennisDvpStage,
  type TennisDvpWindow,
} from '@/lib/tennis/dvpShared';
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

function slimDvpPlayer(row: TennisCachedDvpPlayer, opponentId: string, opponentName: string): TennisCachedDvpPlayer {
  return {
    id: row.id,
    name: humanTennisName(row.name, row.id === opponentId ? opponentName : null) || row.name,
    ioc: row.ioc,
    rankPos: row.rankPos,
    seed: row.seed ?? null,
    drawRank: row.drawRank ?? null,
    metrics: row.metrics || [],
  };
}

function windowsFromCache(
  event: NonNullable<ReturnType<typeof findCachedTennisDvpEvent>>,
  opponentId: string,
  opponentName: string
): Record<TennisDvpWindow, TennisCachedDvpPlayer[]> {
  const out = {} as Record<TennisDvpWindow, TennisCachedDvpPlayer[]>;
  for (const window of TENNIS_DVP_WINDOWS) {
    out[window] = (event.windows[window] || event.windows.last10 || []).map((row) =>
      slimDvpPlayer(row, opponentId, opponentName)
    );
  }
  return out;
}

function eventHasSample(
  event: NonNullable<ReturnType<typeof findCachedTennisDvpEvent>>
): boolean {
  return TENNIS_DVP_WINDOWS.some((window) =>
    (event.windows[window] || []).some((row) => tennisCachedDvpPlayerHasSample(row))
  );
}

function namesAgree(idName: string | null | undefined, opponentName: string): boolean {
  const label = humanTennisName(idName);
  const name = opponentName.trim();
  if (!label || !name) return false;
  if (label.toLowerCase() === name.toLowerCase()) return true;
  if (tennisIdentityMatch(label, name)) return true;
  const last = name.split(/\s+/).filter(Boolean).pop()?.toLowerCase() || '';
  const idLast = label.split(/\s+/).filter(Boolean).pop()?.toLowerCase() || '';
  return last.length >= 3 && idLast === last;
}

function reconcileOpponentId(
  opponentId: string,
  opponentName: string,
  field: TennisCachedDvpPlayer[]
): string {
  const id = opponentId.trim();
  const name = opponentName.trim();
  const byId = id ? field.find((row) => row.id === id) : null;
  if (id && byId && (!name || namesAgree(byId.name, name))) return id;
  const byName = name ? findCachedDvpPlayer(field, '', name) : null;
  if (byName?.id) return byName.id;
  if (!name) return id;
  const roster = loadTennisPlayers();
  const rosterById = id ? roster.find((player) => player.playerId === id) : null;
  if (rosterById && namesAgree(rosterById.name, name)) return id;
  const exact = roster.filter((player) => player.name.toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return exact[0].playerId;
  const identity = roster.filter((player) => tennisIdentityMatch(player.name, name));
  if (identity.length === 1) return identity[0].playerId;
  const last = name.split(/\s+/).filter(Boolean).pop()?.toLowerCase() || '';
  if (last.length >= 3) {
    const lastHits = roster.filter(
      (player) => player.name.toLowerCase().split(/\s+/).pop() === last
    );
    if (lastHits.length === 1) return lastHits[0].playerId;
  }
  return byName?.id || '';
}

function findCachedDvpPlayer(
  players: TennisCachedDvpPlayer[],
  opponentId: string,
  opponentName: string
): TennisCachedDvpPlayer | null {
  if (opponentId) {
    const byId = players.find((row) => row.id === opponentId);
    if (byId && (!opponentName.trim() || namesAgree(byId.name, opponentName))) return byId;
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
  let opponentId = opponentIdRaw || (isNumericTennisId(opponentRaw) ? opponentRaw : '');
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
  opponentId = reconcileOpponentId(opponentId, opponent, cachedPlayers);
  const cachedSelected = cachedEvent
    ? findCachedDvpPlayer(cachedPlayers, opponentId, opponent)
    : null;
  const selectedCachedSample = tennisCachedDvpPlayerHasSample(cachedSelected);
  if (
    cachedEvent &&
    eventHasSample(cachedEvent) &&
    ((!opponent && !opponentId) || selectedCachedSample)
  ) {
    const windows = windowsFromCache(cachedEvent, opponentId, opponent);
    const field = windows[window] || windows.last10;
    const selected = findCachedDvpPlayer(field, opponentId, opponent) || cachedSelected;
    const selectedName = selected
      ? humanTennisName(selected.name, selected.id === opponentId ? opponent : null) || selected.name
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
        : field.find((row) => row.seed === 1) || null,
      opponent: selected
        ? {
            id: selected.id,
            name: selectedName,
            ioc: selected.ioc,
            rankPos: selected.rankPos,
            seed: selected.seed ?? null,
            drawRank: selected.drawRank ?? null,
          }
        : null,
      opponents: field.map((row) => ({
        id: row.id,
        name: row.name,
        ioc: row.ioc,
        rankPos: row.rankPos,
        seed: row.seed ?? null,
        drawRank: row.drawRank ?? null,
      })),
      metrics: selected?.metrics?.length
        ? selected.metrics
        : TENNIS_DVP_METRICS.map((metric) => ({
            key: metric.key,
            label: metric.label,
            pct: metric.pct,
            value: null,
            rank: null,
            matches: 0,
            fieldSize: cachedEvent.fieldSize,
          })),
      windows,
    });
  }

  const liveIds = tennisLiveEventPlayerIds(live, tournamentKey || null, tournament || null, stage);
  const cachedFieldIds = cachedEvent
    ? (cachedEvent.windows.last10 || cachedEvent.windows.season || cachedEvent.windows.last5 || []).map(
        (row) => row.id
      )
    : [];
  const extraPlayerIds = [
    ...new Set(
      [...liveIds, ...cachedFieldIds, playerId, opponentId, cachedSelected?.id || '']
        .map((id) => String(id || '').trim())
        .filter((id) => /^\d+$/.test(id))
    ),
  ];
  const resolvedOpponentId = opponentId || cachedSelected?.id || '';
  const extraMatchIds = [
    ...new Set(
      [resolvedOpponentId, opponentId, playerId]
        .map((id) => String(id || '').trim())
        .filter((id) => /^\d+$/.test(id))
    ),
  ];
  const overlayProbe = tennisDvpProfile({
    tour,
    year,
    opponentName: opponent || null,
    opponentId: resolvedOpponentId || null,
    playerName: player || null,
    playerId: playerId || null,
    tournamentName: tournament || null,
    tournamentKey: tournamentKey || null,
    window,
    stage,
    extraPlayerIds,
    includeField: false,
    liveTournamentKeys: live.keys,
    liveTournamentNames: live.names,
  });
  const extraMatches =
    extraMatchIds.length && !overlayProbe.metrics.some((row) => typeof row.value === 'number')
      ? await tennisDvpExtraMatchesForIds(extraMatchIds)
      : [];
  const windows = {} as Record<TennisDvpWindow, TennisCachedDvpPlayer[]>;
  let profile = tennisDvpProfile({
    tour,
    year,
    opponentName: opponent || null,
    opponentId: resolvedOpponentId || null,
    playerName: player || null,
    playerId: playerId || null,
    tournamentName: tournament || null,
    tournamentKey: tournamentKey || null,
    window,
    stage,
    extraPlayerIds,
    extraMatches,
    includeField: true,
    liveTournamentKeys: live.keys,
    liveTournamentNames: live.names,
  });
  for (const nextWindow of TENNIS_DVP_WINDOWS) {
    const next =
      nextWindow === window
        ? profile
        : tennisDvpProfile({
            tour,
            year,
            opponentName: opponent || null,
            opponentId: resolvedOpponentId || null,
            playerName: player || null,
            playerId: playerId || null,
            tournamentName: tournament || null,
            tournamentKey: tournamentKey || null,
            window: nextWindow,
            stage,
            extraPlayerIds,
            extraMatches,
            includeField: true,
            liveTournamentKeys: live.keys,
            liveTournamentNames: live.names,
          });
    if (nextWindow === window) profile = next;
    const computed = (next.field || []).map((row) => ({
      id: row.id,
      name: humanTennisName(row.name) || row.name,
      ioc: row.ioc,
      rankPos: row.rankPos,
      seed: row.seed ?? null,
      drawRank: row.drawRank ?? null,
      metrics: row.metrics,
    }));
    const cachedWindow = cachedEvent?.windows[nextWindow] || [];
    if (cachedWindow.length) {
      const byId = new Map<string, TennisCachedDvpPlayer>();
      for (const row of cachedWindow) {
        byId.set(row.id, slimDvpPlayer(row, resolvedOpponentId, opponent));
      }
      for (const row of computed) {
        if (tennisCachedDvpPlayerHasSample(row) || !byId.has(row.id)) byId.set(row.id, row);
      }
      windows[nextWindow] = [...byId.values()];
    } else {
      windows[nextWindow] = computed;
    }
  }
  const field = windows[window] || windows.last10 || [];
  const selected = findCachedDvpPlayer(field, resolvedOpponentId, opponent);
  const selectedName = selected
    ? humanTennisName(selected.name, selected.id === resolvedOpponentId ? opponent : null) || selected.name
    : humanTennisName(profile.opponent?.name, opponent) || profile.opponent?.name || '';
  return NextResponse.json({
    success: true,
    ...profile,
    opponent: selected
      ? {
          id: selected.id,
          name: selectedName,
          ioc: selected.ioc,
          rankPos: selected.rankPos,
          seed: selected.seed ?? null,
          drawRank: selected.drawRank ?? null,
        }
      : profile.opponent,
    opponents: field.map((row) => ({
      id: row.id,
      name: row.name,
      ioc: row.ioc,
      rankPos: row.rankPos,
      seed: row.seed ?? null,
      drawRank: row.drawRank ?? null,
    })),
    metrics: selected?.metrics?.length ? selected.metrics : profile.metrics,
    windows,
  });
}
