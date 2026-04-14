import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COMBINED_CACHE_CONTROL = 'private, no-store';

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const debugStats = request.nextUrl.searchParams.get('debugStats') === '1';
  const origin = request.nextUrl.origin;

  const nbaUrl = new URL('/api/nba/player-props', origin);
  const aflUrl = new URL('/api/afl/player-props/list', origin);

  if (refresh) {
    nbaUrl.searchParams.set('refresh', '1');
    aflUrl.searchParams.set('refresh', '1');
  }
  if (debugStats) {
    aflUrl.searchParams.set('debugStats', '1');
  }

  try {
    const [nbaResponse, aflResponse] = await Promise.all([
      fetch(nbaUrl, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      }),
      fetch(aflUrl, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      }),
    ]);

    const [nbaPayload, aflPayload] = await Promise.all([
      nbaResponse.json().catch(() => null),
      aflResponse.json().catch(() => null),
    ]);

    const success = nbaResponse.ok && aflResponse.ok;

    return NextResponse.json(
      {
        success,
        nba: {
          ok: nbaResponse.ok,
          status: nbaResponse.status,
          payload: nbaPayload,
        },
        afl: {
          ok: aflResponse.ok,
          status: aflResponse.status,
          payload: aflPayload,
        },
      },
      {
        status: success ? 200 : 502,
        headers: {
          'Cache-Control': COMBINED_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load combined props payload',
      },
      {
        status: 500,
        headers: {
          'Cache-Control': COMBINED_CACHE_CONTROL,
        },
      }
    );
  }
}
