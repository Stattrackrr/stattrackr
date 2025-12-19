/**
 * Test script to verify tipoff time calculation
 * Run with: node scripts/test-tipoff-calculation.js
 */

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

/**
 * Get today's date in US Eastern Time
 */
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

/**
 * Get Eastern timezone offset in minutes for a given date
 */
function getEasternOffsetMinutes(date) {
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDst = date.getTimezoneOffset() < stdOffset;
  const startDst = new Date(date.getFullYear(), 2, 14 - (1 + new Date(date.getFullYear(), 2, 1).getDay()) % 7);
  const endDst = new Date(date.getFullYear(), 10, 7 - (1 + new Date(date.getFullYear(), 10, 1).getDay()) % 7);
  const isDstActive = date >= startDst && date < endDst;
  return isDstActive ? -240 : -300;
}

/**
 * Parse tipoff time from BallDon'tLie game data
 */
function parseBallDontLieTipoff(game) {
  if (!game) return null;
  const iso = String(game?.date || '');
  if (!iso) return null;
  const status = String(game?.status || '');
  const datePart = iso.split('T')[0];
  if (!datePart) return null;

  const timeMatch = status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
  if (!timeMatch) {
    const fallback = new Date(iso);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  const baseDate = new Date(iso);
  const offsetMinutes = getEasternOffsetMinutes(baseDate);
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes <= 0 ? '-' : '+';
  const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

  const zonedIso = `${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetStr}`;
  const parsed = new Date(zonedIso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calculate tipoff time for a game using the same logic as the props page
 */
function calculateTipoffTime(game) {
  if (!game) return null;
  
  const now = Date.now();
  let tipoffDate = null;
  
  console.log(`  📋 Game data:`, {
    datetime: game.datetime,
    status: game.status,
    date: game.date,
    commenceTime: game.commenceTime,
  });
  
  // First, try to use the datetime field from the game object (most reliable)
  if (game.datetime) {
    const gameDateTime = new Date(game.datetime);
    if (!Number.isNaN(gameDateTime.getTime()) && gameDateTime.getTime() > now) {
      tipoffDate = gameDateTime;
      console.log(`  ✅ Using datetime field: ${tipoffDate.toISOString()}`);
    }
  }
  
  // If that didn't work, check if status is a valid ISO timestamp
  if (!tipoffDate && game.status) {
    const statusTime = Date.parse(game.status);
    if (!Number.isNaN(statusTime)) {
      const parsedStatus = new Date(statusTime);
      const isMidnight = parsedStatus.getUTCHours() === 0 && parsedStatus.getUTCMinutes() === 0 && parsedStatus.getUTCSeconds() === 0;
      
      if (parsedStatus.getTime() > now && !isMidnight && parsedStatus.getTime() < now + (7 * 24 * 60 * 60 * 1000)) {
        tipoffDate = parsedStatus;
        console.log(`  ✅ Using status as ISO timestamp: ${tipoffDate.toISOString()}`);
      }
    }
  }
  
  // Try to parse tipoff from status (this extracts time from status like "7:00 PM")
  if (!tipoffDate) {
    tipoffDate = parseBallDontLieTipoff(game);
    
    if (tipoffDate) {
      const isMidnight = tipoffDate.getUTCHours() === 0 && tipoffDate.getUTCMinutes() === 0 && tipoffDate.getUTCSeconds() === 0;
      if (isMidnight && game.status) {
        const timeMatch = game.status.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
        if (timeMatch) {
          const gameDateStr = game.date?.split('T')[0] || new Date().toISOString().split('T')[0];
          let hour = parseInt(timeMatch[1], 10);
          const minute = parseInt(timeMatch[2], 10);
          const meridiem = timeMatch[3].toUpperCase();
          if (meridiem === 'PM' && hour !== 12) hour += 12;
          else if (meridiem === 'AM' && hour === 12) hour = 0;
          
          const baseDate = new Date(gameDateStr);
          const tipoff = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0);
          
          if (tipoff.getTime() <= now) {
            tipoff.setDate(tipoff.getDate() + 1);
          }
          
          tipoffDate = tipoff;
          console.log(`  ✅ Using extracted time from status: ${tipoffDate.toISOString()}`);
        }
      } else {
        console.log(`  ✅ Using parseBallDontLieTipoff: ${tipoffDate.toISOString()}`);
      }
    }
  }
  
  // Last resort: use game.date with 7:30 PM local time
  if (!tipoffDate && game.date) {
    const dateStr = game.date.split('T')[0];
    if (dateStr) {
      const localDate = new Date(dateStr);
      localDate.setHours(19, 30, 0, 0);
      if (localDate.getTime() <= now) {
        localDate.setDate(localDate.getDate() + 1);
      }
      tipoffDate = localDate;
      console.log(`  ✅ Using fallback 7:30 PM: ${tipoffDate.toISOString()}`);
    }
  }
  
  // Also try parsing from commenceTime (from odds cache)
  if (!tipoffDate && game.commenceTime) {
    const commenceStr = String(game.commenceTime).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      const [y, m, d] = commenceStr.split('-').map(Number);
      const etDateStr = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}T19:30:00`;
      tipoffDate = new Date(etDateStr + '-05:00');
      if (m >= 3 && m <= 11) {
        tipoffDate = new Date(etDateStr + '-04:00');
      }
      console.log(`  ✅ Using commenceTime (date-only) with 7:30 PM ET: ${tipoffDate.toISOString()}`);
    } else {
      tipoffDate = new Date(commenceStr);
      console.log(`  ✅ Using commenceTime (with time): ${tipoffDate.toISOString()}`);
    }
  }
  
  if (!tipoffDate) {
    console.log(`  ❌ Could not calculate tipoff time`);
  } else if (tipoffDate.getTime() <= now) {
    console.log(`  ⚠️ Calculated tipoff is in the past: ${tipoffDate.toISOString()}`);
    return null;
  }
  
  return tipoffDate;
}

/**
 * Get cache from Supabase
 */
async function getCache(key) {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at, updated_at')
      .eq('cache_key', key)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      return null;
    }
    
    return data.data;
  } catch (e) {
    console.error(`Error getting cache:`, e.message);
    return null;
  }
}

/**
 * Fetch games from BDL API
 */
async function fetchBDLGames(dateStr) {
  if (!BALLDONTLIE_API_KEY) {
    console.error('❌ BALLDONTLIE_API_KEY not set');
    return null;
  }

  try {
    const url = `https://api.balldontlie.io/v1/games?dates[]=${dateStr}`;
    console.log(`🌐 Fetching games from BDL API for ${dateStr}...`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`❌ BDL API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data.data || [];
  } catch (e) {
    console.error(`❌ Error fetching BDL games:`, e.message);
    return null;
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('🧪 Testing Tipoff Time Calculation\n');
  console.log(`⏰ Current time: ${new Date().toISOString()}`);
  console.log(`📅 Today (US ET): ${getUSEasternDateString(new Date())}\n`);

  // Get odds cache
  console.log('📦 Step 1: Getting odds cache...');
  const oddsCache = await getCache(ODDS_CACHE_KEY);
  
  if (!oddsCache) {
    console.error('❌ No odds cache found');
    process.exit(1);
  }
  
  console.log(`✅ Found odds cache with ${oddsCache.games?.length || 0} games\n`);

  // Get today's games from odds cache
  const todayUSET = getUSEasternDateString(new Date());
  const todayGames = oddsCache.games?.filter((game) => {
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
  }) || [];

  console.log(`📊 Step 2: Found ${todayGames.length} games for today (${todayUSET})\n`);

  if (todayGames.length === 0) {
    console.log('ℹ️ No games today - nothing to test');
    process.exit(0);
  }

  // Fetch BDL games
  console.log('📦 Step 3: Fetching games from BDL API...');
  const bdlGames = await fetchBDLGames(todayUSET);
  
  if (!bdlGames || bdlGames.length === 0) {
    console.log('⚠️ No BDL games found, testing with odds cache data only\n');
  } else {
    console.log(`✅ Found ${bdlGames.length} games from BDL API\n`);
  }

  // Test tipoff calculation for each game
  console.log('🧪 Step 4: Testing tipoff calculation for each game...\n');
  
  let latestTipoff = null;
  const tipoffResults = [];

  for (let i = 0; i < todayGames.length; i++) {
    const oddsGame = todayGames[i];
    console.log(`\n🎮 Game ${i + 1}: ${oddsGame.awayTeam} @ ${oddsGame.homeTeam}`);
    console.log(`   Game ID: ${oddsGame.gameId}`);
    console.log(`   CommenceTime: ${oddsGame.commenceTime}`);

    // Try to find matching BDL game
    let bdlGame = null;
    if (bdlGames && bdlGames.length > 0) {
      bdlGame = bdlGames.find((g) => {
        const homeTeam = g.home_team?.abbreviation || g.home_team?.full_name;
        const awayTeam = g.visitor_team?.abbreviation || g.visitor_team?.full_name;
        const oddsHome = oddsGame.homeTeam?.toUpperCase();
        const oddsAway = oddsGame.awayTeam?.toUpperCase();
        const bdlHome = homeTeam?.toUpperCase();
        const bdlAway = awayTeam?.toUpperCase();
        
        return (oddsHome === bdlHome && oddsAway === bdlAway) ||
               (oddsHome === bdlAway && oddsAway === bdlHome);
      });
    }

    // Use BDL game data if available, otherwise use odds game
    const gameToTest = bdlGame || oddsGame;
    
    if (bdlGame) {
      console.log(`   ✅ Matched with BDL game (ID: ${bdlGame.id})`);
    } else {
      console.log(`   ⚠️ No BDL match, using odds cache data`);
    }

    const tipoffDate = calculateTipoffTime(gameToTest);
    
    if (tipoffDate) {
      const minutesUntil = (tipoffDate.getTime() - Date.now()) / (60 * 1000);
      const hoursUntil = minutesUntil / 60;
      
      console.log(`   🎯 Calculated Tipoff: ${tipoffDate.toISOString()}`);
      console.log(`   ⏱️ Time until tipoff: ${hoursUntil.toFixed(1)} hours (${minutesUntil.toFixed(0)} minutes)`);
      
      if (tipoffDate > Date.now()) {
        console.log(`   ✅ Tipoff is in the future`);
      } else {
        console.log(`   ⚠️ Tipoff is in the past`);
      }
      
      tipoffResults.push({
        game: `${oddsGame.awayTeam} @ ${oddsGame.homeTeam}`,
        tipoff: tipoffDate,
        minutesUntil: minutesUntil,
      });
      
      if (!latestTipoff || tipoffDate > latestTipoff) {
        latestTipoff = tipoffDate;
      }
    } else {
      console.log(`   ❌ Could not calculate tipoff time`);
      tipoffResults.push({
        game: `${oddsGame.awayTeam} @ ${oddsGame.homeTeam}`,
        tipoff: null,
        minutesUntil: null,
      });
    }
  }

  // Summary
  console.log('\n\n📊 SUMMARY\n');
  console.log('='.repeat(60));
  
  if (latestTipoff) {
    const minutesUntil = (latestTipoff.getTime() - Date.now()) / (60 * 1000);
    const hoursUntil = minutesUntil / 60;
    
    console.log(`🎯 Latest Tipoff: ${latestTipoff.toISOString()}`);
    console.log(`⏱️ Time until latest tipoff: ${hoursUntil.toFixed(1)} hours (${minutesUntil.toFixed(0)} minutes)`);
    
    if (latestTipoff > Date.now()) {
      console.log(`✅ Latest tipoff is in the future - odds refresh will trigger when it passes`);
    } else {
      console.log(`⚠️ Latest tipoff has already passed - odds refresh should trigger now`);
    }
  } else {
    console.log(`❌ Could not calculate latest tipoff`);
  }
  
  console.log('\n📋 All Games:');
  tipoffResults.forEach((result, i) => {
    if (result.tipoff) {
      const hours = (result.minutesUntil / 60).toFixed(1);
      console.log(`   ${i + 1}. ${result.game}: ${result.tipoff.toISOString()} (${hours}h)`);
    } else {
      console.log(`   ${i + 1}. ${result.game}: ❌ Could not calculate`);
    }
  });
  
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});








