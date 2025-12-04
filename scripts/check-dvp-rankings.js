#!/usr/bin/env node

/**
 * Calculate and display DvP rankings per position per team.
 * Shows total points allowed at each position and ranks teams from worst to best defense.
 */

const fs = require('fs');
const path = require('path');

const TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

const SEASON = 2025;
const dvpDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(SEASON));

// Track totals per team per position
const teamStats = {};

// Initialize all teams
TEAMS.forEach(team => {
  teamStats[team] = {
    PG: { total: 0, games: 0, players: 0 },
    SG: { total: 0, games: 0, players: 0 },
    SF: { total: 0, games: 0, players: 0 },
    PF: { total: 0, games: 0, players: 0 },
    C: { total: 0, games: 0, players: 0 }
  };
});

console.log('='.repeat(80));
console.log('DvP Rankings Calculation');
console.log('='.repeat(80));
console.log(`Season: ${SEASON}`);
console.log('');

// Process all games
let totalGames = 0;
let totalPlayers = 0;

for (const team of TEAMS) {
  const filePath = path.join(dvpDir, `${team}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${team}: File not found`);
    continue;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const games = Array.isArray(data) ? data : [];
    
    totalGames += games.length;
    
    games.forEach(game => {
      const players = game.players || [];
      totalPlayers += players.length;
      
      // Track which positions appeared in this game
      const positionsInGame = new Set();
      
      players.forEach(player => {
        const bucket = player.bucket;
        const pts = Number(player.pts || 0);
        
        if (POSITIONS.includes(bucket)) {
          teamStats[team][bucket].total += pts;
          teamStats[team][bucket].players += 1;
          positionsInGame.add(bucket);
        }
      });
      
      // Count games where each position appeared
      positionsInGame.forEach(pos => {
        teamStats[team][pos].games += 1;
      });
    });
  } catch (e) {
    console.error(`❌ ${team}: Error reading file - ${e.message}`);
  }
}

console.log(`Processed ${totalGames} games with ${totalPlayers} total players`);
console.log('');

// Calculate averages and create rankings
const rankings = {};

POSITIONS.forEach(pos => {
  const positionData = TEAMS.map(team => {
    const stats = teamStats[team][pos];
    const avg = stats.games > 0 ? (stats.total / stats.games) : 0;
    const avgPerPlayer = stats.players > 0 ? (stats.total / stats.players) : 0;
    
    return {
      team,
      total: stats.total,
      games: stats.games,
      players: stats.players,
      avgPerGame: avg,
      avgPerPlayer: avgPerPlayer
    };
  });
  
  // Sort by avgPerGame (worst defense = most points allowed = highest avg)
  positionData.sort((a, b) => b.avgPerGame - a.avgPerGame);
  
  rankings[pos] = positionData;
});

// Display rankings
POSITIONS.forEach(pos => {
  console.log('='.repeat(80));
  console.log(`${pos} Rankings (Worst Defense → Best Defense)`);
  console.log('='.repeat(80));
  console.log('Rank | Team | Total Pts | Games | Players | Avg/Game | Avg/Player');
  console.log('-'.repeat(80));
  
  rankings[pos].forEach((data, idx) => {
    const rank = (idx + 1).toString().padStart(2);
    const team = data.team.padEnd(3);
    const total = data.total.toString().padStart(8);
    const games = data.games.toString().padStart(5);
    const players = data.players.toString().padStart(7);
    const avgGame = data.avgPerGame.toFixed(2).padStart(8);
    const avgPlayer = data.avgPerPlayer.toFixed(2).padStart(10);
    
    console.log(`  ${rank}  | ${team} | ${total} | ${games} | ${players} | ${avgGame} | ${avgPlayer}`);
  });
  
  console.log('');
});

// Summary statistics
console.log('='.repeat(80));
console.log('Summary Statistics');
console.log('='.repeat(80));

POSITIONS.forEach(pos => {
  const allTotals = rankings[pos].map(r => r.total);
  const allAvgs = rankings[pos].map(r => r.avgPerGame);
  const allGames = rankings[pos].map(r => r.games);
  
  const maxTotal = Math.max(...allTotals);
  const minTotal = Math.min(...allTotals);
  const maxAvg = Math.max(...allAvgs);
  const minAvg = Math.min(...allAvgs);
  const totalGames = allGames.reduce((sum, g) => sum + g, 0);
  const avgGames = totalGames / TEAMS.length;
  
  console.log(`${pos}:`);
  console.log(`  Total Points Range: ${minTotal} - ${maxTotal}`);
  console.log(`  Avg/Game Range: ${minAvg.toFixed(2)} - ${maxAvg.toFixed(2)}`);
  console.log(`  Average Games per Team: ${avgGames.toFixed(1)}`);
  console.log('');
});

console.log('='.repeat(80));
console.log('✅ Rankings calculation complete!');
console.log('='.repeat(80));


