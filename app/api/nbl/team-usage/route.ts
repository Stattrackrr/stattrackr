import { NextRequest, NextResponse } from 'next/server';
import { loadNblTeamUsage } from '@/lib/nbl/teamUsage';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

function parseTimeframe(tf: string, fallbackYear: number): { year: number; lastN: number | null } {
  const season = tf.match(/^season(\d{4})$/);
  if (season) return { year: Number(season[1]), lastN: null };
  const lastN = parseInt(tf.replace(/^last/i, ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) return { year: fallbackYear, lastN };
  return { year: fallbackYear, lastN: null };
}

export async function GET(request: NextRequest) {
  const team = String(request.nextUrl.searchParams.get('team') || '').trim();
  if (!team) {
    return NextResponse.json({ error: 'team is required' }, { status: 400 });
  }
  const yearParam = Number(request.nextUrl.searchParams.get('year') || NBL_CURRENT_SEASON_YEAR);
  const fallbackYear = Number.isFinite(yearParam) ? yearParam : NBL_CURRENT_SEASON_YEAR;
  const tf = String(request.nextUrl.searchParams.get('tf') || '').trim();
  const { year, lastN } = parseTimeframe(tf, fallbackYear);
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim() || null;

  const players = loadNblTeamUsage({
    team,
    year,
    lastN,
    includePlayerId: playerId,
  });

  return NextResponse.json({
    team,
    year,
    lastN,
    players,
  });
}
