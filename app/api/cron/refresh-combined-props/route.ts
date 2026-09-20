import { after, NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { upsertCombinedSnapshotTennisFromList } from '@/lib/combinedPropsSnapshotPaint';
import { getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

async function fillCombinedPropsCaches(origin: string, cronSecret?: string) {
  const tennis = await getTennisPlayerPropsList({ refresh: true });
  const tennisProps = await upsertCombinedSnapshotTennisFromList(tennis);
  const { warmCombinedPropsSnapshot } = await import('@/lib/combinedPropsSnapshot');
  const snapshot = await warmCombinedPropsSnapshot({
    origin,
    cronSecret,
    refresh: false,
  });
  return {
    tennisList: tennis.data.length,
    tennisCombined: tennisProps,
    combinedAfl: snapshot.afl?.props?.length || 0,
    combinedNba: snapshot.nba?.props?.length || 0,
    combinedTennis: snapshot.tennis?.props?.length || 0,
    wrote: true,
  };
}

/**
 * Rebuild tennis list from stored odds snapshots and write combined Redis keys.
 * Page GET stays cache-only.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const sync = request.nextUrl.searchParams.get('sync') === '1';
  const origin = request.nextUrl.origin;
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    (request.headers.get('authorization')?.startsWith('Bearer ')
      ? request.headers.get('authorization')!.slice(7)
      : undefined);
  if (sync) {
    try {
      const result = await fillCombinedPropsCaches(origin, cronSecret);
      return NextResponse.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }
  after(async () => {
    try {
      await fillCombinedPropsCaches(origin, cronSecret);
    } catch (err) {
      console.error('[combined props cron]', err);
    }
  });
  return NextResponse.json({ success: true, accepted: true });
}
