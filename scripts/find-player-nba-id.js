#!/usr/bin/env node

/**
 * Helper script to find NBA Stats API ID for a player
 * 
 * Usage:
 *   node scripts/find-player-nba-id.js "LeBron James"
 *   node scripts/find-player-nba-id.js "Giannis"
 * 
 * This script searches the NBA Stats API for a player by name
 * and returns their NBA Stats ID, which can then be added to
 * the player ID mapping.
 */

const https = require('https');

const playerName = process.argv[2];

if (!playerName) {
  console.error('❌ Please provide a player name');
  console.log('\nUsage:');
  console.log('  node scripts/find-player-nba-id.js "LeBron James"');
  console.log('  node scripts/find-player-nba-id.js "Giannis"');
  process.exit(1);
}

console.log(`🔍 Searching for NBA Stats ID for: ${playerName}\n`);

// NBA Stats API headers
const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

// Search for player
const searchUrl = `https://stats.nba.com/stats/commonplayerinfo?PlayerID=0`;

// Actually, we need to use a different endpoint that lists all players
const url = 'https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2024-25&IsOnlyCurrentSeason=1';

const options = {
  headers: NBA_HEADERS,
};

https.get(url, options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      
      if (!json.resultSets || !json.resultSets[0]) {
        console.error('❌ Unexpected API response format');
        process.exit(1);
      }
      
      const resultSet = json.resultSets[0];
      const headers = resultSet.headers;
      const rows = resultSet.rowSet;
      
      // Find PERSON_ID and DISPLAY_FIRST_LAST indices
      const personIdIdx = headers.indexOf('PERSON_ID');
      const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
      
      if (personIdIdx === -1 || nameIdx === -1) {
        console.error('❌ Could not find required columns in response');
        process.exit(1);
      }
      
      // Search for matching players
      const searchLower = playerName.toLowerCase();
      const matches = rows.filter(row => {
        const name = row[nameIdx].toLowerCase();
        return name.includes(searchLower);
      });
      
      if (matches.length === 0) {
        console.log('❌ No players found matching:', playerName);
        console.log('\nTry:');
        console.log('  - Using full name (e.g., "LeBron James" instead of "LeBron")');
        console.log('  - Checking spelling');
        console.log('  - Using partial name (e.g., "Antetokounmpo")');
        process.exit(1);
      }
      
      console.log(`✅ Found ${matches.length} matching player(s):\n`);
      
      matches.forEach((match, i) => {
        const playerId = match[personIdIdx];
        const name = match[nameIdx];
        const teamId = match[headers.indexOf('TEAM_ID')];
        const teamAbbr = match[headers.indexOf('TEAM_ABBREVIATION')];
        const fromYear = match[headers.indexOf('FROM_YEAR')];
        const toYear = match[headers.indexOf('TO_YEAR')];
        
        console.log(`${i + 1}. ${name}`);
        console.log(`   NBA Stats ID: ${playerId}`);
        console.log(`   Team: ${teamAbbr || 'N/A'}`);
        console.log(`   Years: ${fromYear}-${toYear}`);
        console.log('');
      });
      
      if (matches.length === 1) {
        const playerId = matches[0][personIdIdx];
        const name = matches[0][nameIdx];
        
        console.log('📋 To add this to your player ID mapping:\n');
        console.log('Edit: lib/playerIdMapping.ts');
        console.log('Add to PLAYER_ID_MAPPINGS array:\n');
        console.log(`  { bdlId: 'YOUR_BDL_ID', nbaId: '${playerId}', name: '${name}' },\n`);
        console.log('Replace YOUR_BDL_ID with the BallDontLie ID for this player.');
      } else {
        console.log('💡 Multiple matches found. Use the most relevant one.');
      }
      
    } catch (err) {
      console.error('❌ Error parsing response:', err.message);
      process.exit(1);
    }
  });
  
}).on('error', (err) => {
  console.error('❌ Request failed:', err.message);
  process.exit(1);
});


