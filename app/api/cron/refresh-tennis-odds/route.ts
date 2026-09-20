import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshTennisOddsSnapshots } from '@/lib/tennis/odds';
import { rebuildTennisDvpAndBakeProps } from '@/lib/tennis/refreshDvpAndProps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Pull The Odds API tennis catalog, rebuild DVP boards, then bake the props list
 * + combined tennis slice (including DVP ranks). Page/Ask reads never hit live APIs.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const force = request.nextUrl.searchParams.get('force') === '1';
    const result = await refreshTennisOddsSnapshots({ force });
    const dvp = await rebuildTennisDvpAndBakeProps();
    return NextResponse.json({
      success: true,
      ...result,
      tennisList: dvp.tennisList,
      tennisCombined: dvp.tennisCombined,
      dvp,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
