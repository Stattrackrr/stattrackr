#!/usr/bin/env node
/**
 * Test the projections API endpoints
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, {
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, raw: true });
        }
      });
    }).on('error', reject);
  });
}

async function testMainProjections() {
  console.log('\n🔍 Testing main projections API...');
  console.log(`   URL: ${BASE_URL}/api/nba/projections`);
  
  try {
    const result = await fetchUrl(`${BASE_URL}/api/nba/projections`);
    
    if (result.status !== 200) {
      console.log(`   ❌ Status: ${result.status}`);
      if (result.raw) {
        console.log(`   Error: ${result.data}`);
      }
      return false;
    }
    
    console.log(`   ✅ Status: ${result.status}`);
    console.log(`   📅 Date: ${result.data.date}`);
    console.log(`   🏀 Games: ${result.data.summary?.games || 0}`);
    
    if (result.data.gamePace && result.data.gamePace.length > 0) {
      console.log(`\n   🏀 Game pace predictions (first 5):`);
      result.data.gamePace.slice(0, 5).forEach((game, idx) => {
        console.log(`      ${idx + 1}. ${game.awayTeam} @ ${game.homeTeam}: ${game.predictedPace.toFixed(2)} pace`);
      });
    } else {
      console.log(`   ⚠️  No game pace data found`);
    }
    
    return true;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🧪 Testing NBA Projections API\n');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log('='.repeat(60));
  
  // Test main projections API
  const result = await testMainProjections();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary:\n');
  console.log(`   Main Projections API: ${result ? '✅ PASS' : '❌ FAIL'}`);
  
  if (result) {
    console.log('\n✅ Test passed!');
  } else {
    console.log('\n❌ Test failed. Check the errors above.');
  }
}

main().catch(console.error);

