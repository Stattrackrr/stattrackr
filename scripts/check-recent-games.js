require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const team = process.argv[2] || 'MIL';
const season = process.argv[3] || '2025';

const storeFile = path.join(__dirname, '..', 'data', 'dvp_store', season, `${team}.json`);

if (!fs.existsSync(storeFile)) {
  console.error(`❌ File not found: ${storeFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));

if (!Array.isArray(data)) {
  console.error('❌ Invalid data format');
  process.exit(1);
}

// Get most recent 5 games
const recent = data
  .filter(g => g.date)
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, 5);

console.log(`\n📅 Most recent 5 games for ${team}:\n`);

recent.forEach((game, idx) => {
  console.log(`${idx + 1}. ${game.date} vs ${game.opponent || 'N/A'}`);
  console.log(`   Source: ${game.source || 'unknown'}`);
  console.log(`   Lineup Verified: ${game.lineupVerified || false}`);
  console.log(`   BM Players Count: ${game.bmPlayersCount || 0}`);
  
  // Check for bmPosition in players
  const players = Array.isArray(game.players) ? game.players : [];
  const bmPlayers = players.filter(p => p.bmPosition);
  console.log(`   Players with bmPosition: ${bmPlayers.length}/${players.length}`);
  if (bmPlayers.length > 0) {
    console.log(`   BM Positions: ${bmPlayers.map(p => `${p.name} (${p.bmPosition})`).join(', ')}`);
  }
  console.log('');
});

