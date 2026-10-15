import { NextResponse } from 'next/server';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { loadNbaInjuries } from '@/lib/nba/dash/server';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/injuries — stored BDL injury report (synced every 3h). */
export async function GET() {
  try {
    const payload = await nbaDashCached('injuries', [], NBA_DASH_CACHE.injuries, () => loadNbaInjuries());
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, injuries: [] }, { status: 502 });
  }
}
