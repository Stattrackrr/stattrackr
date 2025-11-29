/**
 * Check Supabase cache for player IDs
 * 
 * Usage:
 *   node scripts/check-cached-player-ids.js "Alexandre Sarr"
 */

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkCache(playerName) {
  console.log(`\n🔍 Checking cache for "${playerName}"...\n`);
  
  // Search for shot chart cache entries
  const { data: shotCharts, error } = await supabase
    .from('nba_cache')
    .select('*')
    .ilike('cache_key', '%shot_enhanced%')
    .order('updated_at', { ascending: false })
    .limit(100);
  
  if (error) {
    console.error('❌ Error querying cache:', error);
    return;
  }
  
  if (!shotCharts || shotCharts.length === 0) {
    console.log('   No shot chart cache entries found');
    return;
  }
  
  console.log(`   Found ${shotCharts.length} shot chart cache entries\n`);
  
  // Look for entries that might contain the player name
  const nameLower = playerName.toLowerCase();
  const matches = [];
  
  for (const entry of shotCharts) {
    try {
      const cacheData = typeof entry.cache_data === 'string' 
        ? JSON.parse(entry.cache_data) 
        : entry.cache_data;
      
      // Check if cache key or data contains player name
      const key = entry.cache_key || '';
      const playerId = key.match(/shot_enhanced_(\d+)_/)?.[1];
      
      if (playerId) {
        // Try to find player name in the data
        const dataStr = JSON.stringify(cacheData).toLowerCase();
        if (dataStr.includes(nameLower) || key.includes(playerId)) {
          matches.push({
            playerId,
            cacheKey: key,
            updatedAt: entry.updated_at,
            data: cacheData
          });
        }
      }
    } catch (e) {
      // Skip invalid entries
    }
  }
  
  if (matches.length > 0) {
    console.log(`   ✅ Found ${matches.length} potential matches:\n`);
    matches.forEach((match, idx) => {
      console.log(`   ${idx + 1}. NBA Stats ID: ${match.playerId}`);
      console.log(`      Cache Key: ${match.cacheKey}`);
      console.log(`      Updated: ${match.updatedAt}\n`);
    });
  } else {
    console.log('   ⚠️  No matches found in cache');
    console.log('   Showing first 10 entries for reference:\n');
    shotCharts.slice(0, 10).forEach((entry, idx) => {
      const playerId = entry.cache_key?.match(/shot_enhanced_(\d+)_/)?.[1] || 'unknown';
      console.log(`   ${idx + 1}. NBA Stats ID: ${playerId} - ${entry.cache_key}`);
    });
  }
}

async function main() {
  const playerName = process.argv[2] || 'Alexandre Sarr';
  await checkCache(playerName);
  console.log('\n✅ Done!');
}

main();

