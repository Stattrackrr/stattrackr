import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { readSoccerPilotTeams } from '@/lib/soccerPilotTeams';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type WarmJob = {
  name: string;
  href: string;
};

function normalizeSearchToken(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseRequestedTeams(raw: string | null): string[] {
  return String(raw || '')
    .split(',')
    .map((value) => normalizeSearchToken(value))
    .filter(Boolean);
}

function parseWarmLimit(raw: string | null, totalAvailableTeams: number): number {
  const value = String(raw || '').trim().toLowerCase();
  if (!value || value === 'all') return totalAvailableTeams;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return totalAvailableTeams;
  return Math.min(parsed, totalAvailableTeams);
}

function filterTeamsByRequest(teams: WarmJob[], requestedTeams: string[]): WarmJob[] {
  if (requestedTeams.length === 0) return teams;

  return teams.filter((team) => {
    const normalizedName = normalizeSearchToken(team.name);
    const normalizedHref = normalizeSearchToken(team.href);
    return requestedTeams.some((token) => normalizedName === token || normalizedHref === token || normalizedName.includes(token));
  });
}

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

  const allTeams = readSoccerPilotTeams(Number.MAX_SAFE_INTEGER);
  const totalAvailableTeams = allTeams.length;
  const requestedTeams = parseRequestedTeams(request.nextUrl.searchParams.get('team'));
  const limit = parseWarmLimit(request.nextUrl.searchParams.get('limit'), totalAvailableTeams);
  const concurrency = Math.max(1, Math.min(6, Number.parseInt(request.nextUrl.searchParams.get('concurrency') || '2', 10) || 2));
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const matchedTeams = filterTeamsByRequest(allTeams, requestedTeams);
  const teams = matchedTeams.slice(0, limit);

  if (teams.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          requestedTeams.length > 0
            ? `No soccer teams matched: ${requestedTeams.join(', ')}`
            : 'No pilot teams available. Refresh the Soccerway team sample first.',
      },
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
  let warmedTeamResults = 0;
  let warmedNextFixtures = 0;
  let failed = 0;
  let totalMatches = 0;
  let totalUpcomingFixtures = 0;
  const failures: Array<{ team: string; href: string; stage: 'team-results' | 'next-game'; error: string }> = [];

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
          stage: 'team-results',
          error: payload?.error || `HTTP ${response.status}`,
        });
        return;
      }

      warmedTeamResults += 1;
      totalMatches += Number(payload?.count || 0);

      const fixtureResponse = await fetch(`${baseUrl}/api/soccer/next-game?${params.toString()}`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });

      const fixturePayload = (await fixtureResponse.json().catch(() => null)) as
        | { count?: number; error?: string; cache?: { source?: string } }
        | null;

      if (!fixtureResponse.ok) {
        failed += 1;
        failures.push({
          team: team.name,
          href: team.href,
          stage: 'next-game',
          error: fixturePayload?.error || `HTTP ${fixtureResponse.status}`,
        });
        return;
      }

      warmedNextFixtures += 1;
      totalUpcomingFixtures += Number(fixturePayload?.count || 0);
      warmed += 1;
    },
    concurrency
  );

  return NextResponse.json({
    success: failed === 0,
    warmed,
    warmedTeamResults,
    warmedNextFixtures,
    failed,
    totalAvailableTeams,
    totalMatchedTeams: matchedTeams.length,
    totalTeams: teams.length,
    totalMatches,
    totalUpcomingFixtures,
    limit,
    concurrency,
    refresh,
    requestedTeams,
    teams,
    failures,
  });
}
