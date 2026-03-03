import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { listAflPlayerPropsFromCache } from '@/lib/aflPlayerPropsCache';
import { getAflPropStats, buildAflPropStatKey } from '@/lib/aflPropStatsCache';
import { getAflPlayerTeamMap, resolveTeamAndOpponent } from '@/lib/aflPlayerTeamResolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BATCH_SIZE = 20;
const MAX_PROPS = 500;

type PropToWarm = { playerName: string; team: string; opponent: string; statType: string; line: number };

/**
 * GET /api/afl/props-stats/warm
 * Warms the AFL prop stats cache by fetching game logs and computing L5/L10/H2H/Season/Streak/DvP
 * for all current props from the list cache. Call after player-props/refresh (cron or workflow).
 * Protected by CRON_SECRET in production.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const origin = request.nextUrl?.origin ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;

  try {
    const result = await listAflPlayerPropsFromCache();
    if (!result?.props?.length) {
      return NextResponse.json({
        success: true,
        warmed: 0,
        skipped: 0,
        message: 'No AFL props in cache. Run /api/afl/player-props/refresh first.',
      });
    }

    const hasBoth = (r: { overOdds?: string; underOdds?: string }) => {
      const o = r.overOdds != null && String(r.overOdds).trim() !== '' && String(r.overOdds) !== 'N/A';
      const u = r.underOdds != null && String(r.underOdds).trim() !== '' && String(r.underOdds) !== 'N/A';
      return o && u;
    };

    const playerTeamMap = await getAflPlayerTeamMap(baseUrl);
    const seen = new Set<string>();
    const toWarm: PropToWarm[] = [];
    for (const r of result.props) {
      if (!hasBoth(r)) continue;
      const resolved = resolveTeamAndOpponent(r.playerName, r.homeTeam, r.awayTeam, playerTeamMap);
      const team = resolved?.team ?? r.homeTeam;
      const opponent = resolved?.opponent ?? r.awayTeam;
      const key = buildAflPropStatKey(r.playerName, team, opponent, r.statType, r.line);
      if (seen.has(key)) continue;
      seen.add(key);
      toWarm.push({
        playerName: r.playerName,
        team,
        opponent,
        statType: r.statType,
        line: r.line,
      });
    }

    const toProcess = toWarm.slice(0, MAX_PROPS);
    let warmed = 0;
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((p) =>
          getAflPropStats(p.playerName, p.team, p.opponent, p.statType, p.line, baseUrl, null).then((r) => {
            if (r) warmed++;
          }).catch(() => {})
        )
      );
    }

    return NextResponse.json({
      success: true,
      warmed,
      total: toProcess.length,
      skipped: Math.max(0, toWarm.length - MAX_PROPS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
