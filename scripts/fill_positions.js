/*
Fill missing positions for every player in data/player_positions/teams/*.json.
Assigns mock positions cycling PG, SG, SF, PF, C so every player has a value.
Run: node scripts/fill_positions.js
*/
const fs = require('fs');
const path = require('path');

const POS = ['PG','SG','SF','PF','C'];
const baseDir = path.resolve(process.cwd(), 'data', 'player_positions', 'teams');

function normName(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,' ').replace(/\s+/g,' ').trim();
}

function main(){
  if (!fs.existsSync(baseDir)) {
    console.error('Teams dir not found:', baseDir);
    process.exit(1);
  }
  const files = fs.readdirSync(baseDir).filter(f=>f.endsWith('.json'));
  for (const f of files){
    const p = path.join(baseDir, f);
    try{
      const j = JSON.parse(fs.readFileSync(p,'utf8'));
      const players = Array.isArray(j.players) ? j.players : [];
      j.positions = j.positions && typeof j.positions === 'object' ? j.positions : {};
      let idx = 0;
      for (const raw of players){
        const name = normName(raw);
        if (!name) continue;
        if (!['PG','SG','SF','PF','C'].includes(j.positions[name])){
          j.positions[name] = POS[idx % POS.length];
          idx++;
        }
      }
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
      console.log('Filled', f);
    }catch(e){
      console.warn('Skip', f, e.message);
    }
  }
  console.log('Done.');
}

main();
