/**
 * Test script to verify tipoff time calculation
 * Run: node scripts/test-tipoff-time.js
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

function findLastGameTipoff(oddsCache) {
  if (!oddsCache?.games || !Array.isArray(oddsCache.games)) {
    return null;
  }

  const todayUSET = getUSEasternDateString(new Date());
  console.log(`📅 Today (US ET): ${todayUSET}`);
  
  const todayGames = oddsCache.games.filter((game) => {
    if (!game.commenceTime) return false;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET;
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDateUSET = commenceStr;
    } else {
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    
    return gameDateUSET === todayUSET;
  });

  console.log(`\n🎮 Found ${todayGames.length} games for today\n`);

  if (todayGames.length === 0) {
    return null;
  }

  let latestTipoff = null;

  for (const game of todayGames) {
    if (!game.commenceTime) {
      console.log(`\n📋 Game: ${game.homeTeam} vs ${game.awayTeam}`);
      console.log(`   ⚠️  No commenceTime found`);
      continue;
    }
    
    const commenceStr = String(game.commenceTime).trim();
    let tipoffDate;
    
    console.log(`\n📋 Game: ${game.homeTeam} vs ${game.awayTeam}`);
    console.log(`   Raw commenceTime: "${commenceStr}"`);
    console.log(`   Type: ${typeof game.commenceTime}`);
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      // Date-only string - assume 7:00 PM ET
      const [year, month, day] = commenceStr.split('-').map(Number);
      const etDateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T19:00:00`;
      const isDST = month >= 3 && month <= 11;
      const offset = isDST ? '-04:00' : '-05:00';
      tipoffDate = new Date(etDateStr + offset);
      console.log(`   📅 Date-only detected - assuming 7:00 PM ET`);
      console.log(`   📅 Constructed: ${etDateStr}${offset}`);
      console.log(`   🕰️  Parsed as: ${tipoffDate.toISOString()}`);
      console.log(`   🕰️  In ET: ${tipoffDate.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'long' })}`);
      console.log(`   🕰️  In UTC: ${tipoffDate.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' })}`);
    } else {
      // Has time component
      tipoffDate = new Date(commenceStr);
      console.log(`   🕰️  Has time component`);
      console.log(`   🕰️  Parsed as: ${tipoffDate.toISOString()}`);
      console.log(`   🕰️  In ET: ${tipoffDate.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'long' })}`);
      console.log(`   🕰️  In UTC: ${tipoffDate.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' })}`);
    }

    if (!latestTipoff || tipoffDate > latestTipoff) {
      latestTipoff = tipoffDate;
      console.log(`   ✅ This is the latest tipoff so far`);
    } else {
      console.log(`   ⏭️  Earlier than latest tipoff`);
    }
  }

  return latestTipoff;
}

async function test() {
  console.log('🔍 Testing tipoff time calculation...\n');
  
  try {
    // Get odds cache from Supabase
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('*')
      .eq('cache_key', 'all_nba_odds_v2_bdl')
      .single();

    if (error || !data) {
      console.error('❌ Failed to fetch odds cache:', error?.message);
      console.log('\n💡 Make sure the odds refresh cron has run first!');
      return;
    }

    const oddsCache = data.cache_value;
    
    if (!oddsCache || !oddsCache.games) {
      console.error('❌ Odds cache is empty or has no games');
      console.log('\n💡 To populate the cache, run:');
      console.log('   curl http://localhost:3000/api/odds/refresh');
      console.log('   OR wait for the cron to run (every 30 minutes)');
      return;
    }

    console.log(`✅ Found odds cache with ${oddsCache.games.length} total games\n`);

    const lastTipoff = findLastGameTipoff(oddsCache);
    
    if (!lastTipoff) {
      console.log('\n❌ No games found for today');
      return;
    }

    console.log(`\n\n🎯 RESULT:`);
    console.log(`   Last tipoff: ${lastTipoff.toISOString()}`);
    console.log(`   Last tipoff (ET): ${lastTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`   Last tipoff (UTC): ${lastTipoff.toLocaleString('en-US', { timeZone: 'UTC' })}`);
    
    const now = new Date();
    const tenMinutesAfter = new Date(lastTipoff.getTime() + (10 * 60 * 1000));
    const timeUntil = tenMinutesAfter - now;
    const minutesUntil = Math.ceil(timeUntil / (60 * 1000));
    
    console.log(`\n⏰ Processing will trigger:`);
    console.log(`   At: ${tenMinutesAfter.toISOString()}`);
    console.log(`   At (ET): ${tenMinutesAfter.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`   Minutes until trigger: ${minutesUntil}`);
    
    if (now >= lastTipoff) {
      console.log(`\n✅ Last game has started!`);
      if (now >= tenMinutesAfter) {
        console.log(`✅ It's time to trigger processing!`);
      } else {
        console.log(`⏳ Waiting ${minutesUntil} more minutes...`);
      }
    } else {
      console.log(`\n⏳ Last game hasn't started yet`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();

