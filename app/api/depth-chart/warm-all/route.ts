import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NBA_TEAMS = [
  'ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW',
  'HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK',
  'OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS',
];

function getOrigin(req: NextRequest): string {
  try {
    if (req?.nextUrl?.origin) return req.nextUrl.origin;
  } catch {}
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host');
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  const host = req.headers.get('host') || 'localhost:3000';
  const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  return `${proto}://${host}`;
}

async function batch<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    await Promise.all(slice.map(worker));
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const forceRefresh = searchParams.get('refresh') === '1';
  const origin = getOrigin(req);
  const warmed: string[] = [];
  const failed: string[] = [];

  // Limit concurrency to avoid upstream rate limits
  await batch(NBA_TEAMS, 4, async (team) => {
    try {
      const url = `${origin}/api/depth-chart?team=${encodeURIComponent(team)}${forceRefresh ? '&refresh=1' : ''}`;
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success !== false) {
        warmed.push(team);
      } else {
        failed.push(team);
      }
    } catch {
      failed.push(team);
    }
  });

  return NextResponse.json({
    success: failed.length === 0,
    warmed: Array.from(new Set(warmed)).sort(),
    failed: Array.from(new Set(failed)).sort(),
    refresh: forceRefresh,
    ttlHours: 8,
  }, { status: failed.length ? 206 : 200 });
}
