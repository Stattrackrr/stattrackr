import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { normalizeAbbr } from "@/lib/nbaAbbr";

export const runtime = "nodejs";

// --- Position lock (master) helpers ---
type MasterPositions = { positions: Record<string,'PG'|'SG'|'SF'|'PF'|'C'>, aliases: Record<string,string> };
function masterFilePath(){
  return path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
}
function ensureDir(p: string){ const dir = path.dirname(p); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function loadMaster(): MasterPositions{
  try{
    const p = masterFilePath();
    if (!fs.existsSync(p)) return { positions: {}, aliases: {} };
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const pos: any = j?.positions || {};
    const als: any = j?.aliases || {};
    return { positions: pos, aliases: als } as any;
  }catch{ return { positions: {}, aliases: {} }; }
}
function saveMaster(m: MasterPositions){ try{ const p = masterFilePath(); ensureDir(p); fs.writeFileSync(p, JSON.stringify(m, null, 2)); }catch{} }

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

// Ball Don't Lie fallback
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
const ABBR_TO_TEAM_ID_BDL: Record<string, number> = { // 1..30
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

function seasonLabelFromYear(y: number) {
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
async function nbaFetch(pathAndQuery: string) {
  const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, { headers: NBA_HEADERS, cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`NBA ${res.status}: ${t || pathAndQuery}`);
  }
  return res.json();
}
function idx(headers: string[], ...names: string[]) {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

// ESPN dynamic roster (per game) resolver
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
function formatMDY(d: string | Date){
  const dt = typeof d === 'string' ? new Date(d) : d;
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const dd = String(dt.getDate()).padStart(2,'0');
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
type EspnRosterInfo = { pos: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'|'G'|'F'|string>, starters: string[] };
async function fetchEspnRosterMapByDate(dateStr: string, homeAbbr: string, awayAbbr: string): Promise<EspnRosterInfo>{
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
    if (!evt) return { pos: {}, starters: [] };
    const eventId = String(evt?.id || evt?.uid?.split(':').pop() || '');
    if (!eventId) return { pos: {}, starters: [] };
    const sum = await espnFetch(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/summary?event=${eventId}`);
    const map: any = {};
    const starters: string[] = [];
    const addAth = (a:any)=>{
      const nm = normName(a?.athlete?.displayName || a?.athlete?.fullName || a?.athlete?.name || a?.displayName || a?.name || '');
      const pos = String(a?.position?.abbreviation || a?.position || '').toUpperCase();
      const isStarter = Boolean(a?.starter || a?.isStarter || a?.starting || a?.starterStatus === 'STARTER' || a?.lineupSlot === 'starter');
      if (nm) { map[nm] = pos as any; if (isStarter) starters.push(nm); }
    };
    const box = sum?.boxscore;
    // Try boxscore.players[...].athletes
    const teams = box?.players || box?.teams || [];
    for (const t of teams){
      const aths = t?.athletes || t?.statistics?.[0]?.athletes || [];
      if (Array.isArray(aths)) aths.forEach(addAth);
    }
    // Also try boxscore.teams[*].players
    for (const t of (box?.teams||[])){
      const aths = t?.players || [];
      if (Array.isArray(aths)) aths.forEach(addAth);
    }
    return { pos: map as any, starters };
  }catch{ return { pos: {}, starters: [] }; }
}

function storePath(seasonYear: number, team: string) {
  const dir = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear));
  const file = path.join(dir, `${team}.json`);
  return { dir, file };
}

// Decide unique PG/SG/SF/PF/C for starters using ESPN explicit positions first,
// then last-known position, then fill remaining slots with sensible defaults.
function assignUniqueStarterBuckets(
  starterKeys: string[],
  getEspnPos: (k: string) => string,
  lastPos: Map<string, 'PG'|'SG'|'SF'|'PF'|'C'>
): Map<string, 'PG'|'SG'|'SF'|'PF'|'C'> {
  const remaining = new Set<'PG'|'SG'|'SF'|'PF'|'C'>(['PG','SG','SF','PF','C']);
  const out = new Map<string, 'PG'|'SG'|'SF'|'PF'|'C'>();
  const isExact = (p: string): p is 'PG'|'SG'|'SF'|'PF'|'C' => ['PG','SG','SF','PF','C'].includes(p);

  // 1) ESPN explicit
  for (const k of starterKeys){
    const p = getEspnPos(k);
    if (isExact(p) && remaining.has(p)) { out.set(k, p); remaining.delete(p); }
  }
  // 2) Last-known
  for (const k of starterKeys){
    if (out.has(k)) continue;
    const p = lastPos.get(k);
    if (p && remaining.has(p)) { out.set(k, p); remaining.delete(p); }
  }
  // 3) Do NOT guess based on broad G/F. Leave unassigned; per-player logic will consult depth chart and last-known.
  return out;
}

function normName(s: string){
  const base = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,' ').replace(/\s+/g,' ').trim();
  const parts = base.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1);
    let acc = '';
    const out: string[] = [];
    for (const w of first) {
      if (w.length === 1) acc += w; else { if (acc) { out.push(acc); acc=''; } out.push(w); }
    }
    if (acc) out.push(acc);
    out.push(last);
    return out.join(' ');
  }
  return base;
}
// Generate alternative normalized keys to handle names like D'Angelo -> "d angelo" vs "dangelo"
function altKeys(k: string): string[]{
  const out = new Set<string>([k]);
  const parts = k.split(' ').filter(Boolean);
  // Join first+second if first is an initial or short prefix (d, o, de, da, le, la)
  if (parts.length >= 2) {
    const p1 = parts[0]; const p2 = parts[1];
    if (p1.length <= 2 || p2.length <= 2) out.add(`${p1}${p2} ${parts.slice(2).join(' ')}`.trim());
  }
  // Join any token that is a single letter with the next token (handles surnames like O Neal -> Oneal)
  for (let i=0;i<parts.length-1;i++){
    if (parts[i].length === 1){
      const v = [...parts];
      v.splice(i,2, parts[i]+parts[i+1]);
      out.add(v.join(' '));
    }
  }
  return [...out];
}

// Basketball-Reference helpers (no external deps)
const NBA_TO_BR: Record<string,string> = { BKN:'BRK', CHA:'CHO', PHX:'PHO' };
const BR_TO_NBA: Record<string,string> = { BRK:'BKN', CHO:'CHA', PHO:'PHX' };
function toBR(abbr: string){ const u = String(abbr||'').toUpperCase(); return NBA_TO_BR[u] || u; }
function fromBR(abbr: string){ const u = String(abbr||'').toUpperCase(); return BR_TO_NBA[u] || u; }

type BRRoster = { pos: Record<string,'PG'|'SG'|'SF'|'PF'|'C'|'G'|'F'>, starters: string[] };
async function fetchBRRosterByDate(dateStr: string, homeAbbr: string): Promise<Record<string, BRRoster>>{
  try{
    const ymd = /\d{8}/.test(dateStr) ? dateStr : formatYMD(dateStr);
    const url = `https://www.basketball-reference.com/boxscores/${ymd}${toBR(homeAbbr)}.html`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return {} as any;
    const html = await res.text();
    const out: Record<string, BRRoster> = {} as any;
    const tableRe = /<table[^>]*id=\"box-([A-Z]{3})-game-basic\"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/g;
    let m: RegExpExecArray | null;
    while ((m = tableRe.exec(html))) {
      const brAbbr = m[1];
      const nbaAbbr = fromBR(brAbbr);
      const tbody = m[2];
      const rows = Array.from(tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g));
      const pos: Record<string,'PG'|'SG'|'SF'|'PF'|'C'|'G'|'F'> = {} as any;
      const starters: string[] = [];
      rows.forEach((rr, i) => {
        const row = rr[1];
        const nameMatch = row.match(/<th[^>]*data-stat=\"player\"[^>]*>\s*(?:<a[^>]*>)?([^<]+)</i);
        const posMatch = row.match(/<td[^>]*data-stat=\"pos\"[^>]*>\s*([A-Z]{1,2})\s*</i);
        const name = normName(nameMatch?.[1] || '');
        const posRaw = String(posMatch?.[1]||'').toUpperCase();
        const mapped = (posRaw==='G' || posRaw==='F') ? posRaw : (['PG','SG','SF','PF','C'].includes(posRaw)? posRaw : ('' as any));
        if (name && mapped) pos[name] = mapped as any;
        if (i < 5 && name) starters.push(name);
      });
      out[nbaAbbr] = { pos, starters } as any;
    }
    return out;
  }catch{ return {} as any; }
}

function loadTeamCustom(abbr: string): { pos: Record<string,'PG'|'SG'|'SF'|'PF'|'C'>, aliases: Record<string,string> } {
  try{
    const p = path.resolve(process.cwd(),'data','player_positions','teams',`${abbr}.json`);
    if (!fs.existsSync(p)) return { pos: {} as any, aliases: {} };
    const j = JSON.parse(fs.readFileSync(p,'utf8'));
    const pos = j?.positions || {};
    const als = j?.aliases || {};
    const outPos: any = {};
    for (const [k,v] of Object.entries(pos)){
      if (['PG','SG','SF','PF','C'].includes(String(v))) outPos[normName(k)] = v;
    }
    const outAls: any = {};
    for (const [k,v] of Object.entries(als)){
      outAls[normName(k)] = normName(String(v));
    }
    return { pos: outPos, aliases: outAls };
  }catch{ return { pos: {} as any, aliases: {} }; }
}

// Depth chart fetcher that locks starters to ONLY their starting position and removes
// all of their rotation appearances; non-starters pick the earliest slot across positions.
async function fetchDepthChartBestMap(teamAbbr: string, host?: string): Promise<Record<string,'PG'|'SG'|'SF'|'PF'|'C'>>{
  try{
    const t = normalizeAbbr(teamAbbr);
    const base = host ? `http://${host}` : (process.env.NEXT_PUBLIC_BASE_URL || '');
    const url = base ? `${base}/api/depth-chart?team=${encodeURIComponent(t)}&refresh=1` : `/api/depth-chart?team=${encodeURIComponent(t)}&refresh=1`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return {} as any;
    const js = await res.json().catch(()=> ({}));
    let dc = js?.depthChart || {};
    // Injury-aware promotion: drop OUT players from columns so next man up is index 0
    try{
      const injUrl = base ? `${base}/api/injuries?teams=${encodeURIComponent(t)}&per_page=100` : `/api/injuries?teams=${encodeURIComponent(t)}&per_page=100`;
      const ir = await fetch(injUrl, { cache:'no-store' });
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

    // 1) Lock starters: the first entry in each column is the starter. If a player appears
    // as first in multiple columns, prefer by PG>SG>SF>PF>C priority and lock once.
    const order: ('PG'|'SG'|'SF'|'PF'|'C')[] = ['PG','SG','SF','PF','C'];
    const starterLock: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
    for (const pos of order){
      const arr = Array.isArray(dc[pos]) ? dc[pos] : [];
      const first = arr && arr.length ? (typeof arr[0]==='string' ? arr[0] : arr[0]?.name) : null;
      const key = first ? normName(String(first)) : '';
      if (key && !starterLock[key]) starterLock[key] = pos;
    }

    // 2) Build per-player slot indices for NON-STARTERS only (remove all rotation positions for starters)
    const slots: Record<string, Partial<Record<'PG'|'SG'|'SF'|'PF'|'C', number>>> = {};
    (['PG','SG','SF','PF','C'] as const).forEach(k=>{
      const arr = Array.isArray(dc[k]) ? dc[k] : [];
      arr.forEach((p:any, idx:number)=>{
        const name = typeof p==='string'? p : p?.name;
        const key = name ? normName(name) : '';
        if (!key || starterLock[key]) return; // skip all appearances for starters
        const prev = slots[key]?.[k];
        const v = Number.isFinite(prev as any) ? Math.min(prev as number, idx) : idx;
        if (!slots[key]) slots[key] = {};
        (slots[key] as any)[k] = v;
      });
    });

    // 3) Choose best for non-starters by earliest slot; tie-break by PG>SG>SF>PF>C
    const best: Record<string,'PG'|'SG'|'SF'|'PF'|'C'> = {} as any;
    for (const [name, byPos] of Object.entries(slots)){
      const entries = Object.entries(byPos as Record<string,number>) as Array<[ 'PG'|'SG'|'SF'|'PF'|'C', number]>;
      if (!entries.length) continue;
      const minIdx = Math.min(...entries.map(e=> e[1]));
      const tied = entries.filter(e=> e[1]===minIdx).map(e=> e[0]) as ('PG'|'SG'|'SF'|'PF'|'C')[];
      best[name] = order.find(p=> tied.includes(p)) || tied[0];
    }

    // 4) Merge in starter locks (these players will only have their starting position)
    for (const [k,pos] of Object.entries(starterLock)) best[k] = pos as any;

    return best as any;
  }catch{ return {} as any; }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawTeam = searchParams.get('team') || '';
    const team = normalizeAbbr(rawTeam);
    const seasonYear = searchParams.get('season') ? parseInt(String(searchParams.get('season')), 10) : currentNbaSeason();
    const limitGames = Math.min(parseInt(searchParams.get('games') || '50', 10) || 50, 82);
    const refresh = searchParams.get('refresh') === '1';
    const allowRelock = searchParams.get('relock') === '1'; // optional: allow overriding existing locked positions

    if (!team) return NextResponse.json({ success: false, error: 'Missing team' }, { status: 400 });
    const teamId = ABBR_TO_TEAM_ID[team];
    if (!teamId) return NextResponse.json({ success: false, error: `Unknown team: ${team}` }, { status: 400 });

    const seasonLabel = seasonLabelFromYear(seasonYear);

    // Persist setup - load existing data first
    const { dir, file } = storePath(seasonYear, team);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (refresh && fs.existsSync(file)) fs.unlinkSync(file);
    const out: any[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    const have = new Set(out.map(x => String(x.gameId)));
    
    // Find most recent stored game date to only fetch newer games
    let mostRecentDate: Date | null = null;
    if (out.length > 0 && !refresh) {
      const dates = out.map(g => g.date).filter(Boolean).map(d => new Date(d));
      if (dates.length > 0) {
        mostRecentDate = new Date(Math.max(...dates.map(d => d.getTime())));
      }
    }

    // Use BDL to list games quickly - only fetch games newer than most recent stored
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[team];
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page','100');
    gamesUrl.searchParams.append('seasons[]', String(seasonYear));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    // Only fetch games after the most recent stored game (unless refresh=1)
    if (mostRecentDate && !refresh) {
      // Add 1 day to mostRecentDate to ensure we don't re-fetch the same game
      const startDate = new Date(mostRecentDate);
      startDate.setDate(startDate.getDate() + 1);
      gamesUrl.searchParams.set('start_date', startDate.toISOString().split('T')[0]);
    }
    
    const gjs = await bdlFetch(gamesUrl.toString());
    const gdata: any[] = Array.isArray(gjs?.data) ? gjs.data : [];
    const finals = gdata.filter(g => String(g?.status||'').toLowerCase().includes('final'));
    finals.sort((a,b)=> new Date(b?.date||0).getTime() - new Date(a?.date||0).getTime());
    
    // If not refreshing and we have existing data, only process new games up to limit
    const picked = refresh ? finals.slice(0, limitGames) : finals.filter(g => !have.has(String(g.id)));
    let gameIds: string[] = picked.map(g => String(g.id));
    const gameDates: Record<string, string> = Object.fromEntries(picked.map(g => [String(g.id), String(g?.date||'')]));
    const gameMeta: Record<string, { home: string, away: string, oppAbbr: string }> = {} as any;
    picked.forEach(g=>{
      const home = String(g?.home_team?.abbreviation||'');
      const away = String(g?.visitor_team?.abbreviation||'');
      const oppAbbr = home.toUpperCase() === team ? away : home;
      gameMeta[String(g.id)] = { home, away, oppAbbr };
    });
    // process oldest -> newest
    gameIds = gameIds.reverse();

    // last known bucket per player (by normalized name) for this season
    const lastPos = new Map<string, 'PG'|'SG'|'SF'|'PF'|'C'>();
    out.forEach(g => {
      (g.players || []).forEach((p: any) => { const k = normName(p?.name || ''); if (k && p.bucket) lastPos.set(k, p.bucket); });
    });

    // load master locks once (positions that should not change once set)
    const master = loadMaster();
    const MASTER_POS = master.positions || {};
    let masterDirty = false;
    const VALID = new Set(['PG','SG','SF','PF','C']);
    const lockPosition = (key: string, pos: any) => {
      const k = normName(key);
      const p = String(pos||'').toUpperCase();
      if (!k || !VALID.has(p as any)) return;
      if (!MASTER_POS[k] || allowRelock) {
        MASTER_POS[k] = p as any;
        masterDirty = true;
      }
    };

    for (const gid of gameIds) {
      if (!gid || have.has(gid)) continue;
      const when = gameDates[gid] || null;
      const meta = (gameMeta as any)[gid] || { home: team, away: '', oppAbbr: '' };
let espnInfo: EspnRosterInfo = { pos: {}, starters: [] } as any;
      try { if (when) espnInfo = await fetchEspnRosterMapByDate(formatYMD(new Date(when)), meta.home, meta.away); } catch {}
      const espnMap = (espnInfo?.pos || {}) as Record<string,string>;
      const espnStarters = new Set<string>(Array.isArray(espnInfo?.starters)? espnInfo.starters: []);

      // Fetch BDL stats for this game
      const statsUrl = new URL(`${BDL_BASE}/stats`);
      statsUrl.searchParams.append('game_ids[]', String(gid));
      statsUrl.searchParams.set('per_page','100');
      const sjs = await bdlFetch(statsUrl.toString());
      const srows = Array.isArray(sjs?.data)? sjs.data: [];
      const oppIdBdl = ABBR_TO_TEAM_ID_BDL[meta.oppAbbr?.toUpperCase?.() || ''];
      const oppRows = srows.filter((r:any)=> r?.team?.id === oppIdBdl);
      const custom = loadTeamCustom(meta.oppAbbr || '');
      const host = req.headers.get('host') || undefined;
      const depthMap: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = await fetchDepthChartBestMap(meta.oppAbbr || '', host).catch(()=> ({}));

      // Get NBA starter order for this game (resolve GameID and pull boxscore)
      let starterOrder: string[] = [];
      try {
        if (when) {
          const mdy = formatMDY(new Date(when));
          const sb = await nbaFetch(`scoreboardv2?GameDate=${encodeURIComponent(mdy)}&DayOffset=0`);
          const sset = (sb?.resultSets || []).find((r:any)=> (r?.name||'').toLowerCase().includes('games')) || sb?.resultSets?.[0];
          const sh = sset?.headers || [];
          const srows: any[] = sset?.rowSet || [];
          const iGid = idx(sh,'GAME_ID');
          const iHome = idx(sh,'HOME_TEAM_ID');
          const iAway = idx(sh,'VISITOR_TEAM_ID');
          const wantHome = ABBR_TO_TEAM_ID[String(meta.home||'').toUpperCase()]||0;
          const wantAway = ABBR_TO_TEAM_ID[String(meta.away||'').toUpperCase()]||0;
          const game = srows.find(r => (Number(r[iHome])===wantHome && Number(r[iAway])===wantAway) || (Number(r[iHome])===wantAway && Number(r[iAway])===wantHome));
          const nbaGid = game ? String(game[iGid]) : '';
          if (nbaGid){
            const bs = await nbaFetch(`boxscoretraditionalv2?GameID=${nbaGid}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
            const pset = (bs?.resultSets || []).find((r: any) => (r?.name || '').toLowerCase().includes('playerstats')) || bs?.resultSets?.[0];
            const h = pset?.headers || [];
            const rsRows: any[] = pset?.rowSet || [];
            const iTeamAbbr = idx(h, 'TEAM_ABBREVIATION');
            const iPlayer = idx(h, 'PLAYER_NAME');
            const iStartPos = idx(h, 'START_POSITION');
            const nb = rsRows.filter(r => String(r[iTeamAbbr]||'').toUpperCase() === (meta.oppAbbr||'').toUpperCase() && String(r[iStartPos]||'').length>0);
            starterOrder = nb.slice(0,5).map(r => normName(String(r[iPlayer]||''))).map(n => custom.aliases[n] || n);
          }
        }
      } catch {}

      // Assign SF,PF,C,SG,PG to the starters by order (fallback to default order if NBA fails)
      const starterAssign = new Map<string, 'PG'|'SG'|'SF'|'PF'|'C'>();
      const nbaStarters = new Set<string>(starterOrder);
      if (starterOrder.length===5){
        starterAssign.set(starterOrder[2], 'C');
        const f1 = starterOrder[0], f2 = starterOrder[1];
        const f1d = depthMap[f1] || depthMap[custom.aliases[f1]||''];
        const f2d = depthMap[f2] || depthMap[custom.aliases[f2]||''];
        if (f1d==='PF' && f2d!=='PF') { starterAssign.set(f1,'PF'); starterAssign.set(f2,'SF'); }
        else if (f2d==='PF' && f1d!=='PF') { starterAssign.set(f2,'PF'); starterAssign.set(f1,'SF'); }
        else if (f1d==='SF' && f2d!=='SF') { starterAssign.set(f1,'SF'); starterAssign.set(f2,'PF'); }
        else if (f2d==='SF' && f1d!=='SF') { starterAssign.set(f2,'SF'); starterAssign.set(f1,'PF'); }
        else { starterAssign.set(f1,'SF'); starterAssign.set(f2,'PF'); }
        const g1 = starterOrder[3], g2 = starterOrder[4];
        const g1d = depthMap[g1] || depthMap[custom.aliases[g1]||''];
        const g2d = depthMap[g2] || depthMap[custom.aliases[g2]||''];
        if (g1d==='PG' && g2d!=='PG') { starterAssign.set(g1,'PG'); starterAssign.set(g2,'SG'); }
        else if (g2d==='PG' && g1d!=='PG') { starterAssign.set(g2,'PG'); starterAssign.set(g1,'SG'); }
        else if (g1d==='SG' && g2d!=='SG') { starterAssign.set(g1,'SG'); starterAssign.set(g2,'PG'); }
        else if (g2d==='SG' && g1d!=='SG') { starterAssign.set(g2,'SG'); starterAssign.set(g1,'PG'); }
        else { starterAssign.set(g1,'SG'); starterAssign.set(g2,'PG'); }
      }

      const players: any[] = [];
      const buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
      const toTitle = (k: string)=> k.split(' ').map(w=> w? (w[0].toUpperCase()+w.slice(1)) : w).join(' ');

      for (const r of oppRows){
        const name = `${r?.player?.first_name||''} ${r?.player?.last_name||''}`.trim();
        const key = normName(name);
        const aliasKey = custom.aliases[key] || key;
        // Try multiple key variants to match depth/starter sets for apostrophe names
        const keyVars = altKeys(aliasKey);
        let bucket: 'PG'|'SG'|'SF'|'PF'|'C' | undefined = undefined;
        for (const kv of keyVars){ if (starterAssign.has(kv)) { bucket = starterAssign.get(kv); break; } }
        // Prefer NBA/ESPN starters to flag isStarter
        const isStarter = keyVars.some(kv => nbaStarters.has(kv) || espnStarters.has(kv) || starterAssign.has(kv));
        if (!bucket){
          for (const kv of keyVars){ if (depthMap[kv]) { bucket = depthMap[kv] as any; break; } }
        }
        // Fallback: check master position locks for players we've seen before
        if (!bucket) {
          for (const kv of keyVars) {
            if (MASTER_POS[kv]) { bucket = MASTER_POS[kv] as any; break; }
          }
        }
        // Fallback: unique last-name match in depthMap
        if (!bucket){
          const partsNk = aliasKey.split(' ').filter(Boolean);
          const last = partsNk.length ? partsNk[partsNk.length-1] : '';
          if (last){
            const matches = Object.entries(depthMap).filter(([k])=> k.endsWith(` ${last}`) || k===last);
            if (matches.length===1){ bucket = matches[0][1] as any; }
          }
        }
        
        // Extract stats before final fallback
        const val = Number(r?.pts||0);
        const rebVal = Number(r?.reb||0);
        const astVal = Number(r?.ast||0);
        const blkVal = Number(r?.blk||0);
        
        // Final fallback: assign position based on player profile if we still don't have one
        if (!bucket) {
          // Check if player is likely a center based on rebounds vs assists
          if (rebVal > astVal * 2) {
            bucket = 'C';
          } else if (astVal > rebVal) {
            bucket = 'PG';
          } else {
            bucket = 'SF'; // Default to forward
          }
        }
        lastPos.set(aliasKey, bucket);
        // Position lock: only lock if the player recorded any stat contributions (played)
        if ((val + rebVal + astVal + Number(r?.fg3m||0) + Number(r?.stl||0) + blkVal) > 0) {
          lockPosition(aliasKey, bucket);
          // also lock common alt keys to canonical name for robustness
          for (const kv of keyVars){
            const nkv = normName(kv);
            if (nkv && !master.aliases[nkv]) { master.aliases[nkv] = normName(aliasKey); masterDirty = true; }
          }
        }
        buckets[bucket] += val;
        players.push({ playerId: Number(r?.player?.id)||0, name, bucket, isStarter, pts: val, reb: rebVal, ast: astVal, fg3m: Number(r?.fg3m||0), fg3a: Number(r?.fg3a||0), fga: Number(r?.fga||0), fgm: Number(r?.fgm||0), stl: Number(r?.stl||0), blk: blkVal });
      }

      // Add zero-line entries for depth-chart players missing from BDL stats (e.g., DNPs or apostrophe parsing)
      try{
        const seen = new Set(players.map(p=> normName(p.name)));
        for (const [k,pos] of Object.entries(depthMap)){
          if (!seen.has(k)){
            const display = toTitle(k);
            const isStarter = nbaStarters.has(k) || espnStarters.has(k) || starterAssign.has(k as any);
            players.push({ playerId: 0, name: display, bucket: pos, isStarter, pts: 0, reb: 0, ast: 0, fg3m: 0, fg3a: 0, fga: 0, fgm: 0, stl: 0, blk: 0 });
          }
        }
      }catch{}
      
      // Rebalance positions: ensure at least 2 players per position when 10+ players contribute
      const contributingPlayers = players.filter(p => (p.pts + p.reb + p.ast + p.fg3m + p.stl + p.blk) > 0);
      if (contributingPlayers.length >= 10) {
        // Count players per position
        const posCount: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
        contributingPlayers.forEach(p => { 
          if (p.bucket && ['PG', 'SG', 'SF', 'PF', 'C'].includes(p.bucket)) {
            const pos = p.bucket as 'PG'|'SG'|'SF'|'PF'|'C';
            posCount[pos]++;
          }
        });
        
        // Find positions that need players and positions with extras
        const needsPlayers: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
        const hasExtras: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
        
        (['PG','SG','SF','PF'] as const).forEach(pos => {
          if (posCount[pos] < 2) needsPlayers.push(pos);
          if (posCount[pos] > 2) hasExtras.push(pos);
        });
        
        // Don't touch C - centers are fine as-is
        if (needsPlayers.length > 0 && hasExtras.length > 0) {
          // For each position that needs players
          for (const needPos of needsPlayers) {
            const needed = 2 - posCount[needPos];
            
            for (let i = 0; i < needed && hasExtras.length > 0; i++) {
              // Find best candidate from positions with extras
              let bestPlayer: any = null;
              let bestFrom: 'PG'|'SG'|'SF'|'PF'|'C' | null = null;
              
              for (const fromPos of hasExtras) {
                const candidates = contributingPlayers
                  .filter(p => p.bucket === fromPos && !p.isStarter)
                  .sort((a, b) => {
                    // For guard positions (PG/SG), prefer player with most assists
                    if ((needPos === 'PG' || needPos === 'SG') && (fromPos === 'PG' || fromPos === 'SG')) {
                      return (b.ast || 0) - (a.ast || 0);
                    }
                    // For forwards (SF/PF), prefer player with most rebounds
                    return (b.reb || 0) - (a.reb || 0);
                  });
                
                if (candidates.length > 0 && (!bestPlayer || candidates[0].ast > bestPlayer.ast)) {
                  bestPlayer = candidates[0];
                  bestFrom = fromPos;
                }
              }
              
              // Move the best candidate
              if (bestPlayer && bestFrom) {
                bestPlayer.bucket = needPos;
                posCount[needPos]++;
                posCount[bestFrom]--;
                
                // Remove from hasExtras if no longer has extras
                if (posCount[bestFrom] <= 2) {
                  hasExtras.splice(hasExtras.indexOf(bestFrom), 1);
                }
              }
            }
          }
        }
      }
      
      // Recalculate buckets after rebalancing
      const finalBuckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<'PG'|'SG'|'SF'|'PF'|'C', number>;
      players.forEach(p => { 
        if (p.bucket && ['PG', 'SG', 'SF', 'PF', 'C'].includes(p.bucket)) {
          const pos = p.bucket as 'PG'|'SG'|'SF'|'PF'|'C';
          finalBuckets[pos] += (p.pts || 0);
        }
      });
      
      out.push({ gameId: gid, date: when, opponent: meta.oppAbbr, team, season: seasonLabel, buckets: finalBuckets, players, source: 'bdl+nba' });
    }

    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    if (masterDirty) saveMaster({ positions: MASTER_POS as any, aliases: master.aliases || {} });
    return NextResponse.json({ success: true, team, season: seasonYear, stored_games: out.length, file: file.replace(process.cwd(), '') });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Ingest failed' }, { status: 200 });
  }
}

function currentNbaSeason(): number {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}