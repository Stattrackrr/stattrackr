import { NextRequest, NextResponse } from 'next/server';
import { buildNblPlayTypesPayload } from '@/lib/nbl/playTypes';

export async function GET(request: NextRequest) {
  const stat = String(request.nextUrl.searchParams.get('stat') || 'points').trim();
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();

  try {
    const payload = buildNblPlayTypesPayload({
      stat,
      playerId: playerId || null,
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build play types';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
