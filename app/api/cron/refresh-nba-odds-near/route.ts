import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshNbaNearTipOdds } from '@/lib/nba/dash/oddsIngest';
import { rebakeNbaPropsPage } from '@/lib/nba/dash/propsPageRebake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Every few minutes: fresh AU prices for NBA games inside 90 minutes of tip (see refreshNbaNearTipOdds),
 * then the props page rebuilt from the updated board.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const result = await refreshNbaNearTipOdds();
    let propsPage: Awaited<ReturnType<typeof rebakeNbaPropsPage>> | string | null = null;
    if (result.updated) {
      propsPage = await rebakeNbaPropsPage().catch((err) => `failed: ${err instanceof Error ? err.message : err}`);
    }
    return NextResponse.json({ ...result, propsPage }, { status: result.success ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
