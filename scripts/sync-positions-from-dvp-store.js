const fs = require('fs');
const path = require('path');

// All 30 NBA teams
const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const dvpStoreDir = path.join(__dirname, '..', 'data', 'dvp_store', '2025');
const positionsDir = path.join(__dirname, '..', 'data', 'player_positions', 'teams');

// Normalize player name (lowercase, trim, normalize spaces)
function normName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Extract positions from dvp_store file
function extractPositionsFromDvpStore(teamAbbr) {
  const dvpFile = path.join(dvpStoreDir, `${teamAbbr}.json`);
  
  if (!fs.existsSync(dvpFile)) {
    return { positions: {}, aliases: {} };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(dvpFile, 'utf8'));
    const positions = {};
    const aliases = {};
    const seenPlayers = new Set();
    
    // Go through all games and collect player positions
    if (Array.isArray(data)) {
      for (const game of data) {
        if (!Array.isArray(game.players)) continue;
        
        for (const player of game.players) {
          const name = String(player.name || '').trim();
          if (!name) continue;
          
          const normalized = normName(name);
          const bucket = player.bucket; // This is the position: PG, SG, SF, PF, C
          
          // Only add if we have a valid position
          if (bucket && ['PG', 'SG', 'SF', 'PF', 'C'].includes(bucket)) {
            // Use the most recent position if player appears multiple times
            // (later games override earlier ones)
            if (!seenPlayers.has(normalized) || positions[normalized] !== bucket) {
              positions[normalized] = bucket;
              seenPlayers.add(normalized);
            }
          }
        }
      }
    }
    
    return { positions, aliases };
  } catch (e) {
    console.error(`Error reading ${teamAbbr}.json:`, e.message);
    return { positions: {}, aliases: {} };
  }
}

// Main function
function main() {
  console.log('Syncing player positions from dvp_store to player_positions...\n');
  
  let synced = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const team of TEAMS) {
    const { positions, aliases } = extractPositionsFromDvpStore(team);
    const outputFile = path.join(positionsDir, `${team}.json`);
    
    if (Object.keys(positions).length === 0) {
      console.log(`[SKIP] ${team} - No positions found in dvp_store`);
      skipped++;
      continue;
    }
    
    try {
      const output = {
        positions,
        aliases
      };
      
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
      console.log(`[SYNCED] ${team} - ${Object.keys(positions).length} players`);
      synced++;
    } catch (e) {
      console.error(`[ERROR] ${team} - ${e.message}`);
      errors++;
    }
  }
  
  console.log(`\nDone! Synced ${synced} teams, skipped ${skipped}, errors ${errors}`);
  console.log(`\nNext steps:`);
  console.log(`1. Review the synced files in data/player_positions/teams/`);
  console.log(`2. Run: .\\update-positions.ps1`);
  console.log(`3. DVP stats will update automatically after deployment`);
}

main();

