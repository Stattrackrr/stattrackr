import { NextRequest, NextResponse } from 'next/server';
import { fetchFootyinfoInjuries } from '@/lib/afl/footyinfoLeague';

type InjuryRow = { team: string; player: string; injury: string; returning: string };
const TTL_MS = 1000 * 60 * 30;
let cached: { expiresAt: number; data: { generatedAt: string; injuries: InjuryRow[] } } | null = null;

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const now = Date.now();

  if (!refresh && cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data);
  }

  const rows = await fetchFootyinfoInjuries();
  if (!rows.length) return NextResponse.json({ error: 'FootyInfo injury list unavailable', injuries: [] }, { status: 502 });
  const data = {
    generatedAt: new Date().toISOString(),
    injuries: rows.map((row) => ({
      team: row.teamOfficial,
      player: row.playerName,
      injury: row.detail || row.status,
      returning: row.estimatedReturn || row.status,
    })),
  };
  cached = { expiresAt: now + TTL_MS, data };
  return NextResponse.json(data);
}
