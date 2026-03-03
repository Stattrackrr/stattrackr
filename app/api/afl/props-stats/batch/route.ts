import { getAflPropStats, buildAflPropStatKey, type AflPropStatsPayload } from '@/lib/aflPropStatsCache';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type PropInput = { playerName: string; team: string; opponent: string; statType: string; line: number };

async function loadDvpMaps(origin: string): Promise<{ disposals: Map<string, { rank: number; value: number }>; goals: Map<string, { rank: number; value: number }> }> {
  const season = new Date().getFullYear();
  const build = (data: { rows?: Array<{ opponent?: string; rank?: number; value?: number }> } | null) => {
    const map = new Map<string, { rank: number; value: number }>();
    if (!data?.rows) return map;
    for (const row of data.rows) {
      const key = (row.opponent || '').trim().toLowerCase();
      if (!key) continue;
      const rank = typeof row.rank === 'number' ? row.rank : 0;
      const value = typeof row.value === 'number' ? row.value : 0;
      const existing = map.get(key);
      if (!existing || rank < existing.rank) map.set(key, { rank, value });
    }
    return map;
  };
  const [disp, goals] = await Promise.all([
    fetch(`${origin}/api/afl/dvp?season=${season}&stat=disposals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
    fetch(`${origin}/api/afl/dvp?season=${season}&stat=goals&order=desc&top=100`).then((r) => (r.ok ? r.json() : null)),
  ]);
  return { disposals: build(disp), goals: build(goals) };
}

function getDvpLookup(
  opponent: string,
  statType: string,
  maps: { disposals: Map<string, { rank: number; value: number }>; goals: Map<string, { rank: number; value: number }> }
): { rank: number; value: number } | null {
  const opp = (opponent || '').trim().toLowerCase();
  const m = statType === 'goals_over' ? maps.goals : maps.disposals;
  const exact = m.get(opp);
  if (exact) return exact;
  const entry = Array.from(m.entries()).find(([team]) => team.includes(opp) || opp.includes(team));
  return entry ? entry[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { props?: PropInput[] };
    const props = Array.isArray(body?.props) ? body.props : [];
    if (props.length === 0) {
      return NextResponse.json({ stats: {} });
    }
    const origin = request.nextUrl?.origin ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const baseUrl = origin.startsWith('http') ? origin : `https://${origin}`;
    const dvpMaps = await loadDvpMaps(baseUrl);
    const stats: Record<string, AflPropStatsPayload> = {};
    await Promise.all(
      props.map(async (p) => {
        const key = buildAflPropStatKey(p.playerName, p.team, p.opponent, p.statType, p.line);
        const dvp = getDvpLookup(p.opponent, p.statType, dvpMaps);
        const result = await getAflPropStats(p.playerName, p.team, p.opponent, p.statType, p.line, baseUrl, dvp);
        stats[key] = result;
      })
    );
    return NextResponse.json({ stats });
  } catch (e) {
    console.error('[afl/props-stats/batch]', e);
    return NextResponse.json({ stats: {}, error: 'Failed to compute stats' }, { status: 500 });
  }
}
