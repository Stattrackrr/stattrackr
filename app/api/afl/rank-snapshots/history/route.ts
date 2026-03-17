import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { opponentToFootywireTeam, opponentToOfficialTeamName } from '@/lib/aflTeamMapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_SEASON = 2026;

function parseSeason(v: string | null): number {
  if (!v) return DEFAULT_SEASON;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEASON;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const season = parseSeason(searchParams.get('season'));
  const source = (searchParams.get('source') || '').trim().toLowerCase();
  const metric = String(searchParams.get('metric') || '').trim();
  const positionRaw = String(searchParams.get('position') || '').trim().toUpperCase();
  const position = source === 'dvp' ? (positionRaw || 'MID') : 'ALL';

  if (source !== 'oa' && source !== 'dvp') {
    return NextResponse.json({ success: false, error: "Invalid source. Use 'oa' or 'dvp'." }, { status: 400 });
  }
  if (!metric) {
    return NextResponse.json({ success: false, error: 'Missing metric.' }, { status: 400 });
  }

  const metricKey = source === 'oa' ? metric.toUpperCase() : metric.toLowerCase();

  const { data, error } = await supabaseAdmin
    .from('afl_rank_snapshots')
    .select('snapshot_date,team,rank')
    .eq('season', season)
    .eq('source', source)
    .eq('position', position)
    .eq('metric', metricKey)
    .order('snapshot_date', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const grouped = new Map<string, Record<string, number>>();
  for (const row of data || []) {
    const date = String(row.snapshot_date || '').trim();
    const teamRaw = String(row.team || '').trim();
    const rank = Number(row.rank);
    if (!date || !teamRaw || !Number.isFinite(rank)) continue;
    if (!grouped.has(date)) grouped.set(date, {});
    const ranks = grouped.get(date)!;

    const variants = new Set<string>([teamRaw.toLowerCase()]);
    const footy = opponentToFootywireTeam(teamRaw);
    const official = opponentToOfficialTeamName(teamRaw);
    if (footy) variants.add(footy.toLowerCase());
    if (official) variants.add(official.toLowerCase());
    if (footy) {
      const officialFromFooty = opponentToOfficialTeamName(footy);
      if (officialFromFooty) variants.add(officialFromFooty.toLowerCase());
    }

    for (const key of variants) {
      ranks[key] = Math.max(1, Math.min(18, Math.round(rank)));
    }
  }

  const snapshots = Array.from(grouped.entries()).map(([snapshotDate, ranks]) => ({
    snapshotDate,
    ranks,
  }));

  return NextResponse.json({
    success: true,
    season,
    source,
    metric: metricKey,
    position,
    snapshots,
  });
}
