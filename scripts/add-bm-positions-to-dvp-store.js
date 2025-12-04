#!/usr/bin/env node
/**
 * Add missing BasketballMonsters positions to DvP store
 * 
 * This script reads DvP store files and adds bmPosition fields to players
 * for games that have BasketballMonsters source but are missing bmPosition.
 * 
 * Usage:
 *   node scripts/add-bm-positions-to-dvp-store.js [team] [season]
 * 
 * Examples:
 *   node scripts/add-bm-positions-to-dvp-store.js LAL 2025
 *   node scripts/add-bm-positions-to-dvp-store.js all 2025
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const team = process.argv[2] || 'all';
const season = process.argv[3] || '2025';

const ALL_TEAMS = [
  'ATL', 'BKN', 'BOS', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

// Normalization functions (same as ingest-nba route)
function bmNormName(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Get last name from normalized name
function getLastName(normalized) {
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

// Match player name against BM lineup
function findBMPlayerMatch(playerName, bmLineupMap) {
  const normalized = bmNormName(playerName);
  const lastName = getLastName(normalized);
  
  // Try exact match first
  if (bmLineupMap[normalized]) {
    return normalized;
  }
  
  // Try matching by last name
  if (lastName && lastName.length >= 3) {
    for (const [bmKey, pos] of Object.entries(bmLineupMap)) {
      const bmLastName = getLastName(bmKey);
      if (bmLastName === lastName) {
        const playerFirst = normalized.split(' ')[0] || '';
        const bmFirst = bmKey.split(' ')[0] || '';
        if (playerFirst.length > 0 && bmFirst.length > 0) {
          if (playerFirst[0] === bmFirst[0] || 
              (playerFirst.length >= 2 && bmFirst.length >= 2 && 
               playerFirst.substring(0, 2) === bmFirst.substring(0, 2))) {
            return bmKey;
          }
        } else {
          return bmKey;
        }
      }
    }
  }
  
  // Try partial match
  for (const bmKey of Object.keys(bmLineupMap)) {
    if (normalized.includes(bmKey) || bmKey.includes(normalized)) {
      return bmKey;
    }
  }
  
  return null;
}

// Build position map from cached lineup
function buildBMPositionMap(cachedLineup) {
  const positionMap = {};
  
  if (!cachedLineup || !Array.isArray(cachedLineup) || cachedLineup.length !== 5) {
    return positionMap;
  }
  
  for (const player of cachedLineup) {
    const pos = player.position.toUpperCase();
    if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) continue;
    
    // Store all name variations
    positionMap[player.name] = pos;
    positionMap[bmNormName(player.name)] = pos;
    positionMap[normName(player.name)] = pos;
    positionMap[player.name.toLowerCase().trim()] = pos;
    
    // Last name key
    const nameParts = bmNormName(player.name).split(' ');
    if (nameParts.length > 1) {
      const lastName = nameParts[nameParts.length - 1];
      if (lastName.length >= 3) {
        positionMap[`_lastname_${lastName}`] = pos;
      }
    }
  }
  
  return positionMap;
}

// Get BM position for a player
function getBMPosition(playerName, bmLineupMap, cachedLineup) {
  if (!cachedLineup || !Array.isArray(cachedLineup) || cachedLineup.length !== 5) {
    return null;
  }
  
  // Try direct match against cached lineup array first
  const nameNormalized = playerName.toLowerCase().trim().replace(/\s+/g, ' ');
  for (const player of cachedLineup) {
    const playerNameNormalized = player.name.toLowerCase().trim().replace(/\s+/g, ' ');
    if (playerNameNormalized === nameNormalized) {
      const pos = player.position.toUpperCase();
      if (['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) {
        return pos;
      }
    }
  }
  
  // Try last name match
  const nameParts = nameNormalized.split(' ');
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  if (lastName.length >= 3) {
    for (const player of cachedLineup) {
      const playerNameNormalized = player.name.toLowerCase().trim().replace(/\s+/g, ' ');
      const playerParts = playerNameNormalized.split(' ');
      const playerLastName = playerParts.length > 1 ? playerParts[playerParts.length - 1] : '';
      if (lastName === playerLastName && lastName.length >= 3) {
        const pos = player.position.toUpperCase();
        if (['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) {
          return pos;
        }
      }
    }
  }
  
  // Try position map
  if (Object.keys(bmLineupMap).length > 0) {
    const nameLower = playerName.toLowerCase().trim();
    
    // Exact match
    for (const [key, pos] of Object.entries(bmLineupMap)) {
      if (key.toLowerCase().trim() === nameLower) {
        return pos;
      }
    }
    
    // Simple normalization
    const simpleNorm = bmNormName(playerName);
    if (bmLineupMap[simpleNorm]) {
      return bmLineupMap[simpleNorm];
    }
    
    // Complex normalization
    const complexNorm = normName(playerName);
    if (bmLineupMap[complexNorm]) {
      return bmLineupMap[complexNorm];
    }
    
    // Fuzzy match
    const matchedKey = findBMPlayerMatch(playerName, bmLineupMap);
    if (matchedKey && bmLineupMap[matchedKey]) {
      return bmLineupMap[matchedKey];
    }
  }
  
  return null;
}

// Process a single team file
async function processTeamFile(teamAbbr, seasonYear) {
  const filePath = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear), `${teamAbbr}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return { success: false, team: teamAbbr, error: 'File not found' };
  }

  console.log(`\n📊 Processing ${teamAbbr} (${seasonYear})...`);

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!Array.isArray(data)) {
      console.error('❌ Invalid data format - expected array');
      return { success: false, team: teamAbbr, error: 'Invalid format' };
    }

    let gamesUpdated = 0;
    let playersUpdated = 0;
    let gamesWithBM = 0;
    let gamesMissingBM = 0;

    // Process each game
    for (const game of data) {
      const source = game.source || '';
      const hasBMSource = source.includes('basketballmonsters');
      
      if (!hasBMSource) continue;
      
      gamesWithBM++;
      const players = Array.isArray(game.players) ? game.players : [];
      
      // Check if any players are missing bmPosition
      const playersMissingBM = players.filter(p => !p.bmPosition);
      
      if (playersMissingBM.length === 0) {
        continue; // All players already have bmPosition
      }
      
      gamesMissingBM++;
      
      // Get game date
      const gameDate = game.date ? new Date(game.date) : null;
      if (!gameDate) {
        console.log(`   ⚠️  Game ${game.gameId} has no date, skipping`);
        continue;
      }
      
      // Get opponent
      const oppAbbr = game.opponent || '';
      if (!oppAbbr) {
        console.log(`   ⚠️  Game ${game.gameId} has no opponent, skipping`);
        continue;
      }
      
      // Convert game date to Eastern Time for cache lookup
      const easternTime = new Date(gameDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const gameDateEastern = new Date(easternTime.getFullYear(), easternTime.getMonth(), easternTime.getDate(), 0, 0, 0, 0);
      const dateStr = `${gameDateEastern.getFullYear()}-${String(gameDateEastern.getMonth() + 1).padStart(2, '0')}-${String(gameDateEastern.getDate()).padStart(2, '0')}`;
      
      // Try Eastern date first
      let cacheKey = `basketballmonsters:lineup:${oppAbbr.toUpperCase()}:${dateStr}`;
      let cachedLineup = await getNBACache(cacheKey, { quiet: true });
      
      // If not found, try UTC date
      if (!cachedLineup) {
        const utcDateStr = gameDate.toISOString().split('T')[0];
        cacheKey = `basketballmonsters:lineup:${oppAbbr.toUpperCase()}:${utcDateStr}`;
        cachedLineup = await getNBACache(cacheKey, { quiet: true });
      }
      
      if (!cachedLineup || !Array.isArray(cachedLineup) || cachedLineup.length !== 5) {
        console.log(`   ⚠️  Game ${game.gameId} (${game.date} vs ${oppAbbr}): No cached lineup found (key: ${cacheKey})`);
        continue;
      }
      
      // Build position map
      const bmLineupMap = buildBMPositionMap(cachedLineup);
      
      // Update players with bmPosition
      let gameChanged = false;
      for (const player of players) {
        if (player.bmPosition) continue; // Already has bmPosition
        
        const bmPos = getBMPosition(player.name, bmLineupMap, cachedLineup);
        if (bmPos) {
          player.bmPosition = bmPos;
          playersUpdated++;
          gameChanged = true;
        }
      }
      
      if (gameChanged) {
        gamesUpdated++;
        console.log(`   ✅ Game ${game.gameId} (${game.date} vs ${oppAbbr}): Added ${players.filter(p => p.bmPosition && !playersMissingBM.find(pm => pm === p)).length} bmPosition fields`);
      }
    }
    
    // Save if changes were made
    if (gamesUpdated > 0) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`\n✅ Updated ${teamAbbr}: ${gamesUpdated} games, ${playersUpdated} players`);
    } else {
      console.log(`\n✓ ${teamAbbr}: No updates needed`);
    }
    
    return {
      success: true,
      team: teamAbbr,
      gamesWithBM,
      gamesMissingBM,
      gamesUpdated,
      playersUpdated
    };
    
  } catch (error) {
    console.error(`❌ Error processing ${teamAbbr}:`, error.message);
    return { success: false, team: teamAbbr, error: error.message };
  }
}

// Import getNBACache dynamically (ES module)
async function getNBACache(cacheKey, options = {}) {
  // Try .ts first, then .js
  try {
    const nbaCache = await import('../lib/nbaCache.ts');
    return nbaCache.getNBACache(cacheKey, options);
  } catch (e) {
    try {
      const nbaCache = await import('../lib/nbaCache.js');
      return nbaCache.getNBACache(cacheKey, options);
    } catch (e2) {
      // Fallback: try without extension (Node.js might resolve it)
      const nbaCache = await import('../lib/nbaCache');
      return nbaCache.getNBACache(cacheKey, options);
    }
  }
}

// Main
async function main() {
  const teams = team === 'all' ? ALL_TEAMS : [team.toUpperCase()];
  
  console.log(`🔍 Adding BasketballMonsters positions to DvP store`);
  console.log(`   Season: ${season}`);
  console.log(`   Teams: ${teams.length === 1 ? teams[0] : 'all'}\n`);
  
  const results = [];
  
  for (const teamAbbr of teams) {
    const result = await processTeamFile(teamAbbr, season);
    results.push(result);
    
    // Small delay to avoid overwhelming cache
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Summary
  console.log('\n📈 Summary:');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    const totalGamesUpdated = successful.reduce((sum, r) => sum + (r.gamesUpdated || 0), 0);
    const totalPlayersUpdated = successful.reduce((sum, r) => sum + (r.playersUpdated || 0), 0);
    const totalGamesWithBM = successful.reduce((sum, r) => sum + (r.gamesWithBM || 0), 0);
    const totalGamesMissingBM = successful.reduce((sum, r) => sum + (r.gamesMissingBM || 0), 0);
    
    console.log(`   ✅ Successful: ${successful.length} teams`);
    console.log(`   📊 Games with BM source: ${totalGamesWithBM}`);
    console.log(`   📊 Games missing bmPosition: ${totalGamesMissingBM}`);
    console.log(`   ✏️  Games updated: ${totalGamesUpdated}`);
    console.log(`   ✏️  Players updated: ${totalPlayersUpdated}`);
  }
  
  if (failed.length > 0) {
    console.log(`   ❌ Failed: ${failed.length} teams`);
    failed.forEach(r => console.log(`      - ${r.team}: ${r.error}`));
  }
}

main().catch(console.error);

