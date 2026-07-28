import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { NBL_CLUBS, NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export async function GET(request: NextRequest) {
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );

  // Prefer logos from ladder snapshot when available.
  const ladderFile = path.join(process.cwd(), 'data', `nbl-ladder-${year}.json`);
  const logoByTeam: Record<string, string> = {};
  const logoByCode: Record<string, string> = {};

  if (fs.existsSync(ladderFile)) {
    try {
      const ladder = JSON.parse(fs.readFileSync(ladderFile, 'utf8')) as {
        teams?: Array<{ team?: string; teamCode?: string | null; teamLogo?: string | null }>;
      };
      for (const row of ladder.teams || []) {
        if (row.team && row.teamLogo) logoByTeam[row.team] = row.teamLogo;
        if (row.teamCode && row.teamLogo) logoByCode[row.teamCode] = row.teamLogo;
      }
    } catch {
      /* ignore */
    }
  }

  for (const club of NBL_CLUBS) {
    if (!logoByCode[club.code] && logoByTeam[club.name]) {
      logoByCode[club.code] = logoByTeam[club.name];
    }
  }

  return NextResponse.json({
    year,
    clubs: NBL_CLUBS,
    logoByTeam,
    logoByCode,
  });
}
