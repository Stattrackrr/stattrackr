import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { authorizeCronRequest } from '@/lib/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_SEASON = 2026;
const DVP_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;
const DVP_STATS = [
  'disposals',
  'kicks',
  'handballs',
  'marks',
  'goals',
  'tackles',
  'clearances',
  'inside_50s',
  'uncontested_possessions',
  'contested_possessions',
  'meters_gained',
  'free_kicks_for',
  'free_kicks_against',
];

type SnapshotRow = {
  snapshot_date: string;
  season: number;
  source: 'oa' | 'dvp';
  position: string;
  metric: string;
  team: string;
  rank: number;
};

type OaTeamRow = {
  team?: string | null;
  stats?: Record<string, number | string | null> | null;
};

function parseSeason(v: string | null): number {
  if (!v) return DEFAULT_SEASON;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : DEFAULT_SEASON;
}

function toAestDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function runSnapshot(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const season = parseSeason(searchParams.get('season'));
  const snapshotDate = searchParams.get('date') || toAestDateString();
  const origin = new URL(request.url).origin;

  const rows: SnapshotRow[] = [];

  const oaRes = await fetchJson(`${origin}/api/afl/team-rankings?season=${season}&type=oa`);
  const oaTeams: OaTeamRow[] = Array.isArray(oaRes?.teams) ? (oaRes.teams as OaTeamRow[]) : [];
  if (oaTeams.length > 0) {
    const allMetricCodes = new Set<string>();
    for (const t of oaTeams) {
      const stats = t?.stats && typeof t.stats === 'object' ? t.stats : {};
      for (const [code, raw] of Object.entries(stats as Record<string, unknown>)) {
        const val = Number(raw);
        if (Number.isFinite(val)) allMetricCodes.add(String(code).toUpperCase());
      }
    }

    for (const metricCode of allMetricCodes) {
      const values = oaTeams
        .map((t: OaTeamRow) => ({
          team: String(t?.team ?? '').trim(),
          value: Number(t?.stats?.[metricCode] ?? NaN),
        }))
        .filter((x) => x.team && Number.isFinite(x.value))
        .sort((a, b) => a.value - b.value); // low->high (rank 1 toughest)

      values.forEach((x, idx) => {
        rows.push({
          snapshot_date: snapshotDate,
          season,
          source: 'oa',
          position: 'ALL',
          metric: metricCode,
          team: x.team,
          rank: idx + 1,
        });
      });
    }
  }

  for (const position of DVP_POSITIONS) {
    const dvpRes = await fetchJson(
      `${origin}/api/afl/dvp/batch?season=${season}&position=${position}&stats=${encodeURIComponent(DVP_STATS.join(','))}`
    );
    const metrics = dvpRes?.metrics && typeof dvpRes.metrics === 'object' ? dvpRes.metrics : {};
    for (const [metricKeyRaw, metricDataRaw] of Object.entries(metrics as Record<string, unknown>)) {
      const metricKey = String(metricKeyRaw || '').trim().toLowerCase();
      if (!metricKey) continue;
      const teamRanks =
        metricDataRaw &&
        typeof metricDataRaw === 'object' &&
        (metricDataRaw as { teamTotalRanks?: Record<string, number> }).teamTotalRanks
          ? (metricDataRaw as { teamTotalRanks: Record<string, number> }).teamTotalRanks
          : null;
      if (!teamRanks) continue;
      for (const [teamRaw, rankRaw] of Object.entries(teamRanks)) {
        const team = String(teamRaw ?? '').trim();
        const rank = Number(rankRaw);
        if (!team || !Number.isFinite(rank)) continue;
        rows.push({
          snapshot_date: snapshotDate,
          season,
          source: 'dvp',
          position,
          metric: metricKey,
          team,
          rank: Math.max(1, Math.min(18, Math.round(rank))),
        });
      }
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: 'No AFL rank snapshot rows generated.' }, { status: 500 });
  }

  const { error } = await supabaseAdmin
    .from('afl_rank_snapshots')
    .upsert(rows, { onConflict: 'snapshot_date,season,source,position,metric,team' });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    snapshotDate,
    season,
    rows: rows.length,
    oaRows: rows.filter((r) => r.source === 'oa').length,
    dvpRows: rows.filter((r) => r.source === 'dvp').length,
  });
}

export async function POST(request: NextRequest) {
  const adminAuth = await authorizeAdminRequest(request);
  const cronAuth = authorizeCronRequest(request);
  if (!adminAuth.authorized && !cronAuth.authorized) {
    return adminAuth.response || cronAuth.response;
  }
  return runSnapshot(request);
}

export async function GET(request: NextRequest) {
  const adminAuth = await authorizeAdminRequest(request);
  const cronAuth = authorizeCronRequest(request);
  if (!adminAuth.authorized && !cronAuth.authorized) {
    return adminAuth.response || cronAuth.response;
  }
  return runSnapshot(request);
}
