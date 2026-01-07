/**
 * Script to check and optionally clear player props cache
 * Usage:
 *   node scripts/check-and-clear-player-props-cache.js                    # Check cache
 *   node scripts/check-and-clear-player-props-cache.js --clear            # Clear cache
 *   node scripts/check-and-clear-player-props-cache.js --check-old        # Check for old props
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CACHE_KEY = 'nba-player-props-all-dates';
const ODDS_CACHE_KEY = 'nba-odds-cache';

async function getCache(key) {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at, updated_at, created_at')
      .eq('cache_key', key)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return data;
  } catch (e) {
    console.error(`Error getting cache:`, e.message);
    return null;
  }
}

async function clearCache(key) {
  try {
    const { error } = await supabase
      .from('nba_api_cache')
      .delete()
      .eq('cache_key', key);
    
    if (error) {
      console.error(`❌ Error clearing cache:`, error.message);
      return false;
    }
    
    console.log(`✅ Cache cleared: ${key}`);
    return true;
  } catch (e) {
    console.error(`❌ Error clearing cache:`, e.message);
    return false;
  }
}

async function checkCache() {
  console.log(`\n🔍 Checking cache: ${CACHE_KEY}\n`);
  
  const cache = await getCache(CACHE_KEY);
  
  if (!cache) {
    console.log(`❌ No cache found`);
    return null;
  }
  
  console.log(`✅ Cache found:`);
  console.log(`   Updated: ${new Date(cache.updated_at).toLocaleString()}`);
  console.log(`   Created: ${new Date(cache.created_at).toLocaleString()}`);
  console.log(`   Expires: ${new Date(cache.expires_at).toLocaleString()}`);
  
  const props = Array.isArray(cache.data) ? cache.data : [];
  console.log(`\n📊 Total props: ${props.length}`);
  
  if (props.length === 0) {
    console.log(`⚠️ Cache is empty`);
    return cache;
  }
  
  // Count by stat type
  const statTypeCounts = {};
  props.forEach(prop => {
    const statType = prop.statType || 'UNKNOWN';
    statTypeCounts[statType] = (statTypeCounts[statType] || 0) + 1;
  });
  
  console.log(`\n📊 Stat type breakdown:`);
  Object.entries(statTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([statType, count]) => {
      console.log(`   ${statType}: ${count}`);
    });
  
  // Count unique games
  const gameDates = new Set();
  props.forEach(prop => {
    if (prop.gameDate) {
      const dateStr = String(prop.gameDate);
      // Extract date part (YYYY-MM-DD)
      const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        gameDates.add(dateMatch[1]);
      }
    }
  });
  
  console.log(`\n📅 Unique game dates: ${gameDates.size}`);
  if (gameDates.size > 0) {
    const sortedDates = Array.from(gameDates).sort();
    console.log(`   Dates: ${sortedDates.slice(0, 5).join(', ')}${sortedDates.length > 5 ? '...' : ''}`);
  }
  
  return cache;
}

async function checkForOldProps() {
  console.log(`\n🔍 Checking for old props (not in current odds cache)...\n`);
  
  // Get current odds cache
  const oddsCache = await getCache(ODDS_CACHE_KEY);
  if (!oddsCache || !oddsCache.data || !oddsCache.data.games) {
    console.log(`⚠️ No odds cache found - cannot check for old props`);
    return;
  }
  
  // Get current game dates from odds cache
  const currentGameDates = new Set();
  const currentGameCommenceTimes = new Set();
  
  for (const game of oddsCache.data.games || []) {
    if (game.commenceTime) {
      currentGameCommenceTimes.add(String(game.commenceTime));
      const dateMatch = String(game.commenceTime).match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        currentGameDates.add(dateMatch[1]);
      }
    }
  }
  
  console.log(`📅 Current odds cache has ${currentGameCommenceTimes.size} games`);
  console.log(`   Game dates: ${Array.from(currentGameDates).sort().join(', ')}\n`);
  
  // Get player props cache
  const propsCache = await getCache(CACHE_KEY);
  if (!propsCache || !Array.isArray(propsCache.data)) {
    console.log(`❌ No player props cache found`);
    return;
  }
  
  const props = propsCache.data;
  console.log(`📊 Total props in cache: ${props.length}`);
  
  // Check which props are from old games
  let oldPropsCount = 0;
  let currentPropsCount = 0;
  const oldGameDates = new Set();
  
  for (const prop of props) {
    if (!prop.gameDate) {
      // Props without gameDate are considered current (shouldn't happen, but be safe)
      currentPropsCount++;
      continue;
    }
    
    const propGameDate = String(prop.gameDate);
    const isCurrentGame = currentGameCommenceTimes.has(propGameDate) || 
                         (propGameDate.match(/^(\d{4}-\d{2}-\d{2})/) && 
                          currentGameDates.has(propGameDate.match(/^(\d{4}-\d{2}-\d{2})/)[1]));
    
    if (isCurrentGame) {
      currentPropsCount++;
    } else {
      oldPropsCount++;
      const dateMatch = propGameDate.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        oldGameDates.add(dateMatch[1]);
      }
    }
  }
  
  console.log(`\n📊 Props breakdown:`);
  console.log(`   ✅ Current props (from games in odds cache): ${currentPropsCount}`);
  console.log(`   ❌ Old props (from games NOT in odds cache): ${oldPropsCount}`);
  
  if (oldPropsCount > 0) {
    console.log(`\n⚠️ Found ${oldPropsCount} old props that should be removed!`);
    console.log(`   Old game dates: ${Array.from(oldGameDates).sort().join(', ')}`);
    console.log(`\n💡 Run with --clear to remove old cache, then re-run ingestion`);
  } else {
    console.log(`\n✅ No old props found - all props are from current games!`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldClear = args.includes('--clear') || args.includes('-c');
  const shouldCheckOld = args.includes('--check-old') || args.includes('--old');
  
  if (shouldCheckOld) {
    await checkForOldProps();
    return;
  }
  
  const cache = await checkCache();
  
  if (shouldClear) {
    console.log(`\n🗑️ Clearing cache...`);
    const cleared = await clearCache(CACHE_KEY);
    if (cleared) {
      console.log(`\n✅ Cache cleared successfully!`);
      console.log(`   Run the ingestion workflow to rebuild the cache`);
    }
  } else {
    console.log(`\n💡 To clear the cache, run:`);
    console.log(`   node scripts/check-and-clear-player-props-cache.js --clear`);
    console.log(`\n💡 To check for old props, run:`);
    console.log(`   node scripts/check-and-clear-player-props-cache.js --check-old`);
  }
}

main().catch(console.error);














