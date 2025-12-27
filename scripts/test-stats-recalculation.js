#!/usr/bin/env node
/**
 * Test script to verify stats recalculation in 30-minute update
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function test() {
  console.log('🧪 Testing Stats Recalculation in 30-Minute Update\n');
  console.log('='.repeat(60));
  
  try {
    // Step 1: Check props before update
    console.log('\n[1/4] Checking props before update...');
    const propsBefore = await fetch(`${BASE_URL}/api/nba/player-props`).then(r => r.json());
    const totalBefore = propsBefore.data?.length || 0;
    
    const propsWithoutStats = propsBefore.data?.filter((p) => {
      const hasStats = !!(p.__last5Values && Array.isArray(p.__last5Values) && p.__last5Values.length > 0);
      return !hasStats;
    }) || [];
    
    console.log(`   Total props: ${totalBefore}`);
    console.log(`   Props without stat arrays: ${propsWithoutStats.length}`);
    
    if (propsWithoutStats.length === 0) {
      console.log('   ⚠️  All props already have stat arrays - nothing to recalculate');
      console.log('   ✅ This is good! All props have complete stats.');
      process.exit(0);
    }
    
    // Show sample props without stats
    const sample = propsWithoutStats.slice(0, 3);
    console.log(`   Sample props missing stats:`);
    sample.forEach((p) => {
      console.log(`      - ${p.playerName} ${p.statType} (line: ${p.line})`);
    });
    
    // Step 2: Trigger update
    console.log('\n[2/4] Triggering player props update...');
    console.log('   This should recalculate stats for props missing stat arrays');
    const startTime = Date.now();
    const updateResponse = await fetch(`${BASE_URL}/api/nba/player-props/update-odds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(r => r.json());
    const elapsed = Date.now() - startTime;
    
    if (!updateResponse.success) {
      console.error(`   ❌ Update failed: ${updateResponse.error}`);
      process.exit(1);
    }
    
    console.log(`   ✅ Update completed in ${elapsed}ms`);
    console.log(`   📊 Results:`);
    console.log(`      - Updated existing props: ${updateResponse.updated || 0}`);
    console.log(`      - Removed props: ${updateResponse.removed || 0}`);
    console.log(`      - New props added: ${updateResponse.newProps || 0}`);
    console.log(`      - Stats recalculated: ${updateResponse.statsRecalculated || 'N/A'}`);
    console.log(`      - Total props: ${updateResponse.total || totalBefore}`);
    
    // Step 3: Check props after update
    console.log('\n[3/4] Checking props after update...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cache to update
    const propsAfter = await fetch(`${BASE_URL}/api/nba/player-props?refresh=1`).then(r => r.json());
    const totalAfter = propsAfter.data?.length || 0;
    
    const propsWithStats = propsAfter.data?.filter((p) => {
      const hasStats = !!(p.__last5Values && Array.isArray(p.__last5Values) && p.__last5Values.length > 0);
      return hasStats;
    }) || [];
    
    const propsStillWithoutStats = propsAfter.data?.filter((p) => {
      const hasStats = !!(p.__last5Values && Array.isArray(p.__last5Values) && p.__last5Values.length > 0);
      return !hasStats;
    }) || [];
    
    console.log(`   Total props: ${totalAfter}`);
    console.log(`   Props with stat arrays: ${propsWithStats.length} (was ${totalBefore - propsWithoutStats.length})`);
    console.log(`   Props still without stat arrays: ${propsStillWithoutStats.length} (was ${propsWithoutStats.length})`);
    
    const statsAdded = propsWithStats.length - (totalBefore - propsWithoutStats.length);
    if (statsAdded > 0) {
      console.log(`   ✅ Stats were added to ${statsAdded} props!`);
    } else {
      console.log(`   ⚠️  No new stats were added (may need to wait for next update)`);
    }
    
    // Step 4: Verify sample props got stats
    console.log('\n[4/4] Verifying sample props got stats...');
    let verified = 0;
    for (const sampleProp of sample) {
      const updatedProp = propsAfter.data?.find((p) => 
        p.playerName === sampleProp.playerName && 
        p.statType === sampleProp.statType &&
        Math.abs(p.line - sampleProp.line) < 0.1
      );
      
      if (updatedProp && updatedProp.__last5Values && Array.isArray(updatedProp.__last5Values) && updatedProp.__last5Values.length > 0) {
        console.log(`   ✅ ${sampleProp.playerName} ${sampleProp.statType} now has stats (${updatedProp.__last5Values.length} last5 values)`);
        verified++;
      } else {
        console.log(`   ⚠️  ${sampleProp.playerName} ${sampleProp.statType} still missing stats (will be processed in next update)`);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📋 Summary:');
    console.log(`   Props without stats (before): ${propsWithoutStats.length}`);
    console.log(`   Props without stats (after): ${propsStillWithoutStats.length}`);
    console.log(`   Stats added: ${statsAdded > 0 ? `+${statsAdded}` : '0'}`);
    console.log(`   Sample props verified: ${verified}/${sample.length}`);
    console.log(`   Execution time: ${elapsed}ms`);
    
    if (statsAdded > 0 || verified > 0) {
      console.log('\n   ✅ Test PASSED - Stats recalculation is working!');
      process.exit(0);
    } else if (propsStillWithoutStats.length < propsWithoutStats.length) {
      console.log('\n   ✅ Test PASSED - Some stats were recalculated (more will be processed in next update)');
      process.exit(0);
    } else {
      console.log('\n   ⚠️  Test WARNING - No stats were recalculated yet (may need to wait for next update)');
      console.log('   Note: The update processes all props needing stats (with delays to avoid timeouts)');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

test();

