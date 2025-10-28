import { NextRequest, NextResponse } from "next/server";
import { normalizeAbbr } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

const NBA_BASE = "https://stats.nba.com/stats";
const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/stats/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

async function nbaFetch(pathAndQuery: string){
  const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, { headers: NBA_HEADERS, cache: "no-store" });
  if (!res.ok){ const t = await res.text().catch(()=>""); throw new Error(`NBA ${res.status}: ${t || pathAndQuery}`);} 
  return res.json();
}

function idx(headers: string[], ...names: string[]){
  const lower = headers.map(h=> String(h||'').toLowerCase());
  for (const n of names){ const i = lower.indexOf(n.toLowerCase()); if (i>=0) return i; }
  return -1;
}

const ABBR_TO_TEAM_ID: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764,
};

export async function GET(req: NextRequest){
  try{
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date'); // YYYY-MM-DD
    const home = normalizeAbbr(searchParams.get('home')||'');
    const away = normalizeAbbr(searchParams.get('away')||'');
    if (!date || !home || !away) return NextResponse.json({ success:false, error:'Missing date, home, or away' }, { status:400 });

    const mdy = (()=>{ const dt = new Date(date); const mm=String(dt.getMonth()+1).padStart(2,'0'); const dd=String(dt.getDate()).padStart(2,'0'); const yyyy=dt.getFullYear(); return `${mm}/${dd}/${yyyy}`; })();
    const sb = await nbaFetch(`scoreboardv2?GameDate=${encodeURIComponent(mdy)}&DayOffset=0`);
    const sset = (sb?.resultSets || []).find((r:any)=> (r?.name||'').toLowerCase().includes('games')) || sb?.resultSets?.[0];
    const h = sset?.headers || [];
    const rows: any[] = sset?.rowSet || [];
    const iGid = idx(h,'GAME_ID');
    const iHome = idx(h,'HOME_TEAM_ID');
    const iAway = idx(h,'VISITOR_TEAM_ID');
    const wantHome = ABBR_TO_TEAM_ID[home]||0;
    const wantAway = ABBR_TO_TEAM_ID[away]||0;
    const row = rows.find(r => (Number(r[iHome])===wantHome && Number(r[iAway])===wantAway) || (Number(r[iHome])===wantAway && Number(r[iAway])===wantHome));
    if (!row) return NextResponse.json({ success:false, error:'Game not found' }, { status:200 });
    const gameId = String(row[iGid]||'');
    return NextResponse.json({ success:true, gameId, date, home, away });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message || 'Failed to get GameID' }, { status:200 });
  }
}
