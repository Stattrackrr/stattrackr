/**
 * Manual script to run odds snapshots cleanup
 * Usage: node scripts/cleanup-odds-snapshots.js
 */

require('dotenv').config({ path: '.env.local' });

async function runCleanup() {
  try {
    console.log('🧹 Running manual cleanup of odds snapshots...\n');
    
    // Import the cleanup function
    const { cleanupFinishedGameSnapshots } = require('../lib/cleanupOddsSnapshots.ts');
    
    const result = await cleanupFinishedGameSnapshots();
    
    console.log('\n✅ Cleanup completed!');
    console.log(`📊 Results:`, result);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  }
}

runCleanup();





