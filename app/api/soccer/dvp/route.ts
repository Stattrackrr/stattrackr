import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSoccerRoleDvp, type SoccerDvpApiResponse, type SoccerDvpTimeframe } from '@/lib/soccerDvp';
import { getCurrentSoccerSeasonYear } from '@/lib/soccerOpponentBreakdown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type { SoccerDvpApiResponse };

function parseTimeframe(value: string | null): SoccerDvpTimeframe {
  return String(value || '').trim().toLowerCase() === 'last5' ? 'last5' : 'season';
}

function normalizeDvpTeamName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/\b(fc|afc|cf)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readPrebuiltPremierLeagueDvp(
  opponentName: string,
  opponentHref: string,
  timeframe: SoccerDvpTimeframe
): Promise<SoccerDvpApiResponse | null> {
  const seasonYear = getCurrentSoccerSeasonYear();
  const suffix = timeframe === 'last5' ? '-last5' : '';
  const filePath = path.join(process.cwd(), 'data', `soccer-dvp-premier-league-${seasonYear}${suffix}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    const matrix = JSON.parse(raw) as {
      competitionCountry?: string;
      competitionName?: string;
      seasonYear?: number;
      timeframe?: SoccerDvpTimeframe;
      opponentsSampled?: number;
      roles?: SoccerDvpApiResponse['roles'];
      opponents?: Array<NonNullable<SoccerDvpApiResponse['opponent']>>;
      note?: string;
    };
    const target = normalizeDvpTeamName(opponentName || opponentHref);
    const opponent =
      matrix.opponents?.find((row) => normalizeDvpTeamName(row.name) === target) ??
      matrix.opponents?.find((row) => {
        const name = normalizeDvpTeamName(row.name);
        return Boolean(target && (name.includes(target) || target.includes(name)));
      }) ??
      null;
    if (!opponent) return null;
    return {
      mode: 'league',
      competitionLabel: 'England · Premier League',
      timeframe: matrix.timeframe ?? timeframe,
      opponentsSampled: matrix.opponentsSampled ?? matrix.opponents?.length ?? 0,
      opponents: matrix.opponents?.map((row) => row.name).sort((a, b) => a.localeCompare(b)) ?? [],
      roles: matrix.roles ?? [],
      opponent,
      note: matrix.note,
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const opponentName = request.nextUrl.searchParams.get('opponentName')?.trim() || '';
  const opponentHref = request.nextUrl.searchParams.get('opponentHref')?.trim() || '';
  const competitionName = request.nextUrl.searchParams.get('competitionName')?.trim() || '';
  const competitionCountry = request.nextUrl.searchParams.get('competitionCountry')?.trim() || '';
  const timeframe = parseTimeframe(request.nextUrl.searchParams.get('timeframe'));

  if (!competitionName) {
    return NextResponse.json({ error: 'Missing competitionName' }, { status: 400 });
  }
  if (!opponentName && !opponentHref) {
    return NextResponse.json({ error: 'Pass opponentName or opponentHref' }, { status: 400 });
  }

  try {
    const isPrebuiltPremierLeague =
      competitionName.trim().toLowerCase() === 'premier league' &&
      (!competitionCountry || competitionCountry.trim().toLowerCase() === 'england');
    if (isPrebuiltPremierLeague) {
      const prebuilt = await readPrebuiltPremierLeagueDvp(opponentName, opponentHref, timeframe);
      if (prebuilt) return NextResponse.json(prebuilt satisfies SoccerDvpApiResponse);
    }

    const result = await buildSoccerRoleDvp({
      opponentName,
      opponentHref,
      competitionName,
      competitionCountry: competitionCountry || null,
      timeframe,
    });
    return NextResponse.json(result satisfies SoccerDvpApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build soccer DVP';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
