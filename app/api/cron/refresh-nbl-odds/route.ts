import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { refreshNblOddsAndPropsIngest } from '@/lib/nbl/refreshNblPropsIngest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Pull odds-api.net player lines + The Odds API game lines, then bake the
 * props-page list and combined NBL slice. Page/Ask reads stay cache-only.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;
  try {
    const result = await refreshNblOddsAndPropsIngest({ disk: false });
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
