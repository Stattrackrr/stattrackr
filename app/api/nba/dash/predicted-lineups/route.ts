import { NextRequest, NextResponse } from 'next/server';
import { loadNbaPredictedLineups } from '@/lib/nba/dash/predictedLineups';
import { nbaDashCached } from '@/lib/nba/dash/responseCache';

export const dynamic = 'force-dynamic';

const POLICY = { freshSeconds: 5 * 60, maxAgeSeconds: 30 * 60 };

/** GET /api/nba/dash/predicted-lineups?team= — predicted starters and who may not play for the team's next game. */
export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team')?.trim() || '';
  if (!team) return NextResponse.json({ error: 'Missing team' }, { status: 400 });
  try {
    const lineups = await nbaDashCached('predicted-lineups', [team.toLowerCase()], POLICY, () => loadNbaPredictedLineups(team));
    return NextResponse.json(
      { lineups },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load lineups' }, { status: 502 });
  }
}
