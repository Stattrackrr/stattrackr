import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { enrichGameLogsFromSchedule } from '@/lib/nbl/enrichGameLogsFromSchedule';
import { overlayNblQuarterPoints } from '@/lib/nbl/nblPbpData';
import { withComputedNblBoxStats } from '@/lib/nbl/rosettaPlayer';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { enrichNblGamesAdvancedRates } from '@/lib/nbl/teamBoxScores';
import {
  NBL_CHART_HISTORY_YEARS,
  NBL_CURRENT_SEASON_YEAR,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';

/**
 * GET /api/nbl/player-game-logs — disk cache only.
 * Rosetta fetch happens in `scripts/fetch-nbl-player-game-logs.ts`, not per request.
 */

function finalizeGames(
  games: NblGameLogRow[],
  year: number,
  playerName?: string | null
): NblGameLogRow[] {
  return overlayNblQuarterPoints(
    enrichNblGamesAdvancedRates(
      enrichGameLogsFromSchedule(games, year).map((g) => withComputedNblBoxStats(g)),
      year
    ),
    playerName,
    year
  );
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

function readCachedPayload(playerId: string, year: number): {
  games: NblGameLogRow[];
  name: string | null;
  team: string | null;
} | null {
  const file = cachePath(playerId, year);
  if (!fs.existsSync(file)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      games?: NblGameLogRow[];
      name?: string | null;
      team?: string | null;
    };
    const cachedGames = Array.isArray(cached.games) ? cached.games : [];
    return {
      games: cachedGames.map((g) => withComputedNblBoxStats(g)),
      name: cached.name ? String(cached.name) : null,
      team: cached.team ? String(cached.team) : null,
    };
  } catch {
    return null;
  }
}

function loadYearGames(
  playerId: string,
  year: number,
  meta: { name: string | null; team: string | null }
): NblGameLogRow[] {
  const cached = readCachedPayload(playerId, year);
  if (cached == null) return [];
  const name = meta.name || cached.name;
  if (!meta.name && cached.name) meta.name = cached.name;
  if (!meta.team && cached.team) meta.team = cached.team;
  return finalizeGames(cached.games, year, name);
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

  if (resolvedId && !resolvedName) {
    for (const y of years.length ? years : [NBL_CURRENT_SEASON_YEAR]) {
      const rosterFile = path.join(process.cwd(), 'data', `nbl-roster-${y}.json`);
      if (!fs.existsSync(rosterFile)) continue;
      try {
        const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8')) as {
          players?: Array<{ playerId: string; name: string; team?: string }>;
        };
        const hit = (roster.players || []).find((p) => p.playerId === resolvedId);
        if (hit) {
          resolvedName = hit.name;
          resolvedTeam = hit.team ?? resolvedTeam;
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
  const games = mergeGames(years.map((y) => loadYearGames(resolvedId, y, meta)));

  return NextResponse.json({
    playerId: resolvedId,
    name: meta.name || resolvedName,
    team: meta.team || resolvedTeam,
    years,
    year: years[0] ?? NBL_CURRENT_SEASON_YEAR,
    seasonLabel: years.map(nblSeasonLabel).join('+'),
    generatedAt: new Date().toISOString(),
    source: 'cache',
    gameCount: games.length,
    games,
  });
}
