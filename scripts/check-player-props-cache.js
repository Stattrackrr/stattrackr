/**
 * Check what's actually in the player props cache
 * Usage: node scripts/check-player-props-cache.js [date]
 * If no date provided, checks today and tomorrow in US ET
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function getUSEasternDateString(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  });
}

async function checkCache(dateStr) {
  const cacheKey = `nba-player-props-${dateStr}`;
  console.log(`\n🔍 Checking cache for: ${cacheKey}`);
  
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('cache_key, cache_type, updated_at, expires_at')
      .eq('cache_key', cacheKey)
      .single();
    
    if (error || !data) {
      console.log(`❌ No cache found for ${cacheKey}`);
      return null;
    }
    
    console.log(`✅ Cache found:`);
    console.log(`   Updated: ${data.updated_at}`);
    console.log(`   Expires: ${data.expires_at}`);
    
    // Get the actual data
    const { data: cacheData, error: dataError } = await supabase
      .from('nba_api_cache')
      .select('data')
      .eq('cache_key', cacheKey)
      .single();
    
    if (dataError || !cacheData || !cacheData.data) {
      console.log(`❌ Could not retrieve cache data`);
      return null;
    }
    
    const props = Array.isArray(cacheData.data) ? cacheData.data : [];
    console.log(`📊 Total props: ${props.length}`);
    
    // Count by stat type
    const statTypeCounts = {};
    props.forEach(prop => {
      const statType = prop.statType || 'UNKNOWN';
      statTypeCounts[statType] = (statTypeCounts[statType] || 0) + 1;
    });
    
    console.log(`📊 Stat type breakdown:`);
    Object.entries(statTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([statType, count]) => {
        console.log(`   ${statType}: ${count}`);
      });
    
    // Check for STL, BLK, THREES
    const stlCount = statTypeCounts['STL'] || 0;
    const blkCount = statTypeCounts['BLK'] || 0;
    const threesCount = statTypeCounts['THREES'] || 0;
    
    console.log(`\n📊 Secondary stats:`);
    console.log(`   STL: ${stlCount}`);
    console.log(`   BLK: ${blkCount}`);
    console.log(`   THREES: ${threesCount}`);
    
    if (stlCount === 0 && blkCount === 0 && threesCount === 0) {
      console.log(`\n⚠️ WARNING: No secondary stats found in cache!`);
    }
    
    return props;
  } catch (e) {
    console.error(`❌ Exception checking ${cacheKey}:`, e.message);
    return null;
  }
}

async function checkAllDatesCache() {
  const cacheKey = 'nba-player-props-all-dates';
  console.log(`\n🔍 Checking cache for: ${cacheKey}`);
  
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('cache_key, cache_type, updated_at, expires_at')
      .eq('cache_key', cacheKey)
      .single();
    
    if (error || !data) {
      console.log(`❌ No cache found for ${cacheKey}`);
      return null;
    }
    
    console.log(`✅ Cache found:`);
    console.log(`   Updated: ${data.updated_at}`);
    console.log(`   Expires: ${data.expires_at}`);
    
    // Get the actual data
    const { data: cacheData, error: dataError } = await supabase
      .from('nba_api_cache')
      .select('data')
      .eq('cache_key', cacheKey)
      .single();
    
    if (dataError || !cacheData || !cacheData.data) {
      console.log(`❌ Could not retrieve cache data`);
      return null;
    }
    
    const props = Array.isArray(cacheData.data) ? cacheData.data : [];
    console.log(`📊 Total props: ${props.length}`);
    
    // Count by stat type
    const statTypeCounts = {};
    props.forEach(prop => {
      const statType = prop.statType || 'UNKNOWN';
      statTypeCounts[statType] = (statTypeCounts[statType] || 0) + 1;
    });
    
    console.log(`📊 Stat type breakdown:`);
    Object.entries(statTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([statType, count]) => {
        console.log(`   ${statType}: ${count}`);
      });
    
    return props;
  } catch (e) {
    console.error(`❌ Exception checking ${cacheKey}:`, e.message);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const specificDate = args[0];
  
  // Always check all-dates cache first (new unified approach)
  await checkAllDatesCache();
  
  if (specificDate) {
    // Check specific date
    await checkCache(specificDate);
  } else {
    // Check today and tomorrow in US ET
    const todayUSET = getUSEasternDateString(new Date());
    const [year, month, day] = todayUSET.split('-').map(Number);
    const tomorrowDate = new Date(year, month - 1, day + 1);
    const tomorrowUSET = getUSEasternDateString(tomorrowDate);
    
    console.log(`\n🔍 Checking player props cache for today and tomorrow (US ET)`);
    console.log(`📅 Today (US ET): ${todayUSET}`);
    console.log(`📅 Tomorrow (US ET): ${tomorrowUSET}`);
    
    await checkCache(todayUSET);
    await checkCache(tomorrowUSET);
  }
  
  console.log(`\n✅ Cache check complete!`);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

