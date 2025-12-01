export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { normalizeAbbr } from "@/lib/nbaAbbr";
import { getNBACache } from "@/lib/nbaCache";

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

// Helper to normalize name like BasketballMonsters does (simpler normalization)
function bmNormName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

// Fetch BasketballMonsters lineup positions for a game date (if available)
// Returns a map of normalized player name -> position
// For today/future games: Can scrape fresh data
// For past games (up to 7 days): Only uses cached data (lineups were cached before game finished)
// PREFERS verified lineups over projected ones
async function fetchBasketballMonstersLineupPositions(
  teamAbbr: string, 
  gameDate: Date | null,
  preferVerified: boolean = true
): Promise<Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>> {
  if (!gameDate) return {};
  
  // Use Eastern Time to match BasketballMonsters cache keys (they use Eastern Time)
  const now = new Date();
  const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const today = new Date(easternTime.getFullYear(), easternTime.getMonth(), easternTime.getDate(), 0, 0, 0, 0);
  
  // Convert game date to Eastern Time for comparison
  const gameDateEastern = new Date(gameDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const gameDateOnly = new Date(gameDateEastern.getFullYear(), gameDateEastern.getMonth(), gameDateEastern.getDate(), 0, 0, 0, 0);
  
  // Allow checking cache for games up to 7 days in the past
  // (lineups were cached when game was today/future, so cache should still have them)
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  // Skip games older than 7 days (cache likely expired or never existed)
  if (gameDateOnly.getTime() < sevenDaysAgo.getTime()) {
    return {};
  }
  
  try {
    // Format date as YYYY-MM-DD (using Eastern Time to match cache keys)
    const dateStr = `${gameDateOnly.getFullYear()}-${String(gameDateOnly.getMonth() + 1).padStart(2, '0')}-${String(gameDateOnly.getDate()).padStart(2, '0')}`;
    const cacheKey = `basketballmonsters:lineup:${teamAbbr.toUpperCase()}:${dateStr}`;
    
    // IMPORTANT: For past games, ONLY check cache - never try to scrape
    // BasketballMonsters only has today/future games, so past games won't be on their site
    // But if we cached the lineup when the game WAS today, we can still use it
    const isPastGame = gameDateOnly.getTime() < today.getTime();
    
    // Check cache for lineup (works for both today and past games)
    // For past games, use the last projected lineup if verified never came through
    console.error(`[DvP Ingest-NBA] 🔍 Looking up cache for key: ${cacheKey}`);
    let cached = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey, { quiet: false });
    
    if (cached && Array.isArray(cached)) {
      console.error(`[DvP Ingest-NBA] ✅ Cache hit for ${teamAbbr} on ${dateStr}: Found ${cached.length} players`);
      if (cached.length > 0) {
        console.error(`   Players: ${cached.map(p => `${p.name} (${p.position})`).join(', ')}`);
      }
    } else {
      console.error(`[DvP Ingest-NBA] ❌ Cache miss for ${teamAbbr} on ${dateStr} - key: ${cacheKey}`);
    }
    
    // If it's a past game and not in cache, return empty (don't try to scrape)
    if (isPastGame && (!cached || !Array.isArray(cached) || cached.length !== 5)) {
      console.error(`[DvP Ingest-NBA] Past game ${teamAbbr} on ${dateStr} - no cached lineup available, will use fallback methods`);
      return {};
    }
    
    // For past games, if we have a lineup (even if projected), use it
    // This ensures we use the last projected lineup if it never got confirmed
    if (cached && Array.isArray(cached) && cached.length === 5) {
      // Check if lineup is verified (all players verified)
      const allVerified = cached.every(p => p.isVerified && !p.isProjected);
      const hasAnyVerified = cached.some(p => p.isVerified && !p.isProjected);
      
      // For past games: always use the cached lineup (even if projected)
      // This is the "last projected lineup" that was cached before the game finished
      if (isPastGame) {
        // Return the cached lineup directly - don't normalize names yet
        // We'll match using multiple normalization strategies when processing players
        const positionMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
        // Store both original names and normalized names for matching
        // ALWAYS store all variations to ensure matching works
        for (const player of cached) {
          const pos = player.position.toUpperCase() as 'PG'|'SG'|'SF'|'PF'|'C';
          if (['PG','SG','SF','PF','C'].includes(pos)) {
            // Store with original name (exact match) - ALWAYS
            positionMap[player.name] = pos;
            
            // Store with simple normalization (same as BasketballMonsters uses) - ALWAYS
            const simpleNorm = bmNormName(player.name);
            positionMap[simpleNorm] = pos;
            
            // Store with complex normalization (for BDL name matching) - ALWAYS
            const complexNorm = normName(player.name);
            positionMap[complexNorm] = pos;
            
            // Also store lowercase version of original for case-insensitive matching
            const lowerOriginal = player.name.toLowerCase().trim();
            positionMap[lowerOriginal] = pos;
            
            // Also store last name only (for fuzzy matching)
            const nameParts = simpleNorm.split(' ');
            if (nameParts.length > 1) {
              const lastName = nameParts[nameParts.length - 1];
              if (lastName.length >= 3) {
                // Only use last name if it's long enough to avoid false matches
                positionMap[`_lastname_${lastName}`] = pos;
              }
            }
          }
        }
        
        console.error(`[DvP Ingest-NBA] Built position map for ${teamAbbr} on ${dateStr}: ${Object.keys(positionMap).filter(k => !k.startsWith('_lastname_')).length} unique player keys`);
        
        if (process.env.NODE_ENV !== 'production') {
          const verifiedCount = cached.filter(p => p.isVerified).length;
          console.log(`[DvP Ingest-NBA] Using cached lineup for past game ${teamAbbr} on ${dateStr}: ${verifiedCount}/5 verified (using last available lineup)`);
        }
        
        return positionMap;
      }
      
      // For today/future games: prefer verified, but can wait if preferVerified is true
      if (preferVerified && !allVerified) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[DvP Ingest-NBA] Lineup for ${teamAbbr} on ${dateStr} is not fully verified (${cached.filter(p => p.isVerified).length}/5 verified) - skipping to wait for confirmed lineup`);
        }
        return {}; // Return empty to use fallback methods, but don't use projected lineup
      }
      
      // If we have at least some verified players, or preferVerified is false, use the lineup
      if (!preferVerified || hasAnyVerified || allVerified) {
        // Return the cached lineup directly - don't normalize names yet
        // We'll match using multiple normalization strategies when processing players
        const positionMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
        // Store both original names and normalized names for matching
        // ALWAYS store all variations to ensure matching works
        for (const player of cached) {
          const pos = player.position.toUpperCase() as 'PG'|'SG'|'SF'|'PF'|'C';
          if (['PG','SG','SF','PF','C'].includes(pos)) {
            // Store with original name (exact match) - ALWAYS
            positionMap[player.name] = pos;
            
            // Store with simple normalization (same as BasketballMonsters uses) - ALWAYS
            const simpleNorm = bmNormName(player.name);
            positionMap[simpleNorm] = pos;
            
            // Store with complex normalization (for BDL name matching) - ALWAYS
            const complexNorm = normName(player.name);
            positionMap[complexNorm] = pos;
            
            // Also store lowercase version of original for case-insensitive matching
            const lowerOriginal = player.name.toLowerCase().trim();
            positionMap[lowerOriginal] = pos;
            
            // Also store last name only (for fuzzy matching)
            const nameParts = simpleNorm.split(' ');
            if (nameParts.length > 1) {
              const lastName = nameParts[nameParts.length - 1];
              if (lastName.length >= 3) {
                // Only use last name if it's long enough to avoid false matches
                positionMap[`_lastname_${lastName}`] = pos;
              }
            }
          }
        }
        
        console.error(`[DvP Ingest-NBA] Built position map for ${teamAbbr} on ${dateStr}: ${Object.keys(positionMap).filter(k => !k.startsWith('_lastname_')).length} unique player keys`);
        
        if (process.env.NODE_ENV !== 'production') {
          const verifiedCount = cached.filter(p => p.isVerified).length;
          console.log(`[DvP Ingest-NBA] Using BasketballMonsters lineup for ${teamAbbr} on ${dateStr}: ${verifiedCount}/5 verified`);
        }
        
        return positionMap;
      }
    }
  } catch (error) {
    // Silently fail - fallback to other methods
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DvP Ingest-NBA] Could not fetch BasketballMonsters lineup for ${teamAbbr} on ${gameDate}:`, error);
    }
  }
  
  return {};
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
  // Wrap entire function to catch any EROFS errors
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
        // All games stored - include most recent stored games to check for BM data re-processing
        const storedGames = finals.filter(g => have.has(String(g?.id)));
        storedGames.sort((a,b)=> new Date(b?.date||0).getTime() - new Date(a?.date||0).getTime());
        picked = storedGames.slice(0, 3); // Check last 3 stored games for BM data
        console.error(`[DvP Ingest-NBA] All games stored for ${team} - checking last ${picked.length} games for BM data re-processing`);
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
      console.error(`[DvP Ingest-NBA] Processing game ${gidBdl}: ${away} @ ${home} on ${gameDateStr} - Looking for BM lineup for opponent: ${oppAbbr}`);
      
      // Fetch BasketballMonsters lineup directly from cache (same as dashboard uses)
      // IMPORTANT: Cache keys are stored using Eastern Time dates in YYYY-MM-DD format
      // But BDL game dates are in UTC. We need to try BOTH the UTC date AND the Eastern date
      // because a game on 2025-11-30 UTC might be 2025-11-29 or 2025-12-01 in Eastern Time
      const gameDate = g?.date ? new Date(g.date) : null;
      let dateStr = gameDateStr; // Default to UTC date
      let easternDateStr = gameDateStr;
      
      if (gameDate) {
        // Calculate Eastern Time date (prefetch uses Eastern Time)
        const easternDate = new Date(gameDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const year = easternDate.getFullYear();
        const month = easternDate.getMonth() + 1;
        const day = easternDate.getDate();
        easternDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      
      // Try Eastern date first (prefetch uses Eastern Time)
      let cacheKey = `basketballmonsters:lineup:${oppAbbr.toUpperCase()}:${easternDateStr}`;
      let cachedLineup = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey, { quiet: true });
      
      // If not found, try UTC date as fallback
      if (!cachedLineup && easternDateStr !== gameDateStr) {
        cacheKey = `basketballmonsters:lineup:${oppAbbr.toUpperCase()}:${gameDateStr}`;
        cachedLineup = await getNBACache<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>>(cacheKey, { quiet: true });
        dateStr = gameDateStr; // Use UTC date if that's what we found
      } else {
        dateStr = easternDateStr; // Use Eastern date
      }
      
      // Debug: Show what date we're looking for
      console.error(`[DvP Ingest-NBA] Game date (BDL/UTC): ${gameDateStr}, Eastern date: ${easternDateStr}, Using cache key: ${cacheKey}`);
      const usedVerifiedLineup = cachedLineup && Array.isArray(cachedLineup) && cachedLineup.length === 5 
        ? cachedLineup.every(p => p.isVerified && !p.isProjected)
        : false;
      
      // Log what we got from cache (ALWAYS log for debugging)
      if (cachedLineup && Array.isArray(cachedLineup) && cachedLineup.length === 5) {
        console.error(`[DvP Ingest-NBA] ✅ Got cached lineup for ${oppAbbr} on ${dateStr}: ${cachedLineup.map(p => `${p.name} (${p.position})`).join(', ')}`);
      } else {
        console.error(`[DvP Ingest-NBA] ❌ No cached lineup for ${oppAbbr} on ${dateStr} (cacheKey: ${cacheKey})`);
        if (cachedLineup) {
          console.error(`   Got: ${Array.isArray(cachedLineup) ? `Array with ${cachedLineup.length} items` : typeof cachedLineup}`);
        }
      }
      
      // FORCE LOG: Show what we're about to match against
      if (cachedLineup && Array.isArray(cachedLineup) && cachedLineup.length === 5) {
        console.error(`[DvP Ingest-NBA] 📋 Will match BDL players against these ${oppAbbr} starters: ${cachedLineup.map(p => p.name).join(', ')}`);
      }
      
      // Build position map from cached lineup (with all name variations)
      const bmLineupMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
      if (cachedLineup && Array.isArray(cachedLineup) && cachedLineup.length === 5) {
        for (const player of cachedLineup) {
          const pos = player.position.toUpperCase() as 'PG'|'SG'|'SF'|'PF'|'C';
          if (['PG','SG','SF','PF','C'].includes(pos)) {
            // Store ALL variations to ensure matching works
            bmLineupMap[player.name] = pos; // Original: "Payton Pritchard"
            bmLineupMap[player.name.toLowerCase().trim()] = pos; // Lowercase: "payton pritchard"
            bmLineupMap[bmNormName(player.name)] = pos; // Simple norm: "payton pritchard"
            bmLineupMap[normName(player.name)] = pos; // Complex norm: (varies)
            // Last name
            const nameParts = bmNormName(player.name).split(' ');
            if (nameParts.length > 1 && nameParts[nameParts.length - 1].length >= 3) {
              bmLineupMap[`_lastname_${nameParts[nameParts.length - 1]}`] = pos;
            }
          }
        }
        console.error(`[DvP Ingest-NBA] Built position map with ${Object.keys(bmLineupMap).length} keys (${Object.keys(bmLineupMap).filter(k => !k.startsWith('_lastname_')).length} unique players)`);
      }
      
      // Debug: Log BM lineup data if available
      if (Object.keys(bmLineupMap).length > 0) {
        const bmKeys = Object.keys(bmLineupMap).filter(k => !k.startsWith('_lastname_'));
        const sampleKeys = bmKeys.slice(0, 5);
        console.error(`[DvP Ingest-NBA] ✅ BM lineup found for ${oppAbbr} on ${gameDate?.toISOString().split('T')[0]}: ${bmKeys.length} unique keys (${Object.keys(bmLineupMap).length} total including variations)`);
        console.error(`   Sample BM keys: ${sampleKeys.map(k => `"${k}"`).join(', ')}`);
        console.error(`   Sample positions: ${sampleKeys.map(k => `${k}=${bmLineupMap[k]}`).join(', ')}`);
        // Show all keys for first game to debug
        if (out.length === 0) {
          console.error(`   All BM keys in map:`, Object.keys(bmLineupMap).filter(k => !k.startsWith('_lastname_')).map(k => `"${k}"`).join(', '));
        }
      } else {
        console.error(`[DvP Ingest-NBA] ⚠️ No BM lineup for ${oppAbbr} on ${gameDate?.toISOString().split('T')[0]}`);
      }
      
      // Check if this game is already stored
      const alreadyStored = have.has(gidBdl);
      
      // If game is already stored but BM data is now available, re-process it
      // This handles the case where games were ingested before BM lineups were cached
      if (alreadyStored && Object.keys(bmLineupMap).length > 0) {
        console.log(`[ingest-nba] Game ${gidBdl} already stored but BM data now available - re-processing with BM positions`);
        // Remove from have set so it gets processed
        have.delete(gidBdl);
        // Also remove from out array if it exists
        const existingIndex = out.findIndex((x: any) => String(x.gameId) === gidBdl);
        if (existingIndex >= 0) {
          out.splice(existingIndex, 1);
        }
      } else if (alreadyStored) {
        // Game already stored and no BM data available - skip it
        continue;
      }
      
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
      let players: any[] = [];
      const toTitle = (k: string)=> k.split(' ').map(w=> w? (w[0].toUpperCase()+w.slice(1)) : w).join(' ');

// Helper to get last name from normalized name (for fuzzy matching)
function getLastName(normalized: string): string {
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

// Helper to fuzzy match player name against BM lineup map
function findBMPlayerMatch(playerName: string, bmLineupMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>): string | null {
  const normalized = bmNormName(playerName);
  const lastName = getLastName(normalized);
  
  // Try exact match first
  if (bmLineupMap[normalized]) {
    return normalized;
  }
  
  // Try matching by last name (most reliable)
  if (lastName && lastName.length >= 3) {
    for (const [bmKey, pos] of Object.entries(bmLineupMap)) {
      const bmLastName = getLastName(bmKey);
      if (bmLastName === lastName) {
        // Also check if first names are similar (first letter or first few letters)
        const playerFirst = normalized.split(' ')[0] || '';
        const bmFirst = bmKey.split(' ')[0] || '';
        if (playerFirst.length > 0 && bmFirst.length > 0) {
          // Match if first letters match or first 2-3 chars match
          if (playerFirst[0] === bmFirst[0] || 
              (playerFirst.length >= 2 && bmFirst.length >= 2 && playerFirst.substring(0, 2) === bmFirst.substring(0, 2))) {
            return bmKey;
          }
        } else {
          // If no first name in normalized, just match by last name
          return bmKey;
        }
      }
    }
  }
  
  // Try partial match (contains)
  for (const bmKey of Object.keys(bmLineupMap)) {
    if (normalized.includes(bmKey) || bmKey.includes(normalized)) {
      return bmKey;
    }
  }
  
  return null;
}

for (const r of oppRows2){
        const name = `${r?.player?.first_name||''} ${r?.player?.last_name||''}`.trim();
        const key = normName(name);
        const lookup = teamCustom.aliases[key] || key;
        const keys = altKeys(lookup);
        
        // PRIORITY 1: BasketballMonsters lineup (highest priority - most accurate for today/future games)
        let bucket: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = undefined;
        let bmPositionFromBucket: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = undefined;
        
        // MATCH DIRECTLY AGAINST CACHED LINEUP ARRAY FIRST (most reliable - same as dashboard uses)
        if (cachedLineup && Array.isArray(cachedLineup) && cachedLineup.length === 5) {
          // Normalize name: lowercase, trim, collapse multiple spaces
          const nameNormalized = name.toLowerCase().trim().replace(/\s+/g, ' ');
          let matched = false;
          for (const player of cachedLineup) {
            // Normalize cached player name the same way
            const playerNameNormalized = player.name.toLowerCase().trim().replace(/\s+/g, ' ');
            // Exact match after normalization
            if (playerNameNormalized === nameNormalized) {
              const pos = player.position.toUpperCase() as 'PG'|'SG'|'SF'|'PF'|'C';
              if (['PG','SG','SF','PF','C'].includes(pos)) {
                bucket = pos;
                bmPositionFromBucket = pos;
                matched = true;
                if (players.length < 5) {
                  console.error(`[DvP Ingest-NBA] ✅ MATCHED: "${name}" => "${player.name}" => ${pos}`);
                }
                break;
              }
            }
          }
          // If exact match failed, try partial matching (last name only)
          if (!matched) {
            const nameParts = nameNormalized.split(' ');
            const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
            if (lastName.length >= 3) {
              for (const player of cachedLineup) {
                const playerNameNormalized = player.name.toLowerCase().trim().replace(/\s+/g, ' ');
                const playerParts = playerNameNormalized.split(' ');
                const playerLastName = playerParts.length > 1 ? playerParts[playerParts.length - 1] : '';
                if (lastName === playerLastName && lastName.length >= 3) {
                  const pos = player.position.toUpperCase() as 'PG'|'SG'|'SF'|'PF'|'C';
                  if (['PG','SG','SF','PF','C'].includes(pos)) {
                    bucket = pos;
                    bmPositionFromBucket = pos;
                    matched = true;
                    if (players.length < 5) {
                      console.error(`[DvP Ingest-NBA] ✅ MATCHED (last name): "${name}" => "${player.name}" => ${pos}`);
                    }
                    break;
                  }
                }
              }
            }
          }
          if (!matched && players.length < 5) {
            console.error(`[DvP Ingest-NBA] ❌ NO MATCH for "${name}" (normalized: "${nameNormalized}")`);
            console.error(`   Cached lineup: ${cachedLineup.map(p => `"${p.name}" (normalized: "${p.name.toLowerCase().trim().replace(/\s+/g, ' ')}")`).join(', ')}`);
          }
        }
        
        // Fallback: Try position map if direct match didn't work
        
        // Fallback to position map if direct match didn't work
        if (!bucket && Object.keys(bmLineupMap).length > 0) {
          // Strategy 1: Try exact name match (case-insensitive)
          const nameLower = name.toLowerCase().trim();
          let foundKey = null;
          for (const [key, pos] of Object.entries(bmLineupMap)) {
            if (key.toLowerCase().trim() === nameLower) {
              bucket = pos;
              bmPositionFromBucket = pos;
              foundKey = key;
              break;
            }
          }
          // Log first match attempt for debugging
          if (foundKey && players.length < 3) {
            console.error(`[DvP Ingest-NBA] ✅ Matched "${name}" to "${foundKey}" => ${bucket} (Strategy 1: exact case-insensitive)`);
          }
          
          // Strategy 2: Try simple normalization (same as BasketballMonsters uses)
          if (!bucket) {
            const simpleNorm = bmNormName(name);
            if (bmLineupMap[simpleNorm]) {
              bucket = bmLineupMap[simpleNorm];
              bmPositionFromBucket = bmLineupMap[simpleNorm];
            }
          }
          
          // Strategy 3: Try complex normalization (for BDL name variations)
          if (!bucket) {
            const complexNorm = normName(name);
            if (bmLineupMap[complexNorm]) {
              bucket = bmLineupMap[complexNorm];
              bmPositionFromBucket = bmLineupMap[complexNorm];
            }
          }
          
          // Strategy 4: Try all key variations (aliases, etc.)
          if (!bucket) {
            for (const kv of keys) {
              if (bmLineupMap[kv]) {
                bucket = bmLineupMap[kv];
                bmPositionFromBucket = bmLineupMap[kv];
                break;
              }
              const kvSimple = bmNormName(kv);
              if (bmLineupMap[kvSimple]) {
                bucket = bmLineupMap[kvSimple];
                bmPositionFromBucket = bmLineupMap[kvSimple];
                break;
              }
              const kvComplex = normName(kv);
              if (bmLineupMap[kvComplex]) {
                bucket = bmLineupMap[kvComplex];
                bmPositionFromBucket = bmLineupMap[kvComplex];
                break;
              }
            }
          }
          
          // Strategy 5: Try last name matching (for players with common first names)
          if (!bucket) {
            const simpleNorm = bmNormName(name);
            const nameParts = simpleNorm.split(' ');
            if (nameParts.length > 1) {
              const lastName = nameParts[nameParts.length - 1];
              if (lastName.length >= 3) {
                const lastnameKey = `_lastname_${lastName}`;
                if (bmLineupMap[lastnameKey]) {
                  bucket = bmLineupMap[lastnameKey];
                  bmPositionFromBucket = bmLineupMap[lastnameKey];
                }
              }
            }
          }
          
          // Strategy 6: Fuzzy matching (final fallback)
          if (!bucket) {
            const matchedKey = findBMPlayerMatch(name, bmLineupMap);
            if (matchedKey && bmLineupMap[matchedKey]) {
              bucket = bmLineupMap[matchedKey];
              bmPositionFromBucket = bmLineupMap[matchedKey];
            }
          }
          
          // Debug logging if we have BM data but no match (only log first 5 players to avoid spam)
          if (!bucket && Object.keys(bmLineupMap).length > 0 && players.length < 5) {
            const bmKeys = Object.keys(bmLineupMap).filter(k => !k.startsWith('_lastname_'));
            const simpleNorm = bmNormName(name);
            const complexNorm = normName(name);
            const nameLower = name.toLowerCase().trim();
            
            console.error(`[DvP Ingest-NBA] ❌ No BM match for "${name}" (BDL player)`);
            console.error(`   Tried strategies:`);
            console.error(`     1. Exact (case-insensitive): "${name}" => ${bmLineupMap[name] ? '✅' : '❌'}`);
            console.error(`     2. Simple norm: "${simpleNorm}" => ${bmLineupMap[simpleNorm] ? '✅' : '❌'}`);
            console.error(`     3. Complex norm: "${complexNorm}" => ${bmLineupMap[complexNorm] ? '✅' : '❌'}`);
            console.error(`   BM keys in map (${bmKeys.length} total, showing first 10):`);
            bmKeys.slice(0, 10).forEach(k => {
              const kLower = k.toLowerCase().trim();
              const matches = kLower === nameLower || simpleNorm === bmNormName(k) || complexNorm === normName(k);
              console.error(`     - "${k}" => ${bmLineupMap[k]} ${matches ? '✅ MATCHES!' : ''}`);
            });
            
            // Check if any BM key would match with case-insensitive comparison
            const caseInsensitiveMatch = bmKeys.find(k => k.toLowerCase().trim() === nameLower);
            if (caseInsensitiveMatch) {
              console.error(`   ⚠️ FOUND case-insensitive match: "${caseInsensitiveMatch}" but Strategy 1 didn't catch it!`);
            }
          }
        }
        
        // PRIORITY 2: Starters from depth chart (for games without BasketballMonsters data)
        if (!bucket) {
          let starterPos: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = undefined;
          for (const kv of keys){ if ((startersMap as any)[kv] && activeSet.has(kv)) { starterPos = (startersMap as any)[kv]; break; } }
          bucket = starterPos;
        }
        
        // PRIORITY 3: Effective depth chart mapping (for bench players)
        if (!bucket){ 
          for (const kv of keys){ if ((effectiveMap as any)[kv]) { bucket = (effectiveMap as any)[kv]; break; } }
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
        
        // Determine if player is a starter
        // Priority: BasketballMonsters lineup > depth chart starters > active set
        const isStarter = keys.some(kv => 
          bmLineupMap[kv] !== undefined || // BasketballMonsters lineup (highest priority)
          ((startersMap as any)[kv] && activeSet.has(kv)) // Depth chart starter
        );
        const val = Number(r?.pts||0);
        buckets[bucket]+=val;
        // Check if this position came from BasketballMonsters
        // If bucket was set from BM, use that as bmPosition
        // Otherwise, try to match player name to bmLineupMap using same strategies
        let bmPosition: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = bmPositionFromBucket;
        
        // If not set from bucket, try to find in bmLineupMap by name matching (same strategies as above)
        if (!bmPosition && Object.keys(bmLineupMap).length > 0) {
          // Strategy 1: Exact name match
          if (bmLineupMap[name]) {
            bmPosition = bmLineupMap[name];
          }
          
          // Strategy 2: Simple normalization
          if (!bmPosition) {
            const simpleNorm = bmNormName(name);
            if (bmLineupMap[simpleNorm]) {
              bmPosition = bmLineupMap[simpleNorm];
            }
          }
          
          // Strategy 3: Complex normalization
          if (!bmPosition) {
            const complexNorm = normName(name);
            if (bmLineupMap[complexNorm]) {
              bmPosition = bmLineupMap[complexNorm];
            }
          }
          
          // Strategy 4: Key variations
          if (!bmPosition) {
            for (const kv of keys) {
              if (bmLineupMap[kv]) {
                bmPosition = bmLineupMap[kv];
                break;
              }
              const kvSimple = bmNormName(kv);
              if (bmLineupMap[kvSimple]) {
                bmPosition = bmLineupMap[kvSimple];
                break;
              }
              const kvComplex = normName(kv);
              if (bmLineupMap[kvComplex]) {
                bmPosition = bmLineupMap[kvComplex];
                break;
              }
            }
          }
          
          // Strategy 5: Last name matching
          if (!bmPosition) {
            const simpleNorm = bmNormName(name);
            const nameParts = simpleNorm.split(' ');
            if (nameParts.length > 1) {
              const lastName = nameParts[nameParts.length - 1];
              if (lastName.length >= 3) {
                const lastnameKey = `_lastname_${lastName}`;
                if (bmLineupMap[lastnameKey]) {
                  bmPosition = bmLineupMap[lastnameKey];
                }
              }
            }
          }
        }
        
        players.push({ playerId: Number(r?.player?.id)||0, name, bucket, isStarter, pts: val, reb: Number(r?.reb||0), ast: Number(r?.ast||0), fg3m: Number(r?.fg3m||0), fg3a: Number(r?.fg3a||0), fgm: Number(r?.fgm||0), fga: Number(r?.fga||0), stl: Number(r?.stl||0), blk: Number(r?.blk||0), min: (r as any)?.min || '0:00', bmPosition });
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

      // Redistribute bench player positions to avoid too many at same position
      // Only redistribute bench players (starters keep their positions)
      const benchPlayers = players.filter(p => !p.isStarter);
      const starterPlayers = players.filter(p => p.isStarter);
      
      if (benchPlayers.length > 3) { // Only redistribute if more than 3 bench players
        // Count positions for bench players
        const posCount: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
        benchPlayers.forEach(p => {
          if (p.bucket && ['PG','SG','SF','PF','C'].includes(p.bucket)) {
            const pos = p.bucket as 'PG'|'SG'|'SF'|'PF'|'C';
            posCount[pos]++;
          }
        });
        
        // Maximum allowed per position based on bench size
        // 4-5 bench: max 1 per position
        // 6-8 bench: max 2 per position
        // 9+ bench: max 3 per position
        const maxPerPosition = benchPlayers.length <= 5 ? 1 : (benchPlayers.length <= 8 ? 2 : 3);
        // Centers are always unlimited (they're listed separately)
        const maxCenter = Infinity;
        
        // Find positions that are over the limit
        // For guards: ensure balance (1 PG, 1 SG) when possible
        // For forwards: ensure balance (1 SF, 1 PF) when possible
        // Centers: unlimited
        const overLimit: Array<{ pos: 'PG'|'SG'|'SF'|'PF'|'C', count: number, players: typeof benchPlayers }> = [];
        const underLimit: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
        
        (['PG','SG','SF','PF','C'] as const).forEach(pos => {
          const maxAllowed = pos === 'C' ? maxCenter : maxPerPosition;
          if (posCount[pos] > maxAllowed) {
            overLimit.push({ 
              pos, 
              count: posCount[pos], 
              players: benchPlayers.filter(p => p.bucket === pos) 
            });
          } else if (posCount[pos] < maxAllowed && pos !== 'C') {
            // For non-centers, add to under-limit if below max
            underLimit.push(pos);
          }
        });
        
        // Special handling for guard/forward balance in normal games (4-5 bench)
        if (benchPlayers.length <= 5) {
          // Ensure guards are balanced: prefer 1 PG, 1 SG
          const totalGuards = posCount.PG + posCount.SG;
          if (totalGuards > 2) {
            // Too many guards, redistribute excess
            if (posCount.PG > 1 && posCount.SG < 1) {
              // Too many PGs, move one to SG
              const pgPlayers = benchPlayers.filter(p => p.bucket === 'PG').sort((a, b) => {
                const aMin = parseMinToSeconds(a.min);
                const bMin = parseMinToSeconds(b.min);
                return aMin - bMin;
              });
              if (pgPlayers.length > 0) {
                pgPlayers[0].bucket = 'SG';
                posCount.PG--;
                posCount.SG++;
              }
            } else if (posCount.SG > 1 && posCount.PG < 1) {
              // Too many SGs, move one to PG
              const sgPlayers = benchPlayers.filter(p => p.bucket === 'SG').sort((a, b) => {
                const aMin = parseMinToSeconds(a.min);
                const bMin = parseMinToSeconds(b.min);
                return aMin - bMin;
              });
              if (sgPlayers.length > 0) {
                sgPlayers[0].bucket = 'PG';
                posCount.SG--;
                posCount.PG++;
              }
            }
          }
          
          // Ensure forwards are balanced: prefer 1 SF, 1 PF
          const totalForwards = posCount.SF + posCount.PF;
          if (totalForwards > 2) {
            // Too many forwards, redistribute excess
            if (posCount.SF > 1 && posCount.PF < 1) {
              // Too many SFs, move one to PF
              const sfPlayers = benchPlayers.filter(p => p.bucket === 'SF').sort((a, b) => {
                const aMin = parseMinToSeconds(a.min);
                const bMin = parseMinToSeconds(b.min);
                return aMin - bMin;
              });
              if (sfPlayers.length > 0) {
                sfPlayers[0].bucket = 'PF';
                posCount.SF--;
                posCount.PF++;
              }
            } else if (posCount.PF > 1 && posCount.SF < 1) {
              // Too many PFs, move one to SF
              const pfPlayers = benchPlayers.filter(p => p.bucket === 'PF').sort((a, b) => {
                const aMin = parseMinToSeconds(a.min);
                const bMin = parseMinToSeconds(b.min);
                return aMin - bMin;
              });
              if (pfPlayers.length > 0) {
                pfPlayers[0].bucket = 'SF';
                posCount.PF--;
                posCount.SF++;
              }
            }
          }
          
          // Recalculate position counts after guard/forward balance
          posCount.PG = benchPlayers.filter(p => p.bucket === 'PG').length;
          posCount.SG = benchPlayers.filter(p => p.bucket === 'SG').length;
          posCount.SF = benchPlayers.filter(p => p.bucket === 'SF').length;
          posCount.PF = benchPlayers.filter(p => p.bucket === 'PF').length;
          posCount.C = benchPlayers.filter(p => p.bucket === 'C').length;
        }
        
        // Recalculate overLimit and underLimit after any balance adjustments
        const finalOverLimit: Array<{ pos: 'PG'|'SG'|'SF'|'PF'|'C', count: number, players: typeof benchPlayers }> = [];
        const finalUnderLimit: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
        
        (['PG','SG','SF','PF','C'] as const).forEach(pos => {
          const maxAllowed = pos === 'C' ? maxCenter : maxPerPosition;
          if (posCount[pos] > maxAllowed) {
            finalOverLimit.push({ 
              pos, 
              count: posCount[pos], 
              players: benchPlayers.filter(p => p.bucket === pos) 
            });
          } else if (posCount[pos] < maxAllowed && pos !== 'C') {
            finalUnderLimit.push(pos);
          }
        });
        
        // Redistribute players from over-limit positions to under-limit positions
        for (const { pos, players: posPlayers } of finalOverLimit) {
          const maxAllowed = pos === 'C' ? maxCenter : maxPerPosition;
          const excess = posCount[pos] - maxAllowed;
          const toRedistribute = posPlayers
            .sort((a, b) => {
              // Prefer redistributing players with fewer minutes (less important players)
              const aMin = parseMinToSeconds(a.min);
              const bMin = parseMinToSeconds(b.min);
              return aMin - bMin;
            })
            .slice(0, excess);
          
          for (const player of toRedistribute) {
            // Find best alternative position
            let newPos: 'PG'|'SG'|'SF'|'PF'|'C' | null = null;
            
            // Try adjacent positions first
            const adjacent: Record<'PG'|'SG'|'SF'|'PF'|'C', Array<'PG'|'SG'|'SF'|'PF'|'C'>> = {
              PG: ['SG', 'SF'],
              SG: ['PG', 'SF'],
              SF: ['SG', 'PF'],
              PF: ['SF', 'C'],
              C: ['PF', 'SF']
            };
            
            // First try adjacent positions that are under limit
            for (const adjPos of adjacent[pos]) {
              if (finalUnderLimit.includes(adjPos)) {
                newPos = adjPos;
                break;
              }
            }
            
            // If no adjacent position available, try any under-limit position
            if (!newPos && finalUnderLimit.length > 0) {
              // Prefer positions that make sense based on original position
              // For guards: prefer other guard position, then forwards
              // For forwards: prefer other forward position, then guards
              const preferredOrder: Array<'PG'|'SG'|'SF'|'PF'|'C'> = 
                pos === 'PG' ? ['SG', 'SF', 'PF', 'C'] :  // Guard: prefer SG, then forwards
                pos === 'SG' ? ['PG', 'SF', 'PF', 'C'] :  // Guard: prefer PG, then forwards
                pos === 'SF' ? ['PF', 'SG', 'PG', 'C'] :  // Forward: prefer PF, then guards
                pos === 'PF' ? ['SF', 'SG', 'PG', 'C'] :  // Forward: prefer SF, then guards
                ['PF', 'SF', 'SG', 'PG'];  // Center: prefer forwards, then guards
              
              for (const prefPos of preferredOrder) {
                // Skip centers unless it's the only option (centers are unlimited)
                if (prefPos === 'C' && finalUnderLimit.filter(p => p !== 'C').length > 0) {
                  continue;
                }
                if (finalUnderLimit.includes(prefPos)) {
                  newPos = prefPos;
                  break;
                }
              }
              
              // If still no match, just use first available (excluding centers if possible)
              if (!newPos) {
                const nonCenterOptions = finalUnderLimit.filter(p => p !== 'C');
                newPos = nonCenterOptions.length > 0 ? nonCenterOptions[0] : finalUnderLimit[0];
              }
            }
            
            if (newPos) {
              player.bucket = newPos;
              const oldPos = pos as 'PG'|'SG'|'SF'|'PF'|'C';
              posCount[oldPos]--;
              posCount[newPos]++;
              
              // Update under/over limit lists
              if (posCount[oldPos] <= maxPerPosition) {
                const overIdx = overLimit.findIndex(o => o.pos === oldPos);
                if (overIdx >= 0) {
                  overLimit[overIdx].count = posCount[oldPos];
                  if (posCount[oldPos] === maxPerPosition) {
                    overLimit.splice(overIdx, 1);
                  }
                }
              }
              
              if (posCount[newPos] >= (newPos === 'C' ? maxCenter : maxPerPosition)) {
                const underIdx = finalUnderLimit.indexOf(newPos);
                if (underIdx >= 0) {
                  finalUnderLimit.splice(underIdx, 1);
                }
              }
            }
          }
        }
        
        // Rebuild players array with redistributed positions
        players = [...starterPlayers, ...benchPlayers];
      }

      // Add metadata about lineup source
      const lineupSource = usedVerifiedLineup ? 'basketballmonsters-verified' : 
                          (Object.keys(bmLineupMap).length > 0 ? 'basketballmonsters-projected' : 'bdl+espn');
      
      // Summary log for this game
      const playersWithBmPosition = players.filter(p => p.bmPosition).length;
      const totalPlayers = players.length;
      
      // DEBUG: Log first few players with their bmPosition status
      if (players.length > 0 && Object.keys(bmLineupMap).length > 0) {
        console.error(`[DvP Ingest-NBA] 📊 ${team} vs ${oppAbbr} (${gameDateStr}):`);
        console.error(`   Total players: ${totalPlayers}, With bmPosition: ${playersWithBmPosition}`);
        console.error(`   Cached lineup: ${cachedLineup ? `${cachedLineup.length} players` : 'NOT FOUND'}`);
        if (cachedLineup && Array.isArray(cachedLineup)) {
          console.error(`   Cached players: ${cachedLineup.map(p => p.name).join(', ')}`);
        }
        console.error(`   First 3 BDL players: ${players.slice(0, 3).map((p: any) => `${p.name} (bmPosition: ${p.bmPosition || 'NONE'})`).join(', ')}`);
      }
      
      // Count unique BM players (excluding variations like _lastname_ keys)
      const bmUniquePlayers = new Set(Object.keys(bmLineupMap).filter(k => !k.startsWith('_lastname_')).map(k => {
        // Get the original name by finding the key that's not normalized
        const keys = Object.keys(bmLineupMap).filter(key => bmLineupMap[key] === bmLineupMap[k] && !key.startsWith('_lastname_'));
        return keys.find(key => key === key.trim() && key !== bmNormName(key) && key !== normName(key)) || keys[0];
      }));
      const bmLineupCount = bmUniquePlayers.size;
      
      console.error(`[DvP Ingest-NBA] 📊 Game ${gidBdl} (${away} @ ${home} on ${gameDateStr}) summary:`);
      console.error(`   - BM lineup available: ${bmLineupCount} unique players (${Object.keys(bmLineupMap).length} total keys including variations)`);
      console.error(`   - Total players processed: ${totalPlayers}`);
      console.error(`   - Players with bmPosition: ${playersWithBmPosition}`);
      if (bmLineupCount > 0 && playersWithBmPosition === 0) {
        console.error(`   ⚠️ WARNING: BM lineup has ${bmLineupCount} players but 0 matched!`);
        const bmSampleKeys = Array.from(bmUniquePlayers).slice(0, 5);
        console.error(`   - BM players (sample): ${bmSampleKeys.join(', ')}`);
        console.error(`   - BDL players (first 10): ${players.slice(0, 10).map(p => `"${p.name}"`).join(', ')}`);
        // Show what normalizations we tried
        if (players.length > 0) {
          const samplePlayer = players[0];
          console.error(`   - Sample matching attempt for "${samplePlayer.name}":`);
          console.error(`     * Exact: "${samplePlayer.name}" => ${bmLineupMap[samplePlayer.name] ? '✅' : '❌'}`);
          console.error(`     * Simple norm: "${bmNormName(samplePlayer.name)}" => ${bmLineupMap[bmNormName(samplePlayer.name)] ? '✅' : '❌'}`);
          console.error(`     * Complex norm: "${normName(samplePlayer.name)}" => ${bmLineupMap[normName(samplePlayer.name)] ? '✅' : '❌'}`);
        }
      }
      
      out.push({ 
        gameId: gidBdl, 
        date: when, 
        opponent: oppAbbr, 
        team, 
        season: seasonLabelFromYear(seasonYear), 
        buckets, 
        players, 
        source: lineupSource,
        lineupVerified: usedVerifiedLineup // Track if positions came from verified BasketballMonsters lineup
      });
    }

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
    
    // Calculate BasketballMonsters usage statistics
    const bmStats = {
      gamesWithBM: 0,
      gamesWithVerifiedBM: 0,
      totalPlayersWithBMPos: 0
    };
    
    for (const game of out) {
      if (game.source?.startsWith('basketballmonsters') || game.lineupVerified !== undefined) {
        bmStats.gamesWithBM++;
        if (game.lineupVerified === true) {
          bmStats.gamesWithVerifiedBM++;
        }
        // Count players with bmPosition in this game
        const players = Array.isArray(game.players) ? game.players : [];
        bmStats.totalPlayersWithBMPos += players.filter((p: any) => p.bmPosition).length;
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
      basketballmonsters: bmStats.gamesWithBM > 0 ? {
        games_using_bm: bmStats.gamesWithBM,
        games_verified: bmStats.gamesWithVerifiedBM,
        games_projected: bmStats.gamesWithBM - bmStats.gamesWithVerifiedBM,
        players_with_bm_positions: bmStats.totalPlayersWithBMPos
      } : null
    });
  }catch(e:any){
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
