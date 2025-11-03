export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toYMD(d = new Date()){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const da=String(d.getDate()).padStart(2,'0'); return `${y}${m}${da}`; }
const toISO = (ymd: string) => `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;

async function fetchEspnScoreboard(ymd: string){
  const urls = [
    `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${encodeURIComponent(ymd)}`,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${encodeURIComponent(ymd)}`,
  ];
  for (const u of urls){
    try{ const r = await fetch(u, { cache: 'no-store' }); if (r && r.ok) return await r.json(); }catch{}
  }
  return null;
}

function getOrigin(req: NextRequest): string {
  try {
    if (req?.nextUrl?.origin) return req.nextUrl.origin;
  } catch {}
  const xfProto = req.headers.get('x-forwarded-proto');
  const xfHost = req.headers.get('x-forwarded-host');
  if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  const host = req.headers.get('host') || 'localhost:3000';
  const proto = (process.env.NODE_ENV === 'production') ? 'https' : 'http';
  return `${proto}://${host}`;
}

async function fetchBdlGamesByDate(ymd: string){
  try{
    const iso = toISO(ymd);
    const key = process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd';
    const h: Record<string,string> = { Accept: 'application/json', 'User-Agent': 'StatTrackr/1.0' };
    if (key) h['Authorization'] = `Bearer ${key}`;
    const r = await fetch(`https://api.balldontlie.io/v1/games?start_date=${encodeURIComponent(iso)}&end_date=${encodeURIComponent(iso)}&per_page=100`, { headers: h, cache: 'no-store' });
    if (!r.ok) return [] as any[];
    const j = await r.json().catch(()=> ({}));
    return Array.isArray(j?.data) ? j.data : [];
  }catch{ return [] as any[]; }
}

export async function GET(req: NextRequest){
  try{
    const { searchParams } = new URL(req.url);
    const ymd = searchParams.get('date') || toYMD(new Date());
    const windowMin = parseInt(searchParams.get('window_min')||'15',10) || 15; // trigger within next N minutes

    const now = Date.now();
    const warmed: string[] = [];

    // 1) ESPN scoreboard (preferred)
    const espn = await fetchEspnScoreboard(ymd);
    if (espn && Array.isArray(espn.events) && espn.events.length){
      const events: any[] = espn.events;
      const toAbbr = (c:any)=> String(c?.team?.abbreviation||'').toUpperCase();
      for (const e of events){
        const comp = e?.competitions?.[0];
        const comps = comp?.competitors || [];
        const home = toAbbr(comps.find((x:any)=> String(x?.homeAway||'')==='home'));
        const away = toAbbr(comps.find((x:any)=> String(x?.homeAway||'')==='away'));
        const dateStr = comp?.date || e?.date || e?.startDate || '';
        const tip = dateStr ? new Date(dateStr).getTime() : 0;
        if (!home || !away || !tip) continue;
        const minsToTip = (tip - now) / 60000;
        if (minsToTip <= windowMin && minsToTip >= -10){
          const origin = getOrigin(req);
          try{ const r = await fetch(`${origin}/api/depth-chart?team=${encodeURIComponent(home)}&refresh=1`, { cache: 'no-store' }); const j = await r.json().catch(()=>({})); if (j?.changed) warmed.push(home); }catch{}
          try{ const r = await fetch(`${origin}/api/depth-chart?team=${encodeURIComponent(away)}&refresh=1`, { cache: 'no-store' }); const j = await r.json().catch(()=>({})); if (j?.changed) warmed.push(away); }catch{}
        }
      }
      return NextResponse.json({ success:true, date: ymd, warmed: Array.from(new Set(warmed)), source: 'espn' });
    }

    // 2) Fallback to BallDontLie games for the date
    const bdlGames = await fetchBdlGamesByDate(ymd);
    if (bdlGames.length){
      for (const g of bdlGames){
        const home = String(g?.home_team?.abbreviation||'').toUpperCase();
        const away = String(g?.visitor_team?.abbreviation||'').toUpperCase();
        const dateStr = g?.date || '';
        const tip = dateStr ? new Date(dateStr).getTime() : 0;
        if (!home || !away || !tip) continue;
        const minsToTip = (tip - now) / 60000;
        if (minsToTip <= windowMin && minsToTip >= -10){
          const origin = getOrigin(req);
          try{ const r = await fetch(`${origin}/api/depth-chart?team=${encodeURIComponent(home)}&refresh=1`, { cache: 'no-store' }); const j = await r.json().catch(()=>({})); if (j?.changed) warmed.push(home); }catch{}
          try{ const r = await fetch(`${origin}/api/depth-chart?team=${encodeURIComponent(away)}&refresh=1`, { cache: 'no-store' }); const j = await r.json().catch(()=>({})); if (j?.changed) warmed.push(away); }catch{}
        }
      }
      return NextResponse.json({ success:true, date: ymd, warmed: Array.from(new Set(warmed)), source: 'bdl' });
    }

    // No data from either source
    return NextResponse.json({ success:false, error:`no games for date ${ymd}` }, { status:200 });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message||'failed' }, { status:200 });
  }
}
