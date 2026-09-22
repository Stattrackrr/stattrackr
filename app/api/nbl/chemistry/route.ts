import { NextRequest, NextResponse } from 'next/server';
import { loadPlayerChemistryForApi } from '@/lib/nbl/nblPbpChemistry';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/nbl/chemistry — cache only (no live SportRadar).
 * playerName + optional team / year
 */
export async function GET(request: NextRequest) {
  const playerName = String(
    request.nextUrl.searchParams.get('playerName') ||
      request.nextUrl.searchParams.get('player') ||
      ''
  ).trim();
  if (!playerName) {
    return NextResponse.json({ error: 'playerName is required' }, { status: 400 });
  }
  const team = String(request.nextUrl.searchParams.get('team') || '').trim() || null;
  const yearRaw = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  const year = Number.isFinite(yearRaw) ? yearRaw : NBL_CURRENT_SEASON_YEAR;

  try {
    const payload = loadPlayerChemistryForApi(playerName, team, year);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load chemistry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
