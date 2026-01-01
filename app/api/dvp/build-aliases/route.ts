export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const ABBRS = [
  'ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW',
  'HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK',
  'OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'
];

// Ball Don't Lie
const BDL_BASE = 'https://api.balldontlie.io/v1';
function getBdlHeaders(): Record<string, string> {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable is required');
  }
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function bdlFetch(url: string){
  const res = await fetch(url, { headers: getBdlHeaders(), cache: 'no-store' });
  if (!res.ok){ const t = await res.text().catch(()=> ''); throw new Error(`BDL ${res.status}: ${t || url}`); }
  return res.json();
}
const ABBR_TO_TEAM_ID_BDL: Record<string, number> = { // 1..30
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

// ESPN
async function espnFetch(url: string){
  const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}
function formatYMD(d: string | Date){
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear(); const m = String(dt.getMonth()+1).padStart(2,'0'); const da = String(dt.getDate()).padStart(2,'0');
  return `${y}${m}${da}`;
}
async function fetchEspnRosterNames(dateStr: string, homeAbbr: string, awayAbbr: string): Promise<string[]>{
  try{
    const ymd = /\d{8}/.test(dateStr) ? dateStr : formatYMD(dateStr);
    const sb = await espnFetch(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${ymd}`);
    const events = sb?.events || [];
    let evt: any = null;
    for (const e of events){
      const comps = e?.competitions?.[0]?.competitors || [];
      const abbrs = comps.map((c:any)=> String(c?.team?.abbreviation||'').toUpperCase());
      if (abbrs.includes(String(homeAbbr).toUpperCase()) && abbrs.includes(String(awayAbbr).toUpperCase())) { evt = e; break; }
    }
    if (!evt) return [];
    const eventId = String(evt?.id || evt?.uid?.split(':').pop() || '');
    if (!eventId) return [];
    const sum = await espnFetch(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/summary?event=${eventId}`);
    const names: string[] = [];
    const addAth = (a:any)=>{
      const nm = String(a?.athlete?.displayName || a?.athlete?.fullName || a?.athlete?.name || a?.displayName || a?.name || '').trim();
      if (nm) names.push(nm);
    };
    const box = sum?.boxscore;
    const teams = box?.players || box?.teams || [];
    for (const t of teams){
      const aths = t?.athletes || t?.statistics?.[0]?.athletes || [];
      if (Array.isArray(aths)) aths.forEach(addAth);
    }
    for (const t of (box?.teams||[])){
      const aths = t?.players || [];
      if (Array.isArray(aths)) aths.forEach(addAth);
    }
    return names;
  }catch{ return []; }
}

function normName(s: string){
  const base = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,' ').replace(/\s+/g,' ').trim();
  const parts = base.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1);
    let acc = '';
    const out: string[] = [];
    for (const w of first) { if (w.length === 1) acc += w; else { if (acc) { out.push(acc); acc=''; } out.push(w); } }
    if (acc) out.push(acc);
    out.push(last);
    return out.join(' ');
  }
  return base;
}

function fuzzyMatchByLastAndInitial(a: string, b: string){
  const as = a.split(' '); const bs = b.split(' ');
  const al = as[as.length-1]; const bl = bs[bs.length-1];
  if (al !== bl) return false;
  const ai = as[0]?.[0]; const bi = bs[0]?.[0];
  return ai && bi && ai === bi;
}

function readTeamFile(team: string){
  const p = path.resolve(process.cwd(),'data','player_positions','teams',`${team}.json`);
  if (!fs.existsSync(p)) return { file:p, json:{ team, season:'', players:[], positions:{}, aliases:{} } } as any;
  return { file: p, json: JSON.parse(fs.readFileSync(p,'utf8')) } as any;
}

export async function GET(req: NextRequest){
  try{
    // Authentication check - admin only
    const { authorizeAdminRequest } = await import('@/lib/adminAuth');
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const { checkRateLimit, strictRateLimiter } = await import('@/lib/rateLimit');
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }
    const { searchParams } = new URL(req.url);
    const seasonYear = searchParams.get('season') ? parseInt(String(searchParams.get('season')),10) : new Date().getFullYear();
    const games = Math.min(parseInt(searchParams.get('games') || '10',10) || 10, 50);

    const updates: any[] = [];
    for (const team of ABBRS){
      const bdlId = ABBR_TO_TEAM_ID_BDL[team];
      const gurl = new URL(`${BDL_BASE}/games`);
      gurl.searchParams.set('per_page','100');
      gurl.searchParams.append('seasons[]', String(seasonYear));
      gurl.searchParams.append('team_ids[]', String(bdlId));
      const gjs = await bdlFetch(gurl.toString());
      const gd: any[] = Array.isArray(gjs?.data)? gjs.data: [];
      const finals = gd.filter(g=> String(g?.status||'').toLowerCase().includes('final'))
        .sort((a,b)=> new Date(b?.date||0).getTime() - new Date(a?.date||0).getTime())
        .slice(0,games);

      // Build sets
      const espnKeys = new Set<string>();
      const bdlKeys = new Set<string>();
      for (const g of finals){
        const home = String(g?.home_team?.abbreviation||'');
        const away = String(g?.visitor_team?.abbreviation||'');
        const names = await fetchEspnRosterNames(String(g?.date||''), home, away);
        names.forEach(n=> espnKeys.add(normName(n)));
        // BDL opponent rows too
        const statsUrl = new URL(`${BDL_BASE}/stats`);
        statsUrl.searchParams.append('game_ids[]', String(g.id));
        statsUrl.searchParams.set('per_page','100');
        const sjs = await bdlFetch(statsUrl.toString());
        const rows = Array.isArray(sjs?.data)? sjs.data: [];
        rows.forEach((r:any)=> bdlKeys.add(normName(`${r?.player?.first_name||''} ${r?.player?.last_name||''}`.trim())));
      }

      const { file, json } = readTeamFile(team);
      json.aliases = json.aliases && typeof json.aliases==='object'? json.aliases: {};

      // Suggest aliases
      for (const b of bdlKeys){
        if (espnKeys.has(b)) continue;
        // find ESPN candidate by last name + first initial
        const match = Array.from(espnKeys).find(e=> fuzzyMatchByLastAndInitial(b,e));
        if (match){
          json.aliases[b] = match; // b (variant) -> match (canonical)
        }
      }

      fs.mkdirSync(path.dirname(file), { recursive:true });
      fs.writeFileSync(file, JSON.stringify(json, null, 2));
      updates.push({ team, aliases: Object.keys(json.aliases||{}).length });
    }

    return NextResponse.json({ success:true, season:seasonYear, games, updates });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message || 'alias build failed' }, { status:200 });
  }
}
