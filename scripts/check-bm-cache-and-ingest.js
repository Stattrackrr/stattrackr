require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !BALLDONTLIE_API_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Get today's date in local timezone (YYYY-MM-DD)
 * Note: BasketballMonsters cache keys use Eastern Time, but we check local date
 * and then convert to Eastern when looking up cache keys
 */
function getTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert local date to Eastern Time date (for cache key lookup)
 */
function localToEasternDate(localDateStr) {
  // Parse local date and convert to Eastern
  const [year, month, day] = localDateStr.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0); // Noon to avoid DST issues
  const easternTime = new Date(localDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const easternYear = easternTime.getFullYear();
  const easternMonth = String(easternTime.getMonth() + 1).padStart(2, '0');
  const easternDay = String(easternTime.getDate()).padStart(2, '0');
  return `${easternYear}-${easternMonth}-${easternDay}`;
}

/**
 * Check cache for BasketballMonsters lineup
 */
async function checkCache(teamAbbr, date) {
  const cacheKey = `basketballmonsters:lineup:${teamAbbr.toUpperCase()}:${date}`;
  
  try {
    const { data, error } = await supabase
      .from('nba_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .eq('cache_type', 'basketballmonsters_lineup')
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      console.error(`   Error checking cache: ${error.message}`);
      return null;
    }
    
    if (data) {
      return JSON.parse(data.cache_data || '[]');
    }
    
    return null;
  } catch (error) {
    console.error(`   Error: ${error.message}`);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  const todayLocal = getTodayLocal();
  const todayEastern = localToEasternDate(todayLocal);
  
  console.log(`\n🔍 Checking BasketballMonsters cache and triggering ingest`);
  console.log(`   Local date: ${todayLocal}`);
  console.log(`   Eastern date (for cache): ${todayEastern}\n`);
  console.log('='.repeat(60));
  
  // Fetch games for local date (BDL API uses dates as provided)
  const gamesUrl = `https://api.balldontlie.io/v1/games?dates[]=${todayLocal}&per_page=100`;
  
  console.log(`\n📡 Fetching games from Ball Don't Lie API...`);
  const gamesResponse = await fetch(gamesUrl, {
    headers: {
      'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`
    }
  });
  
  if (!gamesResponse.ok) {
    console.error(`❌ Failed to fetch games: ${gamesResponse.status}`);
    process.exit(1);
  }
  
  const gamesData = await gamesResponse.json();
  const games = gamesData.data || [];
  
  if (games.length === 0) {
    console.log(`\n✅ No games found for ${today}`);
    return;
  }
  
  console.log(`\n📊 Found ${games.length} game(s) today\n`);
  
  const teamsToIngest = new Set();
  
  for (const game of games) {
    const homeTeam = game.home_team?.abbreviation;
    const visitorTeam = game.visitor_team?.abbreviation;
    const gameStatus = game.status || 'Scheduled';
    
    if (!homeTeam || !visitorTeam) continue;
    
    console.log(`\n🏀 ${visitorTeam} @ ${homeTeam} (${gameStatus})`);
    
    // Check cache using Eastern Time date (cache keys use Eastern Time)
    const homeCache = await checkCache(homeTeam, todayEastern);
    const visitorCache = await checkCache(visitorTeam, todayEastern);
    
    console.log(`   ${homeTeam}: ${homeCache ? `✅ Cached (${homeCache.length} players)` : '❌ Not cached'}`);
    console.log(`   ${visitorTeam}: ${visitorCache ? `✅ Cached (${visitorCache.length} players)` : '❌ Not cached'}`);
    
    // If game is final and cache exists, add to ingest list
    if (gameStatus.toLowerCase().includes('final')) {
      if (homeCache && homeCache.length === 5) {
        teamsToIngest.add(homeTeam);
      }
      if (visitorCache && visitorCache.length === 5) {
        teamsToIngest.add(visitorTeam);
      }
    }
  }
  
  // Show all teams that played today (for manual ingest)
  const allTeams = new Set();
  for (const game of games) {
    if (game.home_team?.abbreviation) allTeams.add(game.home_team.abbreviation);
    if (game.visitor_team?.abbreviation) allTeams.add(game.visitor_team.abbreviation);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n📋 Summary:\n`);
  console.log(`   Teams that played today: ${Array.from(allTeams).join(', ')}`);
  console.log(`   Teams with cached BM lineups: ${Array.from(teamsToIngest).join(', ') || 'None'}`);
  
  // Always show ingest commands, even if cache not found
  if (allTeams.size > 0) {
    console.log(`\n🔄 To manually trigger ingest for today's games:\n`);
    const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
    
    for (const team of allTeams) {
      const hasCache = teamsToIngest.has(team);
      const cacheStatus = hasCache ? '✅' : '⚠️ ';
      console.log(`   ${cacheStatus} ${PROD_URL}/api/dvp/ingest-nba?team=${team}&latest=1`);
    }
    
    console.log(`\n   Or ingest all teams at once:`);
    console.log(`   ${PROD_URL}/api/dvp/ingest-nba-all?latest=1`);
  }
  
  // Auto-trigger if requested
  if (process.argv.includes('--ingest') && teamsToIngest.size > 0) {
    console.log(`\n🔄 Auto-triggering ingest for teams with cached lineups...\n`);
    
    const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
    const protocol = PROD_URL.includes('localhost') ? 'http' : 'https';
    const baseUrl = PROD_URL.replace(/^https?:\/\//, '');
    
    for (const team of teamsToIngest) {
      console.log(`   Ingesting ${team}...`);
      try {
        const url = `${protocol}://${baseUrl}/api/dvp/ingest-nba?team=${team}&latest=1`;
        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json();
        
        if (data.success || data.stored_games > 0) {
          console.log(`   ✅ ${team}: Success (${data.stored_games || 0} games stored)`);
        } else {
          console.log(`   ⚠️  ${team}: ${data.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.log(`   ❌ ${team}: ${error.message}`);
      }
    }
  }
  
  console.log(`\n${'='.repeat(60)}\n`);
}

main().catch(console.error);

