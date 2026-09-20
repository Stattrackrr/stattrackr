import { after, NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { bakeCachedTennisDvp } from '@/lib/tennis/playerPropsList';
import { rebuildTennisDvpStore, tennisDvpStoreSummary } from '@/lib/tennis/refreshDvpAndProps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

async function runTennisDvpRebuild() {
  const store = await rebuildTennisDvpStore();
  const baked = await bakeCachedTennisDvp();
  return {
    ...tennisDvpStoreSummary(store),
    propsCount: baked.props,
    propsWithDvp: baked.withDvp,
  };
}

/**
 * Rebuild tennis DVP from Redis player logs + cached upcoming/props IDs.
 * Does not hit Odds/API-Tennis. GitHub cron returns immediately; work finishes via after().
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  const sync = request.nextUrl.searchParams.get('sync') === '1';
  if (sync) {
    try {
      const result = await runTennisDvpRebuild();
      return NextResponse.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }
  after(async () => {
    try {
      await runTennisDvpRebuild();
    } catch (err) {
      console.error('[tennis dvp]', err);
    }
  });
  return NextResponse.json({ success: true, accepted: true });
}
