import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      error: 'Deprecated AFL endpoint',
      details: 'The legacy player-stats API-Sports route has been removed. Use scraped AFL routes instead.',
    },
    { status: 410 }
  );
}
