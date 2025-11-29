/**
 * Find player IDs and add to playerIdMapping.ts
 * 
 * Usage:
 *   node scripts/find-and-add-player-mapping.js "Alex Sarr"
 */

require('dotenv').config({ path: '.env.local' });

const BDL_BASE = 'https://api.balldontlie.io/v1';
const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const bdlApiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';

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

async function findBDLPlayer(playerName) {
  // Try active players first
  let url = new URL(`${BDL_BASE}/players/active`);
  url.searchParams.set('search', playerName);
  url.searchParams.set('per_page', '100');
  
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'StatTrackr/1.0',
  };
  if (bdlApiKey) {
    headers['Authorization'] = bdlApiKey.startsWith('Bearer ') ? bdlApiKey : `Bearer ${bdlApiKey}`;
  }
  
  let response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`BDL API error: ${response.status}`);
  }
  
  let data = await response.json();
  let players = Array.isArray(data?.data) ? data.data : [];
  
  // If no results, try all players (not just active)
  if (players.length === 0) {
    console.log('   Trying all players (not just active)...');
    url = new URL(`${BDL_BASE}/players`);
    url.searchParams.set('search', playerName);
    url.searchParams.set('per_page', '100');
    
    response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`BDL API error: ${response.status}`);
    }
    
    data = await response.json();
    players = Array.isArray(data?.data) ? data.data : [];
  }
  
  // Try exact match first
  const exactMatch = players.find(p => {
    const fullName = `${p.first_name} ${p.last_name}`;
    return fullName.toLowerCase() === playerName.toLowerCase();
  });
  
  if (exactMatch) {
    return exactMatch;
  }
  
  // Try "Alex" vs "Alexandre" variations
  const nameParts = playerName.toLowerCase().split(' ');
  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    // Try variations like "Alex" -> "Alexandre"
    const variations = [
      playerName,
      `${firstName} ${lastName}`,
      firstName === 'alex' ? `alexandre ${lastName}` : null,
      firstName === 'alexandre' ? `alex ${lastName}` : null,
    ].filter(Boolean);
    
    for (const variant of variations) {
      const match = players.find(p => {
        const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
        return fullName === variant.toLowerCase() || 
               fullName.includes(variant.toLowerCase()) ||
               variant.toLowerCase().includes(fullName);
      });
      if (match) return match;
    }
  }
  
  // Try partial match
  const partialMatch = players.find(p => {
    const fullName = `${p.first_name} ${p.last_name}`;
    const nameLower = playerName.toLowerCase();
    return fullName.toLowerCase().includes(nameLower) || nameLower.includes(fullName.toLowerCase());
  });
  
  if (partialMatch) {
    return partialMatch;
  }
  
  // Show what we found for debugging
  if (players.length > 0) {
    console.log(`   Found ${players.length} players, showing first 5:`);
    players.slice(0, 5).forEach(p => {
      console.log(`     - ${p.first_name} ${p.last_name} (ID: ${p.id})`);
    });
  }
  
  return null;
}

async function findNBAPlayerId(playerName) {
  const season = '2024-25';
  const params = new URLSearchParams({
    LeagueID: '00',
    Season: season,
    IsOnlyCurrentSeason: '0'
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

  // Try exact match
  const exactMatch = rows.find(row => {
    const name = row[nameIdx] || '';
    return name.toLowerCase() === playerName.toLowerCase();
  });
  
  if (exactMatch) {
    return {
      id: String(exactMatch[personIdx]),
      name: exactMatch[nameIdx]
    };
  }
  
  // Try partial match
  const partialMatch = rows.find(row => {
    const name = row[nameIdx] || '';
    const nameLower = playerName.toLowerCase();
    return name.toLowerCase().includes(nameLower) || nameLower.includes(name.toLowerCase());
  });
  
  if (partialMatch) {
    return {
      id: String(partialMatch[personIdx]),
      name: partialMatch[nameIdx]
    };
  }
  
  return null;
}

async function main() {
  const playerNames = process.argv.slice(2);
  
  if (playerNames.length === 0) {
    console.error('Usage: node scripts/find-and-add-player-mapping.js "Player Name"');
    console.error('Example: node scripts/find-and-add-player-mapping.js "Alex Sarr"');
    process.exit(1);
  }
  
  for (const playerName of playerNames) {
    console.log(`\n🔍 Searching for "${playerName}"...\n`);
    
    try {
      // Find BDL player
      console.log('1. Searching Ball Don\'t Lie API...');
      const bdlPlayer = await findBDLPlayer(playerName);
      
      if (!bdlPlayer) {
        console.log(`   ❌ Not found in BDL`);
        continue;
      }
      
      const bdlFullName = `${bdlPlayer.first_name} ${bdlPlayer.last_name}`;
      console.log(`   ✅ Found: ${bdlFullName} (BDL ID: ${bdlPlayer.id})`);
      
      // Find NBA Stats ID
      console.log('\n2. Searching NBA Stats API...');
      const nbaPlayer = await findNBAPlayerId(bdlFullName);
      
      if (!nbaPlayer) {
        console.log(`   ❌ Not found in NBA Stats`);
        console.log(`\n   📝 Add this to lib/playerIdMapping.ts manually:`);
        console.log(`   { bdlId: '${bdlPlayer.id}', nbaId: '???', name: '${bdlFullName}' },`);
        continue;
      }
      
      console.log(`   ✅ Found: ${nbaPlayer.name} (NBA ID: ${nbaPlayer.id})`);
      
      // Show the mapping to add
      console.log(`\n   📝 Add this to lib/playerIdMapping.ts:`);
      console.log(`   { bdlId: '${bdlPlayer.id}', nbaId: '${nbaPlayer.id}', name: '${bdlFullName}' },`);
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n✅ Done!');
}

main();

