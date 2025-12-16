/**
 * Test script to verify tipoff checking and workflow triggering logic
 * Run with: node scripts/test-tipoff-logic.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  console.log('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

async function getOddsCache() {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at')
      .eq('cache_key', 'all_nba_odds_v2_bdl')
      .single();
    
    if (error || !data) {
      console.log('⚠️ No odds cache found');
      return null;
    }
    
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      console.log('⚠️ Odds cache expired');
      return null;
    }
    
    return data.data;
  } catch (e) {
    console.error('❌ Error fetching odds cache:', e.message);
    return null;
  }
}

function simulateTipoffCheck(oddsCache, testTime = null) {
  const now = testTime ? new Date(testTime) : new Date();
  const todayUSET = getUSEasternDateString(now);
  
  console.log(`\n📅 Test Time: ${now.toISOString()}`);
  console.log(`📅 Today (US ET): ${todayUSET}`);
  
  if (!oddsCache?.games || !Array.isArray(oddsCache.games)) {
    console.log('⚠️ No games in odds cache');
    return null;
  }

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

  console.log(`\n🎮 Found ${todayGames.length} games for today`);
  
  if (todayGames.length === 0) {
    console.log('⚠️ No games today - would not trigger');
    return null;
  }

  // Find last tipoff (only games with actual times)
  let lastTipoff = null;
  let gamesWithTimes = 0;
  let gamesWithoutTimes = 0;

  for (const game of todayGames) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gamesWithoutTimes++;
      console.log(`  ⏭️ Skipping date-only game: ${game.homeTeam} vs ${game.awayTeam} (${commenceStr})`);
      continue;
    }
    
    gamesWithTimes++;
    const tipoffDate = new Date(commenceStr);
    if (isNaN(tipoffDate.getTime())) {
      console.warn(`  ⚠️ Invalid tipoff time: ${commenceStr}`);
      continue;
    }
    
    console.log(`  ✅ Game with time: ${game.homeTeam} vs ${game.awayTeam} at ${tipoffDate.toISOString()} (${tipoffDate.toLocaleString('en-US', { timeZone: 'America/New_York' })})`);
    
    if (!lastTipoff || tipoffDate > lastTipoff) {
      lastTipoff = tipoffDate;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  Games with times: ${gamesWithTimes}`);
  console.log(`  Games without times: ${gamesWithoutTimes}`);

  if (!lastTipoff) {
    console.log(`\n❌ No games with actual tipoff times - would NOT trigger`);
    return null;
  }

  const tipoffTime = lastTipoff.getTime();
  const currentTime = now.getTime();
  const tenMinutesAfterTipoff = tipoffTime + (10 * 60 * 1000);

  console.log(`\n⏰ Last Tipoff: ${lastTipoff.toISOString()} (${lastTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' })})`);
  console.log(`⏰ Current Time: ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'America/New_York' })})`);
  console.log(`⏰ 10 Min After: ${new Date(tenMinutesAfterTipoff).toISOString()} (${new Date(tenMinutesAfterTipoff).toLocaleString('en-US', { timeZone: 'America/New_York' })})`);

  const timeSinceTipoff = currentTime - tipoffTime;
  const minutesSinceTipoff = Math.floor(timeSinceTipoff / (60 * 1000));
  const timeUntilTrigger = tenMinutesAfterTipoff - currentTime;
  const minutesUntilTrigger = Math.ceil(timeUntilTrigger / (60 * 1000));

  console.log(`\n📈 Status:`);
  console.log(`  Minutes since tipoff: ${minutesSinceTipoff}`);
  console.log(`  Minutes until trigger: ${minutesUntilTrigger}`);

  if (currentTime >= tenMinutesAfterTipoff) {
    console.log(`\n✅ WOULD TRIGGER - 10 minutes have passed since last tipoff`);
    return {
      shouldTrigger: true,
      lastTipoff,
      minutesSinceTipoff
    };
  } else {
    console.log(`\n⏳ WOULD NOT TRIGGER YET - Need to wait ${minutesUntilTrigger} more minutes`);
    return {
      shouldTrigger: false,
      lastTipoff,
      minutesUntilTrigger
    };
  }
}

async function testWithSimulatedTime() {
  console.log('🧪 Testing with simulated times...\n');
  
  const oddsCache = await getOddsCache();
  if (!oddsCache) {
    console.log('❌ Cannot test - no odds cache available');
    return;
  }

  // Test 1: Current time
  console.log('='.repeat(60));
  console.log('TEST 1: Current Time');
  console.log('='.repeat(60));
  const result1 = simulateTipoffCheck(oddsCache);
  
  // Test 2: Simulate 15 minutes after a 2pm tipoff
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Simulated Time (15 min after 2pm ET tipoff)');
  console.log('='.repeat(60));
  const testTime = new Date();
  testTime.setHours(14, 15, 0, 0); // 2:15pm ET
  const result2 = simulateTipoffCheck(oddsCache, testTime.toISOString());
  
  // Test 3: Simulate 5 minutes after tipoff (should NOT trigger)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Simulated Time (5 min after 2pm ET tipoff - should NOT trigger)');
  console.log('='.repeat(60));
  const testTime3 = new Date();
  testTime3.setHours(14, 5, 0, 0); // 2:05pm ET
  const result3 = simulateTipoffCheck(oddsCache, testTime3.toISOString());
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Test 1 (Current): ${result1?.shouldTrigger ? '✅ Would trigger' : '⏳ Would not trigger'}`);
  console.log(`Test 2 (15 min after): ${result2?.shouldTrigger ? '✅ Would trigger' : '⏳ Would not trigger'}`);
  console.log(`Test 3 (5 min after): ${result3?.shouldTrigger ? '✅ Would trigger' : '⏳ Would not trigger'}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node scripts/test-tipoff-logic.js [options]

Options:
  --simulate-time=ISO_STRING    Test with a specific time (e.g., "2025-01-15T14:15:00-05:00")
  --test-all                     Run all test scenarios
  --help, -h                     Show this help

Examples:
  node scripts/test-tipoff-logic.js
  node scripts/test-tipoff-logic.js --test-all
  node scripts/test-tipoff-logic.js --simulate-time="2025-01-15T14:15:00-05:00"
    `);
    process.exit(0);
  }

  if (args.includes('--test-all')) {
    await testWithSimulatedTime();
    return;
  }

  const simulateTimeArg = args.find(arg => arg.startsWith('--simulate-time='));
  const testTime = simulateTimeArg ? simulateTimeArg.split('=')[1] : null;

  console.log('🧪 Testing Tipoff Logic\n');
  
  const oddsCache = await getOddsCache();
  if (!oddsCache) {
    console.log('❌ Cannot test - no odds cache available');
    process.exit(1);
  }

  const result = simulateTipoffCheck(oddsCache, testTime);
  
  if (result) {
    console.log(`\n${result.shouldTrigger ? '✅' : '⏳'} Result: ${result.shouldTrigger ? 'WOULD TRIGGER' : 'WOULD NOT TRIGGER YET'}`);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

