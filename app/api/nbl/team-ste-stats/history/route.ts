import { NextRequest, NextResponse } from 'next/server';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';
import { buildNblSteAllowedRankHistory, NBL_STE_STAT_KEYS, type NblSteStatKey } from '@/lib/nbl/teamSteStats';

const TTL_MS = 1000 * 60 * 30;
const cache = new Map<string, { expiresAt: number; data: unknown }>();

function isSteMetric(v: string): v is NblSteStatKey {
  return (NBL_STE_STAT_KEYS as readonly string[]).includes(v);
}

/** GET /api/nbl/team-ste-stats/history?year=&metric= — tip-time allowed rank snapshots. */
export async function GET(request: NextRequest) {
  const yearParam = Number(request.nextUrl.searchParams.get('year') || '');
  const year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : NBL_CURRENT_SEASON_YEAR;
  const metricRaw = String(request.nextUrl.searchParams.get('metric') || 'pts').trim().toLowerCase();
  const metric: NblSteStatKey = isSteMetric(metricRaw) ? metricRaw : 'pts';
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  const cacheKey = `${year}:${metric}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    const data = buildNblSteAllowedRankHistory({ year, metric });
    const payload = {
      success: true,
      year: data.year,
      metric: data.metric,
      snapshots: data.snapshots,
    };
    cache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, data: payload });
    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to build NBL STE rank history';
    return NextResponse.json({ success: false, error: message, snapshots: [] }, { status: 500 });
  }
}
