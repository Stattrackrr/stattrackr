#!/usr/bin/env node
/**
 * Test script for 30-minute player props update
 * Verifies that it only processes new/changed props, not all props
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function test() {
  console.log('🧪 Testing 30-Minute Player Props Update\n');
  console.log('='.repeat(50));
  
  try {
    // Step 1: Get current props count
    console.log('\n[1/3] Checking current player props...');
    const propsBefore = await fetch(`${BASE_URL}/api/nba/player-props`).then(r => r.json());
    const totalBefore = propsBefore.data?.length || 0;
    console.log(`   ✅ Found ${totalBefore} props`);
    
    if (totalBefore === 0) {
      console.log('   ⚠️  No props found - need to process props first');
      console.log('   Run: POST /api/nba/player-props/process');
      process.exit(1);
    }
    
    // Step 2: Trigger update
    console.log('\n[2/3] Triggering player props update...');
    console.log('   This should ONLY update props with changed odds/lines');
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
    console.log(`      - Updated existing props: ${updateResponse.updated}`);
    console.log(`      - Removed props (odds disappeared): ${updateResponse.removed || 0}`);
    console.log(`      - New props added: ${updateResponse.newProps || 0}`);
    console.log(`      - Previous total: ${updateResponse.previousTotal || totalBefore}`);
    console.log(`      - New total: ${updateResponse.total}`);
    
    // Step 3: Verify it's not processing everything
    console.log('\n[3/3] Verifying efficiency...');
    const totalProps = updateResponse.total || totalBefore;
    const updated = updateResponse.updated || 0;
    
    // The key indicator: 'updated' should be much less than 'total'
    // If 'updated' equals 'total', it's processing everything (not good)
    if (updated < totalProps) {
      const percentUpdated = Math.round((updated / totalProps) * 100 * 10) / 10;
      console.log(`   ✅ Only updated ${updated} of ${totalProps} props (${percentUpdated}%)`);
      console.log(`   ✅ This is correct - only props with changed odds were updated`);
    } else if (updated === totalProps && totalProps > 50) {
      console.log(`   ⚠️  Updated all ${totalProps} props - might be reprocessing everything`);
      console.log(`   ⚠️  (This is normal if odds changed for all props, but check if it happens every time)`);
    } else {
      console.log(`   ✅ Update looks efficient`);
    }
    
    if (elapsed < 5000) {
      console.log(`   ✅ Fast execution (${elapsed}ms) - good!`);
    } else {
      console.log(`   ⚠️  Slow execution (${elapsed}ms) - might be processing too much`);
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📋 Summary:');
    console.log(`   Total props: ${totalProps}`);
    console.log(`   Updated: ${updateResponse.updated || 0}`);
    console.log(`   Removed: ${updateResponse.removed || 0}`);
    console.log(`   New: ${updateResponse.newProps || 0}`);
    console.log(`   Execution time: ${elapsed}ms`);
    
    if (totalProcessed < totalProps && elapsed < 5000) {
      console.log('\n   ✅ Test PASSED - Update is efficient!');
      process.exit(0);
    } else {
      console.log('\n   ⚠️  Test WARNING - May be processing too much');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

test();

