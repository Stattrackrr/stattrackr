export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { currentNbaSeason } from '@/lib/nbaConstants';

export const runtime = 'nodejs';

/**
 * Full DvP rank snapshot history for one position + metric.
 * Used by chart Advanced Opp D to resolve tip-time ranks per game date.
 *
 * Query: season, pos, metric
 * Returns: { snapshots: [{ snapshotDate, ranks: { TEAM: rank } }] } ascending by date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seasonParam = searchParams.get('season');
    const pos = String(searchParams.get('pos') || '').trim().toUpperCase();
    const metric = String(searchParams.get('metric') || '').trim().toLowerCase();

    if (!pos || !['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) {
      return NextResponse.json({ error: 'Invalid or missing pos' }, { status: 400 });
    }
    if (!metric) {
      return NextResponse.json({ error: 'Missing metric' }, { status: 400 });
    }

    const season = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    if (!Number.isFinite(season)) {
      return NextResponse.json({ error: 'Invalid season' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('dvp_rank_snapshots')
      .select('snapshot_date, team, rank')
      .eq('season', season)
      .eq('position', pos)
      .eq('metric', metric)
      .gt('rank', 0)
      .order('snapshot_date', { ascending: true });

    if (error) {
      console.error('[DvP Rank History] Database error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const grouped = new Map<string, Record<string, number>>();
    for (const row of data || []) {
      const date = String(row.snapshot_date || '').trim().slice(0, 10);
      const team = normalizeAbbr(String(row.team || ''));
      const rank = Number(row.rank);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !team || !Number.isFinite(rank) || rank <= 0) continue;
      if (!grouped.has(date)) grouped.set(date, {});
      grouped.get(date)![team] = Math.round(rank);
    }

    const snapshots = Array.from(grouped.entries()).map(([snapshotDate, ranks]) => ({
      snapshotDate,
      ranks,
    }));

    return NextResponse.json({
      success: true,
      season,
      position: pos,
      metric,
      snapshots,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'History lookup failed';
    console.error('[DvP Rank History] Error:', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
