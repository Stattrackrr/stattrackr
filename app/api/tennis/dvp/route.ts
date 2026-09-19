import { NextRequest, NextResponse } from 'next/server';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { type TennisTour } from '@/lib/tennis/data';
import {
  TENNIS_DVP_METRICS,
  TENNIS_DVP_WINDOWS,
  tennisDvpTournamentBestOf,
  type TennisDvpStage,
  type TennisDvpWindow,
} from '@/lib/tennis/dvpShared';
import {
  buildTennisDvpWindowsFromRedis,
  findCachedTennisDvpEvent,
  readTennisDvpLiveEvent,
  type TennisCachedDvpPlayer,
} from '@/lib/tennis/dvpLiveCache';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import {
  findLiveTennisEventForPlayers,
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
  return id;
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

function jsonFromEvent(opts: {
  event: NonNullable<ReturnType<typeof findCachedTennisDvpEvent>>;
  tour: TennisTour;
  year: number;
  window: TennisDvpWindow;
  stage: TennisDvpStage;
  opponentId: string;
  opponentName: string;
}) {
  const windows = windowsFromCache(opts.event, opts.opponentId, opts.opponentName);
  const field = windows[opts.window] || windows.last10;
  const selected = findCachedDvpPlayer(field, opts.opponentId, opts.opponentName);
  const selectedName = selected
    ? humanTennisName(selected.name, selected.id === opts.opponentId ? opts.opponentName : null) ||
      selected.name
    : '';
  return {
    success: true,
    tour: opts.tour,
    year: opts.year,
    window: opts.window,
    stage: opts.event.stage || opts.stage,
    bestOf:
      opts.event.bestOf ||
      tennisDvpTournamentBestOf({
        tour: opts.tour,
        stage: opts.event.stage || opts.stage,
        tournamentName: opts.event.tournamentName,
      }),
    tournamentName: opts.event.tournamentName,
    tournamentKey: opts.event.tournamentKey,
    fieldSize: opts.event.fieldSize,
    topSeed: opts.event.topSeed
      ? {
          id: opts.event.topSeed.id,
          name: humanTennisName(opts.event.topSeed.name) || opts.event.topSeed.name,
          ioc: opts.event.topSeed.ioc,
          rankPos: opts.event.topSeed.rankPos,
          seed: opts.event.topSeed.seed ?? 1,
          drawRank: opts.event.topSeed.drawRank ?? 1,
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
          fieldSize: opts.event.fieldSize,
        })),
    windows,
  };
}

export async function GET(request: NextRequest) {
  const tourParam = request.nextUrl.searchParams.get('tour')?.toUpperCase();
  const tour: TennisTour = tourParam === 'WTA' ? 'WTA' : 'ATP';
  const yearRaw = Number(request.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 ? yearRaw : TENNIS_CURRENT_YEAR;
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
  const liveEvent = findLiveTennisEventForPlayers(live, {
    playerId: playerId || null,
    opponentId: opponentId || null,
    tournamentKey: tournamentKey || null,
    tournamentName: tournament || null,
  });
  const resolvedKey = tournamentKey || liveEvent?.tournamentKey || '';
  const resolvedName = tournament || liveEvent?.tournamentName || '';
  const stageParam = String(request.nextUrl.searchParams.get('stage') || '').trim();
  const stage: TennisDvpStage =
    stageParam === 'main' || stageParam === 'qualifying'
      ? stageParam
      : tennisLiveEventStage(live, {
          playerId: playerId || null,
          opponentId: opponentId || null,
          tournamentKey: resolvedKey || null,
          tournamentName: resolvedName || null,
        });

  const extraPlayerIds = [
    ...new Set(
      [
        ...tennisLiveEventPlayerIds(live, resolvedKey || null, resolvedName || null, stage),
        playerId,
        opponentId,
      ]
        .map((id) => String(id || '').trim())
        .filter((id) => /^\d+$/.test(id))
    ),
  ];
  const cachedEvent = await readTennisDvpLiveEvent({
    tour,
    tournamentKey: resolvedKey || null,
    tournamentName: resolvedName || null,
    stage,
  });
  if (cachedEvent) {
    const cachedPlayers = cachedEvent.windows[window] || cachedEvent.windows.last10 || [];
    opponentId = reconcileOpponentId(opponentId, opponent, cachedPlayers);
    return NextResponse.json(
      jsonFromEvent({
        event: cachedEvent,
        tour,
        year,
        window,
        stage,
        opponentId,
        opponentName: opponent,
      })
    );
  }

  const computed = extraPlayerIds.length
    ? await buildTennisDvpWindowsFromRedis({
        tour,
        year,
        opponentName: opponent || null,
        opponentId: opponentId || null,
        playerName: player || null,
        playerId: playerId || null,
        tournamentName: resolvedName || null,
        tournamentKey: resolvedKey || null,
        extraPlayerIds,
        live,
        stage,
      })
    : null;
  if (computed) {
    opponentId = reconcileOpponentId(
      opponentId,
      opponent,
      computed.windows[window] || computed.windows.last10 || []
    );
    return NextResponse.json(
      jsonFromEvent({
        event: computed,
        tour,
        year,
        window,
        stage,
        opponentId,
        opponentName: opponent,
      })
    );
  }

  return NextResponse.json({
    success: true,
    tour,
    year,
    window,
    stage,
    bestOf: tennisDvpTournamentBestOf({
      tour,
      stage,
      tournamentName: resolvedName,
    }),
    tournamentName: resolvedName || null,
    tournamentKey: resolvedKey || null,
    fieldSize: 0,
    topSeed: null,
    opponent: opponentId || opponent ? { id: opponentId || '', name: opponent, ioc: null, rankPos: null, seed: null, drawRank: null } : null,
    opponents: [],
    metrics: TENNIS_DVP_METRICS.map((metric) => ({
      key: metric.key,
      label: metric.label,
      pct: metric.pct,
      value: null,
      rank: null,
      matches: 0,
      fieldSize: 0,
    })),
    windows: { last5: [], last10: [], season: [] },
  });
}
