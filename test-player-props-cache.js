/**
 * Quick test script to check player props cache
 * Run: node test-player-props-cache.js
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function testCache() {
  console.log('🧪 Testing Player Props Cache...\n');
  
  try {
    // Test 1: Check odds cache (needed for player props)
    console.log('1️⃣ Checking odds cache...');
    const oddsRes = await fetch(`${BASE_URL}/api/odds`);
    const oddsData = await oddsRes.json();
    
    if (oddsData.lastUpdated) {
      console.log(`   ✅ Odds cache found - lastUpdated: ${oddsData.lastUpdated}`);
      console.log(`   📊 Games: ${oddsData.games?.length || 0}`);
    } else {
      console.log('   ❌ No odds cache found');
      return;
    }
    
    // Test 2: Check player props cache
    console.log('\n2️⃣ Checking player props cache...');
    const propsRes = await fetch(`${BASE_URL}/api/nba/player-props`);
    const propsData = await propsRes.json();
    
    console.log(`   Cached: ${propsData.cached ? '✅ YES' : '❌ NO'}`);
    console.log(`   Stale: ${propsData.stale ? '⚠️ YES (serving old cache)' : 'NO'}`);
    console.log(`   Data length: ${propsData.data?.length || 0} props`);
    console.log(`   Game date: ${propsData.gameDate || 'N/A'}`);
    console.log(`   Last updated: ${propsData.lastUpdated || 'N/A'}`);
    console.log(`   Message: ${propsData.message || 'N/A'}`);
    
    // Test 3: Check if cache key would match
    if (oddsData.lastUpdated && propsData.lastUpdated) {
      const keysMatch = oddsData.lastUpdated === propsData.lastUpdated;
      console.log(`\n3️⃣ Cache key comparison:`);
      console.log(`   Odds lastUpdated: ${oddsData.lastUpdated}`);
      console.log(`   Props lastUpdated: ${propsData.lastUpdated}`);
      console.log(`   Keys match: ${keysMatch ? '✅ YES' : '❌ NO - THIS IS THE PROBLEM!'}`);
      
      if (!keysMatch) {
        console.log('\n   ⚠️ ISSUE FOUND: The odds cache lastUpdated changed between requests!');
        console.log('   This means the cache key will never match.');
        console.log('   Solution: Use a more stable cache key or check for stale cache.');
      }
    }
    
    // Test 4: Try again immediately to see if cache persists
    console.log('\n4️⃣ Testing cache persistence (second request)...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    const propsRes2 = await fetch(`${BASE_URL}/api/nba/player-props`);
    const propsData2 = await propsRes2.json();
    
    console.log(`   Cached: ${propsData2.cached ? '✅ YES' : '❌ NO'}`);
    console.log(`   Data length: ${propsData2.data?.length || 0} props`);
    
    if (propsData.cached && !propsData2.cached) {
      console.log('\n   ⚠️ ISSUE: Cache was found on first request but not on second!');
      console.log('   This suggests the cache key is changing or cache is being cleared.');
    }
    
    console.log('\n✅ Test complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testCache();

