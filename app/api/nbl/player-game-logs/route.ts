import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { enrichGameLogsFromSchedule } from '@/lib/nbl/enrichGameLogsFromSchedule';
import { fetchNormalizedPlayerGameLogs } from '@/lib/nbl/rosettaPlayer';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CURRENT_SEASON_YEAR, nblSeasonLabel } from '@/lib/nblTeamCanonical';

export async function GET(request: NextRequest) {
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const name = String(request.nextUrl.searchParams.get('name') || '').trim().toLowerCase();
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  const live = request.nextUrl.searchParams.get('live') === '1';

  let resolvedId = playerId;
  let resolvedName: string | null = null;
  let resolvedTeam: string | null = null;

  if (!resolvedId && name) {
    const rosterFile = path.join(process.cwd(), 'data', `nbl-roster-${year}.json`);
    if (fs.existsSync(rosterFile)) {
      try {
        const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8')) as {
          players?: Array<{ playerId: string; name: string; team?: string }>;
        };
        const hit = (roster.players || []).find(
          (p) => String(p.name || '').toLowerCase() === name
        );
        if (hit) {
          resolvedId = hit.playerId;
          resolvedName = hit.name;
          resolvedTeam = hit.team ?? null;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!resolvedId) {
    return NextResponse.json(
      { error: 'Provide playerId or exact name query param' },
      { status: 400 }
    );
  }

  const cacheFile = path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${resolvedId}-${year}.json`
  );

  if (!live && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
        games?: NblGameLogRow[];
        [key: string]: unknown;
      };
      const cachedGames = Array.isArray(cached.games) ? cached.games : [];
      // Older caches predate 2PT/EFF fields — refresh once from Rosetta.
      const sample = cachedGames[0] as NblGameLogRow | undefined;
      const cacheHasExtendedStats =
        sample != null &&
        Object.prototype.hasOwnProperty.call(sample, 'twoMade') &&
        Object.prototype.hasOwnProperty.call(sample, 'efficiency') &&
        Object.prototype.hasOwnProperty.call(sample, 'pr');
      if (cacheHasExtendedStats || cachedGames.length === 0) {
        const games = enrichGameLogsFromSchedule(cachedGames, year);
        return NextResponse.json({ ...cached, games, gameCount: games.length });
      }
    } catch {
      /* fall through to live */
    }
  }

  const games = enrichGameLogsFromSchedule(
    await fetchNormalizedPlayerGameLogs(resolvedId, year, 'regular'),
    year
  );
  const payload = {
    playerId: resolvedId,
    name: resolvedName,
    team: resolvedTeam,
    year,
    seasonLabel: nblSeasonLabel(year),
    generatedAt: new Date().toISOString(),
    source: 'rosetta.nbl.com.au',
    gameCount: games.length,
    games,
  };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
  } catch {
    /* cache write is best-effort */
  }

  return NextResponse.json(payload);
}
