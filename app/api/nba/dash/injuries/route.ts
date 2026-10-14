import { NextResponse } from 'next/server';
import { loadNbaInjuries } from '@/lib/nba/dash/server';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/injuries — stored BDL injury report (synced every 3h). */
export async function GET() {
  try {
    const payload = await loadNbaInjuries();
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, injuries: [] }, { status: 502 });
  }
}
