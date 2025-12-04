/**
 * Get today's NBA starters using balldontlie.io API
 * 
 * Usage:
 *   node scripts/get-todays-starters.js              # Get today's starters
 *   node scripts/get-todays-starters.js 2025-12-01   # Get starters for a specific date
 * 
 * Note: balldontlie.io API only provides starters for games that have started.
 * For projected starters before games begin, you'd need to use other sources.
 * 
 * The script determines starters by finding the 5 players with the most minutes played
 * from either the boxscore (if available) or game stats.
 */

require('dotenv').config({ path: '.env.local' });
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  console.error('❌ BALLDONTLIE_API_KEY not found in environment');
  process.exit(1);
}

const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'StatTrackr/1.0',
  'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
};

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a game has started based on status
 */
function hasGameStarted(status) {
  if (!status) return false;
  
  // If status is "Final" or contains "Final", game is finished
  if (typeof status === 'string' && status.toLowerCase().includes('final')) {
    return true;
  }
  
  // If status is a datetime string, check if it's in the past
  if (typeof status === 'string' && status.includes('T')) {
    try {
      const gameTime = new Date(status);
      const now = new Date();
      // Game has started if game time is more than 2 hours in the past
      // (allowing for games that just started)
      return gameTime < new Date(now.getTime() - 2 * 60 * 60 * 1000);
    } catch (e) {
      // If we can't parse, assume not started
      return false;
    }
  }
  
  // Default: assume not started
  return false;
}

/**
 * Parse minutes string (e.g., "25:30" or "25") to total seconds
 */
function parseMinutesToSeconds(minStr) {
  if (!minStr || minStr === '0' || minStr === '') return 0;
  const parts = minStr.split(':');
  const minutes = parseInt(parts[0] || '0', 10);
  const seconds = parseInt(parts[1] || '0', 10);
  return minutes * 60 + seconds;
}

/**
 * Determine starters from boxscore players
 * Starters are typically the 5 players with the most minutes played
 */
function getStartersFromBoxscore(players) {
  if (!Array.isArray(players) || players.length === 0) return [];
  
  // Sort players by minutes played (descending)
  const playersWithMinutes = players
    .map(player => ({
      player: player.player,
      min: player.min || '0:00',
      minutesInSeconds: parseMinutesToSeconds(player.min),
      stats: player
    }))
    .filter(p => p.player) // Filter out players without player info
    .sort((a, b) => b.minutesInSeconds - a.minutesInSeconds);
  
  // Return top 5 players (starters)
  return playersWithMinutes.slice(0, 5).map(p => ({
    id: p.player.id,
    first_name: p.player.first_name,
    last_name: p.player.last_name,
    position: p.player.position,
    minutes: p.min,
    minutesInSeconds: p.minutesInSeconds
  }));
}

/**
 * Determine starters from game stats
 * Starters are typically the 5 players with the most minutes played per team
 */
function getStartersFromStats(stats, teamId) {
  if (!Array.isArray(stats) || stats.length === 0) return [];
  
  // Filter stats for the specific team and sort by minutes
  const teamStats = stats
    .filter(stat => stat.team?.id === teamId && stat.player)
    .map(stat => ({
      player: stat.player,
      min: stat.min || '0:00',
      minutesInSeconds: parseMinutesToSeconds(stat.min),
      stats: stat
    }))
    .sort((a, b) => b.minutesInSeconds - a.minutesInSeconds);
  
  // Return top 5 players (starters)
  return teamStats.slice(0, 5).map(p => ({
    id: p.player.id,
    first_name: p.player.first_name,
    last_name: p.player.last_name,
    position: p.player.position,
    minutes: p.min,
    minutesInSeconds: p.minutesInSeconds
  }));
}

/**
 * Fetch games for today
 */
async function fetchTodaysGames(date) {
  const url = `${BDL_BASE}/games?dates[]=${date}&per_page=100`;
  console.log(`\n📅 Fetching games for ${date}...`);
  console.log(`   URL: ${url}`);
  
  try {
    const response = await fetch(url, { headers: BDL_HEADERS });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    const games = Array.isArray(data?.data) ? data.data : [];
    console.log(`   ✅ Found ${games.length} game(s)`);
    return games;
  } catch (error) {
    console.error(`   ❌ Error fetching games:`, error.message);
    throw error;
  }
}

/**
 * Fetch stats for a specific game to determine starters
 * Starters are typically the 5 players with the most minutes played
 */
async function fetchGameStats(gameId) {
  const url = `${BDL_BASE}/stats?game_ids[]=${gameId}&per_page=100`;
  
  try {
    const response = await fetch(url, { headers: BDL_HEADERS });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    const stats = Array.isArray(data?.data) ? data.data : [];
    return stats;
  } catch (error) {
    console.error(`   ❌ Error fetching stats for game ${gameId}:`, error.message);
    return null;
  }
}

/**
 * Fetch boxscore for a specific game (if available)
 * According to OpenAPI spec, the endpoint is /nba/v1/boxscore
 */
async function fetchBoxscore(gameId) {
  // Try the OpenAPI spec path first: /nba/v1/boxscore
  let url = `${BDL_BASE.replace('/v1', '/nba/v1')}/boxscore?game_ids[]=${gameId}`;
  
  try {
    let response = await fetch(url, { headers: BDL_HEADERS });
    
    // If 404, try the alternative path without /nba
    if (response.status === 404) {
      url = `${BDL_BASE}/boxscore?game_ids[]=${gameId}`;
      response = await fetch(url, { headers: BDL_HEADERS });
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    // Boxscore endpoint returns array of boxscores
    const boxscore = Array.isArray(data?.data) ? data.data[0] : data?.data;
    return boxscore;
  } catch (error) {
    // Boxscore might not be available, that's okay
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  // Allow date to be passed as command line argument for testing
  const dateArg = process.argv[2];
  const targetDate = dateArg || getTodayDate();
  
  console.log(`\n🏀 Fetching starters for NBA slate (${targetDate})\n`);
  
  try {
    // Fetch games for the target date
    const games = await fetchTodaysGames(targetDate);
    
    if (games.length === 0) {
      console.log('\n📭 No games scheduled for today.');
      return;
    }
    
    // Process each game
    const results = [];
    
    for (const game of games) {
      const homeTeam = game.home_team;
      const visitorTeam = game.visitor_team;
      const gameId = game.id;
      const status = game.status || 'Scheduled';
      
      console.log(`\n🎮 Game ${gameId}: ${visitorTeam?.abbreviation || 'TBD'} @ ${homeTeam?.abbreviation || 'TBD'}`);
      console.log(`   Status: ${status}`);
      
      // Check if game has started
      // Note: balldontlie.io API only provides boxscore/stats for games that have started
      // For projected starters before games start, you'd need to use other sources (ESPN, Rotowire, etc.)
      const gameStarted = hasGameStarted(status);
      
      if (!gameStarted) {
        console.log(`   ⏳ Game not started yet - starters not available from balldontlie.io`);
        console.log(`   💡 Note: balldontlie.io only provides starters after games begin`);
        results.push({
          game_id: gameId,
          date: game.date,
          home_team: homeTeam?.abbreviation || 'TBD',
          visitor_team: visitorTeam?.abbreviation || 'TBD',
          status: status,
          home_starters: null,
          visitor_starters: null,
          note: 'Game not started - balldontlie.io only provides starters after games begin'
        });
        continue;
      }
      
      // Try to fetch boxscore first (more reliable for starters)
      console.log(`   📊 Fetching boxscore...`);
      let boxscore = await fetchBoxscore(gameId);
      
      let homeStarters = [];
      let visitorStarters = [];
      
      if (boxscore && boxscore.home_team && boxscore.visitor_team) {
        // Extract starters from boxscore
        const homePlayers = boxscore.home_team?.players || [];
        const visitorPlayers = boxscore.visitor_team?.players || [];
        
        homeStarters = getStartersFromBoxscore(homePlayers);
        visitorStarters = getStartersFromBoxscore(visitorPlayers);
      } else {
        // Fallback: use stats endpoint to determine starters
        console.log(`   📊 Boxscore not available, trying stats endpoint...`);
        const gameStats = await fetchGameStats(gameId);
        
        if (gameStats && gameStats.length > 0 && homeTeam?.id && visitorTeam?.id) {
          homeStarters = getStartersFromStats(gameStats, homeTeam.id);
          visitorStarters = getStartersFromStats(gameStats, visitorTeam.id);
        } else {
          console.log(`   ⚠️  Stats not available yet`);
          results.push({
            game_id: gameId,
            date: game.date,
            home_team: homeTeam?.abbreviation || 'TBD',
            visitor_team: visitorTeam?.abbreviation || 'TBD',
            status: status,
            home_starters: null,
            visitor_starters: null,
            note: 'Game stats not available yet'
          });
          continue;
        }
      }
      
      console.log(`   ✅ Home starters (${homeTeam?.abbreviation || 'TBD'}):`);
      homeStarters.forEach((starter, idx) => {
        console.log(`      ${idx + 1}. ${starter.first_name} ${starter.last_name} (${starter.position || 'N/A'}) - ${starter.minutes}`);
      });
      
      console.log(`   ✅ Visitor starters (${visitorTeam?.abbreviation || 'TBD'}):`);
      visitorStarters.forEach((starter, idx) => {
        console.log(`      ${idx + 1}. ${starter.first_name} ${starter.last_name} (${starter.position || 'N/A'}) - ${starter.minutes}`);
      });
      
      results.push({
        game_id: gameId,
        date: game.date,
        home_team: homeTeam?.abbreviation || 'TBD',
        visitor_team: visitorTeam?.abbreviation || 'TBD',
        status: status,
        home_starters: homeStarters,
        visitor_starters: visitorStarters
      });
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Print summary
    console.log(`\n\n📋 SUMMARY`);
    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`Date: ${targetDate}`);
    console.log(`Total Games: ${games.length}`);
    console.log(`Games with Starters: ${results.filter(r => r.home_starters && r.visitor_starters).length}`);
    console.log(`\n`);
    
    // Print formatted results
    results.forEach(result => {
      console.log(`\n${result.visitor_team} @ ${result.home_team} (Game ID: ${result.game_id})`);
      console.log(`Status: ${result.status}`);
      
      if (result.home_starters && result.visitor_starters) {
        console.log(`\n  ${result.home_team} Starters:`);
        result.home_starters.forEach((s, i) => {
          console.log(`    ${i + 1}. ${s.first_name} ${s.last_name} (${s.position || 'N/A'})`);
        });
        
        console.log(`\n  ${result.visitor_team} Starters:`);
        result.visitor_starters.forEach((s, i) => {
          console.log(`    ${i + 1}. ${s.first_name} ${s.last_name} (${s.position || 'N/A'})`);
        });
      } else {
        console.log(`  ${result.note || 'Starters not available'}`);
      }
    });
    
    // Save to JSON file
    const fs = require('fs');
    const outputFile = `data/todays-starters-${targetDate}.json`;
    const outputDir = 'data';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputFile, JSON.stringify({
      date: targetDate,
      games: results
    }, null, 2));
    console.log(`\n💾 Results saved to: ${outputFile}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

