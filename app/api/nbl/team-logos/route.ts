import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { NBL_CLUBS, NBL_CURRENT_SEASON_YEAR, resolveNblClubName } from '@/lib/nblTeamCanonical';

function readJson(file: string): unknown | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function setLogo(
  logoByTeam: Record<string, string>,
  logoByCode: Record<string, string>,
  team: string | null | undefined,
  code: string | null | undefined,
  logo: string | null | undefined
) {
  const url = String(logo || '').trim();
  if (!url) return;
  const name = resolveNblClubName(team || '') || String(team || '').trim();
  if (name) logoByTeam[name] = url;
  if (code) logoByCode[String(code).toUpperCase()] = url;
}

export async function GET(request: NextRequest) {
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );

  const logoByTeam: Record<string, string> = {};
  const logoByCode: Record<string, string> = {};
  const dataDir = path.join(process.cwd(), 'data');

  // Prefer ladder logos when the season has started.
  const ladder = readJson(path.join(dataDir, `nbl-ladder-${year}.json`)) as {
    teams?: Array<{ team?: string; teamCode?: string | null; teamLogo?: string | null }>;
  } | null;
  for (const row of ladder?.teams || []) {
    setLogo(logoByTeam, logoByCode, row.team, row.teamCode, row.teamLogo);
  }

  // Schedule logos (home/away) — works before ladder exists (e.g. NBL27 preseason).
  const schedule = readJson(path.join(dataDir, `nbl-schedule-${year}.json`)) as {
    games?: Array<{
      homeTeam?: string;
      awayTeam?: string;
      homeTeamCode?: string | null;
      awayTeamCode?: string | null;
      homeLogo?: string | null;
      awayLogo?: string | null;
    }>;
  } | null;
  for (const g of schedule?.games || []) {
    setLogo(logoByTeam, logoByCode, g.homeTeam, g.homeTeamCode, g.homeLogo);
    setLogo(logoByTeam, logoByCode, g.awayTeam, g.awayTeamCode, g.awayLogo);
  }

  // Next-matches opponent logos as a final fill-in.
  const next = readJson(path.join(dataDir, `nbl-next-matches-${year}.json`)) as {
    teams?: Array<{
      name?: string;
      team_code?: string | null;
      nextMatches?: Array<{ opponent_name?: string | null; opponent_logo?: string | null }>;
    }>;
  } | null;
  for (const row of next?.teams || []) {
    for (const m of row.nextMatches || []) {
      setLogo(logoByTeam, logoByCode, m.opponent_name, null, m.opponent_logo);
    }
  }

  for (const club of NBL_CLUBS) {
    if (!logoByCode[club.code] && logoByTeam[club.name]) {
      logoByCode[club.code] = logoByTeam[club.name];
    }
    if (!logoByTeam[club.name] && logoByCode[club.code]) {
      logoByTeam[club.name] = logoByCode[club.code];
    }
  }

  return NextResponse.json({
    year,
    clubs: NBL_CLUBS,
    logoByTeam,
    logoByCode,
  });
}
