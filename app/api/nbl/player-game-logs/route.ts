import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { enrichGameLogsFromSchedule } from '@/lib/nbl/enrichGameLogsFromSchedule';
import { fetchNormalizedPlayerGameLogs, withComputedNblBoxStats } from '@/lib/nbl/rosettaPlayer';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import {
  NBL_CHART_HISTORY_YEARS,
  NBL_CURRENT_SEASON_YEAR,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';

function finalizeGames(games: NblGameLogRow[], year: number): NblGameLogRow[] {
  return enrichGameLogsFromSchedule(games, year).map((g) => withComputedNblBoxStats(g));
}
function parseYears(request: NextRequest): number[] {
  const yearsParam = String(request.nextUrl.searchParams.get('years') || '').trim();
  if (yearsParam) {
    const parsed = yearsParam
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((y) => Number.isFinite(y) && y >= 2020 && y <= 2100);
    if (parsed.length) return [...new Set(parsed)];
  }
  const history = ['1', 'true'].includes(
    String(request.nextUrl.searchParams.get('history') || '').toLowerCase()
  );
  if (history) return [...NBL_CHART_HISTORY_YEARS];
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  return [Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR];
}

function cachePath(playerId: string, year: number): string {
  return path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${playerId}-${year}.json`
  );
}

function readCachedGames(playerId: string, year: number): NblGameLogRow[] | null {
  const file = cachePath(playerId, year);
  if (!fs.existsSync(file)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      games?: NblGameLogRow[];
    };
    const cachedGames = Array.isArray(cached.games) ? cached.games : [];
    // Older caches predate 2PT/EFF fields — treat as miss so we refresh from Rosetta.
    const sample = cachedGames[0];
    const cacheHasExtendedStats =
      sample != null &&
      Object.prototype.hasOwnProperty.call(sample, 'twoMade') &&
      Object.prototype.hasOwnProperty.call(sample, 'efficiency') &&
      Object.prototype.hasOwnProperty.call(sample, 'pr');
    if (!cacheHasExtendedStats && cachedGames.length > 0) return null;
    return cachedGames.map((g) => withComputedNblBoxStats(g));
  } catch {
    return null;
  }
}

function writeCache(
  playerId: string,
  year: number,
  games: NblGameLogRow[],
  meta: { name: string | null; team: string | null }
) {
  try {
    const file = cachePath(playerId, year);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          playerId,
          name: meta.name,
          team: meta.team,
          year,
          seasonLabel: nblSeasonLabel(year),
          generatedAt: new Date().toISOString(),
          source: 'rosetta.nbl.com.au',
          gameCount: games.length,
          games,
        },
        null,
        2
      )
    );
  } catch {
    /* cache write is best-effort */
  }
}

async function loadYearGames(
  playerId: string,
  year: number,
  live: boolean,
  meta: { name: string | null; team: string | null }
): Promise<NblGameLogRow[]> {
  if (!live) {
    const cached = readCachedGames(playerId, year);
    if (cached != null) {
      return finalizeGames(cached, year);
    }
  }

  const games = finalizeGames(
    await fetchNormalizedPlayerGameLogs(playerId, year, 'regular'),
    year
  );
  writeCache(playerId, year, games, meta);
  return games;
}

function mergeGames(batches: NblGameLogRow[][]): NblGameLogRow[] {
  const seen = new Set<string>();
  const out: NblGameLogRow[] = [];
  for (const games of batches) {
    for (const g of games) {
      const key = `${g.matchId ?? ''}|${g.date ?? ''}|${g.season ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g);
    }
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

export async function GET(request: NextRequest) {
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const name = String(request.nextUrl.searchParams.get('name') || '').trim().toLowerCase();
  const live = request.nextUrl.searchParams.get('live') === '1';
  const years = parseYears(request);

  let resolvedId = playerId;
  let resolvedName: string | null = null;
  let resolvedTeam: string | null = null;

  if (!resolvedId && name) {
    for (const y of years.length ? years : [NBL_CURRENT_SEASON_YEAR]) {
      const rosterFile = path.join(process.cwd(), 'data', `nbl-roster-${y}.json`);
      if (!fs.existsSync(rosterFile)) continue;
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
          break;
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

  const meta = { name: resolvedName, team: resolvedTeam };
  const batches = await Promise.all(
    years.map((y) => loadYearGames(resolvedId, y, live, meta))
  );
  const games = mergeGames(batches);

  return NextResponse.json({
    playerId: resolvedId,
    name: resolvedName,
    team: resolvedTeam,
    years,
    year: years[0] ?? NBL_CURRENT_SEASON_YEAR,
    seasonLabel: years.map(nblSeasonLabel).join('+'),
    generatedAt: new Date().toISOString(),
    source: 'rosetta.nbl.com.au',
    gameCount: games.length,
    games,
  });
}
