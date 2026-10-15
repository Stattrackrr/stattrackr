import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { upsertCombinedSnapshotNbaFromList } from '@/lib/combinedPropsSnapshotPaint';
import { refreshNbaDashOdds } from '@/lib/nba/dash/oddsIngest';
import { getNbaPlayerPropsList } from '@/lib/nba/dash/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Pull BallDontLie + odds-api.net NBA lines into the dashboard board (Redis), record O/U line
 * movement, then bake the props-page list and combined NBA slice. User reads stay cache-only.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const result = await refreshNbaDashOdds();
    let propsList = 0;
    let combinedNba = 0;
    let propsError: string | undefined;
    try {
      const list = await getNbaPlayerPropsList({ refresh: true });
      propsList = list.data.length;
      combinedNba = await upsertCombinedSnapshotNbaFromList(list);
    } catch (err) {
      propsError = err instanceof Error ? err.message : String(err);
      console.warn('[NBA odds cron] props list failed', propsError);
    }
    return NextResponse.json(
      { ...result, propsList, combinedNba, ...(propsError ? { propsError } : {}) },
      { status: result.success ? 200 : 502 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
