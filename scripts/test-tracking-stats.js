#!/usr/bin/env node

/**
 * Test script for NBA Tracking Stats API
 * 
 * Usage:
 *   node scripts/test-tracking-stats.js [player_id] [season]
 * 
 * Examples:
 *   node scripts/test-tracking-stats.js 203507 2024
 *   node scripts/test-tracking-stats.js 2544
 */

const https = require('https');
const http = require('http');

// Test player IDs with known data
const TEST_PLAYERS = [
  { id: '203507', name: 'Giannis Antetokounmpo' },
  { id: '2544', name: 'LeBron James' },
  { id: '1629029', name: 'Luka Dončić' },
  { id: '203999', name: 'Nikola Jokić' },
];

const playerId = process.argv[2] || '203507';
const season = process.argv[3] || '2024';

console.log('🏀 NBA Tracking Stats API Test\n');
console.log(`Player ID: ${playerId}`);
console.log(`Season: ${season}-${(parseInt(season) + 1) % 100}\n`);

// Test 1: Check if local API is running
console.log('Test 1: Checking if local dev server is running...');
testLocalAPI()
  .then(() => {
    console.log('✅ Local API is accessible\n');
    
    // Test 2: Try fetching tracking stats
    console.log('Test 2: Fetching tracking stats...');
    return testTrackingStats();
  })
  .then((data) => {
    console.log('✅ Tracking stats fetched successfully!\n');
    
    if (data.passing_stats) {
      console.log('📊 Passing Stats:');
      console.log(`   Potential Assists: ${data.passing_stats.POTENTIAL_AST || 'N/A'}`);
      console.log(`   Actual Assists: ${data.passing_stats.AST_ADJ || 'N/A'}`);
      console.log(`   Passes Made: ${data.passing_stats.PASSES_MADE || 'N/A'}`);
    } else {
      console.log('⚠️  No passing stats available');
    }
    
    if (data.rebounding_stats) {
      console.log('\n🏀 Rebounding Stats:');
      console.log(`   Rebound Chances: ${data.rebounding_stats.REB_CHANCES || 'N/A'}`);
      console.log(`   Total Rebounds: ${data.rebounding_stats.REB || 'N/A'}`);
      console.log(`   Contested: ${data.rebounding_stats.REB_CONTESTED || 'N/A'}`);
    } else {
      console.log('⚠️  No rebounding stats available');
    }
    
    console.log('\n✨ All tests passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nTroubleshooting tips:');
    console.error('1. Make sure your dev server is running: npm run dev');
    console.error('2. Check if the player ID is valid');
    console.error('3. Try a different season (e.g., 2023 instead of 2024)');
    console.error('4. Wait 30 seconds and try again (NBA API might be slow)');
    console.error('\nFor more help, see: docs/TRACKING_STATS_TROUBLESHOOTING.md');
    process.exit(1);
  });

function testLocalAPI() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3000/api/tracking-stats/health', (res) => {
      if (res.statusCode === 200 || res.statusCode === 404) {
        resolve();
      } else {
        reject(new Error(`Dev server returned status ${res.statusCode}`));
      }
    });
    
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Dev server is not running. Start it with: npm run dev'));
      } else {
        reject(err);
      }
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout - dev server not responding'));
    });
  });
}

function testTrackingStats() {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:3000/api/tracking-stats?player_id=${playerId}&season=${season}`;
    
    const req = http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(new Error('Failed to parse response: ' + err.message));
          }
        } else {
          try {
            const json = JSON.parse(data);
            reject(new Error(json.error || json.details || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });
    
    req.on('error', (err) => {
      reject(new Error('Request failed: ' + err.message));
    });
    
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout - NBA API is slow or down'));
    });
  });
}

// If running directly
if (require.main === module) {
  console.log('Available test players:');
  TEST_PLAYERS.forEach((player, i) => {
    console.log(`  ${i + 1}. ${player.name} (${player.id})`);
  });
  console.log('');
}


