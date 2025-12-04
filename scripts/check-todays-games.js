#!/usr/bin/env node

/**
 * Check if today's games are in the DvP store
 */

const fs = require('fs');
const path = require('path');

const TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

const SEASON = 2025;
const dvpDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(SEASON));

const today = new Date().toISOString().split('T')[0];
console.log('='.repeat(80));
console.log('Checking for Today\'s Games in DvP Store');
console.log('='.repeat(80));
console.log(`Today: ${today}`);
console.log('');

const todaysGames = [];

for (const team of TEAMS) {
  const filePath = path.join(dvpDir, `${team}.json`);
  
  if (!fs.existsSync(filePath)) {
    continue;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const games = Array.isArray(data) ? data : [];
    
    const gamesToday = games.filter(g => g.date === today);
    
    if (gamesToday.length > 0) {
      gamesToday.forEach(game => {
        todaysGames.push({
          team,
          gameId: game.gameId,
          date: game.date,
          opponent: game.opponent,
          players: game.players?.length || 0
        });
      });
    }
  } catch (e) {
    // Skip errors
  }
}

if (todaysGames.length === 0) {
  console.log('❌ No games found for today in DvP store');
  console.log('');
  console.log('This could mean:');
  console.log('  1. No games scheduled for today');
  console.log('  2. Games haven\'t been ingested yet');
  console.log('  3. Games are scheduled but not yet completed');
} else {
  console.log(`✅ Found ${todaysGames.length} game(s) for today:`);
  console.log('');
  
  // Group by team
  const byTeam = {};
  todaysGames.forEach(game => {
    if (!byTeam[game.team]) byTeam[game.team] = [];
    byTeam[game.team].push(game);
  });
  
  Object.entries(byTeam).sort().forEach(([team, games]) => {
    games.forEach(game => {
      console.log(`  ${team} vs ${game.opponent} (Game ID: ${game.gameId}, ${game.players} players)`);
    });
  });
}

console.log('');
console.log('='.repeat(80));


