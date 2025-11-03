export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ABBRS = [
  'ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW',
  'HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK',
  'OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'
];

async function ingestOne(base: string, team: string, season: number, games: number, refresh: boolean) {
  const url = new URL(`${base}/api/dvp/ingest`);
  url.searchParams.set('team', team);
  url.searchParams.set('season', String(season));
  url.searchParams.set('games', String(games));
  if (refresh) url.searchParams.set('refresh', '1');
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const js = await res.json().catch(() => ({ success: false, error: 'parse-failed' }));
  return { team, ok: !!js?.success, data: js };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const season = searchParams.get('season') ? parseInt(String(searchParams.get('season')), 10) : currentNbaSeason();
    const games = Math.min(parseInt(searchParams.get('games') || '50', 10) || 50, 82);
    const refresh = searchParams.get('refresh') === '1';

    const host = req.headers.get('host') || '';
    const base = host ? `http://${host}` : '';

    const results: any[] = [];
    for (const abbr of ABBRS) {
      try {
        const r = await ingestOne(base, abbr, season, games, refresh);
        results.push(r);
      } catch (e: any) {
        results.push({ team: abbr, ok: false, error: e?.message || 'failed' });
      }
    }

    const ok = results.filter(r => r.ok).length;
    return NextResponse.json({ success: true, season, games, refresh, ok, total: ABBRS.length, results });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'ingest-all failed' }, { status: 200 });
  }
}

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}
