require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const team = process.argv[2] || 'MIL';
const season = process.argv[3] || '2025';

const storeFile = path.join(__dirname, '..', 'data', 'dvp_store', season, `${team}.json`);

console.log(`🔍 Inspecting DvP store for ${team} (${season})...`);
console.log(`📁 File: ${storeFile}\n`);

if (!fs.existsSync(storeFile)) {
  console.error(`❌ File not found: ${storeFile}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));

if (!Array.isArray(data)) {
  console.error('❌ Invalid data format - expected array');
  process.exit(1);
}

console.log(`📊 Total games: ${data.length}\n`);

// Analyze games
let gamesWithBM = 0;
let gamesWithBMVerified = 0;
let gamesWithBMProjected = 0;
let totalBMPlayers = 0;
let gamesWithSource = 0;

const recentGames = data
  .filter(g => g.date)
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, 10); // Last 10 games

console.log('📅 Recent games analysis:\n');

for (const game of recentGames) {
  const gameDate = game.date || game.when || 'Unknown';
  const players = Array.isArray(game.players) ? game.players : [];
  
  // Check for BasketballMonsters positions
  const bmPlayers = players.filter(p => p.bmPosition);
  const hasBM = bmPlayers.length > 0;
  const source = game.source || game.lineupSource || 'unknown';
  const isVerified = source.includes('verified');
  const isProjected = source.includes('projected');
  
  if (hasBM) {
    gamesWithBM++;
    totalBMPlayers += bmPlayers.length;
    if (isVerified) gamesWithBMVerified++;
    if (isProjected) gamesWithBMProjected++;
  }
  
  if (source !== 'unknown') gamesWithSource++;
  
  // Show details for games with BM
  if (hasBM) {
    console.log(`✅ ${gameDate} (${game.opponent || 'N/A'})`);
    console.log(`   Source: ${source}`);
    console.log(`   BM Players: ${bmPlayers.length}/${players.length}`);
    console.log(`   BM Positions: ${bmPlayers.map(p => `${p.name} (${p.bmPosition})`).join(', ')}`);
    console.log('');
  }
}

console.log('\n📈 Summary:');
console.log(`   Games with BasketballMonsters positions: ${gamesWithBM}/${recentGames.length}`);
console.log(`   Verified lineups: ${gamesWithBMVerified}`);
console.log(`   Projected lineups: ${gamesWithBMProjected}`);
console.log(`   Total BM players: ${totalBMPlayers}`);
console.log(`   Games with source info: ${gamesWithSource}/${recentGames.length}`);

// Check all games for overall stats
let allGamesWithBM = 0;
let allBMPlayers = 0;

for (const game of data) {
  const players = Array.isArray(game.players) ? game.players : [];
  const bmPlayers = players.filter(p => p.bmPosition);
  if (bmPlayers.length > 0) {
    allGamesWithBM++;
    allBMPlayers += bmPlayers.length;
  }
}

console.log(`\n📊 Overall (all ${data.length} games):`);
console.log(`   Games with BM positions: ${allGamesWithBM}/${data.length} (${((allGamesWithBM/data.length)*100).toFixed(1)}%)`);
console.log(`   Total BM players across all games: ${allBMPlayers}`);

