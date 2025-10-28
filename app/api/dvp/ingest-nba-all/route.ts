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
    for (const t of teams){
      const url = `http://${host}/api/dvp/ingest-nba?team=${encodeURIComponent(t)}&games=${games}${refresh?'&refresh=1':''}${useRapid?'&useRapid=1':''}${latest?'&latest=1':''}`;
      try{
        const res = await fetch(url, { cache:'no-store' });
        const js = await res.json();
        results.push({ team: t, ok: !!js?.success, data: js });
      }catch(e:any){ results.push({ team: t, ok:false, error: e?.message||'failed' }); }
    }
    return NextResponse.json({ success:true, total: teams.length, results });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message||'ingest nba all failed' }, { status:200 });
  }
}
