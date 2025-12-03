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
async function nbaFetch(pathAndQuery: string, timeoutMs = 30000, retries = 3){
  // Retry logic with exponential backoff
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(()=> ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, { headers: NBA_HEADERS, cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok){ 
        const t = await res.text().catch(()=>""); 
        throw new Error(`NBA ${res.status}: ${t || pathAndQuery}`);
      } 
      return await res.json();
    } catch (e: any) {
      clearTimeout(timer);
      const isAbort = e?.name === 'AbortError' || e?.message?.includes('aborted');
      const isLastAttempt = attempt === retries - 1;
      
      if (isLastAttempt) {
        throw e; // Re-throw on last attempt
      }
      
      if (isAbort) {
        // Timeout - wait longer before retry
        const delayMs = (attempt + 1) * 2000; // 2s, 4s, 6s delays
        console.error(`[DvP Ingest-NBA]   NBA API timeout (attempt ${attempt + 1}/${retries}), retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        // Other error - shorter delay
        const delayMs = (attempt + 1) * 1000; // 1s, 2s, 3s delays
        console.error(`[DvP Ingest-NBA]   NBA API error (attempt ${attempt + 1}/${retries}): ${e.message}, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error('NBA API fetch failed after all retries');
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

// ESPN helpers for starter identification
async function espnFetch(url: string, retries = 2){
  const headers = { 
    'Accept': 'application/json', 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.espn.com/'
  };
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return await res.json();
      if (res.status === 404 && attempt < retries - 1) {
        // Try alternative endpoint
        const altUrl = url.replace('site.web.api.espn.com', 'site.api.espn.com');
        if (altUrl !== url) {
          const altRes = await fetch(altUrl, { headers, cache: 'no-store' });
          if (altRes.ok) return await altRes.json();
        }
      }
      throw new Error(`ESPN ${res.status}: ${res.statusText}`);
    } catch (e: any) {
      if (attempt === retries - 1) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error('ESPN fetch failed after retries');
}
function formatYMD(d: string | Date){
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear(); const m = String(dt.getMonth()+1).padStart(2,'0'); const da = String(dt.getDate()).padStart(2,'0');
  return `${y}${m}${da}`;
}
type EspnRosterInfo = { pos: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'|'G'|'F'|string>, starters: string[], starterOrder: string[] };
async function fetchEspnRosterMapByDate(dateStr: string, homeAbbr: string, awayAbbr: string, opponentAbbr?: string): Promise<EspnRosterInfo>{
  try{
    const ymd = /\d{8}/.test(dateStr) ? dateStr : formatYMD(dateStr);
    
    // Try multiple ESPN endpoints
    const scoreboardUrls = [
      `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${ymd}`,
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ymd}`,
    ];
    
    let sb: any = null;
    for (const url of scoreboardUrls) {
      try {
        sb = await espnFetch(url);
        if (sb?.events) break;
      } catch (e: any) {
        // Continue to next URL
        if (url === scoreboardUrls[scoreboardUrls.length - 1]) {
          throw e; // Re-throw if last URL fails
        }
      }
    }
    
    if (!sb) return { pos: {}, starters: [], starterOrder: [] };
    
    const events = sb?.events || [];
    let evt: any = null;
    for (const e of events){
      const comps = e?.competitions?.[0]?.competitors || [];
      const abbrs = comps.map((c:any)=> String(c?.team?.abbreviation||'').toUpperCase());
      if (abbrs.includes(String(homeAbbr).toUpperCase()) && abbrs.includes(String(awayAbbr).toUpperCase())) { 
        evt = e; 
        console.error(`[DvP Ingest-NBA]   ESPN: Found game event with teams: ${abbrs.join(', ')}`);
        break; 
      }
    }
    if (!evt) {
      console.error(`[DvP Ingest-NBA]   ESPN: Game not found in scoreboard for ${homeAbbr} vs ${awayAbbr} on ${ymd}`);
      return { pos: {}, starters: [], starterOrder: [] };
    }
    
    const eventId = String(evt?.id || evt?.uid?.split(':').pop() || '');
    if (!eventId) {
      console.error(`[DvP Ingest-NBA]   ESPN: No event ID found for game ${homeAbbr} vs ${awayAbbr}`);
      return { pos: {}, starters: [], starterOrder: [] };
    }
    
    // Try multiple summary endpoints
    const summaryUrls = [
      `https://site.web.api.espn.com/apis/v2/sports/basketball/nba/summary?event=${eventId}`,
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`,
    ];
    
    let sum: any = null;
    for (const url of summaryUrls) {
      try {
        sum = await espnFetch(url);
        if (sum?.boxscore) break;
      } catch (e: any) {
        // Continue to next URL
        if (url === summaryUrls[summaryUrls.length - 1]) {
          throw e; // Re-throw if last URL fails
        }
      }
    }
    
    if (!sum) return { pos: {}, starters: [], starterOrder: [] };
    const map: any = {};
    const starters: string[] = [];
    const starterOrder: string[] = []; // Ordered list - first 5 in box score are starters
    
    const addAth = (a:any, isStarter: boolean = false, expectedTeam: string = '')=>{
      const nm = normName(a?.athlete?.displayName || a?.athlete?.fullName || a?.athlete?.name || a?.displayName || a?.name || '');
      // Verify team if expectedTeam is provided
      if (expectedTeam) {
        const athleteTeam = String(a?.team?.abbreviation || a?.team?.team?.abbreviation || '').toUpperCase();
        if (athleteTeam && athleteTeam !== expectedTeam.toUpperCase()) {
          console.error(`[DvP Ingest-NBA]     ⚠️ Skipping ${nm} - team mismatch (${athleteTeam} vs ${expectedTeam})`);
          return; // Skip if team doesn't match
        }
      }
      // Try multiple position fields - ESPN might use different structures
      const pos = String(
        a?.position?.abbreviation || 
        a?.position?.name || 
        a?.position || 
        a?.athlete?.position?.abbreviation ||
        a?.athlete?.position?.name ||
        a?.athlete?.position ||
        ''
      ).toUpperCase().trim();
      if (nm) { 
        map[nm] = pos as any; 
        if (isStarter && !starters.includes(nm)) {
          starters.push(nm);
        }
      }
    };
    
    const box = sum?.boxscore;
    
    // ESPN box score: teams have players in order - first 5 are starters
    // Only process the opponent team if specified
    if (box?.teams && Array.isArray(box.teams)) {
      for (const team of box.teams) {
        const teamAbbr = String(team?.team?.abbreviation || '').toUpperCase();
        // Only process the opponent team (not the team we're tracking DvP for)
        if (opponentAbbr) {
          if (teamAbbr !== opponentAbbr.toUpperCase()) {
            console.error(`[DvP Ingest-NBA]   ESPN: Skipping team ${teamAbbr} (not opponent ${opponentAbbr})`);
            continue; // Skip if this is not the opponent team
          } else {
            console.error(`[DvP Ingest-NBA]   ESPN: Processing opponent team ${teamAbbr}`);
          }
        } else if (teamAbbr !== homeAbbr.toUpperCase() && teamAbbr !== awayAbbr.toUpperCase()) {
          continue; // Fallback: process both teams if opponent not specified
        }
        
        // Try statistics[0].athletes (ordered list - first 5 = starters)
        const stats = team?.statistics || [];
        if (stats.length > 0 && stats[0]?.athletes && Array.isArray(stats[0].athletes)) {
          const athletes = stats[0].athletes;
          console.error(`[DvP Ingest-NBA]   ESPN: Found ${athletes.length} athletes for team ${teamAbbr} (first 5 are starters)`);
          for (let i = 0; i < athletes.length; i++) {
            const athlete = athletes[i];
            const nm = normName(athlete?.athlete?.displayName || athlete?.athlete?.fullName || athlete?.athlete?.name || athlete?.displayName || athlete?.name || '');
            const pos = String(athlete?.position?.abbreviation || athlete?.position || athlete?.position?.name || '').toUpperCase();
            // Verify this athlete belongs to the correct team
            const athleteTeam = String(athlete?.team?.abbreviation || athlete?.team?.team?.abbreviation || teamAbbr).toUpperCase();
            if (athleteTeam !== teamAbbr) {
              console.error(`[DvP Ingest-NBA]     ⚠️ Skipping athlete ${nm} - team mismatch (${athleteTeam} vs ${teamAbbr})`);
              continue;
            }
            if (i < 5) {
              console.error(`[DvP Ingest-NBA]     ESPN starter ${i+1}: ${nm} (position: ${pos || 'N/A'}, team: ${athleteTeam})`);
            }
            addAth(athlete, i < 5, opponentAbbr || teamAbbr); // First 5 are starters, verify team
            if (i < 5 && nm && !starterOrder.includes(nm)) {
              starterOrder.push(nm);
            }
          }
        }
        
        // Also try players array directly
        if (team?.players && Array.isArray(team.players)) {
          console.error(`[DvP Ingest-NBA]   ESPN: Found ${team.players.length} players in players array for team ${teamAbbr}`);
          for (let i = 0; i < team.players.length; i++) {
            const player = team.players[i];
            const nm = normName(player?.athlete?.displayName || player?.athlete?.fullName || player?.athlete?.name || player?.displayName || player?.name || '');
            const pos = String(player?.position?.abbreviation || player?.position || player?.position?.name || '').toUpperCase();
            // Verify this player belongs to the correct team
            const playerTeam = String(player?.team?.abbreviation || player?.team?.team?.abbreviation || teamAbbr).toUpperCase();
            if (playerTeam !== teamAbbr) {
              console.error(`[DvP Ingest-NBA]     ⚠️ Skipping player ${nm} - team mismatch (${playerTeam} vs ${teamAbbr})`);
              continue;
            }
            if (i < 5) {
              console.error(`[DvP Ingest-NBA]     ESPN starter ${i+1}: ${nm} (position: ${pos || 'N/A'}, team: ${playerTeam})`);
            }
            addAth(player, i < 5, opponentAbbr || teamAbbr); // First 5 are starters, verify team
            if (i < 5 && nm && !starterOrder.includes(nm)) {
              starterOrder.push(nm);
            }
          }
        }
      }
    }
    
    // Fallback: Try boxscore.players[...].athletes (legacy structure)
    // Only process opponent team if specified
    const teams = box?.players || [];
    for (const t of teams){
      // Check if this team matches the opponent
      const teamAbbr = String(t?.team?.abbreviation || t?.team?.team?.abbreviation || '').toUpperCase();
      if (opponentAbbr && teamAbbr !== opponentAbbr.toUpperCase()) {
        continue; // Skip if this is not the opponent team
      }
      if (!opponentAbbr && teamAbbr !== homeAbbr.toUpperCase() && teamAbbr !== awayAbbr.toUpperCase()) {
        continue; // Fallback: process both teams if opponent not specified
      }
      
      const aths = t?.athletes || t?.statistics?.[0]?.athletes || [];
      if (Array.isArray(aths)) {
        console.error(`[DvP Ingest-NBA]   ESPN: Found ${aths.length} athletes in legacy structure for team ${teamAbbr}`);
        for (let i = 0; i < aths.length; i++) {
          const athlete = aths[i];
          const nm = normName(athlete?.athlete?.displayName || athlete?.athlete?.fullName || athlete?.athlete?.name || athlete?.displayName || athlete?.name || '');
          // Verify team
          const athleteTeam = String(athlete?.team?.abbreviation || athlete?.team?.team?.abbreviation || teamAbbr).toUpperCase();
          if (opponentAbbr && athleteTeam !== opponentAbbr.toUpperCase() && athleteTeam !== teamAbbr) {
            console.error(`[DvP Ingest-NBA]     ⚠️ Skipping ${nm} in legacy structure - team mismatch (${athleteTeam} vs ${opponentAbbr})`);
            continue;
          }
          addAth(athlete, i < 5, opponentAbbr || teamAbbr); // First 5 are starters, verify team
          if (i < 5 && nm && !starterOrder.includes(nm)) {
            starterOrder.push(nm);
          }
        }
      }
    }
    
    // Use starterOrder if we have it, otherwise use starters array
    const finalStarters = starterOrder.length >= 4 ? starterOrder : starters;
    
    return { pos: map as any, starters: finalStarters, starterOrder: finalStarters };
  }catch(e: any){
    console.error(`[DvP Ingest-NBA]   ESPN fetch error: ${e?.message || 'Unknown error'}`);
    return { pos: {}, starters: [], starterOrder: [] };
  }
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
    // Check if we're in serverless before trying file operations
    const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (isServerless) return { aliases: {} };
    if (!fs.existsSync(p)) return { aliases: {} };
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const als = j?.aliases || {};
    const outAls: any = {};
    for (const [k,v] of Object.entries(als)) outAls[normName(k)] = normName(String(v));
    return { aliases: outAls };
  }catch(e: any){
    // Silently return empty if it's a filesystem error (serverless)
    if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
      return { aliases: {} };
    }
    return { aliases: {} };
  }
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
  // Handle number (decimal minutes from BDL)
  if (typeof min === 'number') {
    return Math.floor(min * 60); // Convert decimal minutes to seconds
  }
  
  const s = String(min || '').trim();
  if (!s) return 0;
  
  // Check if it's MM:SS format
  const m = s.split(':');
  if (m.length >= 2) {
    const mm = Number(m[0]) || 0;
    const ss = Number(m[1]) || 0;
    return mm*60 + ss;
  }
  
  // If it's just a number string (e.g., "30"), BDL returns it as MINUTES, not seconds
  const numValue = Number(s);
  if (!isNaN(numValue) && numValue > 0) {
    // If the number is > 60, it's likely already in seconds (unlikely for NBA minutes)
    // Otherwise, treat it as minutes
    if (numValue > 60) {
      return numValue; // Already in seconds
    } else {
      return Math.floor(numValue * 60); // Convert minutes to seconds
    }
  }
  
  return 0;
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
  // Wrap entire function to catch any EROFS errors
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const seasonYear = searchParams.get('season') ? parseInt(String(searchParams.get('season')),10) : currentNbaSeason();
    const refresh = searchParams.get('refresh') === '1';
    const skipNBA = searchParams.get('skipNBA') === '1';
    const latestOnly = searchParams.get('latest') === '1';
    if (!team) return NextResponse.json({ success:false, error:'Missing team' }, { status:400 });

    // Wrap storePath call in try-catch (though it shouldn't throw, being defensive)
    let dir: string, file: string;
    try {
      const paths = storePath(seasonYear, team);
      dir = paths.dir;
      file = paths.file;
    } catch (e: any) {
      if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
        return NextResponse.json({ 
          success: true, 
          team, 
          season: seasonYear, 
          stored_games: 0, 
          file: null, 
          serverless: true, 
          note: 'Read-only filesystem detected early' 
        });
      }
      throw e;
    }
    
    // Check if we're in a serverless environment (Vercel has read-only filesystem)
    // Vercel sets VERCEL=1 and VERCEL_ENV (production/preview/development)
    const isServerless = process.env.VERCEL === '1' || 
                         process.env.VERCEL_ENV !== undefined || 
                         process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
                         process.env.VERCEL_URL !== undefined;
    
    let out: any[] = [];
    // Try to read existing data, but don't fail if filesystem is read-only
    // Always wrap file operations in try-catch since serverless detection might be wrong
    if (!isServerless) {
      try {
        // Try file operations, but catch EROFS errors
        try {
          const dirExists = fs.existsSync(dir);
          if (!dirExists) {
            fs.mkdirSync(dir,{ recursive:true });
          }
        } catch (e: any) {
          if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
            console.log(`[ingest-nba] Read-only filesystem detected (mkdir) for ${team}, skipping file I/O`);
            out = [];
          } else {
            throw e; // Re-throw non-filesystem errors
          }
        }
        
        if (out.length === 0) { // Only try other operations if we didn't hit EROFS
          try {
            if (refresh) {
              const fileExists = fs.existsSync(file);
              if (fileExists) {
                fs.unlinkSync(file);
              }
            }
            const fileExists = fs.existsSync(file);
            if (fileExists) {
              out = JSON.parse(fs.readFileSync(file,'utf8'));
            }
          } catch (e: any) {
            // EROFS = read-only file system (serverless), EACCES = permission denied
            if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
              console.log(`[ingest-nba] Read-only filesystem detected for ${team}, starting fresh`);
              out = [];
            } else {
              console.warn(`[ingest-nba] File read failed for ${team}, starting fresh:`, e.message);
              out = [];
            }
          }
        }
      } catch (e: any) {
        // Catch any other errors
        if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
          console.log(`[ingest-nba] Read-only filesystem detected (outer) for ${team}, starting fresh`);
        }
        out = [];
      }
    } else {
      // In serverless, we can't read/write files, so start fresh
      console.log(`[ingest-nba] Serverless environment detected (VERCEL=${process.env.VERCEL}), skipping file I/O for ${team}`);
      out = [];
    }
    const have = new Set(out.map(x=> String(x.gameId)));

    // List games via BDL - fetch ALL games for the season
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[team];
    let allGames: any[] = [];
    let page = 1;
    const perPage = 100;
    
    // Fetch all pages of games
    while (true) {
      const gamesUrl = new URL(`${BDL_BASE}/games`);
      gamesUrl.searchParams.set('per_page', String(perPage));
      gamesUrl.searchParams.set('page', String(page));
      gamesUrl.searchParams.append('seasons[]', String(seasonYear));
      gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
      
      const gjs = await bdlFetch(gamesUrl.toString());
      const pageGames: any[] = Array.isArray(gjs?.data) ? gjs.data : [];
      
      if (pageGames.length === 0) break;
      
      allGames.push(...pageGames);
      
      // Check if there are more pages
      const totalPages = gjs?.meta?.total_pages || 1;
      if (page >= totalPages || pageGames.length < perPage) break;
      
      page++;
    }
    
    const finals = allGames.filter(g=> String(g?.status||'').toLowerCase().includes('final'));
    finals.sort((a,b)=> new Date(b?.date||0).getTime() - new Date(a?.date||0).getTime());
    
    let picked: any[] = [];
    if (latestOnly) {
      const notStored = finals.filter(g => !have.has(String(g?.id)));
      if (notStored.length) {
        notStored.sort((a,b)=> new Date(a?.date||0).getTime() - new Date(b?.date||0).getTime());
        picked = notStored.slice(-1); // only newest not stored
      } else {
        // All games stored - include most recent stored games to check for BM data re-processing
        const storedGames = finals.filter(g => have.has(String(g?.id)));
        storedGames.sort((a,b)=> new Date(b?.date||0).getTime() - new Date(a?.date||0).getTime());
        picked = storedGames.slice(0, 3); // Check last 3 stored games for BM data
        console.error(`[DvP Ingest-NBA] All games stored for ${team} - checking last ${picked.length} games for BM data re-processing`);
      }
    } else {
      // Process all final games (excluding already stored ones unless refresh is true)
      if (refresh) {
        picked = finals; // Process all games if refresh
      } else {
        picked = finals.filter(g => !have.has(String(g?.id))); // Only process new games
      }
    }

    console.error(`[DvP Ingest-NBA] Processing ${picked.length} games for team ${team}`);
    
    for (const g of picked){
      const gidBdl = String(g?.id);
      if (!gidBdl) continue;
      const when = String(g?.date||'');
      const home = String(g?.home_team?.abbreviation||'');
      const away = String(g?.visitor_team?.abbreviation||'');
      const oppAbbr = home.toUpperCase() === team ? away : home;
      const host = req.headers.get('host') || undefined;
      
      // BDL returns dates in ISO format (e.g., "2025-11-30T00:00:00.000Z")
      // Extract just the date part (YYYY-MM-DD) - this is the game date regardless of timezone
      const gameDateStr = g?.date ? String(g.date).split('T')[0] : 'unknown';
      console.error(`[DvP Ingest-NBA] Processing game ${gidBdl}: ${away} @ ${home} on ${gameDateStr}`);
      
      // Fetch ESPN starters and positions FIRST (highest priority - overwrites everything)
      // ESPN box score shows starters in order (first 5 players = starters)
      let espnStarters: Set<string> = new Set();
      let espnStarterOrder: string[] = []; // Ordered list of starters from ESPN box score
      let espnPositions: Record<string, string> = {}; // ESPN positions for all players (G/F/C or PG/SG/SF/PF/C)
      try {
        // Fetch ESPN data - we need opponent team's positions
        const espnInfo = await fetchEspnRosterMapByDate(gameDateStr, home, away, oppAbbr);
        // ESPN returns starters in order (first 5 in box score)
        // Use starterOrder if available (ordered from box score), otherwise use starters array
        espnStarterOrder = espnInfo.starterOrder && espnInfo.starterOrder.length >= 4 
          ? espnInfo.starterOrder.map(s => normName(s))
          : espnInfo.starters.map(s => normName(s));
        espnStarters = new Set(espnStarterOrder);
        espnPositions = espnInfo.pos; // Store positions for all players (starters and bench) - filtered to opponent only
        if (espnStarters.size > 0) {
          console.error(`[DvP Ingest-NBA]   ✅ Found ${espnStarters.size} ESPN starters for opponent ${oppAbbr} (ordered from box score): ${espnStarterOrder.slice(0, 5).join(', ')}`);
        }
        if (Object.keys(espnPositions).length > 0) {
          console.error(`[DvP Ingest-NBA]   ✅ Found ${Object.keys(espnPositions).length} ESPN positions for opponent ${oppAbbr} (will overwrite all positions)`);
          // Debug: log first few positions
          const samplePositions = Object.entries(espnPositions).slice(0, 5);
          samplePositions.forEach(([name, pos]) => {
            console.error(`[DvP Ingest-NBA]     ESPN position: ${name} → ${pos}`);
          });
        }
      } catch (e: any) {
        console.error(`[DvP Ingest-NBA]   ⚠️ Could not fetch ESPN data for game ${gidBdl}: ${e.message}`);
      }
      
      
      // Check if this game is already stored (skip if not refreshing)
      const alreadyStored = have.has(gidBdl);
      if (alreadyStored && !refresh) {
        console.error(`[DvP Ingest-NBA] Skipping already stored game ${gidBdl} (use refresh=1 to re-process)`);
        continue; // Skip already stored games unless refreshing
      }
      
      if (alreadyStored && refresh) {
        console.error(`[DvP Ingest-NBA] Re-processing game ${gidBdl} (refresh=1)`);
        // Remove from have set so it gets processed and overwritten
        have.delete(gidBdl);
        // Also remove from out array if it exists
        const existingIndex = out.findIndex((x: any) => String(x.gameId) === gidBdl);
        if (existingIndex >= 0) {
          out.splice(existingIndex, 1);
        }
      }
      
      // No depth chart logic needed - using BDL positions directly

      // Fetch BDL stats rows
      const statsUrl = new URL(`${BDL_BASE}/stats`);
      statsUrl.searchParams.append('game_ids[]', String(gidBdl));
      statsUrl.searchParams.set('per_page','100');
      const sjs2 = await bdlFetch(statsUrl.toString());
      const srows2 = Array.isArray(sjs2?.data)? sjs2.data: [];
      const oppIdBdl2 = ABBR_TO_TEAM_ID_BDL[normalizeAbbr(oppAbbr)];
      
      if (!oppIdBdl2) {
        console.error(`[DvP Ingest-NBA] ⚠️ Could not find BDL team ID for opponent: ${oppAbbr} (normalized: ${normalizeAbbr(oppAbbr)})`);
      }
      
      const oppRows2 = srows2.filter((r:any)=> r?.team?.id === oppIdBdl2);
      
      // If we have ESPN starters that didn't match, try to find them by checking ALL stats (not just opponent)
      // This handles cases where a player might be listed with wrong team ID or name variation
      const unmatchedEspnStarters = espnStarterOrder.filter(espnName => {
        const espnNameNorm = normName(espnName);
        return !oppRows2.some((r: any) => {
          const playerName = String(r?.player?.first_name || '') + ' ' + String(r?.player?.last_name || '');
          return normName(playerName) === espnNameNorm;
        });
      });
      
      if (unmatchedEspnStarters.length > 0) {
        console.error(`[DvP Ingest-NBA]   🔍 Searching for unmatched ESPN starters in ALL stats (not just opponent): ${unmatchedEspnStarters.join(', ')}`);
        for (const espnStarterName of unmatchedEspnStarters) {
          const espnNameNorm = normName(espnStarterName);
          // Check all stats (both teams) for this player
          const foundInAllStats = srows2.find((r: any) => {
            const playerName = String(r?.player?.first_name || '') + ' ' + String(r?.player?.last_name || '');
            const playerNameNorm = normName(playerName);
            // Try exact match first
            if (playerNameNorm === espnNameNorm) return true;
            // Try fuzzy match (last name + first name initial/prefix)
            const espnParts = espnNameNorm.split(' ').filter(Boolean);
            const playerParts = playerNameNorm.split(' ').filter(Boolean);
            if (espnParts.length > 0 && playerParts.length > 0) {
              const espnLast = espnParts[espnParts.length - 1];
              const espnFirst = espnParts[0];
              const playerLast = playerParts[playerParts.length - 1];
              const playerFirst = playerParts[0];
              if (playerLast === espnLast && (
                playerFirst === espnFirst ||
                (playerFirst.length === 1 && espnFirst.startsWith(playerFirst)) ||
                (espnFirst.length === 1 && playerFirst.startsWith(espnFirst)) ||
                playerFirst.startsWith(espnFirst) ||
                espnFirst.startsWith(playerFirst)
              )) {
                return true;
              }
            }
            return false;
          });
          
          if (foundInAllStats) {
            const playerTeamId = foundInAllStats?.team?.id;
            const playerTeamAbbr = TEAM_ID_TO_ABBR[playerTeamId] || 'UNKNOWN';
            const playerName = String(foundInAllStats?.player?.first_name || '') + ' ' + String(foundInAllStats?.player?.last_name || '');
            console.error(`[DvP Ingest-NBA]   ✅ Found "${espnStarterName}" in BDL stats as "${playerName}" but on team ${playerTeamAbbr} (ID: ${playerTeamId}), expected ${oppAbbr} (ID: ${oppIdBdl2})`);
            
            // If it's the correct team, add it to oppRows2
            if (playerTeamId === oppIdBdl2) {
              console.error(`[DvP Ingest-NBA]   ✅ Adding "${playerName}" to opponent stats (team ID matches)`);
              oppRows2.push(foundInAllStats);
            } else {
              console.error(`[DvP Ingest-NBA]   ⚠️ Player "${playerName}" is on wrong team (${playerTeamAbbr} vs expected ${oppAbbr}), but including anyway since ESPN says they're a starter`);
              // Still add it - ESPN starter takes precedence
              oppRows2.push(foundInAllStats);
            }
          } else {
            console.error(`[DvP Ingest-NBA]   ❌ Could not find "${espnStarterName}" in ANY stats for this game (checked all ${srows2.length} players)`);
            
            // Last resort: Try fetching by known player ID if we have it
            // For "daniss jenkins" / "Daniss Jenkins", try ID 1028240128
            if (espnNameNorm.includes('daniss') && espnNameNorm.includes('jenkins')) {
              const knownPlayerId = 1028240128;
              console.error(`[DvP Ingest-NBA]   🔍 Trying to fetch "${espnStarterName}" directly by player ID ${knownPlayerId} for game ${gidBdl}`);
              try {
                const playerStatsUrl = new URL(`${BDL_BASE}/stats`);
                playerStatsUrl.searchParams.append('game_ids[]', String(gidBdl));
                playerStatsUrl.searchParams.append('player_ids[]', String(knownPlayerId));
                playerStatsUrl.searchParams.set('per_page', '100');
                const playerStatsRes = await bdlFetch(playerStatsUrl.toString());
                const playerStats = Array.isArray(playerStatsRes?.data) ? playerStatsRes.data : [];
                
                if (playerStats.length > 0) {
                  const foundPlayer = playerStats[0];
                  const playerName = String(foundPlayer?.player?.first_name || '') + ' ' + String(foundPlayer?.player?.last_name || '');
                  const playerTeamId = foundPlayer?.team?.id;
                  console.error(`[DvP Ingest-NBA]   ✅ Found "${espnStarterName}" by player ID ${knownPlayerId}: "${playerName}" on team ID ${playerTeamId}`);
                  
                  // Add to opponent stats if team matches (or even if it doesn't, since ESPN says they're a starter)
                  if (playerTeamId === oppIdBdl2 || !oppIdBdl2) {
                    console.error(`[DvP Ingest-NBA]   ✅ Adding "${playerName}" to opponent stats (found by player ID)`);
                    oppRows2.push(foundPlayer);
                  } else {
                    console.error(`[DvP Ingest-NBA]   ⚠️ Player "${playerName}" is on team ID ${playerTeamId} (expected ${oppIdBdl2}), but adding anyway since ESPN lists as starter`);
                    oppRows2.push(foundPlayer);
                  }
                } else {
                  console.error(`[DvP Ingest-NBA]   ❌ No stats found for player ID ${knownPlayerId} in game ${gidBdl}`);
                }
              } catch (e: any) {
                console.error(`[DvP Ingest-NBA]   ⚠️ Error fetching player ${knownPlayerId} by ID: ${e.message}`);
              }
            }
          }
        }
      }
      
      // BDL returns players in boxscore order - typically starters first, then bench
      // We'll identify starters by their position in the array (first 5 players with 1+ minutes)
      // Store the original index to identify starters later
      let oppRows2WithIndex = oppRows2.map((r: any, index: number) => ({ ...r, _originalIndex: index }));
      
      // BEFORE processing players, check if any ESPN starters are missing and try to find them
      console.error(`[DvP Ingest-NBA]   🔍 DEBUG: espnStarterOrder.length=${espnStarterOrder.length}, oppRows2WithIndex.length=${oppRows2WithIndex.length}`);
      if (espnStarterOrder.length > 0) {
        const existingPlayerNames = new Set(oppRows2WithIndex.map((r: any) => {
          const name = String(r?.player?.first_name || '') + ' ' + String(r?.player?.last_name || '');
          return normName(name);
        }));
        
        // Debug: Show all player names in oppRows2WithIndex
        const allPlayerNames = oppRows2WithIndex.map((r: any) => {
          const name = String(r?.player?.first_name || '') + ' ' + String(r?.player?.last_name || '');
          const min = (r as any)?.min || (r as any)?.minutes || (r as any)?.min_string || '0:00';
          return `${name} (norm: "${normName(name)}", min: ${min})`;
        });
        console.error(`[DvP Ingest-NBA]   🔍 DEBUG: All ${oppRows2WithIndex.length} players in oppRows2WithIndex: ${allPlayerNames.join(', ')}`);
        
        const missingStarters = espnStarterOrder.filter(espnName => !existingPlayerNames.has(normName(espnName)));
        console.error(`[DvP Ingest-NBA]   🔍 DEBUG: missingStarters.length=${missingStarters.length}, missingStarters=${missingStarters.join(', ')}`);
        
        if (missingStarters.length > 0) {
          console.error(`[DvP Ingest-NBA]   🔍 Searching for ${missingStarters.length} missing ESPN starters in ALL stats: ${missingStarters.join(', ')}`);
          
          for (const espnStarterName of missingStarters) {
            const espnNameNorm = normName(espnStarterName);
            // Check all stats (both teams) for this player
            const foundInAllStats = srows2.find((r: any) => {
              const playerName = String(r?.player?.first_name || '') + ' ' + String(r?.player?.last_name || '');
              const playerNameNorm = normName(playerName);
              // Try exact match first
              if (playerNameNorm === espnNameNorm) return true;
              // Try fuzzy match (last name + first name initial/prefix)
              const espnParts = espnNameNorm.split(' ').filter(Boolean);
              const playerParts = playerNameNorm.split(' ').filter(Boolean);
              if (espnParts.length > 0 && playerParts.length > 0) {
                const espnLast = espnParts[espnParts.length - 1];
                const espnFirst = espnParts[0];
                const playerLast = playerParts[playerParts.length - 1];
                const playerFirst = playerParts[0];
                if (playerLast === espnLast && (
                  playerFirst === espnFirst ||
                  (playerFirst.length === 1 && espnFirst.startsWith(playerFirst)) ||
                  (espnFirst.length === 1 && playerFirst.startsWith(espnFirst)) ||
                  playerFirst.startsWith(espnFirst) ||
                  espnFirst.startsWith(playerFirst)
                )) {
                  return true;
                }
              }
              return false;
            });
            
            if (foundInAllStats) {
              const playerName = String(foundInAllStats?.player?.first_name || '') + ' ' + String(foundInAllStats?.player?.last_name || '');
              const playerTeamId = foundInAllStats?.team?.id;
              console.error(`[DvP Ingest-NBA]   ✅ Found "${espnStarterName}" in ALL stats as "${playerName}" on team ID ${playerTeamId}`);
              
              // Add to oppRows2WithIndex so it gets processed
              if (!oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === Number(foundInAllStats?.player?.id))) {
                oppRows2WithIndex.push({ ...foundInAllStats, _originalIndex: oppRows2WithIndex.length });
                console.error(`[DvP Ingest-NBA]   ✅ Added "${playerName}" to processing queue`);
              }
            } else {
              console.error(`[DvP Ingest-NBA]   ❌ Could not find "${espnStarterName}" in ANY stats for this game (checked all ${srows2.length} players)`);
              
              // Last resort: Try fetching by known player ID
              if (espnNameNorm.includes('daniss') && espnNameNorm.includes('jenkins')) {
                const knownPlayerId = 1028240128;
                console.error(`[DvP Ingest-NBA]   🔍 Trying to fetch "${espnStarterName}" directly by player ID ${knownPlayerId} for game ${gidBdl}`);
                try {
                  const playerStatsUrl = new URL(`${BDL_BASE}/stats`);
                  playerStatsUrl.searchParams.append('game_ids[]', String(gidBdl));
                  playerStatsUrl.searchParams.append('player_ids[]', String(knownPlayerId));
                  playerStatsUrl.searchParams.set('per_page', '100');
                  const playerStatsRes = await bdlFetch(playerStatsUrl.toString());
                  const playerStats = Array.isArray(playerStatsRes?.data) ? playerStatsRes.data : [];
                  
                  if (playerStats.length > 0) {
                    const foundPlayer = playerStats[0];
                    const playerName = String(foundPlayer?.player?.first_name || '') + ' ' + String(foundPlayer?.player?.last_name || '');
                    const playerTeamId = foundPlayer?.team?.id;
                    console.error(`[DvP Ingest-NBA]   ✅ Found "${espnStarterName}" by player ID ${knownPlayerId}: "${playerName}" on team ID ${playerTeamId}`);
                    
                    // Add to oppRows2WithIndex so it gets processed
                    if (!oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === Number(foundPlayer?.player?.id))) {
                      oppRows2WithIndex.push({ ...foundPlayer, _originalIndex: oppRows2WithIndex.length });
                      console.error(`[DvP Ingest-NBA]   ✅ Added "${playerName}" to processing queue (found by player ID)`);
                    }
                  } else {
                    console.error(`[DvP Ingest-NBA]   ❌ No stats found for player ID ${knownPlayerId} in game ${gidBdl}`);
                  }
                } catch (e: any) {
                  console.error(`[DvP Ingest-NBA]   ⚠️ Error fetching player ${knownPlayerId} by ID: ${e.message}`);
                }
              }
            }
          }
        }
      }
      
      // Debug logging
      if (srows2.length === 0) {
        console.error(`[DvP Ingest-NBA] ⚠️ No stats found for game ${gidBdl} (${oppAbbr} @ ${team})`);
      } else if (oppRows2.length === 0) {
        console.error(`[DvP Ingest-NBA] ⚠️ No opponent stats found for game ${gidBdl}: ${srows2.length} total stats, oppId=${oppIdBdl2}, oppAbbr=${oppAbbr}`);
        // Log team IDs we got
        const teamIds = [...new Set(srows2.map((r:any) => r?.team?.id).filter(Boolean))];
        console.error(`[DvP Ingest-NBA]   Available team IDs in stats: ${teamIds.join(', ')}`);
      } else {
        console.error(`[DvP Ingest-NBA] ✅ Found ${oppRows2.length} opponent player stats for game ${gidBdl}`);
      }

      // Helper to parse BDL height string (e.g., "6-3", "6'3", "75") to inches
      const parseBdlHeight = (heightStr: string | undefined): number | null => {
        if (!heightStr) return null;
        const str = String(heightStr).trim();
        
        // Try parsing as feet-inches format FIRST (e.g., "6-3", "6'3", "6 3")
        // This must come before direct inches parsing to avoid "6-7" being parsed as 6 inches
        const match = str.match(/(\d+)[-'\s](\d+)/);
        if (match) {
          const feet = parseInt(match[1], 10);
          const inches = parseInt(match[2], 10);
          if (!isNaN(feet) && !isNaN(inches) && feet >= 4 && feet <= 8 && inches >= 0 && inches < 12) {
            return feet * 12 + inches;
          }
        }
        
        // Try parsing as inches directly (e.g., "75") - only if no dash/apostrophe found
        if (!str.includes('-') && !str.includes("'") && !str.includes(' ')) {
          const inchesDirect = parseInt(str, 10);
          if (!isNaN(inchesDirect) && inchesDirect > 0 && inchesDirect < 100) {
            return inchesDirect;
          }
        }
        
        return null;
      };

      // Simple position logic: height < 6'3" = PG, otherwise use BDL position (G/F/C)
      const buckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG:0, SG:0, SF:0, PF:0, C:0 };
      let players: any[] = [];
      let skippedNoPosition = 0;
      let skippedLowMinutes = 0;

for (const r of oppRows2WithIndex){
        const name = `${r?.player?.first_name||''} ${r?.player?.last_name||''}`.trim();
        const originalIndex = (r as any)?._originalIndex ?? 999; // Store original order index
        
        // Debug: Log if this is Daniss Jenkins
        if (normName(name).includes('daniss') && normName(name).includes('jenkins')) {
          const minRaw = (r as any)?.min || (r as any)?.minutes || (r as any)?.min_string || 'N/A';
          const bdlPos = String((r as any)?.player?.position || '').toUpperCase().trim();
          console.error(`[DvP Ingest-NBA]   🔍 DEBUG: Processing Daniss Jenkins at index ${originalIndex}, minRaw=${minRaw}, bdlPos="${bdlPos}"`);
        }
        
        // Debug: Check if BDL has a starter field we're missing
        if (originalIndex < 2) {
          const allKeys = Object.keys(r || {});
          const starterRelatedKeys = allKeys.filter(k => k.toLowerCase().includes('start') || k.toLowerCase().includes('lineup'));
          if (starterRelatedKeys.length > 0) {
            console.error(`[DvP Ingest-NBA]   ⚠️ Found potential starter fields in BDL response: ${starterRelatedKeys.join(', ')}`);
            starterRelatedKeys.forEach(key => {
              console.error(`[DvP Ingest-NBA]     ${key}: ${JSON.stringify((r as any)[key])}`);
            });
          }
        }
        
        // Simple position mapping: Use BDL position directly (G, F, C)
        // Only filter: height < 6'3" = PG
        const bdlHeight = (r as any)?.player?.height;
        const heightInches = parseBdlHeight(bdlHeight);
        const bdlPos = String((r as any)?.player?.position || '').toUpperCase().trim();
        
        // Check if this player is an ESPN starter BEFORE we skip for no position
        const playerNameNorm = normName(name);
        const isEspnStarter = espnStarters.has(playerNameNorm) || espnStarterOrder.includes(playerNameNorm);
        const espnPos = espnPositions[playerNameNorm] ? String(espnPositions[playerNameNorm]).toUpperCase() : null;
        
        // Debug: Log first few players to see height and position data
        if (originalIndex < 3) {
          console.error(`[DvP Ingest-NBA]   Player ${name} (index ${originalIndex}): heightRaw=${JSON.stringify(bdlHeight)}, heightInches=${heightInches}, bdlPos="${bdlPos}"`);
        }
        
        let bucket: 'PG'|'SG'|'SF'|'PF'|'C'|'G'|'F' | undefined = undefined;
        
        // FILTER: Players under 6'3" (75 inches) are automatically PG
        if (heightInches !== null && heightInches < 75) {
          bucket = 'PG';
          if (originalIndex < 3) {
            console.error(`[DvP Ingest-NBA]     → Assigned PG (height ${heightInches}" < 75")`);
          }
        } else {
          // Use BDL position directly - keep G and F as-is (user will fix manually)
          // Check for C first (including "F-C", "C-F", etc.) - center takes priority
          if (bdlPos === 'C' || bdlPos.includes('-C') || bdlPos.includes('C-') || (bdlPos.includes('C') && !bdlPos.includes('G') && !bdlPos.includes('F'))) {
            bucket = 'C';
            if (originalIndex < 3) {
              console.error(`[DvP Ingest-NBA]     → Assigned C (BDL position: ${bdlPos})`);
            }
          } else if (bdlPos === 'G' || bdlPos.includes('G')) {
            // Guard - keep as G (user will fix manually)
            bucket = 'G';
            if (originalIndex < 3) {
              console.error(`[DvP Ingest-NBA]     → Assigned G (BDL position)`);
            }
          } else if (bdlPos === 'F' || bdlPos.includes('F')) {
            // Forward - keep as F (user will fix manually)
            bucket = 'F';
            if (originalIndex < 3) {
              console.error(`[DvP Ingest-NBA]     → Assigned F (BDL position)`);
            }
          } else if (['PG','SG','SF','PF'].includes(bdlPos)) {
            // Already in our format
            bucket = bdlPos as 'PG'|'SG'|'SF'|'PF';
            if (originalIndex < 3) {
              console.error(`[DvP Ingest-NBA]     → Assigned ${bdlPos} (BDL position)`);
            }
          } else {
            if (originalIndex < 3) {
              console.error(`[DvP Ingest-NBA]     → No position assigned (bdlPos="${bdlPos}")`);
            }
          }
        }
        
        // If still no position, but player is an ESPN starter, use ESPN position
        if (!bucket && isEspnStarter && espnPos) {
          // ESPN starter without BDL position - use ESPN position
          if (['PG', 'SG', 'SF', 'PF', 'C'].includes(espnPos)) {
            bucket = espnPos as 'PG'|'SG'|'SF'|'PF'|'C';
          } else if (espnPos === 'C') {
            bucket = 'C';
          } else if (espnPos === 'G' || espnPos.includes('G')) {
            bucket = 'G';
          } else if (espnPos === 'F' || espnPos.includes('F')) {
            bucket = 'F';
          }
          if (normName(name).includes('daniss') && normName(name).includes('jenkins')) {
            console.error(`[DvP Ingest-NBA]   🔍 DEBUG: Daniss Jenkins assigned position from ESPN: ${bucket} (bdlPos was empty)`);
          }
        }
        
        // If still no position, skip this player (unless they're an ESPN starter - we'll handle that above)
        if (!bucket) {
          if (normName(name).includes('daniss') && normName(name).includes('jenkins')) {
            console.error(`[DvP Ingest-NBA]   🔍 DEBUG: Daniss Jenkins SKIPPED - no position (bdlPos="${bdlPos}", isEspnStarter=${isEspnStarter}, espnPos="${espnPos}")`);
          }
          skippedNoPosition++;
          continue;
        }
        
        // Filter: Only include players with 1+ minutes (unless they're an ESPN starter)
        // BDL might return minutes as decimal (e.g., 25.5) or as string (e.g., "25:30")
        const playerMinRaw = (r as any)?.min || (r as any)?.minutes || (r as any)?.min_string || '0:00';
        let playerMinSeconds = 0;
        
        // Try parsing as decimal first (BDL might return minutes as a number)
        if (typeof playerMinRaw === 'number') {
          playerMinSeconds = Math.floor(playerMinRaw * 60); // Convert decimal minutes to seconds
        } else {
          // Try parsing as MM:SS string
          playerMinSeconds = parseMinToSeconds(String(playerMinRaw));
        }
        
        // Check if this player is an ESPN starter (they should be included even with <1 min)
        // playerNameNorm, isEspnStarter, and espnPos already declared above - reuse them
        
        // Debug: Log first few players to see what minutes format we're getting
        if (originalIndex < 3) {
          console.error(`[DvP Ingest-NBA]   Player ${name}: minRaw=${JSON.stringify(playerMinRaw)} (type: ${typeof playerMinRaw}), parsed=${playerMinSeconds}s, bucket=${bucket}, isEspnStarter=${isEspnStarter}`);
        }
        
        if (playerMinSeconds < 60 && !isEspnStarter) {
          if (normName(name).includes('daniss') && normName(name).includes('jenkins')) {
            console.error(`[DvP Ingest-NBA]   🔍 DEBUG: Daniss Jenkins SKIPPED - <1 min (${playerMinSeconds}s) and not ESPN starter (isEspnStarter=${isEspnStarter})`);
          }
          skippedLowMinutes++;
          continue; // Skip players with less than 1 minute (60 seconds) unless they're ESPN starters
        }
        
        if (playerMinSeconds < 60 && isEspnStarter) {
          console.error(`[DvP Ingest-NBA]   ⚠️ Including ESPN starter "${name}" despite <1 min (${playerMinSeconds}s) - they were listed as starter`);
        }
        
        // Debug: Log if Daniss Jenkins is being added
        if (normName(name).includes('daniss') && normName(name).includes('jenkins')) {
          console.error(`[DvP Ingest-NBA]   🔍 DEBUG: Daniss Jenkins ADDED to players array - minSeconds=${playerMinSeconds}, bucket=${bucket}, isEspnStarter=${isEspnStarter}`);
        }
        
        const val = Number(r?.pts||0);
        // Only add to buckets if it's one of the 5 positions (G and F won't be aggregated yet)
        if (bucket && ['PG','SG','SF','PF','C'].includes(bucket)) {
          buckets[bucket as 'PG'|'SG'|'SF'|'PF'|'C'] += val;
        }
        
        // Store the original minutes value for the player object
        const playerMin = String(playerMinRaw); // Convert to string for storage
        
        // Check if ESPN has a position for this player (ESPN overwrites everything)
        // playerNameNorm and espnPos already declared above - reuse them
        
        // Include all players with 1+ minutes
        // Store originalIndex to identify starters later (BDL returns starters first in boxscore order)
        // Store ESPN positions if available
        // Deduplicate by playerId - if player already exists, skip (BDL sometimes lists same player twice)
        const playerId = Number(r?.player?.id)||0;
        if (playerId > 0 && players.find(p => p.playerId === playerId)) {
          console.error(`[DvP Ingest-NBA]   ⚠️ Skipping duplicate player: ${name} (playerId: ${playerId})`);
          continue;
        }
        players.push({ playerId, name, bucket, originalIndex, espnPos, heightInches, pts: val, reb: Number(r?.reb||0), ast: Number(r?.ast||0), fg3m: Number(r?.fg3m||0), fg3a: Number(r?.fg3a||0), fgm: Number(r?.fgm||0), fga: Number(r?.fga||0), stl: Number(r?.stl||0), blk: Number(r?.blk||0), min: playerMin, minSeconds: playerMinSeconds });
      }
      
      // NOTE: DvP store should ONLY contain opponent players, not the team's own players
      // The team's own players are NOT added to the DvP store because DvP tracks
      // how the team defends against opposing players at each position
      
      // First, clear all starter flags
      players.forEach(p => {
        p.isStarter = false;
      });
      
      // Identify starters from ESPN (highest priority - overwrites everything)
      // ESPN provides starters in order (first 5 in box score) - use that order
      let identifiedStarters: any[] = [];
      if (espnStarters.size >= 4) {
        // Match ESPN starter order to BDL players, preserving ESPN's order
        const matchedStarters: any[] = [];
        const matchedNames = new Set<string>();
        
        // First, try to match in ESPN's order (most reliable - first 5 in box score)
        for (const espnStarterName of espnStarterOrder) {
          if (matchedStarters.length >= 5) break;
          const espnNameNorm = normName(espnStarterName);
          let matched = players.find(p => {
            const playerNameNorm = normName(p.name);
            return espnNameNorm === playerNameNorm && !matchedNames.has(playerNameNorm);
          });
          
          // If exact match fails, try fuzzy matching (check if last name matches and first name initial/name matches)
          if (!matched) {
            const espnParts = espnNameNorm.split(' ').filter(Boolean);
            const espnLast = espnParts[espnParts.length - 1];
            const espnFirst = espnParts[0];
            
            matched = players.find(p => {
              if (matchedNames.has(normName(p.name))) return false;
              const playerNameNorm = normName(p.name);
              const playerParts = playerNameNorm.split(' ').filter(Boolean);
              const playerLast = playerParts[playerParts.length - 1];
              const playerFirst = playerParts[0];
              
              // Last name must match exactly
              if (playerLast !== espnLast) return false;
              
              // First name: exact match OR first initial matches OR one is a prefix of the other
              if (playerFirst === espnFirst) return true;
              if (playerFirst.length === 1 && espnFirst.startsWith(playerFirst)) return true;
              if (espnFirst.length === 1 && playerFirst.startsWith(espnFirst)) return true;
              if (playerFirst.startsWith(espnFirst) || espnFirst.startsWith(playerFirst)) return true;
              
              return false;
            });
          }
          
          if (matched) {
            matchedStarters.push(matched);
            matchedNames.add(normName(matched.name));
            const matchType = normName(espnStarterName) === normName(matched.name) ? 'exact' : 'fuzzy';
            console.error(`[DvP Ingest-NBA]   ✅ Matched ESPN starter "${espnStarterName}" → BDL "${matched.name}" (${matchType} match)`);
          } else {
            // Debug: show what BDL players we have that might match
            const allPlayerNames = players.map(p => normName(p.name));
            const espnParts = espnNameNorm.split(' ').filter(Boolean);
            const espnLast = espnParts[espnParts.length - 1];
            const similarMatches = allPlayerNames.filter(n => {
              const parts = n.split(' ').filter(Boolean);
              return parts.length > 0 && parts[parts.length - 1] === espnLast;
            });
            if (similarMatches.length > 0) {
              console.error(`[DvP Ingest-NBA]   ⚠️ Could not match ESPN starter "${espnStarterName}" (normalized: "${espnNameNorm}") but found players with same last name: ${similarMatches.join(', ')}`);
            } else {
              // Show ALL BDL player names to help debug
              const allBdlNames = players.map(p => `"${p.name}" (norm: "${normName(p.name)}")`);
              console.error(`[DvP Ingest-NBA]   ⚠️ Could not match ESPN starter "${espnStarterName}" (normalized: "${espnNameNorm}"). Player may not have played or has different name in BDL.`);
              console.error(`[DvP Ingest-NBA]   All ${players.length} BDL players for this game: ${allBdlNames.join(', ')}`);
              
              // Also check if we can find by player ID if we know it (for future enhancement)
              // For now, just log that this starter is missing from BDL stats
              console.error(`[DvP Ingest-NBA]   💡 Note: If "${espnStarterName}" is a starter but not in BDL stats, they may have played 0 minutes or BDL may not have their stats for this game.`);
            }
          }
        }
        
        // If we didn't get enough from ordered list, fill with any remaining ESPN starters
        if (matchedStarters.length < 4) {
          for (const espnStarterName of espnStarters) {
            if (matchedStarters.length >= 5) break;
            if (matchedNames.has(espnStarterName)) continue;
            const matched = players.find(p => {
              const playerNameNorm = normName(p.name);
              return espnStarterName === playerNameNorm;
            });
            if (matched) {
              matchedStarters.push(matched);
              matchedNames.add(normName(matched.name));
            }
          }
        }
        
        if (matchedStarters.length >= 4) { // Need at least 4 matches to be reliable
          identifiedStarters = matchedStarters;
          console.error(`[DvP Ingest-NBA]   Using ESPN starters (ordered from box score): ${matchedStarters.map(p => p.name).join(', ')}`);
        } else {
          console.error(`[DvP Ingest-NBA]   ⚠️ Only found ${matchedStarters.length} ESPN starter matches (need 4+), falling back to minutes-based logic`);
        }
      }
      
      // If ESPN didn't give us enough starters, use minutes-based heuristic:
      if (identifiedStarters.length < 4) {
        // 1. Sort by minutes descending
        // 2. Look for a natural break between starters and bench (big gap in minutes)
        // 3. Ensure starters meet a minimum threshold (typically 15+ minutes)
        // 4. If no clear break, use top 5 by minutes but with minimum threshold
        const sortedByMinutes = [...players].sort((a, b) => {
        const aMin = a.minSeconds ?? parseMinToSeconds(a.min);
        const bMin = b.minSeconds ?? parseMinToSeconds(b.min);
        if (bMin !== aMin) {
          return bMin - aMin; // Descending by minutes
        }
        // Break ties by originalIndex (BDL order - starters typically come first)
        const aIdx = a.originalIndex ?? 999;
        const bIdx = b.originalIndex ?? 999;
        return aIdx - bIdx; // Lower index = earlier in BDL response = more likely starter
      });
      
      const MIN_STARTER_MINUTES = 15 * 60; // 15 minutes in seconds
      const MIN_BENCH_MINUTES = 20 * 60; // 20 minutes - if a player plays this much, they're likely a starter even if not top 5
      
      // Find the natural break point (big gap in minutes between players)
      let starterCount = 5; // Default to top 5
      let foundBreak = false;
      
      // Look for a significant gap (5+ minutes) that might indicate starter/bench boundary
      for (let i = 4; i < Math.min(sortedByMinutes.length - 1, 8); i++) {
        const currentMin = sortedByMinutes[i].minSeconds ?? parseMinToSeconds(sortedByMinutes[i].min);
        const nextMin = sortedByMinutes[i + 1].minSeconds ?? parseMinToSeconds(sortedByMinutes[i + 1].min);
        const gap = currentMin - nextMin;
        
        // If there's a big gap (5+ minutes = 300 seconds) and current player meets minimum threshold
        if (gap >= 300 && currentMin >= MIN_STARTER_MINUTES) {
          starterCount = i + 1;
          foundBreak = true;
          console.error(`[DvP Ingest-NBA]   Found natural break at position ${i + 1}: ${Math.floor(currentMin / 60)} min vs ${Math.floor(nextMin / 60)} min (gap: ${Math.floor(gap / 60)} min)`);
          break;
        }
      }
      
      // If no clear break found, use top 5 but ensure they meet minimum threshold
      if (!foundBreak) {
        // Count how many players meet the minimum starter threshold
        const eligibleStarters = sortedByMinutes.filter(p => {
          const min = p.minSeconds ?? parseMinToSeconds(p.min);
          return min >= MIN_STARTER_MINUTES;
        });
        
        // If we have 5+ eligible players, use top 5
        // If we have fewer than 5, use all eligible (might be injury/restriction case)
        starterCount = Math.min(5, eligibleStarters.length);
        
        // Also check: if 6th player plays 20+ minutes, they might be a starter too (injury substitution)
        if (sortedByMinutes.length > 5) {
          const sixthMin = sortedByMinutes[5].minSeconds ?? parseMinToSeconds(sortedByMinutes[5].min);
          if (sixthMin >= MIN_BENCH_MINUTES) {
            // 6th player also played starter-level minutes - might be a 6th starter scenario
            // But we need exactly 5, so stick with top 5
            console.error(`[DvP Ingest-NBA]   ⚠️ 6th player also played ${Math.floor(sixthMin / 60)} min (starter-level), but using top 5 only`);
          }
        }
      }
      
        const starters = sortedByMinutes.slice(0, starterCount);
        identifiedStarters = starters;
        
        // Verify all starters meet minimum threshold
        const belowThreshold = starters.filter(p => {
          const min = p.minSeconds ?? parseMinToSeconds(p.min);
          return min < MIN_STARTER_MINUTES;
        });
        
        if (belowThreshold.length > 0) {
          console.error(`[DvP Ingest-NBA]   ⚠️ Warning: Some identified starters below ${MIN_STARTER_MINUTES / 60} min threshold: ${belowThreshold.map(p => `${p.name} (${Math.floor((p.minSeconds ?? parseMinToSeconds(p.min)) / 60)} min)`).join(', ')}`);
        }
        
        console.error(`[DvP Ingest-NBA]   Identified ${starters.length} starters by minutes: ${starters.map(p => `${p.name} (${Math.floor((p.minSeconds ?? parseMinToSeconds(p.min)) / 60)} min)`).join(', ')}`);
      }
      
      // Ensure we have exactly 5 starters (if ESPN gave us fewer, fill with top minutes players)
      if (identifiedStarters.length < 5) {
        const sortedByMinutes = [...players].sort((a, b) => {
          const aMin = a.minSeconds ?? parseMinToSeconds(a.min);
          const bMin = b.minSeconds ?? parseMinToSeconds(b.min);
          if (bMin !== aMin) return bMin - aMin;
          // Break ties by originalIndex (BDL order - starters typically come first)
          const aIdx = a.originalIndex ?? 999;
          const bIdx = b.originalIndex ?? 999;
          return aIdx - bIdx;
        });
        const starterIds = new Set(identifiedStarters.map(p => p.playerId));
        const additionalStarters = sortedByMinutes.filter(p => !starterIds.has(p.playerId)).slice(0, 5 - identifiedStarters.length);
        identifiedStarters = [...identifiedStarters, ...additionalStarters];
        if (additionalStarters.length > 0) {
          console.error(`[DvP Ingest-NBA]   Filled to 5 starters (${identifiedStarters.length - additionalStarters.length} from ESPN, ${additionalStarters.length} from top minutes): ${identifiedStarters.map(p => p.name).join(', ')}`);
        } else {
          console.error(`[DvP Ingest-NBA]   Using ${identifiedStarters.length} ESPN starters: ${identifiedStarters.map(p => p.name).join(', ')}`);
        }
      } else if (identifiedStarters.length > 5) {
        // If ESPN gave us more than 5, take the first 5 (shouldn't happen, but just in case)
        identifiedStarters = identifiedStarters.slice(0, 5);
        console.error(`[DvP Ingest-NBA]   Trimmed to 5 starters: ${identifiedStarters.map(p => p.name).join(', ')}`);
      }
      
      const starterIds = new Set(identifiedStarters.map(p => p.playerId));
      
      // Mark starters
      identifiedStarters.forEach(p => {
        p.isStarter = true;
      });
      
      // Use starters for position assignment
      const top5 = identifiedStarters;
      const top5Ids = starterIds;
      
      // Get heights for top 5 players (need to look them up from the original stats)
      const top5WithHeights = top5.map(p => {
        const originalStat = oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === p.playerId);
        const bdlHeight = originalStat ? (originalStat as any)?.player?.height : null;
        const heightInches = bdlHeight ? parseBdlHeight(bdlHeight) : (p.heightInches ?? null);
        return { ...p, heightInches };
      });
      
      // Apply ESPN positions directly to starters first
      // ESPN gives us positions (F, G, C, or PG/SG/SF/PF/C) - use them as-is initially
      top5WithHeights.forEach(p => {
        const playerNameNorm = normName(p.name);
        
        // ESPN positions take priority (overwrites everything) - use directly, no conversion
        const espnPos = espnPositions[playerNameNorm] ? String(espnPositions[playerNameNorm]).toUpperCase() : null;
        if (espnPos) {
          // Use ESPN position directly - no mapping/conversion
          // If it's already PG/SG/SF/PF/C, use it; if it's G/F/C, keep it as-is for now
          if (['PG', 'SG', 'SF', 'PF', 'C'].includes(espnPos)) {
            p.bucket = espnPos as 'PG'|'SG'|'SF'|'PF'|'C';
          } else if (espnPos === 'C') {
            p.bucket = 'C';
          } else if (espnPos === 'G' || espnPos.includes('G')) {
            p.bucket = 'G'; // Will split into PG/SG below
          } else if (espnPos === 'F' || espnPos.includes('F')) {
            p.bucket = 'F'; // Will split into SF/PF below
          }
        }
      });
      
      // Now apply position assignment logic for starters only
      // Separate guards, forwards, and centers
      const guards = top5WithHeights.filter(p => p.bucket === 'G');
      const forwards = top5WithHeights.filter(p => p.bucket === 'F');
      const centers = top5WithHeights.filter(p => p.bucket === 'C');
      
      // Assign guard positions (G → PG/SG/SF)
      if (guards.length === 2) {
        // Sort by height (ascending), then by assists (descending) if tied
        guards.sort((a, b) => {
          const aHeight = a.heightInches ?? 999;
          const bHeight = b.heightInches ?? 999;
          if (aHeight !== bHeight) return aHeight - bHeight;
          // Tie-break: most assists = PG
          const aAst = a.ast ?? 0;
          const bAst = b.ast ?? 0;
          return bAst - aAst;
        });
        guards[0].bucket = 'PG'; // Smallest (or most assists if tied)
        guards[1].bucket = 'SG'; // Other guard
        console.error(`[DvP Ingest-NBA]   Guards: ${guards[0].name} → PG (${guards[0].heightInches || '?'}", ${guards[0].ast || 0} ast), ${guards[1].name} → SG (${guards[1].heightInches || '?'}", ${guards[1].ast || 0} ast)`);
      } else if (guards.length === 3) {
        // 3 guards: tallest → SF, then split remaining 2 by assists (most assists = PG, other = SG)
        guards.sort((a, b) => {
          const aHeight = a.heightInches ?? 0;
          const bHeight = b.heightInches ?? 0;
          return bHeight - aHeight; // Descending (tallest first)
        });
        // Tallest guard becomes SF
        guards[0].bucket = 'SF';
        // Remaining 2 guards: sort by assists (descending) - most assists = PG, other = SG
        const remainingGuards = guards.slice(1);
        remainingGuards.sort((a, b) => {
          const aAst = a.ast ?? 0;
          const bAst = b.ast ?? 0;
          return bAst - aAst; // Descending (most assists first)
        });
        remainingGuards[0].bucket = 'PG'; // Most assists
        remainingGuards[1].bucket = 'SG'; // Other guard
        console.error(`[DvP Ingest-NBA]   3 Guards: ${guards[0].name} → SF (${guards[0].heightInches || '?'}", tallest), ${remainingGuards[0].name} → PG (${remainingGuards[0].ast || 0} ast, most assists), ${remainingGuards[1].name} → SG (${remainingGuards[1].ast || 0} ast)`);
      } else if (guards.length === 1) {
        // 1 guard: assign to PG (most common case)
        guards[0].bucket = 'PG';
        console.error(`[DvP Ingest-NBA]   1 Guard: ${guards[0].name} → PG (${guards[0].heightInches || '?'}", ${guards[0].ast || 0} ast)`);
      } else if (guards.length > 0) {
        // Catch-all: any remaining guards (4+ guards - rare but possible)
        // Sort by height (ascending), then by assists (descending)
        guards.sort((a, b) => {
          const aHeight = a.heightInches ?? 999;
          const bHeight = b.heightInches ?? 999;
          if (aHeight !== bHeight) return aHeight - bHeight;
          const aAst = a.ast ?? 0;
          const bAst = b.ast ?? 0;
          return bAst - aAst;
        });
        guards[0].bucket = 'PG'; // Smallest/most assists
        guards[1].bucket = 'SG'; // 2nd smallest
        guards.slice(2).forEach(g => g.bucket = 'SG'); // Others = SG
        console.error(`[DvP Ingest-NBA]   Catch-all guards (${guards.length}): ${guards.map(g => `${g.name} → ${g.bucket}`).join(', ')}`);
      }
      
      // Assign forward positions (F → SF/PF/C)
      if (forwards.length === 2) {
        // 2 forwards: tallest = PF, other = SF (regardless of whether there's a center)
        forwards.sort((a, b) => {
          const aHeight = a.heightInches ?? 0;
          const bHeight = b.heightInches ?? 0;
          if (aHeight !== bHeight) return bHeight - aHeight; // Descending (tallest first)
          // Tie-break: most rebounds = PF
          const aReb = a.reb ?? 0;
          const bReb = b.reb ?? 0;
          return bReb - aReb;
        });
        forwards[0].bucket = 'PF'; // Tallest (or most rebounds if tied)
        forwards[1].bucket = 'SF'; // Other forward
        const centerNote = centers.length > 0 ? ' (with center)' : ' (no center)';
        console.error(`[DvP Ingest-NBA]   2 Forwards${centerNote}: ${forwards[0].name} → PF (${forwards[0].heightInches || '?'}", ${forwards[0].reb || 0} reb), ${forwards[1].name} → SF (${forwards[1].heightInches || '?'}", ${forwards[1].reb || 0} reb)`);
      } else if (forwards.length === 3 && centers.length === 0) {
        // 3 forwards, no center: tallest = C, 2nd tallest = PF, shortest = SF
        forwards.sort((a, b) => {
          const aHeight = a.heightInches ?? 0;
          const bHeight = b.heightInches ?? 0;
          return bHeight - aHeight; // Descending (tallest first)
        });
        forwards[0].bucket = 'C'; // Tallest
        forwards[1].bucket = 'PF'; // 2nd tallest
        forwards[2].bucket = 'SF'; // Shortest
        console.error(`[DvP Ingest-NBA]   3 Forwards (no C): ${forwards[0].name} → C (${forwards[0].heightInches || '?'}"), ${forwards[1].name} → PF (${forwards[1].heightInches || '?'}"), ${forwards[2].name} → SF (${forwards[2].heightInches || '?'}")`);
      } else if (forwards.length === 1) {
        // 1 forward: if there are 3 guards, the tallest guard becomes SF, so this forward should be PF
        if (guards.length === 3) {
          forwards[0].bucket = 'PF';
          console.error(`[DvP Ingest-NBA]   1 Forward (with 3 guards): ${forwards[0].name} → PF (tallest guard becomes SF)`);
        } else if (centers.length > 0) {
          // 1 forward with center(s): assign to PF (power forward is typically taller)
          forwards[0].bucket = 'PF';
          console.error(`[DvP Ingest-NBA]   1 Forward (with center): ${forwards[0].name} → PF (${forwards[0].heightInches || '?'}")`);
        } else {
          // 1 forward, no center, not 3 guards: assign to PF (will be converted to C if needed, but for now PF)
          forwards[0].bucket = 'PF';
          console.error(`[DvP Ingest-NBA]   1 Forward (no center): ${forwards[0].name} → PF (${forwards[0].heightInches || '?'}")`);
        }
      } else if (forwards.length === 3 && centers.length > 0) {
        // 3 forwards with center: split to PF/SF (can't use one as C since we already have a center)
        forwards.sort((a, b) => {
          const aHeight = a.heightInches ?? 0;
          const bHeight = b.heightInches ?? 0;
          if (aHeight !== bHeight) return bHeight - aHeight; // Descending (tallest first)
          // Tie-break: most rebounds = PF
          const aReb = a.reb ?? 0;
          const bReb = b.reb ?? 0;
          return bReb - aReb;
        });
        forwards[0].bucket = 'PF'; // Tallest
        forwards[1].bucket = 'PF'; // 2nd tallest also PF (we need 2 PF slots)
        forwards[2].bucket = 'SF'; // Shortest
        console.error(`[DvP Ingest-NBA]   3 Forwards (with center): ${forwards[0].name} → PF (${forwards[0].heightInches || '?'}"), ${forwards[1].name} → PF (${forwards[1].heightInches || '?'}"), ${forwards[2].name} → SF (${forwards[2].heightInches || '?'}")`);
      } else if (forwards.length > 0) {
        // Catch-all: any remaining forwards that weren't handled above
        // Sort by height (descending) - tallest = PF, others = SF
        forwards.sort((a, b) => {
          const aHeight = a.heightInches ?? 0;
          const bHeight = b.heightInches ?? 0;
          if (aHeight !== bHeight) return bHeight - aHeight; // Descending (tallest first)
          // Tie-break: most rebounds = PF
          const aReb = a.reb ?? 0;
          const bReb = b.reb ?? 0;
          return bReb - aReb;
        });
        forwards[0].bucket = 'PF'; // Tallest
        forwards.slice(1).forEach(f => f.bucket = 'SF'); // Others = SF
        console.error(`[DvP Ingest-NBA]   Catch-all forwards (${forwards.length}): ${forwards.map(f => `${f.name} → ${f.bucket}`).join(', ')}`);
      }
      
      // Update the original players array with assigned positions
      top5WithHeights.forEach((updatedPlayer) => {
        const playerIndex = players.findIndex(p => p.playerId === updatedPlayer.playerId);
        if (playerIndex >= 0) {
          players[playerIndex].bucket = updatedPlayer.bucket;
          players[playerIndex].isStarter = true;
        }
      });
      
      // Log top 5 summary
      const top5Summary = top5WithHeights.map(p => `${p.name} (${p.bucket})`).join(', ');
      console.error(`[DvP Ingest-NBA]   Top 5 starters with assigned positions: ${top5Summary}`);
      
      // Verify we have exactly 5 starters
      const starterCount = players.filter(p => p.isStarter).length;
      if (starterCount !== 5) {
        console.error(`[DvP Ingest-NBA]   ⚠️ Warning: Expected 5 starters, found ${starterCount}`);
      }
      
      // Apply position assignment logic to bench players
      const benchPlayers = players.filter(p => !p.isStarter);
      
      if (benchPlayers.length > 0) {
        // Separate into normal bench vs blowout players
        // If ≤5 total bench players: all are normal bench
        // If >5 total bench players: <6 min = blowout, 6+ min = normal bench
        const isBlowoutGame = benchPlayers.length > 5;
        const normalBenchPlayers = isBlowoutGame 
          ? benchPlayers.filter(p => {
              const minSeconds = p.minSeconds ?? parseMinToSeconds(p.min);
              return minSeconds >= 360; // 6 minutes = 360 seconds
            })
          : benchPlayers; // All are normal if ≤5 total
        
        const blowoutPlayers = isBlowoutGame 
          ? benchPlayers.filter(p => {
              const minSeconds = p.minSeconds ?? parseMinToSeconds(p.min);
              return minSeconds < 360; // <6 minutes
            })
          : [];
        
        console.error(`[DvP Ingest-NBA]   Bench players: ${benchPlayers.length} total, ${normalBenchPlayers.length} normal bench, ${blowoutPlayers.length} blowout`);
        
        // Process normal bench players (fill 5 position buckets)
        if (normalBenchPlayers.length > 0) {
          // Get heights for normal bench players
          const normalBenchWithHeights = normalBenchPlayers.map(p => {
            const originalStat = oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === p.playerId);
            const bdlHeight = originalStat ? (originalStat as any)?.player?.height : null;
            const heightInches = bdlHeight ? parseBdlHeight(bdlHeight) : (p.heightInches ?? null);
            return { ...p, heightInches };
          });
          
          // Separate by position type (G/F/C)
          // Include both 'G' and 'PG' guards (some may have been pre-assigned PG due to height <75")
          const benchGuards = normalBenchWithHeights.filter(p => p.bucket === 'G' || p.bucket === 'PG');
          const benchForwards = normalBenchWithHeights.filter(p => p.bucket === 'F' || p.bucket === 'PF' || p.bucket === 'SF');
          const benchCenters = normalBenchWithHeights.filter(p => p.bucket === 'C');
          
          // Assign guard positions (G/PG → PG/SG)
          if (benchGuards.length > 0) {
            // Sort by height (ascending), then by assists (descending) if tied
            benchGuards.sort((a, b) => {
              const aHeight = a.heightInches ?? 999;
              const bHeight = b.heightInches ?? 999;
              if (aHeight !== bHeight) return aHeight - bHeight;
              // Tie-break: most assists = PG
              const aAst = a.ast ?? 0;
              const bAst = b.ast ?? 0;
              return bAst - aAst;
            });
            
            // Smallest guard = PG
            benchGuards[0].bucket = 'PG';
            
            // If there are 2+ guards, split remaining by assists (most assists = PG, but we already have 1 PG, so others = SG)
            // Actually, if there are 2 guards total, smallest = PG, other = SG
            // If there are 3+ guards, smallest = PG, then split remaining 2 by assists (more assists = PG... wait, that doesn't make sense)
            // Re-reading: "if there is 2 guards the same size, it goes to assists for the tie breaker"
            // So: smallest = PG, if 2 guards same size use assists, otherwise other guard = SG
            // For 3+ guards: smallest = PG, remaining all = SG
            if (benchGuards.length === 2) {
              // 2 guards: smallest = PG, other = SG (if same height, use assists as tie-breaker, but we already sorted)
              benchGuards[1].bucket = 'SG';
            } else if (benchGuards.length > 2) {
              // 3+ guards: smallest = PG, remaining all = SG
              benchGuards.slice(1).forEach(guard => {
                guard.bucket = 'SG';
              });
            }
            
            console.error(`[DvP Ingest-NBA]   Normal bench guards: ${benchGuards.map((g, i) => `${g.name} → ${g.bucket} (${g.heightInches || '?'}", ${g.ast || 0} ast)`).join(', ')}`);
          }
          
          // Handle centers FIRST: if no C, use tallest Forward as C
          if (benchCenters.length === 0 && benchForwards.length > 0) {
            // Sort forwards by height (descending), then by rebounds (descending) if tied
            benchForwards.sort((a, b) => {
              const aHeight = a.heightInches ?? 0;
              const bHeight = b.heightInches ?? 0;
              if (aHeight !== bHeight) return bHeight - aHeight; // Descending (tallest first)
              // Tie-break: most rebounds = C
              const aReb = a.reb ?? 0;
              const bReb = b.reb ?? 0;
              return bReb - aReb; // Descending (most rebounds first)
            });
            
            // Tallest forward (or most rebounds if tied) becomes C
            benchForwards[0].bucket = 'C';
            console.error(`[DvP Ingest-NBA]   No C in normal bench: ${benchForwards[0].name} → C (${benchForwards[0].heightInches || '?'}", ${benchForwards[0].reb || 0} reb, tallest/most rebounds)`);
            
            // Reassign remaining forwards: 2nd tallest = PF, 3rd = SF, etc.
            if (benchForwards.length > 1) {
              benchForwards[1].bucket = 'PF';
              console.error(`[DvP Ingest-NBA]   Reassigned forward: ${benchForwards[1].name} → PF (${benchForwards[1].heightInches || '?'}", ${benchForwards[1].reb || 0} reb, 2nd tallest)`);
            }
            if (benchForwards.length > 2) {
              benchForwards.slice(2).forEach(forward => {
                forward.bucket = 'SF';
              });
              console.error(`[DvP Ingest-NBA]   Reassigned forwards: ${benchForwards.slice(2).map(f => `${f.name} → SF`).join(', ')}`);
            }
          } else if (benchForwards.length > 0) {
            // Assign forward positions (F/PF/SF → SF/PF) - only if we didn't reassign any to C
            // Sort by height (descending) - tallest = PF, 2nd tallest = SF
            benchForwards.sort((a, b) => {
              const aHeight = a.heightInches ?? 0;
              const bHeight = b.heightInches ?? 0;
              if (aHeight !== bHeight) return bHeight - aHeight; // Descending (tallest first)
              // Tie-break: most rebounds = PF
              const aReb = a.reb ?? 0;
              const bReb = b.reb ?? 0;
              return bReb - aReb; // Descending (most rebounds first)
            });
            
            // Assign: tallest = PF, 2nd tallest = SF, etc.
            benchForwards.forEach((forward, index) => {
              // Reassign all forwards (even if pre-assigned PF/SF) to ensure proper split
              if (forward.bucket === 'F' || forward.bucket === 'PF' || forward.bucket === 'SF') {
                forward.bucket = index === 0 ? 'PF' : 'SF';
              }
            });
            
            console.error(`[DvP Ingest-NBA]   Normal bench forwards: ${benchForwards.map((f, i) => `${f.name} → ${f.bucket} (${f.heightInches || '?'}", ${f.reb || 0} reb)`).join(', ')}`);
          }
          
          // Update the original players array with assigned positions
          normalBenchWithHeights.forEach((updatedPlayer) => {
            const playerIndex = players.findIndex(p => p.playerId === updatedPlayer.playerId);
            if (playerIndex >= 0) {
              players[playerIndex].bucket = updatedPlayer.bucket;
            }
          });
        }
        
        // Final catch-all: ensure ALL bench players have proper positions (no G or F buckets remaining)
        benchPlayers.forEach(p => {
          if (p.bucket === 'G') {
            // Guard not assigned: assign based on height/assists
            const originalStat = oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === p.playerId);
            const bdlHeight = originalStat ? (originalStat as any)?.player?.height : null;
            const heightInches = bdlHeight ? parseBdlHeight(bdlHeight) : (p.heightInches ?? null);
            // Smallest or most assists = PG, otherwise SG
            const isSmaller = heightInches && heightInches < 78;
            const hasMoreAssists = (p.ast ?? 0) > 0;
            p.bucket = (isSmaller || hasMoreAssists) ? 'PG' : 'SG';
            console.error(`[DvP Ingest-NBA]   Catch-all guard: ${p.name} → ${p.bucket} (${heightInches || '?'}", ${p.ast || 0} ast)`);
          } else if (p.bucket === 'F') {
            // Forward not assigned: assign based on height/rebounds
            const originalStat = oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === p.playerId);
            const bdlHeight = originalStat ? (originalStat as any)?.player?.height : null;
            const heightInches = bdlHeight ? parseBdlHeight(bdlHeight) : (p.heightInches ?? null);
            // Tallest or most rebounds = PF, otherwise SF
            const isTaller = heightInches && heightInches >= 80;
            const hasMoreRebs = (p.reb ?? 0) > 0;
            p.bucket = (isTaller || hasMoreRebs) ? 'PF' : 'SF';
            console.error(`[DvP Ingest-NBA]   Catch-all forward: ${p.name} → ${p.bucket} (${heightInches || '?'}", ${p.reb || 0} reb)`);
          }
        });
        
        // Process blowout players (just assign positions, don't affect buckets)
        if (blowoutPlayers.length > 0) {
          blowoutPlayers.forEach(p => {
            const playerNameNorm = normName(p.name);
            const espnPos = espnPositions[playerNameNorm] ? String(espnPositions[playerNameNorm]).toUpperCase() : null;
            
            // Use ESPN position if available, otherwise use current bucket
            if (espnPos) {
              if (['PG', 'SG', 'SF', 'PF', 'C'].includes(espnPos)) {
                p.bucket = espnPos as 'PG'|'SG'|'SF'|'PF'|'C';
              } else if (espnPos === 'C') {
                p.bucket = 'C';
              } else if (espnPos === 'G' || espnPos.includes('G')) {
                // Guard: assign PG or SG based on height/assists
                const originalStat = oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === p.playerId);
                const bdlHeight = originalStat ? (originalStat as any)?.player?.height : null;
                const heightInches = bdlHeight ? parseBdlHeight(bdlHeight) : (p.heightInches ?? null);
                // Simple heuristic: if has assists or is shorter, assign PG, otherwise SG
                p.bucket = (p.ast && p.ast > 0) || (heightInches && heightInches < 78) ? 'PG' : 'SG';
              } else if (espnPos === 'F' || espnPos.includes('F')) {
                // Forward: assign SF or PF based on height/rebounds
                const originalStat = oppRows2WithIndex.find((r: any) => Number(r?.player?.id) === p.playerId);
                const bdlHeight = originalStat ? (originalStat as any)?.player?.height : null;
                const heightInches = bdlHeight ? parseBdlHeight(bdlHeight) : (p.heightInches ?? null);
                // Simple heuristic: if has rebounds or is taller, assign PF, otherwise SF
                p.bucket = (p.reb && p.reb > 0) || (heightInches && heightInches >= 80) ? 'PF' : 'SF';
              }
            } else {
              // No ESPN position, use current bucket (G/F/C) and assign based on nature
              if (p.bucket === 'G') {
                p.bucket = (p.ast && p.ast > 0) ? 'PG' : 'SG';
              } else if (p.bucket === 'F') {
                p.bucket = (p.reb && p.reb > 0) ? 'PF' : 'SF';
              }
              // C stays as C
            }
          });
          
          console.error(`[DvP Ingest-NBA]   Blowout players (${blowoutPlayers.length}): ${blowoutPlayers.map(p => `${p.name} → ${p.bucket}`).join(', ')}`);
        }
      }
      
      // NO LIMIT - Include ALL players from BDL stats
      // Recalculate buckets with all players (only for 5-position buckets, G and F excluded for now)
      const newBuckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
      players.forEach(p => {
        const bucket = p.bucket;
        const pts = Number(p.pts || 0);
        if (bucket && ['PG','SG','SF','PF','C'].includes(bucket)) {
          newBuckets[bucket as 'PG'|'SG'|'SF'|'PF'|'C'] += pts;
        }
      });
      Object.assign(buckets, newBuckets); // Update the original buckets object
      
      // NO DEPTH CHART LOGIC - Only using BDL stats with simple position mapping
      // All players from BDL stats are included with their assigned positions
      
      // Debug logging
      if (players.length === 0 && oppRows2.length > 0) {
        console.error(`[DvP Ingest-NBA] ⚠️ No players added for game ${gidBdl}: ${oppRows2.length} opponent stats, ${skippedNoPosition} skipped (no position), ${skippedLowMinutes} skipped (<1 min)`);
      } else if (players.length > 0) {
        console.error(`[DvP Ingest-NBA] ✅ Added ${players.length} players for game ${gidBdl} (${skippedNoPosition} skipped no position, ${skippedLowMinutes} skipped <1 min)`);
      }

      out.push({ 
        gameId: gidBdl, 
        date: when, 
        opponent: oppAbbr, 
        team, 
        season: seasonLabelFromYear(seasonYear), 
        buckets, 
        players, 
        source: 'bdl+espn'
      });
    }

    // Sort games by date: oldest at bottom, newest at top
    out.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA; // Descending: newest first (top), oldest last (bottom)
    });

    // Try to write to file, but don't fail if it's read-only (serverless)
    let fileWritten = false;
    if (!isServerless) {
      try {
        if (fs.writeFileSync && typeof fs.writeFileSync === 'function') {
          fs.writeFileSync(file, JSON.stringify(out, null, 2));
          fileWritten = true;
        }
      } catch (e: any) {
        // EROFS = read-only file system (serverless), EACCES = permission denied
        if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
          console.log(`[ingest-nba] Read-only filesystem detected for ${team}, skipping file write`);
        } else {
          console.warn(`[ingest-nba] File write failed for ${team}:`, e.message);
        }
      }
    }
    
    // Always return success - data was computed even if not persisted
    return NextResponse.json({ 
      success: true, 
      team, 
      season: seasonYear, 
      stored_games: out.length, 
      file: fileWritten ? file.replace(process.cwd(),'') : null, 
      serverless: isServerless || !fileWritten,
      note: fileWritten ? undefined : 'Data computed but not persisted (serverless/read-only filesystem)',
    });
  } catch (e: any) {
    // If it's a filesystem error (serverless), still return success - data computation may have succeeded
    if (e.code === 'EROFS' || e.code === 'EACCES' || e.message?.includes('read-only')) {
      const errorTeam = req.url ? new URL(req.url).searchParams.get('team') || 'unknown' : 'unknown';
      const errorSeason = req.url ? (parseInt(new URL(req.url).searchParams.get('season') || '0', 10) || currentNbaSeason()) : currentNbaSeason();
      console.log(`[ingest-nba] Read-only filesystem error caught (outer): ${errorTeam}`, e.message);
      return NextResponse.json({ 
        success: true, 
        team: errorTeam, 
        season: errorSeason, 
        stored_games: 0, 
        file: null, 
        serverless: true, 
        note: 'Data computation may have been interrupted by read-only filesystem',
        error: e.message 
      });
    }
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
