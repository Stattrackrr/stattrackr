/**
 * Find active NBA players that are NOT in BDL
 * 
 * Usage:
 *   node scripts/find-missing-bdl-players.js
 */

require('dotenv').config({ path: '.env.local' });

const NBA_STATS_BASE = 'https://stats.nba.com/stats';
const BDL_BASE = 'https://api.balldontlie.io/v1';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/stats/',
  'Origin': 'https://www.nba.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

const bdlApiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';

const bdlHeaders = {
  'Accept': 'application/json',
  'User-Agent': 'StatTrackr/1.0',
};
if (bdlApiKey) {
  bdlHeaders['Authorization'] = bdlApiKey.startsWith('Bearer ') ? bdlApiKey : `Bearer ${bdlApiKey}`;
}

function normalizeName(name) {
  return String(name || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function searchBDLPlayer(playerName) {
  // Try active players first
  let url = new URL(`${BDL_BASE}/players/active`);
  url.searchParams.set('search', playerName);
  url.searchParams.set('per_page', '100');
  
  let response = await fetch(url.toString(), { headers: bdlHeaders });
  if (!response.ok) {
    return null;
  }
  
  let data = await response.json();
  let players = Array.isArray(data?.data) ? data.data : [];
  
  // If no results, try all players
  if (players.length === 0) {
    url = new URL(`${BDL_BASE}/players`);
    url.searchParams.set('search', playerName);
    url.searchParams.set('per_page', '100');
    
    response = await fetch(url.toString(), { headers: bdlHeaders });
    if (!response.ok) {
      return null;
    }
    
    data = await response.json();
    players = Array.isArray(data?.data) ? data.data : [];
  }
  
  if (players.length === 0) {
    return null;
  }
  
  // Try exact match
  const normalizedSearch = normalizeName(playerName);
  const exactMatch = players.find(p => {
    const fullName = `${p.first_name} ${p.last_name}`;
    return normalizeName(fullName) === normalizedSearch;
  });
  
  if (exactMatch) {
    return exactMatch;
  }
  
  // Try partial match (name contains search or vice versa)
  const partialMatch = players.find(p => {
    const fullName = `${p.first_name} ${p.last_name}`;
    const normalizedFull = normalizeName(fullName);
    return normalizedFull.includes(normalizedSearch) || normalizedSearch.includes(normalizedFull);
  });
  
  return partialMatch || null;
}

async function getAllActiveNBAPlayers() {
  const season = '2024-25';
  const params = new URLSearchParams({
    LeagueID: '00',
    Season: season,
    IsOnlyCurrentSeason: '1' // Only current season (active players)
  });

  const url = `${NBA_STATS_BASE}/commonallplayers?${params.toString()}`;
  const response = await fetch(url, { headers: NBA_HEADERS });
  
  if (!response.ok) {
    throw new Error(`NBA API error: ${response.status}`);
  }
  
  const data = await response.json();
  const resultSet = data?.resultSets?.[0];
  if (!resultSet) {
    throw new Error('Invalid response from NBA players list');
  }

  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];
  const personIdx = headers.indexOf('PERSON_ID');
  const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
  const teamIdx = headers.indexOf('TEAM_ABBREVIATION');

  return rows.map(row => ({
    nbaId: String(row[personIdx]),
    name: row[nameIdx] || '',
    team: row[teamIdx] || ''
  }));
}

async function main() {
  console.log('🔍 Finding active NBA players missing from BDL...\n');
  
  try {
    // Get all active NBA players
    console.log('1. Fetching all active NBA players...');
    const nbaPlayers = await getAllActiveNBAPlayers();
    console.log(`   ✅ Found ${nbaPlayers.length} active NBA players\n`);
    
    // Load existing mappings to skip already-mapped players
    const fs = require('fs');
    const path = require('path');
    const mappingPath = path.join(__dirname, '../lib/playerIdMapping.ts');
    let existingMappings = new Set();
    
    try {
      const mappingContent = fs.readFileSync(mappingPath, 'utf8');
      const nbaIdMatches = mappingContent.matchAll(/nbaId:\s*['"](\d+)['"]/g);
      for (const match of nbaIdMatches) {
        existingMappings.add(match[1]);
      }
    } catch (e) {
      console.log('   ⚠️  Could not load existing mappings');
    }
    
    console.log(`2. Checking ${nbaPlayers.length} players against BDL...`);
    console.log('   (This may take a few minutes...)\n');
    
    const missing = [];
    const found = [];
    let checked = 0;
    
    for (const player of nbaPlayers) {
      // Skip if already mapped
      if (existingMappings.has(player.nbaId)) {
        found.push({ ...player, reason: 'already_mapped' });
        checked++;
        continue;
      }
      
      // Search BDL
      const bdlPlayer = await searchBDLPlayer(player.name);
      
      if (bdlPlayer) {
        found.push({ ...player, bdlId: bdlPlayer.id, reason: 'found_in_bdl' });
      } else {
        missing.push(player);
      }
      
      checked++;
      
      // Progress update every 50 players
      if (checked % 50 === 0) {
        console.log(`   Checked ${checked}/${nbaPlayers.length} players... (${missing.length} missing so far)`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n✅ Complete!\n`);
    console.log(`📊 Summary:`);
    console.log(`   Total NBA players: ${nbaPlayers.length}`);
    console.log(`   Already mapped: ${found.filter(f => f.reason === 'already_mapped').length}`);
    console.log(`   Found in BDL: ${found.filter(f => f.reason === 'found_in_bdl').length}`);
    console.log(`   Missing from BDL: ${missing.length}\n`);
    
    if (missing.length > 0) {
      console.log(`❌ Players NOT found in BDL (${missing.length}):\n`);
      missing.forEach((player, idx) => {
        console.log(`${(idx + 1).toString().padStart(3)}. ${player.name.padEnd(30)} | NBA ID: ${player.nbaId.padEnd(10)} | Team: ${player.team}`);
      });
      
      console.log(`\n📝 Please provide BDL IDs for these players so we can add them to the mapping.`);
    } else {
      console.log(`✅ All active NBA players are found in BDL!`);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();

