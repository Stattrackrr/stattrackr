import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path?.length ? path.join('/') : '';
  return NextResponse.json(
    {
      error: 'AFL API proxy removed',
      details: `Scraped AFL routes now power this app. Endpoint "/api/afl/${pathStr}" is no longer available.`,
    },
    { status: 410 }
  );
}
