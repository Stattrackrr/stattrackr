import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/afl/cron/league-player-stats?season=2026&mode=minimal
 * Returns the latest committed FootyInfo season snapshot.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;

  const seasonParam = request.nextUrl.searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(season)) {
    return NextResponse.json({ success: false, error: 'Invalid season' }, { status: 400 });
  }

  try {
    const file = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    return NextResponse.json({ success: true, ...payload, source: 'footyinfo.com' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
