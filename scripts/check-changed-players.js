#!/usr/bin/env node

/**
 * Check for players/teams with changed stats
 * Runs at 10 PM to identify which players played today
 * 
 * Usage:
 *   node scripts/check-changed-players.js
 */

const https = require('https');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BDL_API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Get current NBA season
function currentNbaSeason() {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 9 && day >= 15) return now.getFullYear();
  return month >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

// Fetch from API
function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(BDL_API_KEY ? { 'Authorization': BDL_API_KEY.startsWith('Bearer ') ? BDL_API_KEY : `Bearer ${BDL_API_KEY}` } : {})
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Get players who played in games today/yesterday
async function getPlayersWhoPlayed() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const startDate = yesterday.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];
  
  console.log(`Checking games from ${startDate} to ${endDate}...`);
  
  try {
    // Fetch games from BDL API
    const gamesUrl = `https://api.balldontlie.io/v1/games?start_date=${startDate}&end_date=${endDate}&per_page=100`;
    const gamesData = await fetchAPI(gamesUrl);
    
    if (!gamesData || !gamesData.data || gamesData.data.length === 0) {
      console.log('No games found for today/yesterday');
      return { playerIds: [], teamAbbrs: [] };
    }
    
    // Filter for completed games
    const completedGames = gamesData.data.filter((game) => {
      const status = String(game?.status || '').toLowerCase();
      return status.includes('final') || status.includes('completed');
    });
    
    if (completedGames.length === 0) {
      console.log('No completed games found');
      return { playerIds: [], teamAbbrs: [] };
    }
    
    console.log(`Found ${completedGames.length} completed games`);
    
    // Get unique team abbreviations
    const teamAbbrs = new Set();
    completedGames.forEach(game => {
      if (game.home_team?.abbreviation) teamAbbrs.add(game.home_team.abbreviation);
      if (game.visitor_team?.abbreviation) teamAbbrs.add(game.visitor_team.abbreviation);
    });
    
    // Fetch player stats for these games
    const gameIds = completedGames.map(g => g.id);
    const playerIds = new Set();
    
    // Fetch stats in batches (BDL API limit)
    for (let i = 0; i < gameIds.length; i += 10) {
      const batch = gameIds.slice(i, i + 10);
      const statsUrl = `https://api.balldontlie.io/v1/stats?game_ids[]=${batch.join('&game_ids[]=')}&per_page=100`;
      
      try {
        const statsData = await fetchAPI(statsUrl);
        if (statsData?.data) {
          statsData.data.forEach(stat => {
            if (stat.player?.id) {
              playerIds.add(stat.player.id);
            }
          });
        }
      } catch (error) {
        console.warn(`Failed to fetch stats for batch: ${error.message}`);
      }
      
      // Small delay to avoid rate limiting
      if (i + 10 < gameIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Found ${playerIds.size} players who played`);
    console.log(`Found ${teamAbbrs.size} teams that played`);
    
    return {
      playerIds: Array.from(playerIds),
      teamAbbrs: Array.from(teamAbbrs)
    };
    
  } catch (error) {
    console.error(`Error fetching games/stats: ${error.message}`);
    return { playerIds: [], teamAbbrs: [] };
  }
}

// Save changed players/teams to Supabase for the update script
async function saveChangedPlayers(playerIds, teamAbbrs) {
  const cacheKey = 'cache_refresh_queue';
  const data = {
    playerIds: playerIds,
    teamAbbrs: teamAbbrs,
    checkedAt: new Date().toISOString(),
    season: currentNbaSeason()
  };
  
  const { error } = await supabase
    .from('nba_api_cache')
    .upsert({
      cache_key: cacheKey,
      cache_type: 'refresh_queue',
      data: data,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }, { onConflict: 'cache_key' });
  
  if (error) {
    console.error(`Failed to save refresh queue: ${error.message}`);
    return false;
  }
  
  console.log(`✅ Saved refresh queue: ${playerIds.length} players, ${teamAbbrs.length} teams`);
  return true;
}

// Main function
async function main() {
  console.log('========================================');
  console.log('Checking for Changed Players/Teams');
  console.log('========================================');
  console.log('');
  
  const { playerIds, teamAbbrs } = await getPlayersWhoPlayed();
  
  if (playerIds.length === 0 && teamAbbrs.length === 0) {
    console.log('No players/teams to refresh');
    return;
  }
  
  await saveChangedPlayers(playerIds, teamAbbrs);
  
  console.log('');
  console.log('✅ Check complete!');
  console.log(`   Players to refresh: ${playerIds.length}`);
  console.log(`   Teams to refresh: ${teamAbbrs.length}`);
  console.log('');
  console.log('The update script will refresh these at midnight.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };

