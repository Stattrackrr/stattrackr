export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { normalizeAbbr, NBA_TEAMS } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

export async function GET(req: NextRequest){
  try{
    const { searchParams } = new URL(req.url);
    const games = Math.min(parseInt(searchParams.get('games')||'1',10)||1, 82);
    const refresh = searchParams.get('refresh') === '1';
    const useRapid = searchParams.get('useRapid') === '1';
    const latest = searchParams.get('latest') === '1';

    const teams = Object.keys(NBA_TEAMS);
    const host = req.headers.get('host') || '';

    const results: any[] = [];
    // Use https in production, http in development
    const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
    for (const t of teams){
      const url = `${protocol}://${host}/api/dvp/ingest-nba?team=${encodeURIComponent(t)}&games=${games}${refresh?'&refresh=1':''}${useRapid?'&useRapid=1':''}${latest?'&latest=1':''}`;
      try{
        const res = await fetch(url, { cache:'no-store' });
        const js = await res.json();
        // Consider it ok if success is true OR if it's a serverless/filesystem error (data was computed)
        const isOk = !!js?.success || (js?.serverless && js?.stored_games !== undefined);
        results.push({ team: t, ok: isOk, data: js });
      }catch(e:any){ results.push({ team: t, ok:false, error: e?.message||'failed' }); }
    }
    return NextResponse.json({ success:true, total: teams.length, results });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message||'ingest nba all failed' }, { status:200 });
  }
}
