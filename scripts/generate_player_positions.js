/*
Generates per-team player position templates under data/player_positions/teams.
Fetches NBA rosters from stats.nba.com (commonteamroster) with proper headers.
Run: node scripts/generate_player_positions.js --season 2025
*/

const fs = require('fs');
const path = require('path');
const https = require('https');

const NBA_BASE = 'https://stats.nba.com/stats';
const HDRS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nba.com',
  Referer: 'https://www.nba.com/stats/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v=124, "Google Chrome";v=124, "Not=A?Brand";v=99',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

const ABBR_TO_TEAM_ID = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764,
};

function seasonLabel(y){return `${y}-${String((y+1)%100).padStart(2,'0')}`}

function fetchJson(url){
  return new Promise((resolve,reject)=>{
    const req = https.get(url, {headers: HDRS}, res => {
      let d='';
      res.on('data', c=>d+=c);
      res.on('end', ()=>{
        try{ resolve(JSON.parse(d)); }catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
  });
}

function normName(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,' ').replace(/\s+/g,' ').trim();
}

async function run(){
  const args = process.argv.slice(2);
  const si = args.indexOf('--season');
  const year = si>=0 ? parseInt(args[si+1],10) : new Date().getMonth()>=9? new Date().getFullYear(): new Date().getFullYear()-1;
  const label = seasonLabel(year);

  const outDir = path.resolve(process.cwd(), 'data', 'player_positions', 'teams');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [abbr, id] of Object.entries(ABBR_TO_TEAM_ID)){
    try{
      const url = `${NBA_BASE}/commonteamroster?Season=${encodeURIComponent(label)}&TeamID=${id}`;
      const js = await fetchJson(url);
      const rs = (js.resultSets||[])[0] || js.resultSets;
      const headers = rs?.headers || [];
      const rows = rs?.rowSet || [];
      const iName = headers.indexOf('PLAYER');
      const players = rows.map(r=>String(r[iName]||'')).filter(Boolean);
      const positions = {}; // empty; user will fill
      const data = {
        team: abbr,
        season: label,
        players: players.map(normName),
        positions,
        aliases: {}
      };
      fs.writeFileSync(path.join(outDir, `${abbr}.json`), JSON.stringify(data, null, 2));
      console.log(`Wrote ${abbr}.json (${players.length} players)`);
    }catch(e){
      console.warn(`Failed ${abbr}:`, e.message);
    }
  }
  console.log('Done. Edit files under data/player_positions/teams/*.json and set positions.PG/SG/SF/PF/C.');
}

run().catch(e=>{console.error(e); process.exit(1);});
