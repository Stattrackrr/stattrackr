import { NextRequest, NextResponse } from 'next/server';
import {
  fetchFootyinfoCbaLeaders,
  fetchFootyinfoKickinLeaders,
  teamToFantasyToolsSlug,
  type RoleLeaderRow,
} from '@/lib/afl/footyinfoFantasyTools';
import { getRoleLeadersFromSnapshot } from '@/lib/afl/roleLeadersSnapshot';

type StatKey = 'cba' | 'kick_ins';

const liveCache = new Map<
  string,
  { expiresAt: number; leaders: RoleLeaderRow[]; teamTotal: number }
>();
const LIVE_TTL_MS = 1000 * 60 * 15;

export async function GET(request: NextRequest) {
  const teamParam = request.nextUrl.searchParams.get('team')?.trim() || '';
  const season = Number(request.nextUrl.searchParams.get('season') || new Date().getFullYear());
  const stat = (request.nextUrl.searchParams.get('stat') || '').trim() as StatKey;
  const limit = Math.min(10, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 5)));
  const forceLive = ['1', 'true'].includes(request.nextUrl.searchParams.get('force_live') || '');

  if (!teamParam) {
    return NextResponse.json({ error: 'team query param is required', leaders: [], teamTotal: 0 }, { status: 400 });
  }
  if (stat !== 'cba' && stat !== 'kick_ins') {
    return NextResponse.json(
      { error: 'stat must be cba or kick_ins', leaders: [], teamTotal: 0 },
      { status: 400 }
    );
  }
  if (!Number.isFinite(season) || season < 2017) {
    return NextResponse.json({ error: 'invalid season', leaders: [], teamTotal: 0 }, { status: 400 });
  }

  const teamSlug = teamToFantasyToolsSlug(teamParam);
  if (!teamSlug) {
    return NextResponse.json(
      { error: 'unrecognised team', leaders: [], teamTotal: 0, team: teamParam },
      { status: 400 }
    );
  }

  if (!forceLive) {
    const fromFile = getRoleLeadersFromSnapshot(season, teamSlug, stat, limit);
    if (fromFile && (fromFile.leaders.length > 0 || fromFile.teamTotal > 0)) {
      return NextResponse.json({
        season,
        team: teamParam,
        teamSlug,
        stat,
        leaders: fromFile.leaders,
        teamTotal: fromFile.teamTotal,
        cached: true,
        source: 'data/afl-role-leaders',
        generatedAt: fromFile.generatedAt,
      });
    }
  }

  const cacheKey = `${stat}:${season}:${teamSlug}:${limit}`;
  const cached = liveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      season,
      team: teamParam,
      teamSlug,
      stat,
      leaders: cached.leaders,
      teamTotal: cached.teamTotal,
      cached: true,
      source: 'footyinfo.com/fantasy-tools',
    });
  }

  const result =
    stat === 'cba'
      ? await fetchFootyinfoCbaLeaders(teamSlug, season, limit)
      : await fetchFootyinfoKickinLeaders(teamSlug, season, limit);

  liveCache.set(cacheKey, {
    expiresAt: Date.now() + LIVE_TTL_MS,
    leaders: result.leaders,
    teamTotal: result.teamTotal,
  });

  return NextResponse.json({
    season,
    team: teamParam,
    teamSlug,
    stat,
    leaders: result.leaders,
    teamTotal: result.teamTotal,
    cached: false,
    source: 'footyinfo.com/fantasy-tools',
  });
}
