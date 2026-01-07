#!/usr/bin/env node

/**
 * Cache Game Filters Script
 * 
 * Pre-calculates and caches filter data for all player games:
 * - Opponent DvP ranks (locked in at game time - current rank when game was played)
 * - Opponent pace ranks (locked in at game time - current rank when game was played)
 * - Player usage rate (per game from NBA API)
 * - Player FGM (per game from game stats)
 * 
 * This data is cached so filtering on the dashboard is instant.
 * 
 * Since BettingPros doesn't provide historical DvP data, we:
 * 1. Use current DvP/pace ranks when caching
 * 2. Lock them in per game (so historical games don't change)
 * 3. Once cached, ranks stay fixed for that game
 * 
 * Usage:
 *   node scripts/cache-game-filters.js [playerId] [season]
 *   
 *   If playerId is provided, only cache that player
 *   If season is provided, use that season (default: current season)
 * 
 * Example:
 *   node scripts/cache-game-filters.js 1629029 2025  # Cache Luka Doncic for 2025 season
 *   node scripts/cache-game-filters.js                # Cache all players for current season
 */

require('dotenv').config({ path: '.env.local' });

const https = require('https');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const NBA_STATS_BASE = 'https://stats.nba.com/stats';
const BDL_BASE = 'https://api.balldontlie.io/v1';
const API_KEY = process.env.BALLDONTLIE_API_KEY;

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/stats/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

// BDL Team ID mappings (BDL uses 1-30, not NBA's large IDs)
const TEAM_ID_TO_ABBR_BDL = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};

const ABBR_TO_TEAM_ID_BDL = Object.fromEntries(
  Object.entries(TEAM_ID_TO_ABBR_BDL).map(([id, abbr]) => [abbr, parseInt(id)])
);

// NBA Team ID mappings (for NBA API calls)
const ABBR_TO_TEAM_ID_NBA = {
  'ATL': 1610612737, 'BOS': 1610612738, 'BKN': 1610612751, 'CHA': 1610612766, 'CHI': 1610612741,
  'CLE': 1610612739, 'DAL': 1610612742, 'DEN': 1610612743, 'DET': 1610612765, 'GSW': 1610612744,
  'HOU': 1610612745, 'IND': 1610612754, 'LAC': 1610612746, 'LAL': 1610612747, 'MEM': 1610612763,
  'MIA': 1610612748, 'MIL': 1610612749, 'MIN': 1610612750, 'NOP': 1610612740, 'NYK': 1610612752,
  'OKC': 1610612760, 'ORL': 1610612753, 'PHI': 1610612755, 'PHX': 1610612756, 'POR': 1610612757,
  'SAC': 1610612758, 'SAS': 1610612759, 'TOR': 1610612761, 'UTA': 1610612762, 'WAS': 1610612764
};

const TEAM_ID_TO_ABBR_NBA = Object.fromEntries(
  Object.entries(ABBR_TO_TEAM_ID_NBA).map(([abbr, id]) => [id, abbr])
);

// DvP metrics we support (matching dashboard)
const DVP_METRICS = ['pts', 'reb', 'ast', 'fg3m', 'fg_pct', 'stl', 'blk', 'to'];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Get current NBA season
function currentNbaSeason() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  // NBA season starts in October (month 9)
  return month >= 9 ? year : year - 1;
}

function formatSeason(season) {
  // NBA API expects format like "2025-26" (with zero-padded year suffix)
  const nextYear = (season + 1) % 100;
  const nextYearStr = String(nextYear).padStart(2, '0');
  return `${season}-${nextYearStr}`;
}

function formatMDY(d) {
  // Handle date strings in YYYY-MM-DD format (BDL format)
  let dt;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    // Parse as local date to avoid timezone issues
    const [year, month, day] = d.split('T')[0].split('-').map(Number);
    dt = new Date(year, month - 1, day);
  } else {
    dt = d instanceof Date ? d : new Date(d);
  }
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function normalizeAbbr(abbr) {
  return String(abbr || '').toUpperCase().trim();
}

function idx(headers, ...names) {
  for (const name of names) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Fetch from BDL API
 */
function fetchBDL(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const headers = { 'Accept': 'application/json' };
    if (API_KEY) {
      headers['Authorization'] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
    }

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`BDL API ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

/**
 * Fetch NBA Stats API using fetch (more reliable than https.request)
 */
async function fetchNBAStats(url, timeout = 30000, retries = 2) {
  let attempt = 0;
  
  while (attempt <= retries) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        headers: NBA_HEADERS,
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timer);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        if (response.status >= 500 && attempt <= retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw new Error(`NBA API ${response.status}: ${errorText.substring(0, 200)}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        if (attempt <= retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      if (attempt <= retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('All retry attempts failed');
}

/**
 * Find NBA game ID by sequential search (when scoreboard fails)
 * NBA game ID format: 00{season}{game_number} (e.g., 0022500048 for 2025-26 season, game 48)
 */
async function findGameIdBySequentialSearch(gameDate, homeTeamId, visitorTeamId, seasonYear) {
  try {
    // Calculate season prefix (e.g., 2025-26 season = 25)
    const seasonSuffix = String(seasonYear).slice(-2);
    const seasonPrefix = `00${seasonSuffix}`;
    
    const targetDate = new Date(gameDate);
    if (typeof gameDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(gameDate)) {
      const [year, month, day] = gameDate.split('T')[0].split('-').map(Number);
      targetDate.setFullYear(year, month - 1, day);
    }
    
    console.log(`      🔄 Trying sequential game ID search (format: ${seasonPrefix}XXXXX)...`);
    
    // Try game numbers 1-500 (covers full season)
    for (let gameNum = 1; gameNum <= 500; gameNum++) {
      const potentialGameId = `${seasonPrefix}${String(gameNum).padStart(5, '0')}`;
      
      try {
        const url = `${NBA_STATS_BASE}/boxscoretraditionalv2?GameID=${potentialGameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`;
        const testBs = await fetchNBAStats(url, 5000); // Shorter timeout for sequential checks
        
        const testPset = (testBs?.resultSets || []).find((r) => 
          (r?.name || '').toLowerCase().includes('playerstats') || 
          (r?.name || '').toLowerCase().includes('player')
        ) || testBs?.resultSets?.[0];
        
        if (!testPset || !testPset.rowSet || testPset.rowSet.length === 0) {
          continue; // Game doesn't exist
        }
        
        const testHeaders = testPset.headers || [];
        const testRows = testPset.rowSet || [];
        const iTeamId = idx(testHeaders, 'TEAM_ID');
        const iGameDate = idx(testHeaders, 'GAME_DATE');
        
        // Check date first (faster)
        if (iGameDate >= 0 && testRows.length > 0) {
          const gameDateStr = String(testRows[0][iGameDate] || '');
          if (gameDateStr) {
            const boxscoreDate = new Date(gameDateStr);
            if (!isNaN(boxscoreDate.getTime())) {
              // If we've passed the target date significantly, stop (games are sequential by date)
              if (boxscoreDate > targetDate && gameNum > 20) {
                const daysDiff = Math.floor((boxscoreDate.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000));
                if (daysDiff > 3) {
                  console.log(`      ⚠️ Passed target date (found ${gameDateStr}, looking for ${gameDate}), stopping search`);
                  break;
                }
              }
              
              // Check if date matches (within 1 day tolerance)
              const dateDiff = Math.abs(boxscoreDate.getTime() - targetDate.getTime());
              const dateMatches = dateDiff < 24 * 60 * 60 * 1000; // Within 1 day
              
              if (dateMatches && iTeamId >= 0) {
                // Date matches, check teams
                const teamIds = new Set(testRows.map((r) => Number(r[iTeamId])).filter(id => id > 0));
                const hasHomeTeam = teamIds.has(homeTeamId);
                const hasVisitorTeam = teamIds.has(visitorTeamId);
                
                if (hasHomeTeam && hasVisitorTeam) {
                  console.log(`      ✅ Found NBA game ID via sequential search: ${potentialGameId} (checked ${gameNum} games)`);
                  return potentialGameId;
                }
              }
            }
          }
        } else if (iTeamId >= 0) {
          // No date field, check teams directly
          const teamIds = new Set(testRows.map((r) => Number(r[iTeamId])).filter(id => id > 0));
          const hasHomeTeam = teamIds.has(homeTeamId);
          const hasVisitorTeam = teamIds.has(visitorTeamId);
          
          if (hasHomeTeam && hasVisitorTeam) {
            console.log(`      ✅ Found NBA game ID via sequential search (no date check): ${potentialGameId} (checked ${gameNum} games)`);
            return potentialGameId;
          }
        }
        
        // Progress logging
        if (gameNum % 100 === 0) {
          console.log(`      🔄 Checked ${gameNum} game IDs...`);
        }
        
        // Small delay every 20 games
        if (gameNum % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (e) {
        // Game doesn't exist or error - continue
        continue;
      }
    }
    
    console.log(`      ⚠️ Could not find game ID after checking 500 games`);
    return null;
  } catch (error) {
    console.warn(`      ⚠️ Sequential search error: ${error.message}`);
    return null;
  }
}

/**
 * Fetch team game log from NBA API (returns game IDs with dates)
 */
async function fetchTeamGameLog(teamId, seasonLabel, tryPreviousSeason = false) {
  try {
    // Direct NBA API call to teamgamelog endpoint
    const url = `${NBA_STATS_BASE}/teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=${encodeURIComponent('Regular Season')}`;
    console.log(`      ⏳ Fetching teamgamelog for team ${teamId}, season ${seasonLabel} (timeout: 30s)...`);
    const data = await fetchNBAStats(url, 30000, 2); // 30 second timeout, 2 retries
    
    // Debug: log the actual response
    if (!data) {
      console.warn(`      ⚠️ No data in response`);
      return [];
    }
    
    // Check for error messages in response
    if (data.error || data.message) {
      console.warn(`      ⚠️ API returned error:`, data.error || data.message);
    }
    
    if (!data.resultSets) {
      console.warn(`      ⚠️ No resultSets in response. Response keys:`, Object.keys(data));
      console.warn(`      ⚠️ Full response (first 500 chars):`, JSON.stringify(data).substring(0, 500));
      return [];
    }
    
    const rs = (data.resultSets || []).find((r) => 
      (r?.name || '').toLowerCase().includes('teamgamelog')
    ) || data.resultSets?.[0];
    
    if (!rs) {
      console.warn(`      ⚠️ No teamgamelog result set found. Available sets:`, data.resultSets.map(r => r?.name));
      return [];
    }
    
    const headers = rs.headers || [];
    const rows = rs.rowSet || [];
    const iGameId = idx(headers, 'GAME_ID', 'Game_ID');
    const iGameDate = idx(headers, 'GAME_DATE', 'Game_Date');
    
    if (iGameId < 0) {
      console.warn(`      ⚠️ GAME_ID column not found in headers:`, headers);
      return [];
    }
    
    console.log(`      ✅ Found ${rows.length} games in teamgamelog for season ${seasonLabel}`);
    
    // If 0 games, the API might not have data yet - log this clearly
    if (rows.length === 0) {
      console.warn(`      ⚠️ NBA API returned 0 games - data may not be available yet or API is blocking requests`);
    }
    
    // Don't try previous season automatically - if 2025-26 has no data, that's the issue
    // The API might be blocking or the data isn't available via API yet
    
    // Debug: show first few game dates if available
    if (rows.length > 0 && iGameDate >= 0) {
      const sampleDates = rows.slice(0, 3).map(r => r[iGameDate]).filter(Boolean);
      console.log(`      📅 Sample game dates:`, sampleDates);
    }
    
    // Return array of { gameId, gameDate }
    return rows.map((row) => ({
      gameId: String(row[iGameId]),
      gameDate: iGameDate >= 0 ? String(row[iGameDate] || '') : null
    })).filter(g => g.gameId);
  } catch (error) {
    console.warn(`      ⚠️ Error fetching team game log for team ${teamId}:`, error.message);
    return [];
  }
}

/**
 * Get NBA game ID from BDL game date and teams
 * Uses teamgamelog endpoint for faster lookup
 */
async function getNBAGameId(gameDate, playerTeamId, opponentTeamId, seasonYear, teamGameLogCache) {
  try {
    // Since teamgamelog is returning 0 games, construct game ID from date pattern
    // Format: 00225XXXXX where 25 = season (2025-26), XXXXX = game number
    // Games are roughly sequential by date, so we can estimate based on date
    
    const targetDate = typeof gameDate === 'string' ? new Date(gameDate) : new Date(gameDate);
    const seasonSuffix = String(seasonYear).slice(-2);
    const seasonPrefix = `00${seasonSuffix}`;
    
    // Estimate game number based on date (NBA season starts early October)
    // Rough estimate: ~2-3 games per day, season starts around Oct 1
    const seasonStart = new Date(`${seasonYear}-10-01`);
    const daysSinceStart = Math.floor((targetDate - seasonStart) / (1000 * 60 * 60 * 24));
    const estimatedGameNum = Math.max(1, Math.min(500, daysSinceStart * 2.5)); // Rough estimate
    
    console.log(`      🔍 Constructing game ID from date pattern (estimated game #${Math.round(estimatedGameNum)})...`);
    
    // Try a small range around the estimate
    const startGameNum = Math.max(1, Math.round(estimatedGameNum) - 20);
    const endGameNum = Math.min(500, Math.round(estimatedGameNum) + 20);
    
    for (let gameNum = startGameNum; gameNum <= endGameNum; gameNum++) {
      const potentialGameId = `${seasonPrefix}${String(gameNum).padStart(5, '0')}`;
      
      try {
        // Test if this game ID exists and matches our teams/date
        const url = `${NBA_STATS_BASE}/boxscoretraditionalv2?GameID=${potentialGameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`;
        const boxscore = await fetchNBAStats(url, 5000, 0); // Quick check, no retries
        
        const teamStats = (boxscore?.resultSets || []).find((r) => 
          (r?.name || '').toLowerCase().includes('teamstats')
        ) || boxscore?.resultSets?.[1];
        
        if (!teamStats || !teamStats.rowSet || teamStats.rowSet.length === 0) {
          continue; // Game doesn't exist
        }
        
        const headers = teamStats.headers || [];
        const rows = teamStats.rowSet || [];
        const iTeamId = idx(headers, 'TEAM_ID');
        const iGameDate = idx(headers, 'GAME_DATE');
        
        // Check if teams match
        const teamIds = rows.map((r) => Number(r[iTeamId])).filter(id => id > 0);
        const hasPlayerTeam = teamIds.includes(playerTeamId);
        const hasOpponentTeam = teamIds.includes(opponentTeamId);
        
        if (hasPlayerTeam && hasOpponentTeam) {
          // Check date if available
          if (iGameDate >= 0 && rows.length > 0) {
            const boxscoreDate = new Date(String(rows[0][iGameDate]));
            const dateDiff = Math.abs(boxscoreDate.getTime() - targetDate.getTime());
            if (dateDiff < 24 * 60 * 60 * 1000) { // Within 1 day
              console.log(`      ✅ Found NBA game ID: ${potentialGameId} (checked ${gameNum - startGameNum + 1} games)`);
              return potentialGameId;
            }
          } else {
            // No date, but teams match - good enough
            console.log(`      ✅ Found NBA game ID (teams match): ${potentialGameId} (checked ${gameNum - startGameNum + 1} games)`);
            return potentialGameId;
          }
        }
      } catch (e) {
        // Game doesn't exist or error - continue
        continue;
      }
    }
    
    console.warn(`      ⚠️ Could not find game ID after checking ${endGameNum - startGameNum + 1} games`);
    return null;
  } catch (error) {
    console.warn(`      ⚠️ Error constructing NBA game ID: ${error.message}`);
    return null;
  }
}

/**
 * Get player game log from NBA API (provides per-game usage rate and game IDs)
 * Uses Next.js API route as proxy (server-side requests work better with NBA API)
 */
async function fetchPlayerGameLog(nbaPlayerId, seasonLabel) {
  try {
    // Use Next.js API route as proxy (server-side requests work better with NBA API)
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    
    try {
      console.log(`      ⏳ Fetching via API route: /api/nba/playergamelog?player_id=${nbaPlayerId}&season=${seasonLabel}...`);
      console.log(`      ⚠️ Make sure your Next.js dev server is running (npm run dev)`);
      const apiUrl = `${baseUrl}/api/nba/playergamelog?player_id=${nbaPlayerId}&season=${encodeURIComponent(seasonLabel)}&season_type=Regular+Season`;
      
      const data = await new Promise((resolve, reject) => {
        const { URL } = require('url');
        const http = require('http');
        const urlObj = new URL(apiUrl);
        
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || 3000,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          timeout: 60000 // 60 second timeout (NBA API can be slow)
        };
        
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error(`Failed to parse API response: ${e.message}`));
              }
            } else {
              const errorData = data.substring(0, 500);
              reject(new Error(`API route returned ${res.statusCode}: ${errorData}`));
            }
          });
        });
        req.on('error', (err) => {
          if (err.code === 'ECONNREFUSED') {
            reject(new Error(`Connection refused - is Next.js server running at ${baseUrl}?`));
          } else {
            reject(err);
          }
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('API route timeout after 60s')); });
        req.setTimeout(60000);
        req.end();
      });
      
      console.log(`      ✅ Got response from API route`);
      
      // Check if response has error
      if (data.error) {
        console.log(`      ⚠️ API route returned error: ${data.error}`);
        return [];
      }
      
      // Parse the response (API route returns raw NBA API response)
      if (!data || !data.resultSets) {
        console.log(`      ⚠️ Invalid response structure:`, Object.keys(data || {}));
        return [];
      }
      
      const rs = (data.resultSets || []).find((r) => 
        (r?.name || '').toLowerCase().includes('playergamelog')
      ) || data.resultSets?.[0];
      
      if (!rs) {
        console.log(`      ⚠️ No playergamelog result set in response. Available sets:`, data.resultSets.map(r => r?.name) || []);
        return [];
      }
      
      const headers = rs.headers || [];
      const rows = rs.rowSet || [];
      const iGameId = idx(headers, 'GAME_ID', 'Game_ID');
      const iGameDate = idx(headers, 'GAME_DATE', 'Game_Date');
      const iUsgPct = idx(headers, 'USG_PCT', 'USG%');
      
      if (iGameId < 0) {
        console.log(`      ⚠️ GAME_ID column not found in headers:`, headers);
        return [];
      }
      
      console.log(`      ✅ Found ${rows.length} games in playergamelog`);
      
      const gameLog = rows.map((row) => ({
        gameId: String(row[iGameId]),
        gameDate: iGameDate >= 0 ? String(row[iGameDate] || '') : null,
        usageRate: iUsgPct >= 0 ? (parseFloat(row[iUsgPct]) || 0) * 100 : null // Convert to percentage
      })).filter(g => g.gameId);
      
      return gameLog;
    } catch (apiError) {
      console.log(`      ⚠️ API route failed: ${apiError.message}`);
      throw apiError; // Don't fall back to direct call since it won't work
    }
  } catch (error) {
    console.warn(`      ⚠️ Error fetching player game log: ${error.message}`);
    return [];
  }
}

/**
 * Get pace from boxscoreadvancedv2 (per-game pace)
 */
/**
 * Fetch advanced stats from BDL (includes pace and usage rate per game)
 * Returns a map of BDL game ID -> { pace, usageRate }
 */
async function fetchAdvancedStats(bdlPlayerId, seasonYear) {
  try {
    const url = new URL(`${BDL_BASE}/stats/advanced`);
    url.searchParams.append('player_ids[]', String(bdlPlayerId));
    url.searchParams.append('seasons[]', String(seasonYear));
    url.searchParams.set('postseason', 'false');
    
    const headers = {};
    if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }
    
    console.log(`  📊 Fetching advanced stats from BDL for player ${bdlPlayerId}...`);
    const response = await fetch(url.toString(), { headers });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`BDL API ${response.status}: ${errorText.substring(0, 200)}`);
    }
    
    const json = await response.json();
    const advancedStats = Array.isArray(json?.data) ? json.data : [];
    
    // Create a map of game ID -> { pace, usageRate }
    // Note: BDL returns usage_percentage as a decimal (0.3 = 30%), so we multiply by 100
    const statsByGameId = new Map();
    advancedStats.forEach(stat => {
      const gameId = stat?.game?.id;
      const pace = stat?.pace;
      const usageRate = stat?.usage_percentage;
      if (gameId) {
        statsByGameId.set(String(gameId), {
          pace: pace != null ? parseFloat(pace) : null,
          usageRate: usageRate != null ? parseFloat(usageRate) * 100 : null // Convert decimal to percentage
        });
      }
    });
    
    const paceCount = Array.from(statsByGameId.values()).filter(s => s.pace != null).length;
    const usageCount = Array.from(statsByGameId.values()).filter(s => s.usageRate != null).length;
    console.log(`  ✅ Found pace for ${paceCount} games and usage rate for ${usageCount} games from BDL advanced stats`);
    return statsByGameId;
  } catch (error) {
    console.warn(`  ⚠️ Could not fetch advanced stats: ${error.message}`);
    return new Map();
  }
}

/**
 * Load player ID mappings
 */
function loadPlayerIdMappings() {
  try {
    const fs = require('fs');
    const path = require('path');
    const mappingPath = path.join(__dirname, 'player-id-mappings.json');
    if (fs.existsSync(mappingPath)) {
      const data = fs.readFileSync(mappingPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`Warning: Could not load player ID mappings: ${error.message}`);
  }
  return [];
}

/**
 * Convert BDL player ID to NBA Stats ID
 * Also handles NBA ID input (will find the mapping and return NBA ID)
 */
function getNbaStatsId(playerId, mappings) {
  const idStr = String(playerId);
  
  // First try as BDL ID
  const mappingByBdl = mappings.find(m => m.bdlId === idStr);
  if (mappingByBdl) {
    return mappingByBdl.nbaId;
  }
  
  // Then try as NBA ID (return it directly if found in mappings)
  const mappingByNba = mappings.find(m => m.nbaId === idStr);
  if (mappingByNba) {
    return mappingByNba.nbaId;
  }
  
  return null;
}

/**
 * Get BDL player ID (handles both BDL and NBA ID input)
 */
function getBdlPlayerId(playerId, mappings) {
  const idStr = String(playerId);
  
  // First try as BDL ID
  const mappingByBdl = mappings.find(m => m.bdlId === idStr);
  if (mappingByBdl) {
    return mappingByBdl.bdlId;
  }
  
  // Then try as NBA ID
  const mappingByNba = mappings.find(m => m.nbaId === idStr);
  if (mappingByNba) {
    return mappingByNba.bdlId;
  }
  
  return null;
}

/**
 * Get DvP ranks for all positions/metrics (from BettingPros)
 * Returns: { [position]: { [metric]: rank } }
 */
async function getDvpRanks(opponentAbbr, season) {
  const ranks = {};
  
  // Fetch BettingPros data
  try {
    const BETTINGPROS_URL = 'https://www.bettingpros.com/nba/defense-vs-position/';
    
    const html = await new Promise((resolve, reject) => {
      const urlObj = new URL(BETTINGPROS_URL);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`BettingPros ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    });
    
    // Extract JSON from HTML (same logic as lib/bettingpros-dvp.ts)
    const startMarker = 'const bpDefenseVsPositionStats = {';
    const startIdx = html.indexOf(startMarker);
    
    if (startIdx < 0) {
      console.warn(`  ⚠️ Could not find BettingPros data in HTML`);
      return ranks;
    }
    
    let braceCount = 0;
    let jsonStart = startIdx + startMarker.length - 1;
    let jsonEnd = jsonStart;
    
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') braceCount++;
      if (html[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
    
    const jsonStr = html.substring(jsonStart, jsonEnd);
    let bpData;
    try {
      bpData = JSON.parse(jsonStr);
    } catch (error) {
      console.error('Error parsing JSON:', error.message);
      throw new Error(`Failed to parse JSON: ${error.message}`);
    }
    
    // Map team abbreviations
    const OUR_TO_BP_ABBR = { 'NOP': 'NOR', 'PHX': 'PHO', 'UTA': 'UTH' };
    const OUR_TO_BP_METRIC = {
      'pts': 'points', 'reb': 'rebounds', 'ast': 'assists',
      'fg3m': 'three_points_made', 'fg_pct': 'field_goals_perc',
      'stl': 'steals', 'blk': 'blocks', 'to': 'turnovers'
    };
    
    const bpTeamAbbr = OUR_TO_BP_ABBR[opponentAbbr] || opponentAbbr;
    const teamStats = bpData?.teamStats?.[bpTeamAbbr];
    
    if (!teamStats) {
      console.warn(`  ⚠️ No BettingPros data for team ${opponentAbbr}`);
      return ranks;
    }
    
    // Calculate ranks for each position/metric
    for (const pos of POSITIONS) {
      ranks[pos] = {};
      const positionData = teamStats[pos] || teamStats['ALL'];
      
      if (!positionData) continue;
      
      // Get all teams' values for this position/metric to calculate rank
      const allTeams = Object.keys(bpData.teamStats || {});
      
      for (const metric of DVP_METRICS) {
        const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
        
        // Collect all team values for this position/metric
        const teamValues = allTeams.map(t => {
          const ts = bpData.teamStats[t];
          if (!ts) return null;
          const pd = ts[pos] || ts['ALL'];
          if (!pd) return null;
          const val = pd[bpMetric];
          return val !== null && val !== undefined ? Number(val) : null;
        }).filter(v => v !== null);
        
        if (teamValues.length === 0) continue;
        
        // Sort and find rank (lower value = better defense = lower rank)
        teamValues.sort((a, b) => a - b);
        const teamValue = positionData[bpMetric];
        
        if (teamValue !== null && teamValue !== undefined) {
          const numValue = Number(teamValue);
          const rank = teamValues.findIndex(v => v >= numValue) + 1;
          ranks[pos][metric] = rank > 0 ? rank : teamValues.length;
        }
      }
    }
  } catch (error) {
    console.warn(`  ⚠️ Error fetching DvP ranks: ${error.message}`);
  }
  
  return ranks;
}

/**
 * Calculate pace rank from all teams' pace values
 */
function calculatePaceRank(pace, allPaces) {
  if (pace === null || pace === undefined) return null;
  
  // Sort paces descending (higher pace = better rank)
  const sorted = [...allPaces].filter(p => p !== null && p !== undefined).sort((a, b) => b - a);
  const rank = sorted.findIndex(p => p <= pace) + 1;
  return rank > 0 ? rank : null;
}

/**
 * Save to Supabase cache
 */
async function setCache(cacheKey, cacheType, data, ttlMinutes = 525600) { // 1 year default
  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);
    
    const now = new Date();
    const cacheEntry = {
      cache_key: cacheKey,
      cache_type: cacheType,
      data: data,
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
      created_at: now.toISOString()
    };

    const { error } = await supabase
      .from('nba_api_cache')
      .upsert(cacheEntry, { onConflict: 'cache_key' });

    if (error) {
      console.error(`  ❌ Error writing to Supabase: ${error.message}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`  ❌ Error setting cache: ${error.message}`);
    return false;
  }
}

/**
 * Fetch player games from BDL
 */
async function fetchPlayerGames(playerId, season) {
  console.log(`  📥 Fetching games for player ${playerId}, season ${season}...`);
  
  const allGames = [];
  let page = 1;
  const perPage = 100;
  
  while (true) {
    try {
      const url = new URL(`${BDL_BASE}/stats`);
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      url.searchParams.append('player_ids[]', String(playerId));
      url.searchParams.append('seasons[]', String(season));
      
      const data = await fetchBDL(url.toString());
      const games = Array.isArray(data?.data) ? data.data : [];
      
      if (games.length === 0) break;
      
      allGames.push(...games);
      console.log(`    Page ${page}: ${games.length} games (total: ${allGames.length})`);
      
      const meta = data?.meta || {};
      if (!meta.next_page || games.length < perPage) break;
      
      page++;
      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit
    } catch (error) {
      console.error(`  ⚠️ Error fetching page ${page}:`, error.message);
      break;
    }
  }
  
  console.log(`  ✅ Found ${allGames.length} games`);
  return allGames;
}

/**
 * Main function to cache game filters
 */
async function cacheGameFilters(playerId = null, season = null) {
  const seasonYear = season || currentNbaSeason();
  console.log('\n📊 Starting Game Filters Cache...');
  console.log(`   Player: ${playerId || 'ALL'}`);
  console.log(`   Season: ${seasonYear}\n`);
  
  if (!playerId) {
    console.error('❌ Player ID is required for now (all players not yet implemented)');
    process.exit(1);
  }
  
  // Load player ID mappings
  const playerMappings = loadPlayerIdMappings();
  
  // Get BDL ID (handles both BDL and NBA ID input)
  const bdlPlayerId = getBdlPlayerId(playerId, playerMappings);
  if (!bdlPlayerId) {
    console.error(`  ❌ Could not find player ID mapping for ${playerId}`);
    console.error(`  ⚠️ Make sure the player ID exists in player-id-mappings.json`);
    console.error(`  ⚠️ Note: Use BDL ID or NBA ID (script handles both)`);
    process.exit(1);
  }
  
  const nbaPlayerId = getNbaStatsId(playerId, playerMappings);
  
  if (!nbaPlayerId) {
    console.warn(`  ⚠️ Could not find NBA player ID for ${playerId}`);
    console.warn(`  ⚠️ Usage rate will not be available`);
  } else {
    console.log(`  ✅ Player mapping: BDL ID ${bdlPlayerId} → NBA ID ${nbaPlayerId}`);
  }
  
  // Fetch player games using BDL ID
  const games = await fetchPlayerGames(bdlPlayerId, seasonYear);
  
  if (games.length === 0) {
    console.log('  ⚠️ No games found for this player/season');
    return;
  }
  
  // Collect all pace values to calculate ranks
  const allPaces = [];
  const gameFilterData = [];
  
  // Fetch advanced stats from BDL (includes pace and usage rate per game)
  let advancedStatsByGameId = new Map(); // BDL game ID -> { pace, usageRate }
  
  if (bdlPlayerId) {
    advancedStatsByGameId = await fetchAdvancedStats(bdlPlayerId, seasonYear);
  }
  
  // Filter out games where player played 0 minutes
  // Parse minutes from BDL format (can be "MM:SS" or a number)
  function parseMinutes(minVal) {
    if (typeof minVal === 'number') return minVal;
    if (!minVal) return 0;
    const str = String(minVal);
    const match = str.match(/(\d+):(\d+)/);
    if (match) {
      return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
    }
    return parseFloat(str) || 0;
  }
  
  const gamesWithMinutes = games.filter(stat => {
    const minutes = parseMinutes(stat?.min);
    return minutes > 0;
  });
  
  console.log(`  🔄 Processing ${gamesWithMinutes.length} games (filtered out ${games.length - gamesWithMinutes.length} games with 0 minutes)...`);
  
  for (let i = 0; i < gamesWithMinutes.length; i++) {
    const stat = gamesWithMinutes[i];
    const game = stat?.game;
    const gameDate = game?.date;
    
    // Determine opponent - check which team is NOT the player's team
    // BDL uses BDL team IDs (1-30), not NBA team IDs
    const playerTeamId = stat?.team?.id;
    const homeTeamId = game?.home_team?.id || game?.home_team_id;
    const visitorTeamId = game?.visitor_team?.id || game?.visitor_team_id;
    
    let opponent = null;
    let homeTeam = null;
    let visitorTeam = null;
    
    if (homeTeamId && visitorTeamId) {
      // Try to get abbreviations from BDL response first, then fallback to mapping
      homeTeam = game?.home_team?.abbreviation || TEAM_ID_TO_ABBR_BDL[homeTeamId] || null;
      visitorTeam = game?.visitor_team?.abbreviation || TEAM_ID_TO_ABBR_BDL[visitorTeamId] || null;
      
      // Determine opponent based on which team the player is NOT on
      if (playerTeamId === homeTeamId) {
        opponent = visitorTeam;
      } else if (playerTeamId === visitorTeamId) {
        opponent = homeTeam;
      } else {
        // Fallback: use visitor team if player team doesn't match
        opponent = visitorTeam;
      }
    }
    
    if (!gameDate || !opponent || !homeTeam || !visitorTeam) {
      console.log(`    ⚠️ Skipping game ${i + 1}: missing data`, {
        date: gameDate,
        opponent,
        homeTeam,
        visitorTeam,
        playerTeamId,
        homeTeamId,
        visitorTeamId
      });
      continue;
    }
    
    console.log(`    [${i + 1}/${gamesWithMinutes.length}] Processing ${gameDate} vs ${opponent}...`);
    console.log(`      📅 Raw date from BDL: ${gameDate}`);
    console.log(`      🏠 Teams: ${visitorTeam} @ ${homeTeam}`);
    
    try {
      // Get player's team ID and opponent team ID
      const playerTeamAbbr = normalizeAbbr(stat?.team?.abbreviation || '');
      const playerTeamId = ABBR_TO_TEAM_ID_NBA[playerTeamAbbr];
      const opponentAbbr = normalizeAbbr(opponent);
      const opponentTeamId = ABBR_TO_TEAM_ID_NBA[opponentAbbr];
      
      if (!playerTeamId || !opponentTeamId) {
        console.log(`      ⚠️ Missing team IDs: player=${playerTeamAbbr} (${playerTeamId}), opponent=${opponentAbbr} (${opponentTeamId})`);
        continue;
      }
      
      // Get pace and usage rate from BDL advanced stats (by BDL game ID)
      const bdlGameId = String(game?.id || '');
      const advancedStats = advancedStatsByGameId.get(bdlGameId);
      
      let pace = null;
      let usageRate = null;
      
      if (advancedStats) {
        pace = advancedStats.pace;
        usageRate = advancedStats.usageRate;
        
        if (pace !== null) {
          allPaces.push(pace);
          console.log(`      ✅ Found pace ${pace.toFixed(1)} and usage rate ${usageRate?.toFixed(1) || 'N/A'}% from BDL advanced stats`);
        } else {
          console.log(`      ⚠️ Pace not found in BDL advanced stats for game ${bdlGameId}`);
        }
        
        if (usageRate === null) {
          console.log(`      ⚠️ Usage rate not found in BDL advanced stats for game ${bdlGameId}`);
        }
      } else {
        console.log(`      ⚠️ Advanced stats not found for game ${bdlGameId}`);
      }
      
      // Get FGM from game stats
      const fgm = stat?.fgm || 0;
      
      // Get DvP ranks
      const dvpRanks = await getDvpRanks(opponentAbbr, seasonYear);
      
      gameFilterData.push({
        gameId: String(game?.id || ''),
        gameDate: gameDate,
        opponent: opponentAbbr,
        opponentDvpRanks: dvpRanks,
        opponentPace: pace,
        opponentPaceRank: null, // Will calculate after collecting all paces
        playerUsageRate: usageRate,
        playerFGM: fgm
      });
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`      ❌ Error processing game:`, error.message);
    }
  }
  
  // Calculate pace ranks
  console.log(`  📊 Calculating pace ranks from ${allPaces.length} pace values...`);
  gameFilterData.forEach(game => {
    if (game.opponentPace !== null) {
      game.opponentPaceRank = calculatePaceRank(game.opponentPace, allPaces);
    }
  });
  
  // Cache to Supabase (use BDL ID for consistency)
  const cacheKey = `player_game_filters_${bdlPlayerId}_${seasonYear}`;
  console.log(`  💾 Caching ${gameFilterData.length} games to Supabase...`);
  const cached = await setCache(cacheKey, 'game_filters', gameFilterData);
  
  if (cached) {
    console.log(`  ✅ Successfully cached game filters for player ${bdlPlayerId} (BDL ID)`);
  } else {
    console.log(`  ⚠️ Failed to cache game filters`);
  }
  
  console.log('\n✅ Cache complete!');
}

// Run if called directly
if (require.main === module) {
  const playerId = process.argv[2] || null;
  const season = process.argv[3] ? parseInt(process.argv[3]) : currentNbaSeason();
  
  cacheGameFilters(playerId, season)
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { cacheGameFilters };
