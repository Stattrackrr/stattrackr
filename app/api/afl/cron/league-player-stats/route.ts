import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const execFileAsync = promisify(execFile);

/**
 * GET /api/afl/cron/league-player-stats?season=2026
 * Scrapes FootyWire from production (Vercel) when GitHub Actions IPs are blocked.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.authorized) return auth.response;

  const seasonParam = request.nextUrl.searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(season)) {
    return NextResponse.json({ success: false, error: 'Invalid season' }, { status: 400 });
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'fetch-footywire-league-player-stats.js');
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, `--season=${season}`, '--json-stdout'],
      {
        cwd: process.cwd(),
        maxBuffer: 20 * 1024 * 1024,
        timeout: 110_000,
        env: { ...process.env, FOOTYWIRE_PROBE_ATTEMPTS: '6', FOOTYWIRE_FETCH_ATTEMPTS: '5' },
      }
    );
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    return NextResponse.json({ success: true, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
