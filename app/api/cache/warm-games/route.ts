export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import sharedCache from '@/lib/sharedCache';

// Minimal team map (BDL IDs)
const TEAM_ID_TO_ABBR: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};
const TEAM_IDS = Object.keys(TEAM_ID_TO_ABBR).map((k) => parseInt(k, 10));

// Warm shared cache for games by team and season. Call this endpoint from your scheduler (e.g., 03:30 and 05:30 ET).
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const seasonsParam = searchParams.getAll('seasons[]');
    const perPage = searchParams.get('per_page') || '100';
    const seasons = seasonsParam.length > 0 ? seasonsParam.map(Number) : [new Date().getFullYear()];

    const tasks: Promise<any>[] = [];
    for (const s of seasons) {
      for (const id of TEAM_IDS) {
        const p = new URLSearchParams();
        p.set('seasons[]', String(s));
        p.set('team_ids[]', String(id));
        p.set('per_page', perPage);
        // Call our own API route to populate both shared and memory caches
        tasks.push(fetch(`${req.nextUrl.origin}/api/bdl/games?${p.toString()}`).then((r) => r.ok ? r.json() : null));
      }
    }

    // Simple concurrency: chunk in groups of 6
    const chunk = 6;
    for (let i = 0; i < tasks.length; i += chunk) {
      /* eslint-disable no-await-in-loop */
      await Promise.allSettled(tasks.slice(i, i + chunk));
      /* eslint-enable no-await-in-loop */
    }

    return NextResponse.json({ ok: true, warmed: TEAM_IDS.length * seasons.length, seasons });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'warm failed' }, { status: 500 });
  }
}
