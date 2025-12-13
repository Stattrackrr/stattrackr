/**
 * Clear all caches (player props + odds)
 * Usage: node scripts/clear-all-caches.js
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

async function clearCache(cacheKey) {
  console.log(`🧹 Clearing cache: ${cacheKey}`);
  
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
  console.log('🧹 Starting full cache clear...\n');
  
  // 1. Clear odds cache
  console.log('📊 Clearing odds cache...');
  const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
  const ODDS_STAGING_KEY = 'all_nba_odds_v2_bdl_staging';
  await clearCache(ODDS_CACHE_KEY);
  await clearCache(ODDS_STAGING_KEY);
  console.log('');
  
  // 2. Clear player props cache for today and tomorrow
  const todayUSET = getUSEasternDateString(new Date());
  const [year, month, day] = todayUSET.split('-').map(Number);
  const tomorrowDate = new Date(year, month - 1, day + 1);
  const tomorrowUSET = getUSEasternDateString(tomorrowDate);
  
  console.log(`📅 Today (US ET): ${todayUSET}`);
  console.log(`📅 Tomorrow (US ET): ${tomorrowUSET}\n`);
  
  console.log('📊 Clearing player props cache...');
  await clearCache(`nba-player-props-${todayUSET}`);
  await clearCache(`nba-player-props-${tomorrowUSET}`);
  console.log('');
  
  // 3. Clear checkpoints
  console.log('📊 Clearing checkpoints...');
  await clearCache(`nba-player-props-checkpoint-${todayUSET}`);
  await clearCache(`nba-player-props-checkpoint-${tomorrowUSET}`);
  console.log('');
  
  console.log('✅ All caches cleared successfully!');
  console.log('\n💡 Next steps:');
  console.log('   1. Trigger odds refresh: GET /api/odds/refresh');
  console.log('   2. Run GitHub Actions workflow for player props processing');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

