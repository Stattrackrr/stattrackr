#!/usr/bin/env node
/**
 * Test SportsLine projections API
 */

const https = require('https');
const http = require('http');

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const url = `${baseUrl}/api/nba/projections/sportsline`;

console.log('🧪 Testing SportsLine Projections API\n');
console.log(`URL: ${url}\n`);

const protocol = url.startsWith('https') ? https : http;

protocol.get(url, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`❌ Status ${res.statusCode}`);
      console.error(data);
      process.exit(1);
    }
    
    try {
      const json = JSON.parse(data);
      
      console.log('✅ Successfully fetched projections\n');
      console.log(`📊 Summary:`);
      console.log(`   - Players with projections: ${json.summary?.playersWithProjections || 0}`);
      console.log(`   - Last updated: ${json.summary?.lastUpdated || 'N/A'}\n`);
      
      if (json.playerMinutes && json.playerMinutes.length > 0) {
        console.log(`📋 Sample players (first 10):`);
        json.playerMinutes.slice(0, 10).forEach((p, i) => {
          console.log(`   ${i + 1}. ${p.player} (${p.team}) - ${p.minutes} min`);
        });
        
        // Check for specific test players
        const testPlayers = ['Nikola Jokic', 'Jalen Johnson', 'Josh Giddey'];
        console.log(`\n🔍 Looking for test players:`);
        testPlayers.forEach(name => {
          const found = json.playerMinutes.find((p) => 
            p.player.toLowerCase().includes(name.toLowerCase())
          );
          if (found) {
            console.log(`   ✅ ${name}: ${found.minutes} min (${found.team})`);
          } else {
            console.log(`   ❌ ${name}: Not found`);
          }
        });
      } else {
        console.log('⚠️  No player projections found');
      }
      
    } catch (e) {
      console.error('❌ Error parsing JSON:', e.message);
      console.error('Response:', data.substring(0, 500));
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error('❌ Request error:', err.message);
  process.exit(1);
});

