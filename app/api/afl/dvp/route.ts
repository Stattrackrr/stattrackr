import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_POSITIONS = new Set(['DEF', 'MID', 'FWD', 'RUC']);
const DEFAULT_SEASON = 2025;
const DEFAULT_STAT = 'disposals';

type DvpRow = {
  opponent: string;
  position: string;
  sampleSize: number;
  perPlayerGame: Record<string, number>;
  indexVsLeague: Record<string, number | null>;
};

type DvpFileShape = {
  generatedAt: string;
  season: number;
  summary?: Record<string, unknown>;
  leagueBaselineByPosition?: Record<string, unknown>;
  rows: DvpRow[];
  missingPlayers?: Array<Record<string, unknown>>;
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const season = parseIntSafe(searchParams.get('season'), DEFAULT_SEASON);
  const positionParam = (searchParams.get('position') || '').trim().toUpperCase();
  const stat = (searchParams.get('stat') || DEFAULT_STAT).trim();
  const order = (searchParams.get('order') || 'desc').trim().toLowerCase(); // desc = easier, asc = harder
  const team = (searchParams.get('team') || '').trim().toLowerCase();
  const top = Math.max(1, Math.min(100, parseIntSafe(searchParams.get('top'), 100)));
  const minSample = Math.max(0, parseIntSafe(searchParams.get('minSample'), 0));

  if (positionParam && !VALID_POSITIONS.has(positionParam)) {
    return NextResponse.json(
      { success: false, error: `Unsupported position '${positionParam}'. Use DEF, MID, FWD, RUC.` },
      { status: 400 }
    );
  }
  if (order !== 'asc' && order !== 'desc') {
    return NextResponse.json(
      { success: false, error: `Unsupported order '${order}'. Use 'desc' (easiest) or 'asc' (hardest).` },
      { status: 400 }
    );
  }

  try {
    const data = await readDvpFile(season);
    const allRows = Array.isArray(data.rows) ? data.rows : [];

    const statExists = allRows.some((r) => r?.perPlayerGame && Number.isFinite(Number(r.perPlayerGame?.[stat])));
    if (!statExists) {
      return NextResponse.json(
        {
          success: false,
          error: `Stat '${stat}' is not available in built DVP file for ${season}.`,
          hint: 'Check keys in rows[].perPlayerGame or rebuild with updated stat mappings.',
        },
        { status: 400 }
      );
    }

    let rows = allRows
      .filter((r) => (positionParam ? r.position === positionParam : true))
      .filter((r) => (team ? r.opponent.toLowerCase().includes(team) : true))
      .filter((r) => Number(r.sampleSize || 0) >= minSample)
      .map((r) => ({
        opponent: r.opponent,
        position: r.position,
        sampleSize: r.sampleSize,
        value: Number(r.perPlayerGame?.[stat] ?? 0),
        index: r.indexVsLeague?.[stat] ?? null,
      }));

    rows.sort((a, b) => (order === 'asc' ? a.value - b.value : b.value - a.value));
    rows = rows.slice(0, top);

    const rankedRows = rows.map((r, i) => ({ rank: i + 1, ...r }));

    return NextResponse.json({
      success: true,
      source: 'afl-dvp-file',
      season,
      stat,
      position: positionParam || 'ALL',
      order,
      totalRows: rankedRows.length,
      generatedAt: data.generatedAt,
      summary: data.summary ?? null,
      rows: rankedRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missingFile = /ENOENT/i.test(message) || /no such file/i.test(message);
    return NextResponse.json(
      {
        success: false,
        error: missingFile ? `DVP file for season ${season} not found.` : 'Failed to read AFL DVP data.',
        details: message,
        hint: `Run: npm run build:afl:dvp -- --season=${season}`,
      },
      { status: missingFile ? 404 : 500 }
    );
  }
}

