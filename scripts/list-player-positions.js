const fs = require('fs');
const path = require('path');

// NBA team abbreviations
const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

// Load current position mappings
function loadCurrentPositions() {
  const masterPath = path.join(__dirname, '..', 'data', 'player_positions', 'master.json');
  const teamsDir = path.join(__dirname, '..', 'data', 'player_positions', 'teams');
  
  const positions = {};
  const aliases = {};
  
  // Load master
  try {
    const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    Object.assign(positions, master.positions || {});
    Object.assign(aliases, master.aliases || {});
  } catch (e) {
    console.log('No master.json found');
  }
  
  // Load team-specific
  try {
    const teamFiles = fs.readdirSync(teamsDir).filter(f => f.endsWith('.json'));
    for (const file of teamFiles) {
      const teamData = JSON.parse(fs.readFileSync(path.join(teamsDir, file), 'utf8'));
      Object.assign(positions, teamData.positions || {});
      Object.assign(aliases, teamData.aliases || {});
    }
  } catch (e) {
    console.log('No team files found');
  }
  
  return { positions, aliases };
}

// Normalize name (lowercase, trim, normalize spaces)
function normName(name) {
  return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Get all players from DVP store files
function getAllPlayers() {
  const storeDir = path.join(__dirname, '..', 'data', 'dvp_store', '2025');
  const playersByTeam = {};
  
  for (const team of TEAMS) {
    const filePath = path.join(storeDir, `${team}.json`);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    
    try {
      const games = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const teamPlayers = new Map(); // Use Map to track unique players
      
      for (const game of games) {
        if (!Array.isArray(game.players)) continue;
        
        for (const player of game.players) {
          const name = String(player.name || '').trim();
          if (!name) continue;
          
          const normalized = normName(name);
          if (!teamPlayers.has(normalized)) {
            teamPlayers.set(normalized, {
              name: name,
              normalized: normalized,
              currentPosition: player.bucket || 'UNKNOWN',
              gamesPlayed: 0,
              totalPoints: 0,
              totalReb: 0,
              totalAst: 0,
              isStarter: player.isStarter || false,
            });
          }
          
          const p = teamPlayers.get(normalized);
          p.gamesPlayed++;
          p.totalPoints += Number(player.pts || 0);
          p.totalReb += Number(player.reb || 0);
          p.totalAst += Number(player.ast || 0);
          if (player.isStarter) p.isStarter = true;
        }
      }
      
      playersByTeam[team] = Array.from(teamPlayers.values()).sort((a, b) => {
        // Sort by: starters first, then by total points
        if (a.isStarter !== b.isStarter) return b.isStarter ? 1 : -1;
        return b.totalPoints - a.totalPoints;
      });
    } catch (e) {
      console.error(`Error reading ${team}.json:`, e.message);
    }
  }
  
  return playersByTeam;
}

// Main
function main() {
  console.log('📊 Analyzing player positions from DVP store...\n');
  
  const { positions: currentPositions, aliases } = loadCurrentPositions();
  const playersByTeam = getAllPlayers();
  
  console.log('='.repeat(80));
  console.log('PLAYER POSITION REPORT');
  console.log('='.repeat(80));
  console.log('\nThis shows all players found in your DVP store files.');
  console.log('Compare their current positions with what they should be.\n');
  
  let totalPlayers = 0;
  let playersWithCustomPositions = 0;
  let playersNeedingUpdates = 0;
  
  for (const team of TEAMS) {
    const players = playersByTeam[team];
    if (!players || players.length === 0) continue;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🏀 ${team} (${players.length} players)`);
    console.log('='.repeat(80));
    
    for (const player of players) {
      totalPlayers++;
      const hasCustomPosition = currentPositions[player.normalized] !== undefined;
      const customPosition = currentPositions[player.normalized];
      
      if (hasCustomPosition) {
        playersWithCustomPositions++;
      }
      
      // Check if position might be wrong
      const mightBeWrong = hasCustomPosition && customPosition !== player.currentPosition;
      if (mightBeWrong) {
        playersNeedingUpdates++;
      }
      
      const status = hasCustomPosition 
        ? (mightBeWrong ? '⚠️  CONFLICT' : '✅ SET')
        : '❌ NOT SET';
      
      const positionInfo = hasCustomPosition
        ? `Custom: ${customPosition} | Stored: ${player.currentPosition}`
        : `Stored: ${player.currentPosition}`;
      
      const starterBadge = player.isStarter ? '⭐' : '  ';
      const gamesInfo = `${player.gamesPlayed}G | ${player.totalPoints}PTS | ${player.totalReb}REB | ${player.totalAst}AST`;
      
      console.log(`${status} ${starterBadge} ${player.name.padEnd(25)} | ${positionInfo.padEnd(30)} | ${gamesInfo}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total players found: ${totalPlayers}`);
  console.log(`Players with custom positions: ${playersWithCustomPositions}`);
  console.log(`Players needing position updates: ${playersNeedingUpdates}`);
  console.log(`Players without custom positions: ${totalPlayers - playersWithCustomPositions}`);
  console.log('\n💡 TIP: Update positions in data/player_positions/master.json or data/player_positions/teams/{TEAM}.json');
  console.log('💡 Then run: .\\update-positions.ps1');
  console.log('='.repeat(80));
}

main();

