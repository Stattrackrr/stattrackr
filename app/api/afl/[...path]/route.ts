/**
 * AFL API Proxy - forwards requests to API-Sports AFL API
 * Docs: https://api-sports.io/documentation/afl/v1
 * Base: https://v1.afl.api-sports.io
 * Auth: x-apisports-key header
 */
import { NextRequest, NextResponse } from 'next/server';

const AFL_BASE = 'https://v1.afl.api-sports.io';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const apiKey = process.env.AFL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AFL_API_KEY not configured' },
      { status: 500 }
    );
  }

  const { path } = await params;
  const pathStr = path?.length ? path.join('/') : '';
  const searchParams = request.nextUrl.searchParams.toString();
  const url = `${AFL_BASE}/${pathStr}${searchParams ? `?${searchParams}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'x-apisports-key': apiKey,
      },
      next: { revalidate: 60 },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[AFL API]', err);
    return NextResponse.json(
      { error: 'Failed to fetch AFL data' },
      { status: 502 }
    );
  }
}
