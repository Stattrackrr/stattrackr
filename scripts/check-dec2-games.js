#!/usr/bin/env node

/**
 * Check if December 2nd games are in the DvP store
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

const targetDate = '2025-12-02';
console.log('='.repeat(80));
console.log('Checking for December 2nd Games in DvP Store');
console.log('='.repeat(80));
console.log(`Date: ${targetDate}`);
console.log('');

const dec2Games = [];

for (const team of TEAMS) {
  const filePath = path.join(dvpDir, `${team}.json`);
  
  if (!fs.existsSync(filePath)) {
    continue;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const games = Array.isArray(data) ? data : [];
    
    const gamesOnDate = games.filter(g => g.date === targetDate);
    
    if (gamesOnDate.length > 0) {
      gamesOnDate.forEach(game => {
        dec2Games.push({
          team,
          gameId: game.gameId,
          date: game.date,
          opponent: game.opponent,
          players: game.players?.length || 0,
          buckets: game.buckets || {}
        });
      });
    }
  } catch (e) {
    // Skip errors
  }
}

if (dec2Games.length === 0) {
  console.log('❌ No games found for December 2nd in DvP store');
} else {
  console.log(`✅ Found ${dec2Games.length} game(s) for December 2nd:`);
  console.log('');
  
  // Group by matchup (avoid duplicates)
  const matchups = new Map();
  dec2Games.forEach(game => {
    const key = [game.team, game.opponent].sort().join(' vs ');
    if (!matchups.has(key)) {
      matchups.set(key, []);
    }
    matchups.get(key).push(game);
  });
  
  matchups.forEach((games, matchup) => {
    games.forEach(game => {
      console.log(`  ${game.team} vs ${game.opponent}`);
      console.log(`    Game ID: ${game.gameId}`);
      console.log(`    Players: ${game.players}`);
      console.log(`    Buckets: PG=${game.buckets.PG || 0}, SG=${game.buckets.SG || 0}, SF=${game.buckets.SF || 0}, PF=${game.buckets.PF || 0}, C=${game.buckets.C || 0}`);
      console.log('');
    });
  });
  
  console.log(`Total: ${dec2Games.length} game(s) across ${matchups.size} unique matchup(s)`);
}

console.log('='.repeat(80));


