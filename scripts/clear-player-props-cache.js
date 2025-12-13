/**
 * Clear player props cache for testing
 * Usage: node scripts/clear-player-props-cache.js [date]
 * If no date provided, clears cache for today and tomorrow in US ET
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

async function clearCache(dateStr) {
  const cacheKey = `nba-player-props-${dateStr}`;
  console.log(`🧹 Clearing cache for: ${cacheKey}`);
  
  try {
    const { error } = await supabase
      .from('nba_api_cache')
      .delete()
      .eq('cache_key', cacheKey);
    
    if (error) {
      console.error(`❌ Error clearing ${cacheKey}:`, error.message);
      return false;
    }
    
    console.log(`✅ Cleared: ${cacheKey}`);
    return true;
  } catch (e) {
    console.error(`❌ Exception clearing ${cacheKey}:`, e.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const specificDate = args[0];
  
  if (specificDate) {
    // Clear specific date
    await clearCache(specificDate);
  } else {
    // Clear today and tomorrow in US ET
    const todayUSET = getUSEasternDateString(new Date());
    const [year, month, day] = todayUSET.split('-').map(Number);
    const tomorrowDate = new Date(year, month - 1, day + 1);
    const tomorrowUSET = getUSEasternDateString(tomorrowDate);
    
    console.log(`🧹 Clearing player props cache for today and tomorrow (US ET)`);
    console.log(`📅 Today (US ET): ${todayUSET}`);
    console.log(`📅 Tomorrow (US ET): ${tomorrowUSET}\n`);
    
    await clearCache(todayUSET);
    await clearCache(tomorrowUSET);
    
    // Also clear checkpoint
    const checkpointToday = `nba-player-props-checkpoint-${todayUSET}`;
    const checkpointTomorrow = `nba-player-props-checkpoint-${tomorrowUSET}`;
    
    console.log(`\n🧹 Clearing checkpoints...`);
    await clearCache(checkpointToday.replace('nba-player-props-', ''));
    await clearCache(checkpointTomorrow.replace('nba-player-props-', ''));
  }
  
  console.log(`\n✅ Cache clearing complete!`);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

