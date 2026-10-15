import { NextRequest, NextResponse } from 'next/server';
import { loadNbaTeamUsage } from '@/lib/nba/dash/leagueCards';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { resolveNbaDataSeason } from '@/lib/nba/dash/season';

export const dynamic = 'force-dynamic';

function parseTimeframe(tf: string): { year: number | null; lastN: number | null } {
  const season = tf.match(/^season(\d{4})$/);
  if (season) return { year: Number(season[1]), lastN: null };
  const lastN = parseInt(tf.replace(/^last/i, ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) return { year: null, lastN };
  return { year: null, lastN: null };
}

/** GET /api/nba/dash/team-usage?team=&tf=&playerId=&teammateId=&ww= — per-player usage share for the pie. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const team = String(sp.get('team') || '').trim();
  if (!team) return NextResponse.json({ error: 'team is required' }, { status: 400 });
  const tf = parseTimeframe(String(sp.get('tf') || '').trim());
  const yearParam = Number(sp.get('year') || '');
  const ww = String(sp.get('ww') || '').trim().toLowerCase();
  try {
    const year = await resolveNbaDataSeason(tf.year ?? (Number.isFinite(yearParam) && yearParam > 0 ? yearParam : null));
    const opts = {
      team,
      year,
      lastN: tf.lastN,
      includePlayerId: String(sp.get('playerId') || '').trim() || null,
      teammatePlayerId: String(sp.get('teammateId') || '').trim() || null,
      teammateName: String(sp.get('teammateName') || '').trim() || null,
      teammateMode: ww === 'without' ? ('without' as const) : ww === 'with' ? ('with' as const) : null,
    };
    const { players, sampleGames } = await nbaDashCached(
      'team-usage',
      [{ ...opts, team: team.toLowerCase(), teammateName: opts.teammateName?.toLowerCase() ?? null }],
      NBA_DASH_CACHE.league,
      () => loadNbaTeamUsage(opts)
    );
    return NextResponse.json({ team, year, lastN: tf.lastN, sampleGames, players });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, players: [] }, { status: 500 });
  }
}
