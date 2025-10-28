import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest){
  try{
    const host = req.headers.get('host') || '';
    const base = host ? `http://${host}` : '';
    const url = `${base}/api/bdl/players?all=true&per_page=100&max_hops=60`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return NextResponse.json({ success:false, error:`upstream ${r.status}` }, { status:200 });
    const j = await r.json();
    const arr: any[] = Array.isArray(j?.results)? j.results: [];
    const list = arr.filter(p=> typeof p?.full==='string' && p.full.includes("'"));
    // Sort by last name then first
    const sorted = [...list].sort((a,b)=> String(a.full).localeCompare(String(b.full)));
    return NextResponse.json({ success:true, count: sorted.length, players: sorted });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message||'failed' }, { status:200 });
  }
}