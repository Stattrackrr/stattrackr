/**
 * Standalone script to process player props - runs entirely in GitHub Actions
 * No Vercel calls - all processing happens here
 */

const { createClient } = require('@supabase/supabase-js');
// Use built-in fetch (Node.js 18+) - no need for node-fetch
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
  console.log(`[GitHub Actions] 📁 Loading mappings from: ${mappingFilePath}`);
  const mappingFile = fs.readFileSync(mappingFilePath, 'utf8');
  console.log(`[GitHub Actions] 📄 File size: ${mappingFile.length} bytes`);
  
  // Extract the array from the TypeScript file - match everything between [ and ];
  const arrayStart = mappingFile.indexOf('export const PLAYER_ID_MAPPINGS');
  console.log(`[GitHub Actions] 🔍 Found export at index: ${arrayStart}`);
  
  if (arrayStart === -1) {
    console.warn(`[GitHub Actions] ⚠️ Could not find PLAYER_ID_MAPPINGS in file`);
  } else {
    // Find the opening bracket AFTER the type annotation (skip PlayerIdMapping[])
    // Look for the = sign first, then find the [ after that
    const equalsSign = mappingFile.indexOf('=', arrayStart);
    if (equalsSign === -1) {
      console.warn(`[GitHub Actions] ⚠️ Could not find equals sign`);
    } else {
      // Find the opening bracket after the equals sign
      const bracketStart = mappingFile.indexOf('[', equalsSign);
      console.log(`[GitHub Actions] 🔍 Found opening bracket at index: ${bracketStart} (after = at ${equalsSign})`);
      
      if (bracketStart === -1) {
        console.warn(`[GitHub Actions] ⚠️ Could not find opening bracket`);
      } else {
        // Find matching closing bracket (handle nested brackets)
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
        console.log(`[GitHub Actions] 🔍 Found closing bracket at index: ${bracketEnd}`);
        console.log(`[GitHub Actions] 🔍 Array content length: ${bracketEnd - bracketStart - 1} characters`);
      
      const arrayContent = mappingFile.substring(bracketStart + 1, bracketEnd);
      // Parse entries - each entry is on its own line: { bdlId: 'X', nbaId: 'Y', name: 'Z' },
      const lines = arrayContent.split('\n');
      console.log(`[GitHub Actions] 🔍 Total lines in array: ${lines.length}`);
      
      PLAYER_ID_MAPPINGS = [];
      let parsedCount = 0;
      let skippedCount = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.includes('bdlId')) {
          // Handle both single and double quotes, and allow apostrophes in names
          // Match: bdlId: 'X' or bdlId: "X"
          const bdlIdMatch = trimmed.match(/bdlId:\s*['"]([^'"]+)['"]/);
          
          // For name, handle escaped apostrophes (e.g., De\'Aaron Fox)
          // Find name: field and extract value between quotes, handling escaped quotes
          let nameMatch = null;
          const nameFieldIndex = trimmed.indexOf('name:');
          if (nameFieldIndex !== -1) {
            // Find the quote character after name:
            const afterName = trimmed.substring(nameFieldIndex + 5);
            const quoteMatch = afterName.match(/^\s*['"]/);
            if (quoteMatch) {
              const quoteChar = quoteMatch[0].trim();
              const nameStart = nameFieldIndex + 5 + afterName.indexOf(quoteChar);
              // Find the closing quote, but skip escaped quotes (\' or \")
              let nameEnd = nameStart + 1;
              while (nameEnd < trimmed.length) {
                if (trimmed[nameEnd] === quoteChar && trimmed[nameEnd - 1] !== '\\') {
                  break;
                }
                nameEnd++;
              }
              if (nameEnd < trimmed.length) {
                let nameValue = trimmed.substring(nameStart + 1, nameEnd);
                // Unescape apostrophes: \' becomes '
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
            parsedCount++;
          } else {
            skippedCount++;
            if (skippedCount <= 3) {
              console.log(`[GitHub Actions] ⚠️ Skipped line (no match): ${trimmed.substring(0, 50)}...`);
            }
          }
        }
      }
      console.log(`[GitHub Actions] ✅ Loaded ${PLAYER_ID_MAPPINGS.length} player ID mappings (parsed: ${parsedCount}, skipped: ${skippedCount})`);
      
      // Debug: Check if specific players are loaded
      const testPlayers = ['Josh Giddey', 'Isaac Okoro', 'K.J. Simpson', 'Zach Collins', 'Miles Bridges'];
      const found = testPlayers.filter(p => PLAYER_ID_MAPPINGS.some(m => m.name === p));
      console.log(`[GitHub Actions] 🔍 Test players found: ${found.length}/${testPlayers.length}`, found);
      
      // Show first few mappings as sample
      if (PLAYER_ID_MAPPINGS.length > 0) {
        console.log(`[GitHub Actions] 📋 Sample mappings:`, PLAYER_ID_MAPPINGS.slice(0, 3));
      }
      }
    }
  }
} catch (e) {
  console.warn(`[GitHub Actions] ⚠️ Failed to load player ID mappings:`, e.message);
  console.warn(`[GitHub Actions] Stack:`, e.stack);
}

// Helper to get player ID from name (same as frontend)
function getPlayerIdFromName(playerName) {
  if (!playerName || !PLAYER_ID_MAPPINGS.length) return null;
  const mapping = PLAYER_ID_MAPPINGS.find(m => 
    m.name.toLowerCase() === playerName.toLowerCase() ||
    m.name.toLowerCase().includes(playerName.toLowerCase()) ||
    playerName.toLowerCase().includes(m.name.toLowerCase())
  );
  return mapping?.bdlId || null;
}

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props';
const CHECKPOINT_CACHE_PREFIX = 'nba-player-props-checkpoint';

// Helper functions
function parseAmericanOdds(oddsStr) {
  if (!oddsStr || oddsStr === 'N/A') return null;
  const cleaned = oddsStr.replace(/[^0-9+-]/g, '');
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  return num >= 0 ? (num / 100) + 1 : 1 - (100 / num);
}

function americanToImpliedProb(american) {
  if (american >= 0) {
    return (100 / (american + 100)) * 100;
  } else {
    return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
  }
}

function isPickemBookmaker(name) {
  const lower = name.toLowerCase();
  return lower.includes('prizepicks') || 
         lower.includes('underdog') || 
         lower.includes('draftkings pick6') ||
         lower.includes('pick6');
}

// Team mappings (inline)
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

function getGameDateFromOddsCache(oddsCache) {
  const getUSEasternDateString = (date) => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
  };
  
  // ALWAYS use TOMORROW's date (stats are processed once per day for tomorrow's games)
  // STRICT: Only process games that are exactly tomorrow, not any future date
  // Calculate tomorrow in US ET (not 24 hours from now, but actual tomorrow in US ET)
  const todayUSETStr = getUSEasternDateString(new Date());
  const [year, month, day] = todayUSETStr.split('-').map(Number);
  const tomorrowDate = new Date(year, month - 1, day + 1); // month is 0-indexed
  const tomorrowUSET = getUSEasternDateString(tomorrowDate);
  
  if (!oddsCache.games || oddsCache.games.length === 0) {
    console.log(`[GitHub Actions] ⚠️ No games in cache, using tomorrow: ${tomorrowUSET}`);
    return tomorrowUSET;
  }
  
  // Filter games to ONLY include tomorrow's games (strict check)
  const tomorrowGames = oddsCache.games.filter(game => {
    if (!game.commenceTime) return false;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET;
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDateUSET = commenceStr;
    } else {
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    return gameDateUSET === tomorrowUSET;
  });
  
  // If we have games for tomorrow, use tomorrow's date
  if (tomorrowGames.length > 0) {
    console.log(`[GitHub Actions] ✅ Found ${tomorrowGames.length} games for TOMORROW (${tomorrowUSET})`);
    return tomorrowUSET;
  }
  
  // NO FALLBACK: If no games for tomorrow, return tomorrow anyway but log a warning
  // This ensures we don't process games from 2-3 days in the future
  const todayUSET = getUSEasternDateString(new Date());
  const allGameDates = new Set();
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET;
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDateUSET = commenceStr;
    } else {
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    allGameDates.add(gameDateUSET);
  }
  
  console.log(`[GitHub Actions] ⚠️ No games found for tomorrow (${tomorrowUSET})`);
  console.log(`[GitHub Actions] 📊 Available game dates in cache: ${Array.from(allGameDates).sort().join(', ')}`);
  console.log(`[GitHub Actions] 📅 Today: ${todayUSET}, Tomorrow: ${tomorrowUSET}`);
  console.log(`[GitHub Actions] ⚠️ Returning tomorrow anyway - will result in empty cache (no games to process)`);
  return tomorrowUSET;
}

function calculateImpliedProbabilities(overOddsStr, underOddsStr) {
  // Parse American odds strings (e.g., "+130", "-110") to numeric American odds
  const parseAmericanOddsValue = (oddsStr) => {
    if (!oddsStr || oddsStr === 'N/A') return null;
    // Remove all non-numeric characters except +, -, and decimal point
    const cleaned = typeof oddsStr === 'string' 
      ? oddsStr.replace(/[^0-9.+-]/g, '') 
      : String(oddsStr).replace(/[^0-9.+-]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num) || !Number.isFinite(num)) return null;
    // If the number is between 1 and 10, it might be decimal odds - convert to American
    if (num >= 1 && num <= 10 && !cleaned.includes('+') && !cleaned.includes('-')) {
      // This is decimal odds, convert to American
      if (num >= 2.0) {
        return (num - 1) * 100; // e.g., 2.3 -> +130
      } else {
        return -100 / (num - 1); // e.g., 1.3 -> -333.33
      }
    }
    // Otherwise, treat as American odds
    return num;
  };
  
  const overOdds = parseAmericanOddsValue(overOddsStr);
  const underOdds = parseAmericanOddsValue(underOddsStr);
  
  if (overOdds === null || underOdds === null || !Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
    return null;
  }
  
  // Calculate implied probabilities from American odds
  const overProb = overOdds >= 0 ? (100 / (overOdds + 100)) * 100 : (Math.abs(overOdds) / (Math.abs(overOdds) + 100)) * 100;
  const underProb = underOdds >= 0 ? (100 / (underOdds + 100)) * 100 : (Math.abs(underOdds) / (Math.abs(underOdds) + 100)) * 100;
  const totalProb = overProb + underProb;
  
  if (totalProb > 0) {
    return {
      overImpliedProb: (overProb / totalProb) * 100,
      underImpliedProb: (underProb / totalProb) * 100,
    };
  }
  
  return null;
}

function getPlayerPropVendors(oddsCache) {
  const vendors = new Set();
  if (oddsCache.games && Array.isArray(oddsCache.games)) {
    for (const game of oddsCache.games) {
      if (game.playerPropsByBookmaker && typeof game.playerPropsByBookmaker === 'object') {
        Object.keys(game.playerPropsByBookmaker).forEach(vendor => {
          if (vendor) vendors.add(vendor);
        });
      }
    }
  }
  return Array.from(vendors).sort();
}

function getPlayerPropsCacheKey(gameDate) {
  // Simple key: just date, no timestamp or vendor count
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}`;
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
        cache_type: 'player-props',
        data: value,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'cache_key'
      });
    
    if (error) {
      console.error(`[GitHub Actions] ❌ Failed to save cache ${key}:`, error.message);
      console.error(`[GitHub Actions] ❌ Error details:`, error);
      throw error;
    }
    
    console.log(`[GitHub Actions] ✅ Successfully saved cache ${key} (${Array.isArray(value) ? value.length : 'unknown'} items)`);
    return true;
  } catch (e) {
    console.error(`[GitHub Actions] ❌ Exception saving cache ${key}:`, e.message);
    console.error(`[GitHub Actions] ❌ Stack:`, e.stack);
    throw e; // Re-throw so caller knows it failed
  }
}

// Call production API (read-only, fast)
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

// Team ID mappings (from nbaConstants)
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

// Process player props
async function processPlayerProps() {
  console.log('[GitHub Actions] 🚀 Starting player props processing...');
  
  // Get odds cache
  const oddsCache = await getCache(ODDS_CACHE_KEY);
  if (!oddsCache || !oddsCache.lastUpdated) {
    console.error('[GitHub Actions] ❌ No odds cache found');
    process.exit(1);
  }
  
  console.log(`[GitHub Actions] ✅ Found odds cache: ${oddsCache.games?.length || 0} games`);
  
  const gameDate = getGameDateFromOddsCache(oddsCache);
  const cacheKey = getPlayerPropsCacheKey(gameDate);
  const checkpointKey = `${CHECKPOINT_CACHE_PREFIX}-${gameDate}`;
  
  console.log(`[GitHub Actions] 📅 Processing for game date: ${gameDate}`);
  console.log(`[GitHub Actions] 🔑 Cache key: ${cacheKey}`);
  
  // Check for force refresh flag
  const forceRefresh = process.argv.includes('--refresh') || process.argv.includes('-r');
  
  // Check for stat filter (e.g., --stats=PRA,RA,PR,PA,POINTS,REB,AST)
  let allowedStats = null;
  const statsArg = process.argv.find(arg => arg.startsWith('--stats='));
  if (statsArg) {
    const statsList = statsArg.split('=')[1];
    allowedStats = statsList.split(',').map(s => s.trim().toUpperCase());
    console.log(`[GitHub Actions] 📊 Filtering stats to: ${allowedStats.join(', ')}`);
  }
  
  // Check for split parameter (e.g., --split=1/3 means first third)
  // Can split by games OR by props (if --split-props flag is used)
  let gameSplit = null;
  let propsSplit = null;
  const splitArg = process.argv.find(arg => arg.startsWith('--split='));
  const splitProps = process.argv.includes('--split-props');
  
  if (splitArg) {
    const splitValue = splitArg.split('=')[1];
    const match = splitValue.match(/(\d+)\/(\d+)/);
    if (match) {
      const part = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (part > 0 && part <= total) {
        if (splitProps) {
          propsSplit = { part, total };
          console.log(`[GitHub Actions] 🔀 Splitting props: processing part ${part} of ${total}`);
        } else {
          gameSplit = { part, total };
          console.log(`[GitHub Actions] 🔀 Splitting games: processing part ${part} of ${total}`);
        }
      }
    }
  }
  
  // Check for existing cache - will merge if filtering by stats, otherwise overwrite
  const existingCache = await getCache(cacheKey);
  if (existingCache && Array.isArray(existingCache) && existingCache.length > 0) {
    if (allowedStats) {
      console.log(`[GitHub Actions] 📦 Found existing cache (${existingCache.length} props) - will merge with new data`);
    } else {
      console.log(`[GitHub Actions] 📦 Found existing cache (${existingCache.length} props) - will overwrite with new data`);
    }
  }
  
  if (forceRefresh) {
    console.log(`[GitHub Actions] 🔄 Force refresh requested, recalculating all props...`);
  }
  
  // Extract props from odds cache - FILTER TO ONLY TOMORROW'S GAMES
  const tomorrowUSET = getGameDateFromOddsCache(oddsCache);
  const getUSEasternDateString = (date) => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
  };
  
  // Filter games to only tomorrow's games
  let games = (oddsCache.games || []).filter(game => {
    if (!game.commenceTime) return false;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET;
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDateUSET = commenceStr;
    } else {
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    return gameDateUSET === tomorrowUSET;
  });
  
  // Apply game split if specified (split games into chunks)
  if (gameSplit && games.length > 0) {
    const totalGames = games.length;
    const chunkSize = Math.ceil(totalGames / gameSplit.total);
    const startIndex = (gameSplit.part - 1) * chunkSize;
    const endIndex = Math.min(startIndex + chunkSize, totalGames);
    games = games.slice(startIndex, endIndex);
    console.log(`[GitHub Actions] 🔀 Split games: ${startIndex}-${endIndex} of ${totalGames} (part ${gameSplit.part}/${gameSplit.total})`);
  }
  
  console.log(`[GitHub Actions] 🎯 Processing ${games.length} games for TOMORROW (${tomorrowUSET}) out of ${oddsCache.games?.length || 0} total games`);
  
  if (games.length === 0) {
    console.log(`[GitHub Actions] ⚠️ No games found for tomorrow (${tomorrowUSET}) - nothing to process`);
    console.log(`[GitHub Actions] 💡 This is normal if tomorrow's games aren't in the odds cache yet`);
    return;
  }
  
  // Log which teams are playing tomorrow
  const tomorrowTeams = new Set();
  for (const game of games) {
    if (game.homeTeam) tomorrowTeams.add(game.homeTeam);
    if (game.awayTeam) tomorrowTeams.add(game.awayTeam);
  }
  console.log(`[GitHub Actions] 🏀 Teams playing tomorrow: ${Array.from(tomorrowTeams).join(', ')}`);
  
  const allProps = [];
  
  for (const game of games) {
    if (!game?.playerPropsByBookmaker || typeof game.playerPropsByBookmaker !== 'object') continue;
    
    const homeTeam = game.homeTeam || '';
    const awayTeam = game.awayTeam || '';
    const homeTeamAbbr = TEAM_FULL_TO_ABBR[homeTeam] || homeTeam;
    const awayTeamAbbr = TEAM_FULL_TO_ABBR[awayTeam] || awayTeam;
    
    for (const [bookmakerName, bookmakerProps] of Object.entries(game.playerPropsByBookmaker)) {
      if (!bookmakerProps || typeof bookmakerProps !== 'object') continue;
      if (isPickemBookmaker(bookmakerName)) continue;
      
      for (const [playerName, playerData] of Object.entries(bookmakerProps)) {
        if (!playerData || typeof playerData !== 'object') continue;
        
        const propsData = playerData;
        const statTypes = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'THREES', 'PRA', 'PA', 'PR', 'RA'];
        
        for (const statType of statTypes) {
          // Filter by allowed stats if specified
          if (allowedStats && !allowedStats.includes(statType)) {
            continue;
          }
          const statData = propsData[statType];
          if (!statData) continue;
          
          const entries = Array.isArray(statData) ? statData : [statData];
          
          for (const entry of entries) {
            if (!entry || !entry.line || entry.line === 'N/A') continue;
            if (entry.isPickem === true) continue;
            if (entry.variantLabel && (entry.variantLabel.toLowerCase().includes('goblin') || entry.variantLabel.toLowerCase().includes('demon'))) continue;
            
            const line = parseFloat(entry.line);
            if (isNaN(line)) continue;
            
            const overOddsStr = entry.over;
            const underOddsStr = entry.under;
            
            if (!overOddsStr || overOddsStr === 'N/A' || !underOddsStr || underOddsStr === 'N/A') continue;
            if (overOddsStr === '+100' && underOddsStr === '+100') continue;
            
            // Parse American odds to decimal (for storage/display)
            const overOdds = parseAmericanOdds(overOddsStr);
            const underOdds = parseAmericanOdds(underOddsStr);
            
            if (overOdds === null || underOdds === null) continue;
            
            // Calculate implied probabilities from ORIGINAL American odds strings (not decimal)
            const implied = calculateImpliedProbabilities(overOddsStr, underOddsStr);
            const overProb = implied ? implied.overImpliedProb : americanToImpliedProb(parseFloat(overOddsStr.replace(/[^0-9+-]/g, '')));
            const underProb = implied ? implied.underImpliedProb : americanToImpliedProb(parseFloat(underOddsStr.replace(/[^0-9+-]/g, '')));
            
            // Player ID will be fetched from production API during stats calculation
            const playerId = '';
            
            allProps.push({
              playerName,
              playerId,
              team: homeTeamAbbr,
              opponent: awayTeamAbbr,
              statType,
              line,
              overOdds: overOddsStr,
              underOdds: underOddsStr,
              overProb,
              underProb,
              impliedOverProb: overProb,
              impliedUnderProb: underProb,
              bestLine: line,
              bookmaker: bookmakerName,
              confidence: Math.max(overProb, underProb) > 70 ? 'High' : Math.max(overProb, underProb) > 65 ? 'Medium' : 'Low',
              gameDate: game.commenceTime || gameDate,
              last5Avg: null,
              last10Avg: null,
              h2hAvg: null,
              seasonAvg: null,
              last5HitRate: null,
              last10HitRate: null,
              h2hHitRate: null,
              seasonHitRate: null,
              streak: null,
              dvpRating: null,
              dvpStatValue: null,
              bookmakerLines: [{
                bookmaker: bookmakerName,
                line,
                overOdds: overOddsStr,
                underOdds: underOddsStr,
              }],
            });
          }
        }
      }
    }
  }
  
  // Group and deduplicate
  const propsByPlayerStat = new Map();
  for (const prop of allProps) {
    const roundedLine = Math.round(prop.line * 2) / 2;
    const key = `${prop.playerName}|${prop.statType}|${roundedLine}`;
    if (!propsByPlayerStat.has(key)) {
      propsByPlayerStat.set(key, []);
    }
    propsByPlayerStat.get(key).push(prop);
  }
  
  const processedProps = [];
  for (const [key, propGroup] of propsByPlayerStat.entries()) {
    const bestProb = Math.max(...propGroup.map(p => Math.max(p.overProb, p.underProb)));
    if (bestProb > 50) {
      const bestProp = propGroup.reduce((best, current) => {
        const bestMaxProb = Math.max(best.overProb, best.underProb);
        const currentMaxProb = Math.max(current.overProb, current.underProb);
        return currentMaxProb > bestMaxProb ? current : best;
      });
      
      // Merge all bookmakerLines from all props in the group
      // IMPORTANT: Only include lines that match the prop's line value (within 0.1 tolerance)
      // This prevents mixing lines from different stat types or different line values
      const allBookmakerLines = [];
      const seenBookmakers = new Set();
      const propLineValue = bestProp.line;
      
      for (const prop of propGroup) {
        // Verify prop matches the group's stat type and line (safety check)
        if (prop.statType !== bestProp.statType) {
          console.warn(`[GitHub Actions] ⚠️ Prop statType mismatch in group: ${prop.statType} vs ${bestProp.statType}`);
          continue;
        }
        
        if (prop.bookmakerLines && Array.isArray(prop.bookmakerLines)) {
          for (const line of prop.bookmakerLines) {
            // Only include lines that match the prop's line value (within 0.1 tolerance)
            // This ensures we don't mix lines from different stat types or values
            const lineValue = typeof line.line === 'number' ? line.line : parseFloat(line.line);
            if (isNaN(lineValue) || Math.abs(lineValue - propLineValue) > 0.1) {
              console.warn(`[GitHub Actions] ⚠️ Skipping bookmaker line ${lineValue} that doesn't match prop line ${propLineValue} for ${bestProp.playerName} ${bestProp.statType}`);
              continue;
            }
            
            // Deduplicate by bookmaker name (in case same bookmaker appears multiple times)
            const bookmakerKey = `${line.bookmaker}|${lineValue}`;
            if (!seenBookmakers.has(bookmakerKey)) {
              allBookmakerLines.push(line);
              seenBookmakers.add(bookmakerKey);
            }
          }
        }
      }
      
      // Update bestProp with merged bookmakerLines
      bestProp.bookmakerLines = allBookmakerLines.length > 0 ? allBookmakerLines : bestProp.bookmakerLines;
      
      // Safety check: Ensure prop.line matches the bookmakerLines (use most common line if mismatch)
      if (bestProp.bookmakerLines && bestProp.bookmakerLines.length > 0) {
        const lineValues = bestProp.bookmakerLines.map(l => typeof l.line === 'number' ? l.line : parseFloat(l.line)).filter(v => !isNaN(v));
        if (lineValues.length > 0) {
          // Find most common line value
          const lineCounts = new Map();
          lineValues.forEach(v => {
            const rounded = Math.round(v * 2) / 2;
            lineCounts.set(rounded, (lineCounts.get(rounded) || 0) + 1);
          });
          const mostCommonLine = Array.from(lineCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
          
          // If prop.line doesn't match most common line, update it
          if (mostCommonLine !== undefined && Math.abs(mostCommonLine - propLineValue) > 0.1) {
            console.warn(`[GitHub Actions] ⚠️ Prop line ${propLineValue} doesn't match bookmakerLines (most common: ${mostCommonLine}) for ${bestProp.playerName} ${bestProp.statType} - updating prop.line`);
            bestProp.line = mostCommonLine;
            bestProp.bestLine = mostCommonLine;
          }
        }
      }
      
      processedProps.push(bestProp);
    }
  }
  
  // Remove duplicates
  let uniqueProps = processedProps.filter((prop, index, self) =>
    index === self.findIndex((p) => 
      p.playerName === prop.playerName && 
      p.statType === prop.statType && 
      Math.abs(p.line - prop.line) < 0.1
    )
  );
  
  console.log(`[GitHub Actions] ✅ Processed ${uniqueProps.length} props, calculating stats...`);
  
  // Apply props split if specified (split props into chunks instead of games)
  if (propsSplit && uniqueProps.length > 0) {
    const totalProps = uniqueProps.length;
    const chunkSize = Math.ceil(totalProps / propsSplit.total);
    const startIndex = (propsSplit.part - 1) * chunkSize;
    const endIndex = Math.min(startIndex + chunkSize, totalProps);
    uniqueProps = uniqueProps.slice(startIndex, endIndex);
    console.log(`[GitHub Actions] 🔀 Split props: ${startIndex}-${endIndex} of ${totalProps} (part ${propsSplit.part}/${propsSplit.total})`);
  }
  
  // Load checkpoint
  let startIndex = 0;
  let propsWithStats = [];
  const checkpoint = await getCache(checkpointKey);
  if (checkpoint && checkpoint.processedProps && checkpoint.startIndex > 0) {
    console.log(`[GitHub Actions] 📍 Resuming from checkpoint at index ${checkpoint.startIndex}`);
    startIndex = checkpoint.startIndex;
    propsWithStats = checkpoint.processedProps;
  }
  
  // Process in batches (call production APIs for stats/dvp/depth-chart)
  // Batch size of 5 is safe when props are split equally across jobs
  // Each prop can make 2-6 API calls (player ID, depth chart, stats, DvP)
  // With props split 1/3 per job, 5 props/batch * 3 jobs = manageable load
  const BATCH_SIZE = 5; // Process 5 props at a time in parallel
  const MAX_RUNTIME_MS = 55 * 60 * 1000; // 55 minutes (leave 5 min buffer)
  const startTime = Date.now();
  
  for (let i = startIndex; i < uniqueProps.length; i += BATCH_SIZE) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_RUNTIME_MS) {
      console.log(`[GitHub Actions] ⏱️ Approaching timeout, saving checkpoint at index ${i}...`);
      await setCache(checkpointKey, {
        processedProps: propsWithStats,
        startIndex: i,
        totalProps: uniqueProps.length,
        processedCount: propsWithStats.length,
      }, 60);
      console.log(`[GitHub Actions] 💾 Checkpoint saved: ${propsWithStats.length}/${uniqueProps.length} props`);
      return;
    }
    
    const batch = uniqueProps.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel with caching
    const playerIdCache = new Map();
    const depthChartCache = new Map();
    const statsCache = new Map();
    const dvpCache = new Map();
    
    // Process all props in batch in parallel for speed
    const batchPromises = batch.map(async (prop) => {
      try {
        // Get player ID (with caching) - use same logic as frontend
        // Handle case where playerName is a numeric ID (data quality issue from odds provider)
        let playerId = null;
        let actualPlayerName = prop.playerName;
        
        if (/^\d+$/.test(prop.playerName)) {
          // Player name is numeric - this is likely a player ID from the odds provider
          // Try to use it as the player ID and look up the actual name
          console.warn(`[GitHub Actions] ⚠️ Player name is numeric ID: ${prop.playerName} - attempting to look up player`);
          playerId = prop.playerName;
          
          // Try to look up player by ID to get the actual name
          try {
            await new Promise(resolve => setTimeout(resolve, 100));
            const playerByIdUrl = `/api/bdl/player/${prop.playerName}`;
            const playerByIdResponse = await callAPI(playerByIdUrl).catch(() => null);
            if (playerByIdResponse && playerByIdResponse.data) {
              const playerData = playerByIdResponse.data;
              if (playerData.first_name && playerData.last_name) {
                actualPlayerName = `${playerData.first_name} ${playerData.last_name}`;
                console.log(`[GitHub Actions] ✅ Found player name for ID ${prop.playerName}: ${actualPlayerName}`);
              }
            }
          } catch (e) {
            // API failed, continue with numeric ID
            console.warn(`[GitHub Actions] ⚠️ Could not look up player name for ID ${prop.playerName}: ${e.message}`);
          }
        } else {
          // Normal case: playerName is a name string
          playerId = playerIdCache.get(prop.playerName);
          if (!playerId) {
            // First try the player ID mappings (same as frontend)
            playerId = getPlayerIdFromName(prop.playerName);
            
            // If not found in mappings, try API as fallback (with delay to avoid rate limits)
            if (!playerId) {
              try {
                await new Promise(resolve => setTimeout(resolve, 100)); // Delay before API call
                const searchUrl = `/api/bdl/players?q=${encodeURIComponent(prop.playerName)}&per_page=5`;
                const playerSearch = await callAPI(searchUrl);
                if (playerSearch?.results && Array.isArray(playerSearch.results) && playerSearch.results.length > 0) {
                  playerId = playerSearch.results[0].id || '';
                  // Update actual player name if API returned a different format
                  const apiPlayer = playerSearch.results[0];
                  if (apiPlayer.first_name && apiPlayer.last_name) {
                    actualPlayerName = `${apiPlayer.first_name} ${apiPlayer.last_name}`;
                  }
                }
              } catch (e) {
                // API failed, continue with null
              }
            }
            
            // Final fallback to prop.playerId if available
            if (!playerId) {
              playerId = prop.playerId || '';
            }
            
            // Cache the result
            if (playerId) {
              playerIdCache.set(prop.playerName, playerId);
              console.log(`[GitHub Actions] ✅ Found player ID for ${prop.playerName}: ${playerId}`);
            } else {
              console.warn(`[GitHub Actions] ⚠️ No player ID found for ${prop.playerName}`);
            }
          }
        }
        
        // Use actual player name for position lookup (not the numeric ID if that's what we got)
        const nameForPositionLookup = actualPlayerName;
        
        // Determine which team the player is actually on (try both home and away)
        // This is needed because we initially assign all players to home team
        let actualTeam = prop.team;
        let actualOpponent = prop.opponent;
        let position = null;
        
        // Helper function to decode HTML entities (e.g., &#x27; or &#39; to ')
        const decodeHtmlEntities = (str) => {
          if (!str) return '';
          // Decode common HTML entities
          return str
            .replace(/&#x27;/g, "'")  // &#x27; -> '
            .replace(/&#39;/g, "'")   // &#39; -> '
            .replace(/&apos;/g, "'")  // &apos; -> '
            .replace(/&quot;/g, '"')   // &quot; -> "
            .replace(/&amp;/g, '&')    // &amp; -> &
            .replace(/&lt;/g, '<')     // &lt; -> <
            .replace(/&gt;/g, '>');    // &gt; -> >
        };
        
        // Helper function to normalize names for matching
        // MUST match the depth chart API's `norm` function exactly:
        // norm = (s) => (s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
        // BUT: We need to decode HTML entities first (depth chart returns &#x27; for apostrophes)
        const normalizeNameForMatch = (name) => {
          if (!name) return '';
          // First decode HTML entities, then normalize
          const decoded = decodeHtmlEntities(name);
          return decoded.toLowerCase()
            .replace(/[^a-z\s]/g, '') // Remove all non-alphabetic chars (including apostrophes, numbers, etc.)
            .replace(/\b(jr|sr|ii|iii|iv)\b/g, '') // Remove suffixes
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        };
        
        const normalizedPlayerName = normalizeNameForMatch(nameForPositionLookup);
        const isDebugPlayer = nameForPositionLookup.includes("'") || nameForPositionLookup.toLowerCase().includes('fox') || nameForPositionLookup.toLowerCase().includes('claxton') || /^\d+$/.test(prop.playerName);
        
        if (isDebugPlayer) {
          console.log(`[GitHub Actions] 🔍 Looking for position for ${nameForPositionLookup}${prop.playerName !== nameForPositionLookup ? ` (original: ${prop.playerName})` : ''}`);
          console.log(`[GitHub Actions] 🔍 Normalized name: "${normalizedPlayerName}"`);
          console.log(`[GitHub Actions] 🔍 Checking teams: home=${prop.team}, away=${prop.opponent}`);
        }
        
        // Helper function to find player in depth chart and return all positions with their depth indices
        const findPlayerPositions = (depthChart, teamAbbr) => {
          const matches = []; // Array of { position, depthIndex }
          const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
          
          for (const pos of positions) {
            const players = depthChart[pos] || [];
            for (let depthIndex = 0; depthIndex < players.length; depthIndex++) {
              const p = players[depthIndex];
              const name = typeof p === 'string' ? p : (p?.name || p?.displayName || '');
              const normalizedName = normalizeNameForMatch(name);
              
              // Check if normalized names match (handles apostrophes and special chars)
              let matchesName = normalizedName === normalizedPlayerName || 
                     normalizedName.includes(normalizedPlayerName) || 
                     normalizedPlayerName.includes(normalizedName);
              
              // If no match, try matching by last name + first name prefix (handles "Nic" vs "Nicolas")
              if (!matchesName) {
                const playerParts = normalizedPlayerName.split(' ').filter(p => p.length > 0);
                const chartParts = normalizedName.split(' ').filter(p => p.length > 0);
                
                if (playerParts.length >= 2 && chartParts.length >= 2) {
                  const playerFirst = playerParts[0];
                  const playerLast = playerParts[playerParts.length - 1];
                  const chartFirst = chartParts[0];
                  const chartLast = chartParts[chartParts.length - 1];
                  
                  // Match if last names match AND (first names match OR one is a prefix of the other)
                  if (playerLast === chartLast && 
                      (playerFirst === chartFirst || 
                       playerFirst.startsWith(chartFirst) || 
                       chartFirst.startsWith(playerFirst))) {
                    matchesName = true;
                  }
                }
              }
              
              if (matchesName) {
                if (isDebugPlayer) {
                  console.log(`[GitHub Actions] ✅ Match found! "${name}" (normalized: "${normalizedName}") at ${pos} depth ${depthIndex} (${depthIndex === 0 ? 'Starter' : `${depthIndex + 1}nd/rd/th`})`);
                }
                matches.push({ position: pos, depthIndex });
              }
            }
          }
          
          return matches;
        };
        
        // Try home team first
        let foundOnHomeTeam = false;
        const homeDepthChart = await callAPI(`/api/depth-chart?team=${encodeURIComponent(prop.team)}`).catch(() => null);
        if (homeDepthChart?.depthChart) {
          if (isDebugPlayer) {
            console.log(`[GitHub Actions] 🔍 Checking home team ${prop.team} depth chart...`);
          }
          
          const matches = findPlayerPositions(homeDepthChart.depthChart, prop.team);
          
          if (matches.length > 0) {
            // Sort by depth index (lowest first), then by position priority (PG > SG > SF > PF > C)
            const positionPriority = { 'PG': 0, 'SG': 1, 'SF': 2, 'PF': 3, 'C': 4 };
            matches.sort((a, b) => {
              if (a.depthIndex !== b.depthIndex) {
                return a.depthIndex - b.depthIndex; // Lower depth index = higher priority
              }
              return positionPriority[a.position] - positionPriority[b.position]; // Tie-break by position order
            });
            
            const bestMatch = matches[0];
            position = bestMatch.position;
            foundOnHomeTeam = true;
            actualTeam = prop.team; // Home team
            actualOpponent = prop.opponent; // Away team
            depthChartCache.set(prop.team, position);
            console.log(`[GitHub Actions] ✅ Found position for ${nameForPositionLookup}${prop.playerName !== nameForPositionLookup ? ` (original: ${prop.playerName})` : ''} on ${prop.team}: ${position} (depth ${bestMatch.depthIndex}${bestMatch.depthIndex === 0 ? ', Starter' : `, ${bestMatch.depthIndex + 1}nd/rd/th string`}${matches.length > 1 ? `, also found at: ${matches.slice(1).map(m => `${m.position} depth ${m.depthIndex}`).join(', ')}` : ''})`);
          }
        } else if (isDebugPlayer) {
          console.warn(`[GitHub Actions] ⚠️ No depth chart data for home team ${prop.team}`);
        }
        
        // If not found on home team, try away team
        if (!foundOnHomeTeam && prop.opponent) {
          const awayDepthChart = await callAPI(`/api/depth-chart?team=${encodeURIComponent(prop.opponent)}`).catch(() => null);
          if (awayDepthChart?.depthChart) {
            if (isDebugPlayer) {
              console.log(`[GitHub Actions] 🔍 Checking away team ${prop.opponent} depth chart...`);
            }
            
            const matches = findPlayerPositions(awayDepthChart.depthChart, prop.opponent);
            
            if (matches.length > 0) {
              // Sort by depth index (lowest first), then by position priority (PG > SG > SF > PF > C)
              const positionPriority = { 'PG': 0, 'SG': 1, 'SF': 2, 'PF': 3, 'C': 4 };
              matches.sort((a, b) => {
                if (a.depthIndex !== b.depthIndex) {
                  return a.depthIndex - b.depthIndex; // Lower depth index = higher priority
                }
                return positionPriority[a.position] - positionPriority[b.position]; // Tie-break by position order
              });
              
              const bestMatch = matches[0];
              position = bestMatch.position;
              actualTeam = prop.opponent; // Away team (swap)
              actualOpponent = prop.team; // Home team (swap)
              depthChartCache.set(prop.opponent, position);
              console.log(`[GitHub Actions] ✅ Found position for ${nameForPositionLookup}${prop.playerName !== nameForPositionLookup ? ` (original: ${prop.playerName})` : ''} on ${prop.opponent}: ${position} (depth ${bestMatch.depthIndex}${bestMatch.depthIndex === 0 ? ', Starter' : `, ${bestMatch.depthIndex + 1}nd/rd/th string`}${matches.length > 1 ? `, also found at: ${matches.slice(1).map(m => `${m.position} depth ${m.depthIndex}`).join(', ')}` : ''})`);
            }
          } else if (isDebugPlayer) {
            console.warn(`[GitHub Actions] ⚠️ No depth chart data for away team ${prop.opponent}`);
          }
        }
        
        if (!position) {
          console.warn(`[GitHub Actions] ⚠️ No position found for ${nameForPositionLookup}${prop.playerName !== nameForPositionLookup ? ` (original: ${prop.playerName})` : ''} (${actualTeam}) - DvP will be null`);
          if (isDebugPlayer) {
            console.warn(`[GitHub Actions] ⚠️ Searched in: home=${prop.team}, away=${prop.opponent}`);
            console.warn(`[GitHub Actions] ⚠️ Normalized search name: "${normalizedPlayerName}"`);
          }
        }
        
        // Update prop with correct team/opponent
        prop.team = actualTeam;
        prop.opponent = actualOpponent;
        
        // Calculate player averages (fetch stats and calculate L5, L10, H2H, Season, Streak)
        let averages = {
          last5Avg: null,
          last10Avg: null,
          h2hAvg: null,
          seasonAvg: null,
          last5HitRate: null,
          last10HitRate: null,
          h2hHitRate: null,
          seasonHitRate: null,
          streak: null,
        };
        
        if (playerId) {
          try {
            // Fetch stats for current and previous season (regular + playoffs)
            // EXACT SAME LOGIC AS CLIENT-SIDE: fetch regular first, then playoffs sequentially with delay
            const currentSeason = currentNbaSeason();
            const allStats = [];
            
            // Fetch current season: regular only (playoffs don't start for months)
            let currSeasonReg;
            try {
              await new Promise(resolve => setTimeout(resolve, 300)); // Delay before first request
              currSeasonReg = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=3&postseason=false`);
              if (currSeasonReg?.data && Array.isArray(currSeasonReg.data)) {
                allStats.push(...currSeasonReg.data);
                console.log(`[GitHub Actions] ✅ Fetched ${currSeasonReg.data.length} stats for ${prop.playerName} (${playerId}), season ${currentSeason}, regular`);
              }
            } catch (e) {
              console.warn(`[GitHub Actions] ⚠️ Failed to fetch stats for ${prop.playerName} (${playerId}), season ${currentSeason}, regular: API error: ${e.message}`);
            }
            
            // Delay between seasons
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Fetch previous season regular only (no playoffs)
            let prevSeasonReg;
            try {
              prevSeasonReg = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=3&postseason=false`);
              if (prevSeasonReg?.data && Array.isArray(prevSeasonReg.data)) {
                allStats.push(...prevSeasonReg.data);
                console.log(`[GitHub Actions] ✅ Fetched ${prevSeasonReg.data.length} stats for ${prop.playerName} (${playerId}), season ${currentSeason - 1}, regular`);
              }
            } catch (e) {
              console.warn(`[GitHub Actions] ⚠️ Failed to fetch stats for ${prop.playerName} (${playerId}), season ${currentSeason - 1}, regular: API error: ${e.message}`);
            }
            
            console.log(`[GitHub Actions] 📊 Total stats fetched for ${prop.playerName}: ${allStats.length}`);
            
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
            
            // Get stat values
            const gamesWithStats = gamesWithMinutes
              .map((stats) => ({
                ...stats,
                statValue: getStatValue(stats, prop.statType),
              }))
              .filter((stats) => Number.isFinite(stats.statValue))
              .sort((a, b) => {
                const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
                const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
                return dateB - dateA;
              });
            
            if (gamesWithStats.length > 0) {
              console.log(`[GitHub Actions] ✅ Found ${gamesWithStats.length} games with stats for ${prop.playerName} ${prop.statType} (line: ${prop.line})`);
              
              // Validation: Log sample stat values to ensure they match the stat type
              if (gamesWithStats.length > 0) {
                const sampleValues = gamesWithStats.slice(0, 3).map(g => g.statValue);
                const avgValue = sampleValues.reduce((sum, v) => sum + v, 0) / sampleValues.length;
                console.log(`[GitHub Actions] 📊 Sample stat values for ${prop.playerName} ${prop.statType}: ${sampleValues.join(', ')} (avg: ${avgValue.toFixed(1)})`);
                
                // Warn if stat values seem wrong for the stat type (e.g., PTS should be > 10, REB should be > 3)
                if (prop.statType === 'PTS' && avgValue < 5) {
                  console.warn(`[GitHub Actions] ⚠️ Suspicious: PTS stat values seem low (avg: ${avgValue.toFixed(1)}) for ${prop.playerName} - might be wrong stat type`);
                } else if (prop.statType === 'REB' && avgValue > 20) {
                  console.warn(`[GitHub Actions] ⚠️ Suspicious: REB stat values seem high (avg: ${avgValue.toFixed(1)}) for ${prop.playerName} - might be wrong stat type`);
                }
              }
              
              // Filter to current season games only (EXACT SAME LOGIC AS DASHBOARD)
              const getSeasonYear = (stats) => {
                if (!stats?.game?.date) return null;
                const gameDate = new Date(stats.game.date);
                const gameYear = gameDate.getFullYear();
                const gameMonth = gameDate.getMonth();
                // NBA season spans two calendar years (e.g., 2024-25 season)
                // Games from Oct-Dec are from the season year, games from Jan-Apr are from season year + 1
                return gameMonth >= 9 ? gameYear : gameYear - 1;
              };
              
              const currentSeasonGames = gamesWithStats.filter((stats) => {
                const gameSeasonYear = getSeasonYear(stats);
                return gameSeasonYear === currentSeason;
              });
              
              console.log(`[GitHub Actions] 📅 Current season (${currentSeason}): ${currentSeasonGames.length} games, Total: ${gamesWithStats.length} games`);
              
              // Calculate season average from CURRENT SEASON ONLY
              const seasonValues = currentSeasonGames.map((g) => g.statValue);
              const seasonSum = seasonValues.reduce((sum, val) => sum + val, 0);
              averages.seasonAvg = seasonValues.length > 0 ? seasonSum / seasonValues.length : null;
              
              // Calculate season hit rate from CURRENT SEASON ONLY
              if (Number.isFinite(prop.line) && seasonValues.length > 0) {
                const hits = seasonValues.filter((val) => val > prop.line).length;
                averages.seasonHitRate = { hits, total: seasonValues.length };
              } else {
                averages.seasonHitRate = null;
              }
              
              // Calculate last 5 average
              const last5Games = gamesWithStats.slice(0, 5);
              const last5Values = last5Games.map((g) => g.statValue);
              const last5Sum = last5Values.reduce((sum, val) => sum + val, 0);
              averages.last5Avg = last5Values.length > 0 ? last5Sum / last5Values.length : null;
              
              // Calculate last 5 hit rate
              if (Number.isFinite(prop.line) && last5Values.length > 0) {
                const hits = last5Values.filter((val) => val > prop.line).length;
                averages.last5HitRate = { hits, total: last5Values.length };
              }
              
              // Calculate last 10 average
              const last10Games = gamesWithStats.slice(0, 10);
              const last10Values = last10Games.map((g) => g.statValue);
              const last10Sum = last10Values.reduce((sum, val) => sum + val, 0);
              averages.last10Avg = last10Values.length > 0 ? last10Sum / last10Values.length : null;
              
              // Calculate last 10 hit rate
              if (Number.isFinite(prop.line) && last10Values.length > 0) {
                const hits = last10Values.filter((val) => val > prop.line).length;
                averages.last10HitRate = { hits, total: last10Values.length };
              }
              
              // Calculate H2H average - EXACT COPY FROM route.ts
              if (prop.opponent && prop.opponent !== 'ALL' && prop.opponent !== 'N/A' && prop.opponent !== '') {
                const normalizeAbbr = (abbr) => {
                  if (!abbr) return '';
                  return String(abbr).toUpperCase().trim();
                };
                
                // Determine correct opponent: if player's actual team matches provided opponent, they're swapped
                let correctOpponent = prop.opponent;
                if (gamesWithStats.length > 0 && prop.team) {
                  const playerActualTeam = gamesWithStats[0]?.team?.abbreviation || '';
                  const playerActualTeamNorm = normalizeAbbr(playerActualTeam);
                  const providedTeamNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[prop.team] || prop.team);
                  const providedOpponentNorm = normalizeAbbr(TEAM_FULL_TO_ABBR[prop.opponent] || prop.opponent);
                  
                  // If player's actual team matches the provided opponent, they're swapped
                  if (playerActualTeamNorm === providedOpponentNorm) {
                    // Player is on the "opponent" team, so the real opponent is the "team"
                    correctOpponent = prop.team;
                  }
                }
                
                // Normalize opponent
                const normalizedOpponent = normalizeAbbr(TEAM_FULL_TO_ABBR[correctOpponent] || correctOpponent);
                
                // Filter H2H games - EXACT COPY FROM route.ts
                let h2hStats = gamesWithStats
                  .filter((stats) => {
                    // Get player team from stats
                    const playerTeamFromStats = stats?.team?.abbreviation || (prop.team ? (TEAM_FULL_TO_ABBR[prop.team] || prop.team) : '') || '';
                    const playerTeamNorm = normalizeAbbr(playerTeamFromStats);
                    
                    // Get opponent from game data
                    const homeTeamId = stats?.game?.home_team?.id ?? stats?.game?.home_team_id;
                    const visitorTeamId = stats?.game?.visitor_team?.id ?? stats?.game?.visitor_team_id;
                    const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
                    const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
                    
                    // Determine opponent using team IDs/abbrs
                    const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
                    let gameOpponent = '';
                    
                    if (playerTeamId && homeTeamId && visitorTeamId) {
                      if (playerTeamId === homeTeamId && visitorTeamAbbr) {
                        gameOpponent = normalizeAbbr(visitorTeamAbbr);
                      } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
                        gameOpponent = normalizeAbbr(homeTeamAbbr);
                      }
                    }
                    
                    // Fallback: compare abbreviations directly if IDs missing
                    if (!gameOpponent && homeTeamAbbr && visitorTeamAbbr) {
                      const homeNorm = normalizeAbbr(homeTeamAbbr);
                      const awayNorm = normalizeAbbr(visitorTeamAbbr);
                      if (playerTeamNorm && playerTeamNorm === homeNorm) gameOpponent = awayNorm;
                      else if (playerTeamNorm && playerTeamNorm === awayNorm) gameOpponent = homeNorm;
                    }
                    
                    return gameOpponent === normalizedOpponent;
                  })
                  .slice(0, 6) // Limit to last 6 H2H games
                  .map((s) => s.statValue);
                
                // Fallback: if no H2H stats found, include any game where either side matches the opponent abbr
                if (h2hStats.length === 0 && normalizedOpponent) {
                  const fallbackStats = gamesWithStats
                    .filter((stats) => {
                      const homeTeamId = stats?.game?.home_team?.id ?? stats?.game?.home_team_id;
                      const visitorTeamId = stats?.game?.visitor_team?.id ?? stats?.game?.visitor_team_id;
                      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
                      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
                      const homeNorm = normalizeAbbr(homeTeamAbbr || '');
                      const awayNorm = normalizeAbbr(visitorTeamAbbr || '');
                      return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
                    })
                    .slice(0, 6)
                    .map((s) => s.statValue);
                  
                  if (fallbackStats.length > 0) {
                    h2hStats = fallbackStats;
                  }
                }
                
                if (h2hStats.length > 0) {
                  averages.h2hAvg = h2hStats.reduce((sum, val) => sum + val, 0) / h2hStats.length;
                  if (Number.isFinite(prop.line)) {
                    const hits = h2hStats.filter((val) => val > prop.line).length;
                    averages.h2hHitRate = { hits, total: h2hStats.length };
                  }
                }
              }
              
              // Calculate streak
              if (Number.isFinite(prop.line)) {
                averages.streak = 0;
                for (const game of gamesWithStats) {
                  if (game.statValue > prop.line) {
                    averages.streak++;
                  } else {
                    break;
                  }
                }
              }
            }
          } catch (e) {
            console.error(`[GitHub Actions] ❌ Error calculating averages for ${prop.playerName}:`, e.message);
            console.error(`[GitHub Actions] Stack:`, e.stack);
          }
        } else {
          console.warn(`[GitHub Actions] ⚠️ No player ID found for ${prop.playerName} - skipping stats calculation`);
        }
        
        // Get DvP (with caching) - use actualOpponent (the team the player is facing)
        let dvp = { rank: null, statValue: null };
        if (position && actualOpponent) {
          const dvpMetric = mapStatTypeToDvpMetric(prop.statType);
          if (dvpMetric) {
            const dvpKey = `${position}-${dvpMetric}-${actualOpponent}`;
            const cachedDvp = dvpCache.get(dvpKey);
            if (cachedDvp && typeof cachedDvp === 'object') {
              dvp = cachedDvp;
              if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
                console.log(`[GitHub Actions] 🔍 DvP (cached) for ${prop.playerName}: position=${position}, opponent=${actualOpponent}, metric=${dvpMetric}, rank=${dvp.rank}`);
              }
            } else {
              try {
                const dvpUrl = `/api/dvp/rank?pos=${position}&metric=${dvpMetric}`;
                if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
                  console.log(`[GitHub Actions] 🔍 Fetching DvP for ${prop.playerName}: ${dvpUrl}`);
                  console.log(`[GitHub Actions] 🔍 DvP params: position=${position}, opponent=${actualOpponent}, metric=${dvpMetric}, statType=${prop.statType}`);
                }
                const dvpData = await callAPI(dvpUrl).catch((e) => {
                  if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
                    console.error(`[GitHub Actions] ❌ DvP API error for ${prop.playerName}:`, e.message);
                  }
                  return null;
                });
                if (dvpData && dvpData.ranks && typeof dvpData.ranks === 'object') {
                  const teamAbbr = TEAM_FULL_TO_ABBR[actualOpponent] || actualOpponent.toUpperCase();
                  const rank = dvpData.ranks[teamAbbr] || null;
                  const statValue = (dvpData.values && Array.isArray(dvpData.values)) 
                    ? (dvpData.values.find(v => v && v.team && v.team.toUpperCase() === teamAbbr)?.value || null)
                    : null;
                  
                  dvp = { rank, statValue };
                  dvpCache.set(dvpKey, dvp);
                  
                  if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
                    console.log(`[GitHub Actions] ✅ DvP for ${prop.playerName}: teamAbbr=${teamAbbr}, rank=${rank}, statValue=${statValue}`);
                    console.log(`[GitHub Actions] 🔍 Available ranks keys:`, Object.keys(dvpData.ranks).slice(0, 10));
                    console.log(`[GitHub Actions] 🔍 Looking for team: ${teamAbbr} in ranks`);
                  }
                } else {
                  dvpCache.set(dvpKey, dvp);
                  if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
                    console.warn(`[GitHub Actions] ⚠️ No DvP data returned for ${prop.playerName}:`, {
                      hasData: !!dvpData,
                      hasRanks: !!(dvpData && dvpData.ranks),
                      ranksType: dvpData && typeof dvpData.ranks
                    });
                  }
                }
              } catch (e) {
                dvpCache.set(dvpKey, dvp);
                if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
                  console.error(`[GitHub Actions] ❌ DvP exception for ${prop.playerName}:`, e.message);
                }
              }
            }
          } else {
            if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
              console.warn(`[GitHub Actions] ⚠️ No DvP metric mapping for ${prop.playerName} statType=${prop.statType}`);
            }
          }
        } else {
          if (prop.playerName.includes("'") || prop.playerName.toLowerCase().includes('fox')) {
            console.warn(`[GitHub Actions] ⚠️ Missing DvP prerequisites for ${prop.playerName}: position=${position}, actualOpponent=${actualOpponent}`);
          }
        }
        
        // Ensure dvp is always an object with rank and statValue
        const safeDvp = (dvp && typeof dvp === 'object') ? dvp : { rank: null, statValue: null };
        
        const result = {
          ...prop,
          playerId,
          position,
          ...averages,
          dvpRating: safeDvp.rank || null,
          dvpStatValue: safeDvp.statValue || null,
        };
        return result;
      } catch (e) {
        console.error(`[GitHub Actions] Error processing ${prop.playerName}:`, e.message);
        return { ...prop, position: null, dvpRating: null, dvpStatValue: null };
      }
    });
    
    // Wait for all props in batch to complete
    const batchResults = await Promise.allSettled(batchPromises);
    const processedResults = batchResults.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`[GitHub Actions] Prop ${batch[idx].playerName} failed:`, result.reason);
        return { ...batch[idx], position: null, dvpRating: null, dvpStatValue: null };
      }
    });
    
    propsWithStats.push(...processedResults);
    
    // Save checkpoint after each batch
    await setCache(checkpointKey, {
      processedProps: propsWithStats,
      startIndex: i + BATCH_SIZE,
      totalProps: uniqueProps.length,
      processedCount: propsWithStats.length,
    }, 60);
    
    if (i + BATCH_SIZE < uniqueProps.length) {
      // Delay between batches to avoid overwhelming APIs
      // With props split equally across jobs, batch size 5 is safe
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between batches
      // Log progress every batch
      const elapsed = Date.now() - startTime;
      const propsPerSecond = (i + BATCH_SIZE) / (elapsed / 1000);
      const remaining = uniqueProps.length - (i + BATCH_SIZE);
      const eta = remaining / propsPerSecond;
      console.log(`[GitHub Actions] Progress: ${Math.min(i + BATCH_SIZE, uniqueProps.length)}/${uniqueProps.length} (${Math.round(elapsed/1000)}s, ~${Math.round(eta)}s remaining)`);
    }
  }
  
  // Count props with actual stats
  const propsWithStatsCount = propsWithStats.filter(p => 
    p.last5Avg !== null || p.last10Avg !== null || p.h2hAvg !== null || p.seasonAvg !== null
  ).length;
  
  console.log(`[GitHub Actions] ✅ Calculated stats for ${propsWithStats.length} props`);
  console.log(`[GitHub Actions] 📊 Props with stats: ${propsWithStatsCount}/${propsWithStats.length}`);
  
  // Sample a few props to verify stats are present
  const sampleProps = propsWithStats.slice(0, 5).map(p => ({
    player: p.playerName,
    stat: p.statType,
    last5: p.last5Avg,
    last10: p.last10Avg,
    h2h: p.h2hAvg,
    season: p.seasonAvg,
    streak: p.streak
  }));
  console.log(`[GitHub Actions] 📋 Sample props with stats:`, JSON.stringify(sampleProps, null, 2));
  
  // Merge with existing cache if splitting by props OR filtering by stats
  let finalProps = [...propsWithStats];
  
  // Always merge when splitting by props (to combine results from parallel jobs)
  // Also merge when filtering by stats (secondary stats job merging with main stats)
  const shouldMerge = propsSplit || (allowedStats && existingCache && Array.isArray(existingCache) && existingCache.length > 0);
  
  // When splitting by props, read cache again right before saving to get latest from parallel jobs
  let cacheToMerge = existingCache;
  if (propsSplit) {
    console.log(`[GitHub Actions] 🔄 Re-reading cache before merge to get latest from parallel jobs...`);
    const latestCache = await getCache(cacheKey);
    if (latestCache && Array.isArray(latestCache) && latestCache.length > 0) {
      cacheToMerge = latestCache;
      console.log(`[GitHub Actions] 📦 Found updated cache (${cacheToMerge.length} props) - will merge with new data`);
    } else if (existingCache && Array.isArray(existingCache) && existingCache.length > 0) {
      cacheToMerge = existingCache;
      console.log(`[GitHub Actions] 📦 Using initial cache (${cacheToMerge.length} props) - no updates from parallel jobs yet`);
    }
  }
  
  if (shouldMerge && cacheToMerge && Array.isArray(cacheToMerge) && cacheToMerge.length > 0) {
    // Create a Set of keys from new props to avoid duplicates
    const newPropsKeys = new Set(
      propsWithStats.map(p => `${p.playerName}|${p.statType}|${Math.round(p.line * 2) / 2}`)
    );
    
    if (propsSplit) {
      // When splitting by props: merge ALL existing props (from other parallel jobs)
      // Only exclude exact duplicates based on player|stat|line
      const uniqueExistingProps = cacheToMerge.filter(existingProp => {
        // Validate prop structure before merging
        if (!existingProp.playerName || !existingProp.statType || existingProp.line === undefined || existingProp.line === null) {
          console.warn(`[GitHub Actions] ⚠️ Skipping invalid prop in cache:`, {
            hasPlayerName: !!existingProp.playerName,
            hasStatType: !!existingProp.statType,
            hasLine: existingProp.line !== undefined && existingProp.line !== null
          });
          return false;
        }
        
        const key = `${existingProp.playerName}|${existingProp.statType}|${Math.round(existingProp.line * 2) / 2}`;
        return !newPropsKeys.has(key);
      });
      
      // Validate new props before merging
      const validNewProps = propsWithStats.filter(prop => {
        if (!prop.playerName || !prop.statType || prop.line === undefined || prop.line === null) {
          console.warn(`[GitHub Actions] ⚠️ Skipping invalid new prop:`, {
            playerName: prop.playerName,
            statType: prop.statType,
            line: prop.line
          });
          return false;
        }
        return true;
      });
      
      finalProps = [...validNewProps, ...uniqueExistingProps];
      console.log(`[GitHub Actions] 🔀 Merging (split mode): ${validNewProps.length} new props + ${uniqueExistingProps.length} existing props = ${finalProps.length} total`);
    } else if (allowedStats) {
      // When filtering by stats: only keep existing props that are NOT in the filtered stat list
      const existingPropsToKeep = cacheToMerge.filter(existingProp => {
        return !allowedStats.includes(existingProp.statType);
      });
      
      const uniqueExistingProps = existingPropsToKeep.filter(existingProp => {
        const key = `${existingProp.playerName}|${existingProp.statType}|${Math.round(existingProp.line * 2) / 2}`;
        return !newPropsKeys.has(key);
      });
      
      finalProps = [...propsWithStats, ...uniqueExistingProps];
      console.log(`[GitHub Actions] 🔀 Merging (stats filter): ${propsWithStats.length} new props + ${uniqueExistingProps.length} existing props (kept ${existingPropsToKeep.length} total, filtered ${cacheToMerge.length - existingPropsToKeep.length} duplicates)`);
    }
    
    console.log(`[GitHub Actions] ✅ Saving ${finalProps.length} props to cache (merged with existing)`);
  } else {
    console.log(`[GitHub Actions] ✅ Saving ${finalProps.length} props to cache (overwriting existing)`);
  }
  
  // Clear checkpoint and save final cache
  // When splitting by props, use retry logic to handle race conditions
  const maxRetries = propsSplit ? 3 : 1;
  let savedSuccessfully = false;
  
  for (let retry = 0; retry < maxRetries && !savedSuccessfully; retry++) {
    try {
      // If retrying, re-read cache to get latest (another job may have written)
      if (retry > 0 && propsSplit) {
        console.log(`[GitHub Actions] 🔄 Retry ${retry}: Re-reading cache before save...`);
        const retryCache = await getCache(cacheKey);
        if (retryCache && Array.isArray(retryCache) && retryCache.length > 0) {
          // Re-merge with latest cache
          const newPropsKeys = new Set(
            propsWithStats.map(p => `${p.playerName}|${p.statType}|${Math.round(p.line * 2) / 2}`)
          );
          const uniqueExistingProps = retryCache.filter(existingProp => {
            const key = `${existingProp.playerName}|${existingProp.statType}|${Math.round(existingProp.line * 2) / 2}`;
            return !newPropsKeys.has(key);
          });
          finalProps = [...propsWithStats, ...uniqueExistingProps];
          console.log(`[GitHub Actions] 🔀 Re-merged for retry: ${propsWithStats.length} new + ${uniqueExistingProps.length} existing = ${finalProps.length} total`);
        }
      }
      
      // IMPORTANT: Clear old cache ONLY after processing is complete and we're ready to save new cache
      // This ensures we never have an empty cache - old cache is only cleared when new cache is ready
      // For split jobs, we merge (don't clear) because other parallel jobs might still be writing
      // For non-split jobs, we clear and replace atomically
      
      // Always clear checkpoint (safe - it's just a progress tracker)
      await supabase.from('nba_api_cache').delete().eq('cache_key', checkpointKey);
      
      // Only clear main cache if NOT splitting (single job processing all props)
      // When splitting, we merge with other jobs' results, so we can't clear
      if (!propsSplit && finalProps.length > 0) {
        console.log(`[GitHub Actions] 🧹 Clearing old cache before saving new cache (non-split job)...`);
        try {
          await supabase.from('nba_api_cache').delete().eq('cache_key', cacheKey);
          console.log(`[GitHub Actions] ✅ Cleared old cache for key: ${cacheKey}`);
        } catch (clearError) {
          console.warn(`[GitHub Actions] ⚠️ Warning: Could not clear old cache (non-fatal): ${clearError.message}`);
          // Continue anyway - setCache will overwrite
        }
      } else if (propsSplit) {
        console.log(`[GitHub Actions] 📦 Split job: Merging with existing cache (not clearing - other jobs may be writing)`);
      } else if (finalProps.length === 0) {
        console.warn(`[GitHub Actions] ⚠️ No props to save - skipping cache clear to preserve existing data`);
        throw new Error('No props processed - cannot clear cache without replacement data');
      }
      
      console.log(`[GitHub Actions] 💾 Saving ${propsSplit ? 'merged' : 'new'} cache with key: ${cacheKey}${retry > 0 ? ` (retry ${retry})` : ''}`);
      console.log(`[GitHub Actions] 📊 Cache details: gameDate=${gameDate}, propsCount=${finalProps.length}`);
      
      // Debug: Log stat type breakdown
      const statTypeCounts = {};
      finalProps.forEach(prop => {
        statTypeCounts[prop.statType] = (statTypeCounts[prop.statType] || 0) + 1;
      });
      console.log(`[GitHub Actions] 📊 Stat type breakdown:`, statTypeCounts);
      
      // Save the new cache (replaces old one if we cleared it, or merges if splitting)
      await setCache(cacheKey, finalProps, 24 * 60);
      
      // Verify the save by reading it back (with small delay to ensure write completed)
      if (propsSplit) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for cache to propagate
      }
      const verifyCache = await getCache(cacheKey);
      
      if (verifyCache && Array.isArray(verifyCache)) {
        // Check if our props are in the cache (at least some of them)
        const ourPropsKeys = new Set(
          propsWithStats.map(p => `${p.playerName}|${p.statType}|${Math.round(p.line * 2) / 2}`)
        );
        const ourPropsInCache = verifyCache.filter(prop => {
          const key = `${prop.playerName}|${prop.statType}|${Math.round(prop.line * 2) / 2}`;
          return ourPropsKeys.has(key);
        });
        
        // If at least 80% of our props are in cache, consider it successful
        const successThreshold = Math.floor(propsWithStats.length * 0.8);
        if (ourPropsInCache.length >= successThreshold) {
          savedSuccessfully = true;
          console.log(`[GitHub Actions] ✅ Verified: Cache contains ${verifyCache.length} props after save (${ourPropsInCache.length}/${propsWithStats.length} of our props present)`);
          const verifyStatTypes = {};
          verifyCache.forEach(prop => {
            verifyStatTypes[prop.statType] = (verifyStatTypes[prop.statType] || 0) + 1;
          });
          console.log(`[GitHub Actions] 📊 Verified stat types:`, verifyStatTypes);
        } else {
          console.warn(`[GitHub Actions] ⚠️ Verification failed: Only ${ourPropsInCache.length}/${propsWithStats.length} of our props in cache (threshold: ${successThreshold})`);
          if (retry < maxRetries - 1) {
            const delay = (retry + 1) * 1000; // Exponential backoff: 1s, 2s, 3s
            console.log(`[GitHub Actions] 🔄 Will retry in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      } else {
        console.warn(`[GitHub Actions] ⚠️ Warning: Could not verify cache after save`);
        // If no cache found, assume it's a first write and accept it
        if (!existingCache || existingCache.length === 0) {
          savedSuccessfully = true;
        } else if (retry < maxRetries - 1) {
          const delay = (retry + 1) * 1000;
          console.log(`[GitHub Actions] 🔄 Will retry in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      if (savedSuccessfully) {
        console.log(`[GitHub Actions] ✅ Processing complete! Saved ${finalProps.length} props to cache`);
        console.log(`[GitHub Actions] 🔑 Cache key saved: ${cacheKey}`);
        break; // Exit retry loop on success
      }
    } catch (e) {
      console.error(`[GitHub Actions] ⚠️ Error saving final cache (attempt ${retry + 1}/${maxRetries}): ${e.message}`);
      if (retry === maxRetries - 1) {
        // Last retry failed, try to save partial data
        try {
          await setCache(cacheKey, propsWithStats, 24 * 60);
          console.log(`[GitHub Actions] ✅ Saved partial data: ${propsWithStats.length} props to cache`);
        } catch (e2) {
          console.error(`[GitHub Actions] ❌ Failed to save cache after all retries: ${e2.message}`);
          throw e2;
        }
      } else {
        // Wait before retrying
        const delay = (retry + 1) * 1000;
        console.log(`[GitHub Actions] 🔄 Will retry in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  if (!savedSuccessfully && !propsSplit) {
    // For non-split jobs, if we couldn't save, that's an error
    throw new Error('Failed to save cache after all retries');
  }
}

processPlayerProps().catch((error) => {
  console.error('[GitHub Actions] ❌ Fatal error:', error);
  process.exit(1);
});
