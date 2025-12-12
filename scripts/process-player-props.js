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

// Import mappings - use production API to get these or inline them
// For now, we'll call production APIs for stats/depth-chart/DvP (read-only, fast)
// All processing logic is here in the script

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PLAYER_PROPS_CACHE_PREFIX = 'nba-player-props-processed-v2';
const CHECKPOINT_CACHE_PREFIX = 'nba-player-props-checkpoint-v2';

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
  
  const todayUSET = getUSEasternDateString(new Date());
  
  if (!oddsCache.games || oddsCache.games.length === 0) {
    return todayUSET;
  }
  
  const gameDates = new Set();
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDates.add(commenceStr);
    } else {
      const date = new Date(commenceStr);
      gameDates.add(getUSEasternDateString(date));
    }
  }
  
  if (gameDates.has(todayUSET)) {
    return todayUSET;
  }
  
  return Array.from(gameDates).sort()[0] || todayUSET;
}

function calculateImpliedProbabilities(overOddsStr, underOddsStr) {
  const overOdds = (overOddsStr && overOddsStr !== 'N/A') 
    ? (typeof overOddsStr === 'string' ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(overOddsStr)))
    : null;
  const underOdds = (underOddsStr && underOddsStr !== 'N/A')
    ? (typeof underOddsStr === 'string' ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(underOddsStr)))
    : null;
  
  if (overOdds === null || underOdds === null || !Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
    return null;
  }
  
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

function getPlayerIdFromName(playerName) {
  // Call production API to get player ID mapping
  // For now, return empty string - will be filled when processing
  return '';
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

function getPlayerPropsCacheKey(gameDate, oddsLastUpdated, vendorCount) {
  return `${PLAYER_PROPS_CACHE_PREFIX}-${gameDate}-${oddsLastUpdated}-v${vendorCount}`;
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
    await supabase
      .from('nba_api_cache')
      .upsert({
        cache_key: key,
        cache_type: 'player-props',
        data: value,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      });
  } catch (e) {
    console.error(`Failed to save cache: ${e.message}`);
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
  const vendors = getPlayerPropVendors(oddsCache);
  const vendorCount = vendors.length;
  const cacheKey = getPlayerPropsCacheKey(gameDate, oddsCache.lastUpdated, vendorCount);
  const checkpointKey = `${CHECKPOINT_CACHE_PREFIX}-${gameDate}-${oddsCache.lastUpdated}-v${vendorCount}`;
  
  console.log(`[GitHub Actions] 📅 Processing for game date: ${gameDate}, vendors: ${vendorCount}`);
  
  // Check for force refresh flag
  const forceRefresh = process.argv.includes('--refresh') || process.argv.includes('-r');
  
  // Check existing cache
  const existingCache = await getCache(cacheKey);
  if (existingCache && Array.isArray(existingCache) && existingCache.length > 0 && !forceRefresh) {
    console.log(`[GitHub Actions] ✅ Cache already exists (${existingCache.length} props)`);
    console.log(`[GitHub Actions] 💡 Use --refresh flag to force recalculation`);
    return;
  }
  
  if (forceRefresh) {
    console.log(`[GitHub Actions] 🔄 Force refresh requested, recalculating all props...`);
  }
  
  // Extract props from odds cache (same logic as route.ts)
  const games = oddsCache.games || [];
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
            
            const overOdds = parseAmericanOdds(overOddsStr);
            const underOdds = parseAmericanOdds(underOddsStr);
            
            if (overOdds === null || underOdds === null) continue;
            
            const implied = calculateImpliedProbabilities(overOdds, underOdds);
            const overProb = implied ? implied.overImpliedProb : americanToImpliedProb(overOdds);
            const underProb = implied ? implied.underImpliedProb : americanToImpliedProb(underOdds);
            
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
      processedProps.push(bestProp);
    }
  }
  
  // Remove duplicates
  const uniqueProps = processedProps.filter((prop, index, self) =>
    index === self.findIndex((p) => 
      p.playerName === prop.playerName && 
      p.statType === prop.statType && 
      Math.abs(p.line - prop.line) < 0.1
    )
  );
  
  console.log(`[GitHub Actions] ✅ Processed ${uniqueProps.length} props, calculating stats...`);
  
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
  // Increased batch size and process in parallel for speed
  const BATCH_SIZE = 20; // Process 20 props at a time in parallel
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
    
    // Process all props in batch in parallel
    const batchPromises = batch.map(async (prop) => {
      try {
        // Get player ID (with caching)
        let playerId = playerIdCache.get(prop.playerName);
        if (!playerId) {
          const playerSearch = await callAPI(`/api/bdl/players?q=${encodeURIComponent(prop.playerName)}&per_page=5`).catch(() => ({ results: [] }));
          playerId = playerSearch?.results?.[0]?.id || prop.playerId || '';
          if (playerId) playerIdCache.set(prop.playerName, playerId);
        }
        
        // Get position from depth chart (with caching)
        let position = depthChartCache.get(prop.team);
        if (!position) {
          const depthChart = await callAPI(`/api/depth-chart?team=${encodeURIComponent(prop.team)}`).catch(() => null);
          if (depthChart?.depthChart) {
            // Find player in depth chart
            for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
              const players = depthChart.depthChart[pos] || [];
              if (players.some(p => {
                const name = typeof p === 'string' ? p : (p?.name || p?.displayName || '');
                return name.toLowerCase().includes(prop.playerName.toLowerCase()) || prop.playerName.toLowerCase().includes(name.toLowerCase());
              })) {
                position = pos;
                break;
              }
            }
          }
          if (position) depthChartCache.set(prop.team, position);
        }
        
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
            
            // Fetch current season: regular first, then playoffs (sequential with delay)
            let currSeasonReg;
            try {
              currSeasonReg = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=3&postseason=false`);
              if (currSeasonReg?.data && Array.isArray(currSeasonReg.data)) {
                allStats.push(...currSeasonReg.data);
                console.log(`[GitHub Actions] ✅ Fetched ${currSeasonReg.data.length} stats for ${prop.playerName} (${playerId}), season ${currentSeason}, regular`);
              }
            } catch (e) {
              console.warn(`[GitHub Actions] ⚠️ Failed to fetch stats for ${prop.playerName} (${playerId}), season ${currentSeason}, regular:`, e.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 300)); // Delay between regular and postseason
            
            let currSeasonPo;
            try {
              currSeasonPo = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=3&postseason=true`);
              if (currSeasonPo?.data && Array.isArray(currSeasonPo.data)) {
                allStats.push(...currSeasonPo.data);
                console.log(`[GitHub Actions] ✅ Fetched ${currSeasonPo.data.length} stats for ${prop.playerName} (${playerId}), season ${currentSeason}, playoffs`);
              }
            } catch (e) {
              console.warn(`[GitHub Actions] ⚠️ Failed to fetch stats for ${prop.playerName} (${playerId}), season ${currentSeason}, playoffs:`, e.message);
            }
            
            // Small delay between seasons
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Fetch previous season: regular first, then playoffs (sequential with delay)
            let prevSeasonReg;
            try {
              prevSeasonReg = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=3&postseason=false`);
              if (prevSeasonReg?.data && Array.isArray(prevSeasonReg.data)) {
                allStats.push(...prevSeasonReg.data);
                console.log(`[GitHub Actions] ✅ Fetched ${prevSeasonReg.data.length} stats for ${prop.playerName} (${playerId}), season ${currentSeason - 1}, regular`);
              }
            } catch (e) {
              console.warn(`[GitHub Actions] ⚠️ Failed to fetch stats for ${prop.playerName} (${playerId}), season ${currentSeason - 1}, regular:`, e.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 300)); // Delay between regular and postseason
            
            let prevSeasonPo;
            try {
              prevSeasonPo = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason - 1}&per_page=100&max_pages=3&postseason=true`);
              if (prevSeasonPo?.data && Array.isArray(prevSeasonPo.data)) {
                allStats.push(...prevSeasonPo.data);
                console.log(`[GitHub Actions] ✅ Fetched ${prevSeasonPo.data.length} stats for ${prop.playerName} (${playerId}), season ${currentSeason - 1}, playoffs`);
              }
            } catch (e) {
              console.warn(`[GitHub Actions] ⚠️ Failed to fetch stats for ${prop.playerName} (${playerId}), season ${currentSeason - 1}, playoffs:`, e.message);
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
              console.log(`[GitHub Actions] ✅ Found ${gamesWithStats.length} games with stats for ${prop.playerName} ${prop.statType}`);
              
              // Calculate season average
              const seasonValues = gamesWithStats.map((g) => g.statValue);
              const seasonSum = seasonValues.reduce((sum, val) => sum + val, 0);
              averages.seasonAvg = seasonValues.length > 0 ? seasonSum / seasonValues.length : null;
              
              // Calculate season hit rate
              if (Number.isFinite(prop.line) && seasonValues.length > 0) {
                const hits = seasonValues.filter((val) => val > prop.line).length;
                averages.seasonHitRate = { hits, total: seasonValues.length };
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
        
        // Get DvP (with caching)
        let dvp = { rank: null, statValue: null };
        if (position && prop.opponent) {
          const dvpMetric = mapStatTypeToDvpMetric(prop.statType);
          if (dvpMetric) {
            const dvpKey = `${position}-${dvpMetric}-${prop.opponent}`;
            const cachedDvp = dvpCache.get(dvpKey);
            if (cachedDvp && typeof cachedDvp === 'object') {
              dvp = cachedDvp;
            } else {
              try {
                const dvpData = await callAPI(`/api/dvp/rank?pos=${position}&metric=${dvpMetric}`).catch(() => null);
                if (dvpData && dvpData.ranks && typeof dvpData.ranks === 'object') {
                  const teamAbbr = TEAM_FULL_TO_ABBR[prop.opponent] || prop.opponent.toUpperCase();
                  dvp = {
                    rank: dvpData.ranks[teamAbbr] || null,
                    statValue: (dvpData.values && Array.isArray(dvpData.values)) 
                      ? (dvpData.values.find(v => v && v.team && v.team.toUpperCase() === teamAbbr)?.value || null)
                      : null
                  };
                  dvpCache.set(dvpKey, dvp);
                } else {
                  dvpCache.set(dvpKey, dvp);
                }
              } catch (e) {
                dvpCache.set(dvpKey, dvp);
              }
            }
          }
        }
        
        // Ensure dvp is always an object with rank and statValue
        const safeDvp = (dvp && typeof dvp === 'object') ? dvp : { rank: null, statValue: null };
        
        return {
          ...prop,
          playerId,
          position,
          ...averages,
          dvpRating: safeDvp.rank || null,
          dvpStatValue: safeDvp.statValue || null,
        };
      } catch (e) {
        console.error(`[GitHub Actions] Error processing ${prop.playerName}:`, e.message);
        return { ...prop, position: null, dvpRating: null, dvpStatValue: null };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    propsWithStats.push(...batchResults);
    
    // Save checkpoint after each batch
    await setCache(checkpointKey, {
      processedProps: propsWithStats,
      startIndex: i + BATCH_SIZE,
      totalProps: uniqueProps.length,
      processedCount: propsWithStats.length,
    }, 60);
    
    if (i + BATCH_SIZE < uniqueProps.length) {
      // Small delay between batches to avoid overwhelming APIs
      await new Promise(resolve => setTimeout(resolve, 100));
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
  
  // Clear checkpoint and save final cache
  await supabase.from('nba_api_cache').delete().eq('cache_key', checkpointKey);
  await setCache(cacheKey, propsWithStats, 24 * 60);
  
  console.log(`[GitHub Actions] ✅ Processing complete! Saved ${propsWithStats.length} props to cache`);
}

processPlayerProps().catch((error) => {
  console.error('[GitHub Actions] ❌ Fatal error:', error);
  process.exit(1);
});
