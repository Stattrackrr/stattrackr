export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { normalizeAbbr } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

// NBA Stats
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
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "sec-ch-ua": '"Chromium";v=124, "Google Chrome";v=124, "Not=A?Brand";v=99',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};
async function nbaFetch(pathAndQuery: string, timeoutMs = 6000){
  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, { headers: NBA_HEADERS, cache: "no-store", signal: ctrl.signal });
    if (!res.ok){ const t = await res.text().catch(()=>""); throw new Error(`NBA ${res.status}: ${t || pathAndQuery}`);} 
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Ball Don't Lie
const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'StatTrackr/1.0',
  Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
};
async function bdlFetch(url: string){
  const res = await fetch(url, { headers: BDL_HEADERS, cache: 'no-store' });
  if (!res.ok){ const t = await res.text().catch(()=> ''); throw new Error(`BDL ${res.status}: ${t || url}`); }
  return res.json();
}

// Mappings
const ABBR_TO_TEAM_ID: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764,
};
const TEAM_ID_TO_ABBR: Record<number, string> = Object.fromEntries(
  Object.entries(ABBR_TO_TEAM_ID).map(([abbr, id]) => [id as any, abbr])
) as any;
const ABBR_TO_TEAM_ID_BDL: Record<string, number> = { // 1..30
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

function seasonLabelFromYear(y: number){ return `${y}-${String((y+1)%100).padStart(2,'0')}`; }
function formatMDY(d: string | Date){ const dt = typeof d==='string'? new Date(d): d; const mm=String(dt.getMonth()+1).padStart(2,'0'); const dd=String(dt.getDate()).padStart(2,'0'); const yyyy=dt.getFullYear(); return `${mm}/${dd}/${yyyy}`; }
function normName(s: string){
  const base = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv)\b/g,' ').replace(/\s+/g,' ').trim();
  const parts = base.split(' ').filter(Boolean);
  if (parts.length>=2){ const last = parts[parts.length-1]; const first = parts.slice(0,-1); let acc=''; const out:string[]=[]; for (const w of first){ if (w.length===1) acc+=w; else { if (acc){ out.push(acc); acc=''; } out.push(w);} } if (acc) out.push(acc); out.push(last); return out.join(' ');} return base;
}
function altKeys(k: string): string[]{
  const out = new Set<string>([k]);
  const parts = k.split(' ').filter(Boolean);
  if (parts.length>=2){ const p1=parts[0], p2=parts[1]; if (p1.length<=2 || p2.length<=2){ out.add(`${p1}${p2} ${parts.slice(2).join(' ')}`.trim()); } }
  for (let i=0;i<parts.length-1;i++){ if (parts[i].length===1){ const v=[...parts]; v.splice(i,2, parts[i]+parts[i+1]); out.add(v.join(' ')); } }
  return [...out];
}
function idx(headers: string[], ...names: string[]){ const lower = headers.map(h=> String(h||'').toLowerCase()); for (const n of names){ const i = lower.indexOf(n.toLowerCase()); if (i>=0) return i; } return -1; }

function storePath(seasonYear: number, team: string){
  const dir = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear));
  const file = path.join(dir, `${team}.json`);
  return { dir, file };
}

function loadTeamCustom(abbr: string): { aliases: Record<string,string> }{
  try{
    const p = path.resolve(process.cwd(),'data','player_positions','teams',`${abbr}.json`);
    if (!fs.existsSync(p)) return { aliases: {} };
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const als = j?.aliases || {};
    const outAls: any = {};
    for (const [k,v] of Object.entries(als)) outAls[normName(k)] = normName(String(v));
    return { aliases: outAls };
  }catch{ return { aliases: {} }; }
}

async function fetchDepthChartBestMap(teamAbbr: string, host?: string): Promise<Record<string,'PG'|'SG'|'SF'|'PF'|'C'>>{
  try{
    const t = normalizeAbbr(teamAbbr);
    const base = host ? `http://${host}` : (process.env.NEXT_PUBLIC_BASE_URL || '');
    const url = base ? `${base}/api/depth-chart?team=${encodeURIComponent(t)}&refresh=1` : `/api/depth-chart?team=${encodeURIComponent(t)}&refresh=1`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return {} as any;
    const js = await res.json().catch(()=> ({}));
    let dc = js?.depthChart || {};
    // Pull injuries and promote next man up by removing OUT players from the depth columns
    try{
      const injUrl = base ? `${base}/api/injuries?teams=${encodeURIComponent(t)}&per_page=100` : `/api/injuries?teams=${encodeURIComponent(t)}&per_page=100`;
      const ir = await fetch(injUrl, { cache: 'no-store' });
      const ij = await ir.json().catch(()=> ({}));
      const teamInj: any[] = (ij?.injuriesByTeam && ij?.injuriesByTeam[t]) ? ij.injuriesByTeam[t] : (Array.isArray(ij?.injuries)? ij.injuries: []);
      const injSet = new Set<string>();
      for (const it of (teamInj||[])){
        const full = `${it?.player?.first_name||''} ${it?.player?.last_name||''}`.trim();
        const key = normName(full);
        const st = String(it?.status||'').toLowerCase();
        if (/(out|inactive|suspended|g league|dnp)/.test(st)) injSet.add(key);
      }
      const filtered: any = {};
      (['PG','SG','SF','PF','C'] as const).forEach(k=>{
        const arr = Array.isArray(dc[k])? dc[k]: [];
        const mapped = arr.map((p:any)=> typeof p==='string'? p : p?.name).filter(Boolean) as string[];
        const out = mapped.filter(n=> !injSet.has(normName(n)));
        filtered[k] = out.map(n=> ({ name: n, jersey: '' }));
      });
      dc = filtered;
    }catch{}

    // Lock starters to ONLY their starting position and remove their rotation slots
    const posOrder: ('PG'|'SG'|'SF'|'PF'|'C')[] = ['PG','SG','SF','PF','C'];
    const starterLock: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
    for (const pos of posOrder){
      const arr = Array.isArray(dc[pos]) ? dc[pos] : [];
      const first = arr && arr.length ? (typeof arr[0]==='string' ? arr[0] : arr[0]?.name) : null;
      const key = first ? normName(String(first)) : '';
      if (key && !starterLock[key]) starterLock[key] = pos;
    }

    // Build per-player slot indices for non-starters only
    const slots: Record<string, Partial<Record<'PG'|'SG'|'SF'|'PF'|'C', number>>> = {};
    (['PG','SG','SF','PF','C'] as const).forEach(k=>{
      const arr = Array.isArray(dc[k]) ? dc[k] : [];
      arr.forEach((p:any, idx:number)=>{ 
        const name = typeof p==='string'? p : p?.name; 
        const key = name ? normName(name) : ''; 
        if (!key || starterLock[key]) return; 
        const prev = slots[key]?.[k]; 
        const v = Number.isFinite(prev as any) ? Math.min(prev as number, idx) : idx; 
        if (!slots[key]) slots[key] = {}; 
        (slots[key] as any)[k] = v; 
      });
    });

    const best: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
    const heightCache = new Map<string, number>();
    async function getHeightInches(name: string): Promise<number | null>{
      if (heightCache.has(name)) return heightCache.get(name)!;
      try{
        const hUrl = base ? `${base}/api/espn/player?name=${encodeURIComponent(name)}&team=${encodeURIComponent(t)}` : `/api/espn/player?name=${encodeURIComponent(name)}&team=${encodeURIComponent(t)}`;
        const r = await fetch(hUrl, { cache:'no-store' });
        const j = await r.json().catch(()=> null);
        const hNum = Number(j?.data?.height);
        if (!isFinite(hNum)) { heightCache.set(name, NaN); return null; }
        const inches = hNum > 100 ? hNum/2.54 : hNum;
        heightCache.set(name, inches);
        return inches;
      }catch{ heightCache.set(name, NaN); return null; }
    }
    function fallbackPick(posList: ('PG'|'SG'|'SF'|'PF'|'C')[]): 'PG'|'SG'|'SF'|'PF'|'C'{
      for (const p of posOrder) if (posList.includes(p)) return p;
      return posList[0];
    }
    async function breakTie(name: string, posList: ('PG'|'SG'|'SF'|'PF'|'C')[]): Promise<'PG'|'SG'|'SF'|'PF'|'C'>{
      const h = await getHeightInches(name);
      if (h && isFinite(h)){
        if (posList.includes('PG') && posList.includes('SG')) return h < 76 ? 'PG' : 'SG';
        if (posList.includes('SF') && posList.includes('PF')) return h < 79 ? 'SF' : 'PF';
        if (posList.includes('PF') && posList.includes('C')) return h < 82 ? 'PF' : 'C';
      }
      return fallbackPick(posList);
    }
    for (const [name, byPos] of Object.entries(slots)){
      const entries = Object.entries(byPos as Record<string,number>) as Array<[ 'PG'|'SG'|'SF'|'PF'|'C', number]>;
      if (!entries.length) continue;
      const minIdx = Math.min(...entries.map(e=> e[1]));
      const tied = entries.filter(e=> e[1]===minIdx).map(e=> e[0]) as ('PG'|'SG'|'SF'|'PF'|'C')[];
      if (tied.length===1) best[name] = tied[0]; else best[name] = await breakTie(name, tied);
    }
    // Merge starter locks last so starters only have starting position
    for (const [k,pos] of Object.entries(starterLock)) best[k] = pos as any;
    return best as any;
  }catch{ return {} as any; }
}

function parseMinToSeconds(min: any): number {
  const s = String(min || '').trim();
  if (!s) return 0;
  const m = s.split(':');
  if (m.length < 2) return Number(s) || 0;
  const mm = Number(m[0]) || 0;
  const ss = Number(m[1]) || 0;
  return mm*60 + ss;
}

// Light ESPN player query for fallback position/height
async function fetchEspnPlayerBasics(name: string, teamAbbr: string, base: string): Promise<{ pos?: string; height?: number }>{
  try{
    const url = base ? `${base}/api/espn/player?name=${encodeURIComponent(name)}&team=${encodeURIComponent(teamAbbr)}` : `/api/espn/player?name=${encodeURIComponent(name)}&team=${encodeURIComponent(teamAbbr)}`;
    const r = await fetch(url, { cache:'no-store' });
    const j = await r.json();
    const rawPos = String(j?.data?.position || j?.data?.pos || '').toUpperCase();
    const hNum = Number(j?.data?.height);
    const height = Number.isFinite(hNum) ? (hNum > 100 ? hNum/2.54 : hNum) : undefined;
    return { pos: rawPos, height };
  }catch{ return {}; }
}

export async function GET(req: NextRequest){
  try{
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const seasonYear = searchParams.get('season') ? parseInt(String(searchParams.get('season')),10) : currentNbaSeason();
    const limitGames = Math.min(parseInt(searchParams.get('games')||'50',10) || 50, 82);
    const refresh = searchParams.get('refresh') === '1';
    const skipNBA = searchParams.get('skipNBA') === '1';
    const latestOnly = searchParams.get('latest') === '1';
    if (!team) return NextResponse.json({ success:false, error:'Missing team' }, { status:400 });

    const { dir, file } = storePath(seasonYear, team);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir,{ recursive:true });
    if (refresh && fs.existsSync(file)) fs.unlinkSync(file);
    const out: any[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
    const have = new Set(out.map(x=> String(x.gameId)));

    // List games via BDL
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[team];
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page','100');
    gamesUrl.searchParams.append('seasons[]', String(seasonYear));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    const gjs = await bdlFetch(gamesUrl.toString());
    const gdata: any[] = Array.isArray(gjs?.data) ? gjs.data : [];
    const finals = gdata.filter(g=> String(g?.status||'').toLowerCase().includes('final'));
    finals.sort((a,b)=> new Date(b?.date||0).getTime() - new Date(a?.date||0).getTime());
    let picked = finals.slice(0, limitGames).reverse(); // oldest -> newest
    if (latestOnly) {
      const notStored = finals.filter(g => !have.has(String(g?.id)));
      if (notStored.length) {
        notStored.sort((a,b)=> new Date(a?.date||0).getTime() - new Date(b?.date||0).getTime());
        picked = notStored.slice(-1); // only newest not stored
      } else {
        picked = [];
      }
    }

    for (const g of picked){
      const gidBdl = String(g?.id);
      if (!gidBdl || have.has(gidBdl)) continue;
      const when = String(g?.date||'');
      const home = String(g?.home_team?.abbreviation||'');
      const away = String(g?.visitor_team?.abbreviation||'');
      const oppAbbr = home.toUpperCase() === team ? away : home;
      const host = req.headers.get('host') || undefined;
const depthMap = await fetchDepthChartBestMap(oppAbbr, host).catch(()=> ({}));
      // Build starters override map directly from depth chart to ensure exact starters
      const base = host ? `http://${host}` : (process.env.NEXT_PUBLIC_BASE_URL || '');
      const dcUrl = base ? `${base}/api/depth-chart?team=${encodeURIComponent(oppAbbr)}&refresh=1` : `/api/depth-chart?team=${encodeURIComponent(oppAbbr)}&refresh=1`;
      let startersMap: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
      let dcRaw: any = null;
      try {
        const dr = await fetch(dcUrl, { cache:'no-store' });
        const dj = await dr.json();
        const dchart = dj?.depthChart || {};
        dcRaw = dchart;
        (['PG','SG','SF','PF','C'] as const).forEach((k)=>{
          const arr = Array.isArray(dchart[k]) ? dchart[k] : [];
          const first = arr && arr.length ? (typeof arr[0]==='string' ? arr[0] : arr[0]?.name) : null;
          const key = first ? normName(String(first)) : '';
          if (key) startersMap[key] = k;
        });
      } catch {}

      // Depth chart driven only: no NBA starters, use ESPN depth-chart map for all players
      const starterAssign = new Map<string,'PG'|'SG'|'SF'|'PF'|'C'>();

      // Fetch BDL stats rows
      const statsUrl = new URL(`${BDL_BASE}/stats`);
      statsUrl.searchParams.append('game_ids[]', String(gidBdl));
      statsUrl.searchParams.set('per_page','100');
      const sjs2 = await bdlFetch(statsUrl.toString());
      const srows2 = Array.isArray(sjs2?.data)? sjs2.data: [];
      const oppIdBdl2 = ABBR_TO_TEAM_ID_BDL[normalizeAbbr(oppAbbr)];
      const oppRows2 = srows2.filter((r:any)=> r?.team?.id === oppIdBdl2);
      const teamCustom = loadTeamCustom(normalizeAbbr(oppAbbr));

      // Build active set for opponent players in this game
      const activeSet = new Set<string>(oppRows2.filter((r:any)=> parseMinToSeconds((r as any)?.min || '0:00') > 0).map((r:any)=> normName(`${r?.player?.first_name||''} ${r?.player?.last_name||''}`.trim())));
      
      // Recompute best map using depth chart but filtered to active players for THIS game
      const recomputeBestMap = (dchart:any): Record<string,'PG'|'SG'|'SF'|'PF'|'C'> => {
        try{
          // Build compressed active-order lists per position (removes injured/inactive starters and promotes bench)
          const activeByPos: Record<'PG'|'SG'|'SF'|'PF'|'C', string[]> = { PG:[], SG:[], SF:[], PF:[], C:[] } as any;
          (['PG','SG','SF','PF','C'] as const).forEach(k=>{
            const arr = Array.isArray(dchart[k]) ? dchart[k] : [];
            for (const p of arr){
              const name = typeof p==='string'? p : p?.name; const key = normName(String(name||''));
              if (key && activeSet.has(key)) activeByPos[k].push(key);
            }
          });

          // Assign compressed indices (0-based) across positions
          const slots: Record<string, Partial<Record<'PG'|'SG'|'SF'|'PF'|'C', number>>> = {};
          (['PG','SG','SF','PF','C'] as const).forEach(k=>{
            const list = activeByPos[k];
            list.forEach((key, i)=>{ if (!slots[key]) slots[key] = {}; (slots[key] as any)[k] = i; });
          });

          const order: ('PG'|'SG'|'SF'|'PF'|'C')[] = ['PG','SG','SF','PF','C'];
          const best: any = {};
          for (const [name, byPos] of Object.entries(slots)){
            const entries = Object.entries(byPos as Record<string,number>) as Array<[ 'PG'|'SG'|'SF'|'PF'|'C', number]>;
            if (!entries.length) continue;
            // If player is rank 0 at any position, prefer that; else choose the position with smallest compressed rank
            const zero = entries.find(e=> e[1]===0);
            if (zero){ best[name] = zero[0]; continue; }
            const minIdx = Math.min(...entries.map(e=> e[1]));
            const tied = entries.filter(e=> e[1]===minIdx).map(e=> e[0]) as any;
            best[name] = order.find(p=> (tied as any).includes(p)) || tied[0];
          }
          // Force active-first in each column explicitly to that column
          (['PG','SG','SF','PF','C'] as const).forEach(k=>{
            const firstActive = activeByPos[k][0];
            if (firstActive){ best[firstActive] = k; }
          });
          return best as any;
        }catch{ return {}; }
      };

      // If we have a startersMap source dchart, recompute active best map
      let depthActiveMap: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
      try{
        // dchart comes from earlier fetch for startersMap
        if (dcRaw) depthActiveMap = recomputeBestMap(dcRaw);
      }catch{}
      // Build a raw depth map from dcRaw (unfiltered; includes injured/inactive)
      const rawMap: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
      try{
        (['PG','SG','SF','PF','C'] as const).forEach(k=>{
          const arr = Array.isArray((dcRaw as any)?.[k]) ? (dcRaw as any)[k] : [];
          for (const p of arr){
            const name = typeof p === 'string' ? p : p?.name;
            const key = name ? normName(String(name)) : '';
            if (key && !rawMap[key]) rawMap[key] = k;
          }
        });
      }catch{}
      // Prefer active map for players who played, but include all depth-chart names
      const effectiveMap = Object.keys(depthActiveMap).length
        ? { ...rawMap, ...depthActiveMap }
        : { ...rawMap, ...depthMap };

      const buckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG:0, SG:0, SF:0, PF:0, C:0 };
      const players: any[] = [];
      const toTitle = (k: string)=> k.split(' ').map(w=> w? (w[0].toUpperCase()+w.slice(1)) : w).join(' ');
for (const r of oppRows2){
        const name = `${r?.player?.first_name||''} ${r?.player?.last_name||''}`.trim();
        const key = normName(name);
        const lookup = teamCustom.aliases[key] || key;
        const keys = altKeys(lookup);
        // Starters override first, then effective best mapping (try alt keys for apostrophes)
        let starterPos: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = undefined;
        for (const kv of keys){ if ((startersMap as any)[kv] && activeSet.has(kv)) { starterPos = (startersMap as any)[kv]; break; } }
        let bucket: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = starterPos;
        if (!bucket){ for (const kv of keys){ if ((effectiveMap as any)[kv]) { bucket = (effectiveMap as any)[kv]; break; } }
        }
        if (!bucket){
          const partsNk = lookup.split(' ').filter(Boolean);
          const last = partsNk.length ? partsNk[partsNk.length-1] : '';
          if (last){
            const entries = Object.entries(effectiveMap as any) as Array<[string,string]>;
            const matches = entries.filter(([k])=> k.endsWith(` ${last}`) || k===last);
            if (matches.length===1) {
              const pos = matches[0][1];
              if (['PG','SG','SF','PF','C'].includes(pos)) {
                bucket = pos as 'PG'|'SG'|'SF'|'PF'|'C';
              }
            }
          }
        }
        // Final fallback for blowout/garbage-time players: use ESPN primary pos (G/F/C) and map to PG/SG or SF/PF
        if (!bucket){
          try{
            const basics = await fetchEspnPlayerBasics(name, normalizeAbbr(oppAbbr), base || '');
            const p = String(basics?.pos||'').toUpperCase();
            const h = basics?.height;
            const chooseGF = (isGuard: boolean): 'PG'|'SG'|'SF'|'PF' => {
              if (isGuard){ return (h && h < 76) ? 'PG' : 'SG'; }
              return (h && h < 79) ? 'SF' : 'PF';
            };
            if (['PG','SG','SF','PF','C'].includes(p as any)) bucket = p as any;
            else if (p.includes('G')) bucket = chooseGF(true) as any;
            else if (p.includes('F')) bucket = chooseGF(false) as any;
            else if (p.includes('C')) bucket = 'C' as any;
          }catch{}
        }
        // Final fallback: use BDL reported position if available
        if (!bucket){
          try{
            const rawPos = String((r as any)?.player?.position || '').toUpperCase();
            if (['PG','SG','SF','PF','C'].includes(rawPos as any)) bucket = rawPos as any;
            else if (rawPos.includes('G')) bucket = 'SG' as any;
            else if (rawPos.includes('F')) bucket = 'PF' as any;
            else if (rawPos.includes('C')) bucket = 'C' as any;
          }catch{}
        }
        if (!bucket) continue;
        const isStarter = Boolean(starterPos);
        const val = Number(r?.pts||0);
        buckets[bucket]+=val;
        players.push({ playerId: Number(r?.player?.id)||0, name, bucket, isStarter, pts: val, reb: Number(r?.reb||0), ast: Number(r?.ast||0), fg3m: Number(r?.fg3m||0), fg3a: Number(r?.fg3a||0), fgm: Number(r?.fgm||0), fga: Number(r?.fga||0), stl: Number(r?.stl||0), blk: Number(r?.blk||0), min: (r as any)?.min || '0:00' });
      }
      
      // Add zero-line entries for depth-chart players missing from BDL stats
      try{
        const seen = new Set(players.map(p=> normName(p.name)));
        for (const [k,pos] of Object.entries(effectiveMap)){
          if (!seen.has(k)){
            const display = toTitle(k);
            const isStarter = Boolean((startersMap as any)[k]);
            players.push({ playerId: 0, name: display, bucket: pos, isStarter, pts: 0, reb: 0, ast: 0, fg3m: 0, fg3a: 0, fgm: 0, fga: 0, stl: 0, blk: 0, min: '0:00' });
          }
        }
      }catch{}

out.push({ gameId: gidBdl, date: when, opponent: oppAbbr, team, season: seasonLabelFromYear(seasonYear), buckets, players, source: 'bdl+espn' });
    }

    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    return NextResponse.json({ success:true, team, season: seasonYear, stored_games: out.length, file: file.replace(process.cwd(),'') });
  }catch(e:any){
    return NextResponse.json({ success:false, error: e?.message || 'Ingest NBA mode failed' }, { status: 200 });
  }
}

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}
