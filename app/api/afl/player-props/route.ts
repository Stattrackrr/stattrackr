import { NextRequest, NextResponse } from 'next/server';
import {
  getAflEventIdForMatchup,
  getAflOddsCache,
  refreshAflOddsData,
} from '@/lib/refreshAflOdds';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import {
  CACHED_PP_STATS,
  getAflPlayerPropsAllFromCache,
  getAflPlayerPropsFromCache,
} from '@/lib/aflPlayerPropsCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/afl/player-props?player=...&stat=...&team=...&opponent=...&game_date=...
 * Serves from 90-min cache for disposals/goals only. Marks/tackles return empty (not cached).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const player = searchParams.get('player')?.trim();
  const stat = (searchParams.get('stat') ?? 'disposals').trim().toLowerCase();
  const team = searchParams.get('team')?.trim();
  const opponent = searchParams.get('opponent')?.trim();
  const gameDate = searchParams.get('game_date')?.trim();
  const eventIdParam = searchParams.get('event_id')?.trim();
  const returnAll = searchParams.get('all') === '1' || searchParams.get('all') === 'true';

  if (!player) {
    return NextResponse.json({ error: 'Player name required', props: [] }, { status: 400 });
  }

  // Only goals + disposals are in the 90-min cache; marks/tackles not requested to save API calls
  if (stat === 'marks_over' || stat === 'tackles_over') {
    const msg = 'Only goals and disposals are cached. Marks/tackles are not available.';
    if (returnAll) return NextResponse.json({ all: {}, message: msg });
    return NextResponse.json({ props: [], message: msg });
  }

  let resolvedEventId = eventIdParam ?? null;
  if (!resolvedEventId && team && opponent) {
    const cache = await getAflOddsCache();
    let games = cache?.games ?? [];
    resolvedEventId = getAflEventIdForMatchup(games, team, opponent, gameDate || undefined);
    if (!resolvedEventId) {
      const canonical = await refreshAflOddsData({ skipWrite: true });
      if (canonical.success && canonical.games?.length) {
        const teamNorm = toOfficialAflTeamDisplayName(team);
        const oppNorm = toOfficialAflTeamDisplayName(opponent);
        resolvedEventId = getAflEventIdForMatchup(canonical.games, teamNorm || team, oppNorm || opponent, gameDate || undefined);
      }
    }
  }

  if (!resolvedEventId) {
    const message = 'Could not resolve game. Ensure game odds cache is filled (run /api/afl/odds/refresh).';
    if (returnAll) return NextResponse.json({ all: {}, message });
    return NextResponse.json({ props: [], message });
  }

  try {
    if (returnAll) {
      const all = await getAflPlayerPropsAllFromCache(resolvedEventId, player);
      if (all && Object.keys(all).length > 0) {
        return NextResponse.json({ all });
      }
      return NextResponse.json({ all: {}, message: 'No cached props for this player. Cache refreshes every 90 min.' });
    }

    const props = await getAflPlayerPropsFromCache(resolvedEventId, player, stat);
    if (props && props.length > 0) {
      return NextResponse.json({ props });
    }
    return NextResponse.json({
      props: [],
      message: 'No cached props for this player/stat. Cache refreshes every 90 min.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[AFL player-props]', message);
    if (returnAll) return NextResponse.json({ all: {}, error: message });
    return NextResponse.json({ props: [], error: message });
  }
}
