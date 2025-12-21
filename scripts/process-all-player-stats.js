/**
 * Daily script to process stats for ALL NBA players
 * Runs once per day at 5:30pm AEST
 * No date filtering - processes all active players regardless of game dates
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.PROD_URL || 'https://www.stattrackr.co';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Import player ID mappings (same as frontend uses)
const fs = require('fs');
const path = require('path');
let PLAYER_ID_MAPPINGS = [];
try {
  const mappingFilePath = path.join(__dirname, '../lib/playerIdMapping.ts');
  console.log(`[Daily Stats Ingestion] 📁 Loading mappings from: ${mappingFilePath}`);
  const mappingFile = fs.readFileSync(mappingFilePath, 'utf8');
  
  const arrayStart = mappingFile.indexOf('export const PLAYER_ID_MAPPINGS');
  if (arrayStart !== -1) {
    const equalsSign = mappingFile.indexOf('=', arrayStart);
    if (equalsSign !== -1) {
      const bracketStart = mappingFile.indexOf('[', equalsSign);
      if (bracketStart !== -1) {
        let bracketCount = 0;
        let bracketEnd = bracketStart;
        for (let i = bracketStart; i < mappingFile.length; i++) {
          if (mappingFile[i] === '[') bracketCount++;
          if (mappingFile[i] === ']') bracketCount--;
          if (bracketCount === 0) {
            bracketEnd = i;
            break;
          }
        }
        
        const arrayContent = mappingFile.substring(bracketStart + 1, bracketEnd);
        const lines = arrayContent.split('\n');
        
        PLAYER_ID_MAPPINGS = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.includes('bdlId')) {
            const bdlIdMatch = trimmed.match(/bdlId:\s*['"]([^'"]+)['"]/);
            
            let nameMatch = null;
            const nameFieldIndex = trimmed.indexOf('name:');
            if (nameFieldIndex !== -1) {
              const afterName = trimmed.substring(nameFieldIndex + 5);
              const quoteMatch = afterName.match(/^\s*['"]/);
              if (quoteMatch) {
                const quoteChar = quoteMatch[0].trim();
                const nameStart = nameFieldIndex + 5 + afterName.indexOf(quoteChar);
                let nameEnd = nameStart + 1;
                while (nameEnd < trimmed.length) {
                  if (trimmed[nameEnd] === quoteChar && trimmed[nameEnd - 1] !== '\\') {
                    break;
                  }
                  nameEnd++;
                }
                if (nameEnd < trimmed.length) {
                  let nameValue = trimmed.substring(nameStart + 1, nameEnd);
                  nameValue = nameValue.replace(/\\'/g, "'").replace(/\\"/g, '"');
                  nameMatch = [null, nameValue];
                }
              }
            }
            
            if (bdlIdMatch && nameMatch) {
              PLAYER_ID_MAPPINGS.push({
                bdlId: bdlIdMatch[1],
                name: nameMatch[1]
              });
            }
          }
        }
      }
    }
  }
  console.log(`[Daily Stats Ingestion] ✅ Loaded ${PLAYER_ID_MAPPINGS.length} player ID mappings`);
} catch (e) {
  console.warn(`[Daily Stats Ingestion] ⚠️ Failed to load player ID mappings:`, e.message);
}

// Helper to get player ID from name
function getPlayerIdFromName(playerName) {
  if (!playerName || !PLAYER_ID_MAPPINGS.length) return null;
  const mapping = PLAYER_ID_MAPPINGS.find(m => 
    m.name.toLowerCase() === playerName.toLowerCase() ||
    m.name.toLowerCase().includes(playerName.toLowerCase()) ||
    playerName.toLowerCase().includes(m.name.toLowerCase())
  );
  return mapping?.bdlId || null;
}

const PLAYER_STATS_CACHE_KEY = 'all-nba-player-stats';
const CHECKPOINT_CACHE_PREFIX = 'all-nba-player-stats-checkpoint';

// Team mappings
const TEAM_FULL_TO_ABBR = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Detroit Pistons': 'DET', 'Indiana Pacers': 'IND', 'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL', 'New York Knicks': 'NYK', 'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI', 'Toronto Raptors': 'TOR', 'Washington Wizards': 'WAS',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU', 'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM', 'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NOP',
  'Oklahoma City Thunder': 'OKC', 'Phoenix Suns': 'PHX', 'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Utah Jazz': 'UTA',
};

// Team ID mappings
const TEAM_ID_TO_ABBR = {
  1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET', 10: 'GSW',
  11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NOP', 20: 'NYK',
  21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
};

const ABBR_TO_TEAM_ID = {};
for (const [id, abbr] of Object.entries(TEAM_ID_TO_ABBR)) {
  ABBR_TO_TEAM_ID[abbr] = parseInt(id, 10);
}

// Current NBA season
function currentNbaSeason() {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 9 && day < 15) {
    return now.getFullYear() - 1;
  }
  if (month >= 9) {
    return now.getFullYear();
  }
  return now.getFullYear() - 1;
}

// Helper to parse minutes
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

// Helper to get stat value from game stats
function getStatValue(game, statType) {
  if (statType === 'PRA') {
    return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
  }
  if (statType === 'PA') {
    return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.ast || 0) || 0);
  }
  if (statType === 'PR') {
    return (parseFloat(game.pts || 0) || 0) + (parseFloat(game.reb || 0) || 0);
  }
  if (statType === 'RA') {
    return (parseFloat(game.reb || 0) || 0) + (parseFloat(game.ast || 0) || 0);
  }
  
  const statMap = {
    'PTS': 'pts',
    'REB': 'reb',
    'AST': 'ast',
    'STL': 'stl',
    'BLK': 'blk',
    'THREES': 'fg3m',
  };
  const key = statMap[statType] || statType.toLowerCase();
  const rawValue = game[key];
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return 0;
  }
  const parsed = parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Map stat type to DvP metric
function mapStatTypeToDvpMetric(statType) {
  const mapping = {
    'PTS': 'pts',
    'REB': 'reb',
    'AST': 'ast',
    'STL': 'stl',
    'BLK': 'blk',
    'THREES': 'fg3m',
    'FG3M': 'fg3m',
    'PRA': 'pra',
    'PA': 'pa',
    'PR': 'pr',
    'RA': 'ra',
  };
  return mapping[statType.toUpperCase()] || null;
}

// Cache helpers
async function getCache(key) {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data, expires_at')
      .eq('cache_key', key)
      .single();
    
    if (error || !data) return null;
    
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) return null;
    
    return data.data;
  } catch (e) {
    return null;
  }
}

async function setCache(key, value, ttlMinutes = 24 * 60) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .upsert({
        cache_key: key,
        cache_type: 'player-stats',
        data: value,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'cache_key'
      });
    
    if (error) {
      console.error(`[Daily Stats Ingestion] ❌ Failed to save cache ${key}:`, error.message);
      throw error;
    }
    
    console.log(`[Daily Stats Ingestion] ✅ Successfully saved cache ${key}`);
    return true;
  } catch (e) {
    console.error(`[Daily Stats Ingestion] ❌ Exception saving cache ${key}:`, e.message);
    throw e;
  }
}

// Call production API
async function callAPI(endpoint) {
  const url = `${PROD_URL}${endpoint}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'Accept': 'application/json' },
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// Fetch all active NBA players
async function getAllActivePlayers() {
  console.log('[Daily Stats Ingestion] 📥 Fetching all active NBA players...');
  
  try {
    const playersData = await callAPI('/api/bdl/players?all=true&max_hops=60&per_page=100');
    
    if (!playersData.results || !Array.isArray(playersData.results)) {
      throw new Error('Invalid response format from players API');
    }
    
    const players = playersData.results
      .filter(p => p && p.id && p.full)
      .map(p => ({
        id: p.id,
        name: p.full,
        team: p.team || null,
      }));
    
    console.log(`[Daily Stats Ingestion] ✅ Found ${players.length} active players`);
    return players;
  } catch (e) {
    console.error(`[Daily Stats Ingestion] ❌ Error fetching players:`, e.message);
    throw e;
  }
}

// Calculate stats for a player
async function calculatePlayerStats(playerId, playerName, currentTeam) {
  try {
    // Get player ID from name if needed
    let bdlId = playerId;
    if (!bdlId || bdlId === '') {
      bdlId = getPlayerIdFromName(playerName);
    }
    
    if (!bdlId) {
      console.warn(`[Daily Stats Ingestion] ⚠️ No player ID found for ${playerName}`);
      return null;
    }
    
    // Get position from depth chart (try current team first)
    let position = null;
    if (currentTeam) {
      try {
        const teamAbbr = TEAM_FULL_TO_ABBR[currentTeam] || currentTeam;
        const depthChart = await callAPI(`/api/depth-chart?team=${encodeURIComponent(teamAbbr)}`).catch(() => null);
        if (depthChart?.depthChart) {
          const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
          for (const pos of positions) {
            const players = depthChart.depthChart[pos] || [];
            for (const p of players) {
              const name = typeof p === 'string' ? p : (p?.name || p?.displayName || '');
              if (name.toLowerCase().includes(playerName.toLowerCase()) || 
                  playerName.toLowerCase().includes(name.toLowerCase())) {
                position = pos;
                break;
              }
            }
            if (position) break;
          }
        }
      } catch (e) {
        // Ignore depth chart errors
      }
    }
    
    // Fetch stats for current and previous season
    const currentSeason = currentNbaSeason();
    const allStats = [];
    
    // Fetch current season regular
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const currSeasonReg = await callAPI(`/api/stats?player_id=${bdlId}&season=${currentSeason}&per_page=100&max_pages=3&postseason=false`);
      if (currSeasonReg?.data && Array.isArray(currSeasonReg.data)) {
        allStats.push(...currSeasonReg.data);
      }
    } catch (e) {
      // Ignore errors
    }
    
    // Fetch previous season regular
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      const prevSeasonReg = await callAPI(`/api/stats?player_id=${bdlId}&season=${currentSeason - 1}&per_page=100&max_pages=3&postseason=false`);
      if (prevSeasonReg?.data && Array.isArray(prevSeasonReg.data)) {
        allStats.push(...prevSeasonReg.data);
      }
    } catch (e) {
      // Ignore errors
    }
    
    // Filter, deduplicate, and sort stats
    const validStats = allStats.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
    const uniqueStatsMap = new Map();
    for (const stat of validStats) {
      const gameId = stat?.game?.id;
      if (gameId && !uniqueStatsMap.has(gameId)) {
        uniqueStatsMap.set(gameId, stat);
      }
    }
    const uniqueStats = Array.from(uniqueStatsMap.values());
    uniqueStats.sort((a, b) => {
      const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return db - da; // newest first
    });
    
    // Filter games with minutes > 0
    const gamesWithMinutes = uniqueStats.filter((stats) => {
      const minutes = parseMinutes(stats.min);
      return minutes > 0;
    });
    
    // Calculate stats for each stat type
    const statTypes = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'THREES', 'PRA', 'PA', 'PR', 'RA'];
    const playerStats = {
      playerId: bdlId,
      playerName,
      position,
      team: currentTeam,
      stats: {},
    };
    
    for (const statType of statTypes) {
      const gamesWithStats = gamesWithMinutes
        .map((stats) => ({
          ...stats,
          statValue: getStatValue(stats, statType),
        }))
        .filter((stats) => Number.isFinite(stats.statValue))
        .sort((a, b) => {
          const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
          const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
          return dateB - dateA;
        });
      
      if (gamesWithStats.length === 0) {
        playerStats.stats[statType] = {
          last5Avg: null,
          last10Avg: null,
          seasonAvg: null,
          last5HitRate: null,
          last10HitRate: null,
          seasonHitRate: null,
          streak: null,
        };
        continue;
      }
      
      // Filter to current season games only
      const getSeasonYear = (stats) => {
        if (!stats?.game?.date) return null;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        return gameMonth >= 9 ? gameYear : gameYear - 1;
      };
      
      const currentSeasonGames = gamesWithStats.filter((stats) => {
        const gameSeasonYear = getSeasonYear(stats);
        return gameSeasonYear === currentSeason;
      });
      
      // Calculate averages
      const last5Games = gamesWithStats.slice(0, 5);
      const last10Games = gamesWithStats.slice(0, 10);
      
      const last5Values = last5Games.map((g) => g.statValue);
      const last10Values = last10Games.map((g) => g.statValue);
      const seasonValues = currentSeasonGames.map((g) => g.statValue);
      
      const last5Avg = last5Values.length > 0 ? last5Values.reduce((sum, val) => sum + val, 0) / last5Values.length : null;
      const last10Avg = last10Values.length > 0 ? last10Values.reduce((sum, val) => sum + val, 0) / last10Values.length : null;
      const seasonAvg = seasonValues.length > 0 ? seasonValues.reduce((sum, val) => sum + val, 0) / seasonValues.length : null;
      
      playerStats.stats[statType] = {
        last5Avg,
        last10Avg,
        seasonAvg,
        last5HitRate: null, // Will be calculated when line is known
        last10HitRate: null,
        seasonHitRate: null,
        streak: null,
      };
    }
    
    return playerStats;
  } catch (e) {
    console.error(`[Daily Stats Ingestion] ❌ Error calculating stats for ${playerName}:`, e.message);
    return null;
  }
}

// Process all players
async function processAllPlayerStats() {
  console.log('[Daily Stats Ingestion] 🚀 Starting daily stats ingestion for all NBA players...');
  
  // Check for split parameter
  let playersSplit = null;
  const splitArg = process.argv.find(arg => arg.startsWith('--split='));
  
  if (splitArg) {
    const splitValue = splitArg.split('=')[1];
    const match = splitValue.match(/(\d+)\/(\d+)/);
    if (match) {
      const part = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (part > 0 && part <= total) {
        playersSplit = { part, total };
        console.log(`[Daily Stats Ingestion] 🔀 Splitting players: processing part ${part} of ${total}`);
      }
    }
  }
  
  // Fetch all active players
  const allPlayers = await getAllActivePlayers();
  
  // Apply split if specified
  let playersToProcess = allPlayers;
  if (playersSplit && allPlayers.length > 0) {
    const totalPlayers = allPlayers.length;
    const chunkSize = Math.ceil(totalPlayers / playersSplit.total);
    const startIndex = (playersSplit.part - 1) * chunkSize;
    const endIndex = Math.min(startIndex + chunkSize, totalPlayers);
    playersToProcess = allPlayers.slice(startIndex, endIndex);
    console.log(`[Daily Stats Ingestion] 🔀 Split players: ${startIndex}-${endIndex} of ${totalPlayers} (part ${playersSplit.part}/${playersSplit.total})`);
  }
  
  console.log(`[Daily Stats Ingestion] 🎯 Processing ${playersToProcess.length} players`);
  
  // Load checkpoint (unique per split part if splitting)
  const checkpointKey = playersSplit 
    ? `${CHECKPOINT_CACHE_PREFIX}-part${playersSplit.part}`
    : CHECKPOINT_CACHE_PREFIX;
  let startIndex = 0;
  let processedStats = {};
  const checkpoint = await getCache(checkpointKey);
  if (checkpoint && checkpoint.processedStats && checkpoint.startIndex > 0) {
    console.log(`[Daily Stats Ingestion] 📍 Resuming from checkpoint at index ${checkpoint.startIndex}`);
    startIndex = checkpoint.startIndex;
    processedStats = checkpoint.processedStats || {};
  }
  
  // Process in batches
  const BATCH_SIZE = 5;
  const MAX_RUNTIME_MS = 55 * 60 * 1000; // 55 minutes
  const startTime = Date.now();
  
  for (let i = startIndex; i < playersToProcess.length; i += BATCH_SIZE) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_RUNTIME_MS) {
      console.log(`[Daily Stats Ingestion] ⏱️ Approaching timeout, saving checkpoint at index ${i}...`);
      await setCache(checkpointKey, {
        processedStats,
        startIndex: i,
        totalPlayers: playersToProcess.length,
        processedCount: Object.keys(processedStats).length,
      }, 60);
      console.log(`[Daily Stats Ingestion] 💾 Checkpoint saved: ${Object.keys(processedStats).length} players processed`);
      return;
    }
    
    const batch = playersToProcess.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (player) => {
      const stats = await calculatePlayerStats(player.id, player.name, player.team);
      return { player, stats };
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.stats) {
        const { player, stats } = result.value;
        processedStats[player.id] = stats;
      }
    }
    
    // Save checkpoint after each batch
    await setCache(checkpointKey, {
      processedStats,
      startIndex: i + BATCH_SIZE,
      totalPlayers: playersToProcess.length,
      processedCount: Object.keys(processedStats).length,
    }, 60);
    
    if (i + BATCH_SIZE < playersToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      const elapsed = Date.now() - startTime;
      console.log(`[Daily Stats Ingestion] Progress: ${Math.min(i + BATCH_SIZE, playersToProcess.length)}/${playersToProcess.length} (${Math.round(elapsed/1000)}s)`);
    }
  }
  
  // Merge with existing cache if splitting (to combine results from parallel jobs)
  // When splitting, use retry logic to handle race conditions
  const maxRetries = playersSplit ? 3 : 1;
  let savedSuccessfully = false;
  
  for (let retry = 0; retry < maxRetries && !savedSuccessfully; retry++) {
    try {
      let finalStats = { ...processedStats };
      
      // If retrying and splitting, re-read cache to get latest from parallel jobs
      if (retry > 0 && playersSplit) {
        console.log(`[Daily Stats Ingestion] 🔄 Retry ${retry}: Re-reading cache before save...`);
        const retryCache = await getCache(PLAYER_STATS_CACHE_KEY);
        if (retryCache && typeof retryCache === 'object') {
          finalStats = { ...retryCache, ...processedStats };
          console.log(`[Daily Stats Ingestion] 🔀 Re-merged for retry: ${Object.keys(processedStats).length} new + ${Object.keys(retryCache).length} existing = ${Object.keys(finalStats).length} total`);
        }
      } else if (playersSplit) {
        // First attempt: re-read cache before saving
        console.log(`[Daily Stats Ingestion] 🔄 Re-reading cache before merge to get latest from parallel jobs...`);
        const existingCache = await getCache(PLAYER_STATS_CACHE_KEY);
        if (existingCache && typeof existingCache === 'object') {
          finalStats = { ...existingCache, ...processedStats };
          console.log(`[Daily Stats Ingestion] 🔀 Merging: ${Object.keys(processedStats).length} new + ${Object.keys(existingCache).length} existing = ${Object.keys(finalStats).length} total`);
        }
      }
      
      // Save final cache
      console.log(`[Daily Stats Ingestion] ✅ Processed ${Object.keys(processedStats).length} players`);
      console.log(`[Daily Stats Ingestion] 💾 Saving ${Object.keys(finalStats).length} total players to cache${retry > 0 ? ` (retry ${retry})` : ''}`);
      await setCache(PLAYER_STATS_CACHE_KEY, finalStats, 24 * 60); // 24 hours TTL
      
      // Verify the save
      if (playersSplit) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for cache to propagate
      }
      const verifyCache = await getCache(PLAYER_STATS_CACHE_KEY);
      
      if (verifyCache && typeof verifyCache === 'object') {
        // Check if our stats are in the cache
        const ourPlayerIds = new Set(Object.keys(processedStats));
        const ourStatsInCache = Object.keys(verifyCache).filter(id => ourPlayerIds.has(id));
        
        // If at least 80% of our stats are in cache, consider it successful
        const successThreshold = Math.floor(Object.keys(processedStats).length * 0.8);
        if (ourStatsInCache.length >= successThreshold) {
          savedSuccessfully = true;
          console.log(`[Daily Stats Ingestion] ✅ Verified: Cache contains ${Object.keys(verifyCache).length} players after save (${ourStatsInCache.length}/${Object.keys(processedStats).length} of our players present)`);
        } else {
          console.warn(`[Daily Stats Ingestion] ⚠️ Verification failed: Only ${ourStatsInCache.length}/${Object.keys(processedStats).length} of our players in cache (threshold: ${successThreshold})`);
          if (retry < maxRetries - 1) {
            const delay = (retry + 1) * 1000;
            console.log(`[Daily Stats Ingestion] 🔄 Will retry in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      } else {
        // If no cache found and this is first write, accept it
        if (!await getCache(PLAYER_STATS_CACHE_KEY)) {
          savedSuccessfully = true;
        } else if (retry < maxRetries - 1) {
          const delay = (retry + 1) * 1000;
          console.log(`[Daily Stats Ingestion] 🔄 Will retry in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      if (savedSuccessfully) {
        break; // Exit retry loop on success
      }
    } catch (e) {
      console.error(`[Daily Stats Ingestion] ⚠️ Error saving cache (attempt ${retry + 1}/${maxRetries}): ${e.message}`);
      if (retry === maxRetries - 1) {
        // Last retry failed, try to save partial data
        try {
          await setCache(PLAYER_STATS_CACHE_KEY, processedStats, 24 * 60);
          console.log(`[Daily Stats Ingestion] ✅ Saved partial data: ${Object.keys(processedStats).length} players to cache`);
          savedSuccessfully = true;
        } catch (e2) {
          console.error(`[Daily Stats Ingestion] ❌ Failed to save cache after all retries: ${e2.message}`);
          throw e2;
        }
      } else {
        const delay = (retry + 1) * 1000;
        console.log(`[Daily Stats Ingestion] 🔄 Will retry in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  if (!savedSuccessfully && !playersSplit) {
    throw new Error('Failed to save cache after all retries');
  }
  
  // Clear checkpoint (clear all split checkpoints if this is the last part)
  if (!playersSplit || playersSplit.part === playersSplit.total) {
    // Clear all split checkpoints
    for (let part = 1; part <= (playersSplit?.total || 1); part++) {
      const partCheckpointKey = playersSplit 
        ? `${CHECKPOINT_CACHE_PREFIX}-part${part}`
        : CHECKPOINT_CACHE_PREFIX;
      await supabase.from('nba_api_cache').delete().eq('cache_key', partCheckpointKey);
    }
    console.log(`[Daily Stats Ingestion] 🧹 Cleared all checkpoints`);
  } else {
    // Clear just this part's checkpoint
    await supabase.from('nba_api_cache').delete().eq('cache_key', checkpointKey);
    console.log(`[Daily Stats Ingestion] 🧹 Cleared checkpoint for part ${playersSplit.part}`);
  }
  
  console.log(`[Daily Stats Ingestion] ✅ Daily stats ingestion complete!`);
}

processAllPlayerStats().catch((error) => {
  console.error('[Daily Stats Ingestion] ❌ Fatal error:', error);
  process.exit(1);
});

