/**
 * Find NBA Stats ID from BDL ID
 * 
 * Usage:
 *   node scripts/find-nba-id-from-bdl.js 1028028405
 */

require('dotenv').config({ path: '.env.local' });

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

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

const BDL_BASE = 'https://api.balldontlie.io/v1';
const bdlApiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';

async function getBDLPlayer(bdlId) {
  const url = `${BDL_BASE}/players/${bdlId}`;
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'StatTrackr/1.0',
  };
  if (bdlApiKey) {
    headers['Authorization'] = bdlApiKey.startsWith('Bearer ') ? bdlApiKey : `Bearer ${bdlApiKey}`;
  }
  
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`BDL API error: ${response.status}`);
  }
  
  const data = await response.json();
  // BDL API might return data directly or wrapped
  return data.data || data;
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
  
      // Try name variations (Alex/Alexandre, Nic/Nicolas, etc.)
      const nameParts = playerName.toLowerCase().split(' ');
      if (nameParts.length >= 2) {
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];
        
        const variations = [
          `${firstName} ${lastName}`,
          firstName === 'alex' ? `alexandre ${lastName}` : null,
          firstName === 'alexandre' ? `alex ${lastName}` : null,
          firstName === 'nic' ? `nicolas ${lastName}` : null,
          firstName === 'nicolas' ? `nic ${lastName}` : null,
        ].filter(Boolean);
        
        for (const variant of variations) {
          const match = rows.find(row => {
            const name = (row[nameIdx] || '').toLowerCase();
            return name === variant || name.includes(variant) || variant.includes(name);
          });
          if (match) {
            return {
              id: String(match[personIdx]),
              name: match[nameIdx]
            };
          }
        }
      }
  
  return null;
}

async function main() {
  const bdlId = process.argv[2];
  
  if (!bdlId) {
    console.error('Usage: node scripts/find-nba-id-from-bdl.js <BDL_ID>');
    console.error('Example: node scripts/find-nba-id-from-bdl.js 1028028405');
    process.exit(1);
  }
  
  console.log(`\n🔍 Finding NBA Stats ID for BDL ID: ${bdlId}\n`);
  
  try {
    // Get player from BDL
    console.log('1. Fetching player from Ball Don\'t Lie API...');
    const bdlPlayer = await getBDLPlayer(bdlId);
    const fullName = `${bdlPlayer.first_name} ${bdlPlayer.last_name}`;
    console.log(`   ✅ Found: ${fullName} (BDL ID: ${bdlId})`);
    
    // Find NBA Stats ID
    console.log('\n2. Searching NBA Stats API...');
    const nbaPlayer = await findNBAPlayerId(fullName);
    
    if (!nbaPlayer) {
      console.log(`   ❌ Not found in NBA Stats`);
      console.log(`\n   📝 Add this to lib/playerIdMapping.ts manually (NBA ID unknown):`);
      console.log(`   { bdlId: '${bdlId}', nbaId: '???', name: '${fullName}' },`);
      process.exit(1);
    }
    
    console.log(`   ✅ Found: ${nbaPlayer.name} (NBA ID: ${nbaPlayer.id})`);
    
    // Show the mapping to add
    console.log(`\n   📝 Add this to lib/playerIdMapping.ts:`);
    console.log(`   { bdlId: '${bdlId}', nbaId: '${nbaPlayer.id}', name: '${fullName}' },`);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    process.exit(1);
  }
  
  console.log('\n✅ Done!');
}

main();

