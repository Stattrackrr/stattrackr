import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

const CURRENT_SEASON = process.env.AFL_CURRENT_SEASON || String(new Date().getFullYear());
const SUPPORTED_SEASONS = [2026, 2025, 2024] as const;

/** Read cached team rankings. Run scripts/fetch-footywire-team-rankings.js to refresh. */
function readCachedTeamRankings(season: number, type: 'ta' | 'oa' = 'ta') {
  const readRaw = (which: 'primary' | 'legacy'): string | null => {
    if (which === 'primary') {
      if (season === 2026) return fs.readFileSync(path.join(process.cwd(), 'data', type === 'oa' ? 'afl-team-rankings-2026-oa.json' : 'afl-team-rankings-2026-ta.json'), 'utf8');
      if (season === 2025) return fs.readFileSync(path.join(process.cwd(), 'data', type === 'oa' ? 'afl-team-rankings-2025-oa.json' : 'afl-team-rankings-2025-ta.json'), 'utf8');
      if (season === 2024) return fs.readFileSync(path.join(process.cwd(), 'data', type === 'oa' ? 'afl-team-rankings-2024-oa.json' : 'afl-team-rankings-2024-ta.json'), 'utf8');
      return null;
    }
    if (season === 2026) return fs.readFileSync(path.join(process.cwd(), 'data', 'afl-team-rankings-2026.json'), 'utf8');
    if (season === 2025) return fs.readFileSync(path.join(process.cwd(), 'data', 'afl-team-rankings-2025.json'), 'utf8');
    if (season === 2024) return fs.readFileSync(path.join(process.cwd(), 'data', 'afl-team-rankings-2024.json'), 'utf8');
    return null;
  };

  const parse = (raw: string) => {
    const data = JSON.parse(raw) as {
      season?: number;
      teams?: Array<{ rank: number | null; team: string; stats: Record<string, number | string | null> }>;
      statColumns?: string[];
      statLabels?: Record<string, string>;
    };
    if (!data?.teams?.length) return null;
    return data;
  };

  try {
    const raw = readRaw('primary');
    if (raw) {
      const parsed = parse(raw);
      if (parsed) return parsed;
    } 
  } catch {
    /* try legacy */
  }
  try {
    const raw = readRaw('legacy');
    if (raw) {
      const parsed = parse(raw);
      if (parsed) return parsed;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function GET(request: NextRequest) {
  const seasonParam = request.nextUrl.searchParams.get('season');
  const typeParam = request.nextUrl.searchParams.get('type') as 'ta' | 'oa' | null;
  const type = typeParam === 'oa' ? 'oa' : 'ta';
  const requestedSeason = seasonParam ? parseInt(seasonParam, 10) : parseInt(CURRENT_SEASON, 10) || new Date().getFullYear();
  const season = SUPPORTED_SEASONS.includes(requestedSeason as (typeof SUPPORTED_SEASONS)[number])
    ? requestedSeason
    : 2026;

  const cached = readCachedTeamRankings(season, type);
  if (!cached) {
    const prev = readCachedTeamRankings(season - 1, type);
    if (prev) {
      // Return previous season's data with its actual season so clients can show "2026 stats when ready" instead of 2025 data.
      return NextResponse.json({
        ...prev,
        _note: `No data for ${season}; returning ${season - 1}`,
      });
    }
    return NextResponse.json(
      { error: 'Team rankings not found. Run: npm run fetch:footywire-team-rankings' },
      { status: 404 }
    );
  }

  return NextResponse.json(cached);
}
