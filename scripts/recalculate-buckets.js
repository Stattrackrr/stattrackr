const fs = require('fs');
const path = require('path');

// All 30 NBA teams
const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const dvpStoreDir = path.join(__dirname, '..', 'data', 'dvp_store', '2025');

// Recalculate buckets for a single game based on player positions and stats
function recalculateGameBuckets(game) {
  const buckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  const players = Array.isArray(game.players) ? game.players : [];
  
  for (const player of players) {
    const bucket = player.bucket;
    const pts = Number(player.pts || 0);
    
    // Only add to bucket if it's a valid position
    if (bucket && ['PG', 'SG', 'SF', 'PF', 'C'].includes(bucket)) {
      buckets[bucket] += pts;
    }
  }
  
  return buckets;
}

// Process a single team file
function processTeam(teamAbbr) {
  const filePath = path.join(dvpStoreDir, `${teamAbbr}.json`);
  
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!Array.isArray(data)) {
      return { success: false, error: 'Invalid data format' };
    }
    
    let gamesUpdated = 0;
    
    // Recalculate buckets for each game
    for (const game of data) {
      const oldBuckets = game.buckets || {};
      const newBuckets = recalculateGameBuckets(game);
      
      // Check if buckets changed
      const changed = JSON.stringify(oldBuckets) !== JSON.stringify(newBuckets);
      
      if (changed) {
        game.buckets = newBuckets;
        gamesUpdated++;
      }
    }
    
    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    
    return { 
      success: true, 
      totalGames: data.length,
      gamesUpdated 
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Main function
function main() {
  const args = process.argv.slice(2);
  const teamArg = args[0]?.toUpperCase();
  
  if (teamArg && TEAMS.includes(teamArg)) {
    // Process single team
    console.log(`Recalculating buckets for ${teamArg}...`);
    const result = processTeam(teamArg);
    
    if (result.success) {
      console.log(`✅ ${teamArg}: Updated ${result.gamesUpdated} of ${result.totalGames} games`);
    } else {
      console.error(`❌ ${teamArg}: ${result.error}`);
    }
  } else if (teamArg === 'ALL') {
    // Process all teams
    console.log('Recalculating buckets for all teams...\n');
    
    let totalUpdated = 0;
    let totalGames = 0;
    let errors = 0;
    
    for (const team of TEAMS) {
      const result = processTeam(team);
      
      if (result.success) {
        console.log(`✅ ${team}: Updated ${result.gamesUpdated} of ${result.totalGames} games`);
        totalUpdated += result.gamesUpdated;
        totalGames += result.totalGames;
      } else {
        console.error(`❌ ${team}: ${result.error}`);
        errors++;
      }
    }
    
    console.log(`\nDone! Updated ${totalUpdated} games across ${totalGames} total games. Errors: ${errors}`);
  } else {
    console.log('Usage:');
    console.log('  node scripts/recalculate-buckets.js <TEAM>  - Recalculate for one team (e.g., ATL)');
    console.log('  node scripts/recalculate-buckets.js ALL     - Recalculate for all teams');
    console.log('\nAvailable teams:', TEAMS.join(', '));
  }
}

main();

