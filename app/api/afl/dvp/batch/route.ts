import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { opponentToFootywireTeam } from '@/lib/aflTeamMapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_SEASON = 2025;
const VALID_POSITIONS = new Set(['DEF', 'MID', 'FWD', 'RUC']);

type DvpRow = {
  opponent: string;
  position: string;
  sampleSize: number;
  perPlayerGame: Record<string, number>;
  perTeamGame?: Record<string, number | null>;
  teamGames?: number;
};

type DvpFileShape = {
  generatedAt: string;
  season: number;
  rows: DvpRow[];
};

type OaTeamRow = {
  team: string;
  stats?: Record<string, number | string | null>;
};

type OaFileShape = {
  season: number;
  type: string;
  teams: OaTeamRow[];
};

function parseIntSafe(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function readDvpFile(season: number): Promise<DvpFileShape> {
  const file = path.join(process.cwd(), 'data', `afl-dvp-${season}.json`);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as DvpFileShape;
}

async function readOaFile(season: number): Promise<OaFileShape | null> {
  try {
    const file = path.join(process.cwd(), 'data', `afl-team-rankings-${season}-oa.json`);
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as OaFileShape;
  } catch {
    return null;
  }
}

const STAT_TO_OA_CODE: Record<string, string> = {
  disposals: 'D',
  kicks: 'K',
  handballs: 'HB',
  marks: 'M',
  goals: 'G',
  tackles: 'T',
  clearances: 'CL',
  inside_50s: 'I50',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const season = parseIntSafe(searchParams.get('season'), DEFAULT_SEASON);
  const position = (searchParams.get('position') || '').trim().toUpperCase();
  const statsParam = (searchParams.get('stats') || '').trim();

  if (!VALID_POSITIONS.has(position)) {
    return NextResponse.json(
      { success: false, error: `Unsupported position '${position}'. Use DEF, MID, FWD, RUC.` },
      { status: 400 }
    );
  }

  try {
    const data = await readDvpFile(season);
    const allRows = Array.isArray(data.rows) ? data.rows : [];
    const rows = allRows.filter((r) => r.position === position);
    const oa = await readOaFile(season);

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `No DVP rows found for position ${position} in ${season}.` },
        { status: 404 }
      );
    }

    const availableStats = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.perPlayerGame || {})) availableStats.add(k);
    }

    const requestedStats = statsParam
      ? statsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : [...availableStats];
    const stats = requestedStats.filter((s) => availableStats.has(s));

    if (stats.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid stats requested.', availableStats: [...availableStats].sort() },
        { status: 400 }
      );
    }

    const metrics: Record<
      string,
      {
        values: Record<string, number>;
        ranks: Record<string, number>;
        teamTotalValues: Record<string, number>;
        teamTotalRanks: Record<string, number>;
        samples: Record<string, number>;
        teamGames: Record<string, number>;
      }
    > = {};

    for (const stat of stats) {
      const values: Record<string, number> = {};
      const teamTotalValues: Record<string, number> = {};
      const samples: Record<string, number> = {};
      const teamGames: Record<string, number> = {};
      for (const r of rows) {
        const v = Number(r.perPlayerGame?.[stat] ?? NaN);
        if (Number.isFinite(v)) {
          values[r.opponent] = v;
          samples[r.opponent] = Number(r.sampleSize || 0);
        }
        const tv = Number(r.perTeamGame?.[stat] ?? NaN);
        if (Number.isFinite(tv)) {
          teamTotalValues[r.opponent] = tv;
        }
        if (Number.isFinite(Number(r.teamGames))) {
          teamGames[r.opponent] = Number(r.teamGames || 0);
        }
      }

      const sorted = Object.entries(values).sort((a, b) => a[1] - b[1]); // low->high
      const ranks: Record<string, number> = {};
      sorted.forEach(([team], idx) => {
        ranks[team] = idx + 1; // 1 = hardest (lowest allowed), N = easiest (highest allowed)
      });

      const sortedTeamTotals = Object.entries(teamTotalValues).sort((a, b) => a[1] - b[1]); // low->high
      const teamTotalRanks: Record<string, number> = {};
      sortedTeamTotals.forEach(([team], idx) => {
        teamTotalRanks[team] = idx + 1;
      });

      // Calibrate team totals to OA team-level totals so position sums align with Opponent Breakdown.
      const oaCode = STAT_TO_OA_CODE[stat];
      if (oa && oaCode) {
        const sumByOpponent: Record<string, number> = {};
        for (const rAll of allRows) {
          const vAll = Number(rAll.perTeamGame?.[stat] ?? NaN);
          if (Number.isFinite(vAll)) {
            sumByOpponent[rAll.opponent] = (sumByOpponent[rAll.opponent] || 0) + vAll;
          }
        }

        for (const opp of Object.keys(teamTotalValues)) {
          const footywireName = opponentToFootywireTeam(opp);
          if (!footywireName) continue;
          const oaRow = oa.teams.find((t) => String(t.team || '').toLowerCase() === footywireName.toLowerCase());
          const oaRaw = oaRow?.stats?.[oaCode];
          const oaValue = Number(oaRaw);
          const denom = Number(sumByOpponent[opp] || 0);
          if (!Number.isFinite(oaValue) || oaValue <= 0 || !Number.isFinite(denom) || denom <= 0) continue;
          const factor = oaValue / denom;
          teamTotalValues[opp] = Math.round(teamTotalValues[opp] * factor * 100) / 100;
        }

        // Re-rank after calibration
        const recalibrated = Object.entries(teamTotalValues).sort((a, b) => a[1] - b[1]);
        const recalibratedRanks: Record<string, number> = {};
        recalibrated.forEach(([team], idx) => {
          recalibratedRanks[team] = idx + 1;
        });
        Object.assign(teamTotalRanks, recalibratedRanks);
      }

      metrics[stat] = { values, ranks, teamTotalValues, teamTotalRanks, samples, teamGames };
    }

    const opponents = [...new Set(rows.map((r) => r.opponent))].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      success: true,
      source: 'afl-dvp-file',
      season,
      position,
      generatedAt: data.generatedAt,
      opponents,
      metrics,
      metricCount: stats.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingFile = /ENOENT/i.test(message) || /no such file/i.test(message);
    return NextResponse.json(
      {
        success: false,
        error: missingFile ? `DVP file for season ${season} not found.` : 'Failed to read AFL DVP batch data.',
        details: message,
        hint: `Run: npm run build:afl:dvp -- --season=${season}`,
      },
      { status: missingFile ? 404 : 500 }
    );
  }
}

