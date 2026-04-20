import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { readSoccerPilotTeams } from '@/lib/soccerPilotTeams';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type WarmJob = {
  name: string;
  href: string;
};

async function runPool<T>(jobs: T[], worker: (job: T) => Promise<void>, size: number) {
  let index = 0;
  let active = 0;
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const next = () => {
    while (active < size && index < jobs.length) {
      const current = jobs[index++];
      active += 1;
      void worker(current)
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          if (index >= jobs.length && active === 0) {
            resolveDone?.();
          } else {
            next();
          }
        });
    }
  };

  next();
  await done;
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const limit = Math.max(1, Math.min(50, Number.parseInt(request.nextUrl.searchParams.get('limit') || '10', 10) || 10));
  const concurrency = Math.max(1, Math.min(6, Number.parseInt(request.nextUrl.searchParams.get('concurrency') || '2', 10) || 2));
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const teams = readSoccerPilotTeams(limit);

  if (teams.length === 0) {
    return NextResponse.json(
      { success: false, error: 'No pilot teams available. Refresh the Soccerway team sample first.' },
      { status: 500 }
    );
  }

  const cronSecret = (process.env.CRON_SECRET ?? '').replace(/\r\n|\r|\n/g, '').trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
    headers['X-Cron-Secret'] = cronSecret;
  }

  const origin =
    request.nextUrl?.origin ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;

  let warmed = 0;
  let failed = 0;
  let totalMatches = 0;
  const failures: Array<{ team: string; href: string; error: string }> = [];

  await runPool<WarmJob>(
    teams,
    async (team) => {
      const params = new URLSearchParams({ href: team.href });
      if (refresh) params.set('refresh', '1');
      const response = await fetch(`${baseUrl}/api/soccer/team-results?${params.toString()}`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });

      const payload = (await response.json().catch(() => null)) as
        | { count?: number; error?: string; cache?: { teamResultsSource?: string } }
        | null;

      if (!response.ok) {
        failed += 1;
        failures.push({
          team: team.name,
          href: team.href,
          error: payload?.error || `HTTP ${response.status}`,
        });
        return;
      }

      warmed += 1;
      totalMatches += Number(payload?.count || 0);
    },
    concurrency
  );

  return NextResponse.json({
    success: failed === 0,
    warmed,
    failed,
    totalTeams: teams.length,
    totalMatches,
    limit,
    concurrency,
    refresh,
    teams,
    failures,
  });
}
