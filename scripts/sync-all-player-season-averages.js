/**
 * Script to sync all player season averages with all stat types
 * This will cache FGM, FGA, FTM, FTA, OREB, DREB, TO, PF, STL, BLK for all players
 * 
 * Usage:
 *   node scripts/sync-all-player-season-averages.js [season]
 * 
 * Example:
 *   node scripts/sync-all-player-season-averages.js 2025
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'http://localhost:3000';

async function syncSeasonAverages(season) {
  console.log(`\n🔄 Starting sync for season ${season}...`);
  console.log(`📡 Calling: ${BASE_URL}/api/player-season-averages/sync`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/player-season-averages/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ season }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`\n✅ Sync completed successfully!`);
      console.log(`   Season: ${result.season}`);
      console.log(`   Total Players: ${result.totalPlayers}`);
      console.log(`   Synced: ${result.synced}`);
      console.log(`   Skipped: ${result.skipped}`);
      console.log(`   Errors: ${result.errors}`);
      console.log(`\n📊 All stats cached: PTS, REB, AST, FGM, FGA, FTM, FTA, OREB, DREB, TO, PF, STL, BLK, 3PM`);
    } else {
      console.error(`\n❌ Sync failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error syncing season averages:`, error.message);
    if (error.message.includes('fetch')) {
      console.error(`\n💡 Make sure the app is running at ${BASE_URL}`);
      console.error(`   Or set NEXT_PUBLIC_APP_URL environment variable`);
    }
    process.exit(1);
  }
}

// Get season from command line or use current season
const season = process.argv[2] || new Date().getFullYear();

console.log(`\n📦 Player Season Averages Sync Tool`);
console.log(`   This will cache all stat types for all players`);
console.log(`   Stats: PTS, REB, AST, FGM, FGA, FTM, FTA, OREB, DREB, TO, PF, STL, BLK, 3PM`);

syncSeasonAverages(season);

