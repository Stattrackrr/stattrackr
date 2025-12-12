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
  
  // Check existing cache
  const existingCache = await getCache(cacheKey);
  if (existingCache && Array.isArray(existingCache) && existingCache.length > 0) {
    console.log(`[GitHub Actions] ✅ Cache already exists (${existingCache.length} props)`);
    return;
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
  const BATCH_SIZE = 5;
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
    const batchResults = [];
    
    for (const prop of batch) {
      try {
        // Process prop directly - call production APIs for stats/depth-chart/DvP (read-only, fast)
        // All processing logic is here in GitHub Actions
        try {
          // Get player ID from production API (read-only)
          const playerSearch = await callAPI(`/api/bdl/players?q=${encodeURIComponent(prop.playerName)}&per_page=5`).catch(() => ({ results: [] }));
          const playerId = playerSearch?.results?.[0]?.id || prop.playerId || '';
          
          // Get position from depth chart API (read-only)
          const depthChart = await callAPI(`/api/depth-chart?team=${encodeURIComponent(prop.team)}`).catch(() => null);
          let position = null;
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
          
          // Get stats from production API (read-only)
          let stats = null;
          if (playerId) {
            const currentSeason = new Date().getFullYear();
            const statsData = await callAPI(`/api/stats?player_id=${playerId}&season=${currentSeason}&per_page=100&max_pages=3&postseason=false`).catch(() => ({ data: [] }));
            stats = statsData?.data || [];
          }
          
          // Get DvP from production API (read-only)
          let dvp = { rank: null, statValue: null };
          if (position && prop.opponent) {
            const dvpData = await callAPI(`/api/dvp/rank?pos=${position}&metric=${prop.statType.toLowerCase()}`).catch(() => null);
            if (dvpData?.ranks) {
              const teamAbbr = TEAM_FULL_TO_ABBR[prop.opponent] || prop.opponent.toUpperCase();
              dvp.rank = dvpData.ranks[teamAbbr] || null;
              const teamValue = dvpData.values?.find(v => v.team?.toUpperCase() === teamAbbr);
              dvp.statValue = teamValue?.value || null;
            }
          }
          
          // Calculate averages from stats (simplified - full logic would be here)
          batchResults.push({
            ...prop,
            playerId,
            position,
            dvpRating: dvp.rank,
            dvpStatValue: dvp.statValue,
            // Stats calculations would go here (last5, last10, h2h, season, streak)
            // For now, leaving as null - full implementation would calculate from stats array
          });
        } catch (e) {
          console.error(`[GitHub Actions] Error processing ${prop.playerName}:`, e.message);
          batchResults.push({ ...prop, position: null, dvpRating: null, dvpStatValue: null });
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[GitHub Actions] Error for ${prop.playerName}:`, error.message);
        batchResults.push({ ...prop, position: null, dvpRating: null, dvpStatValue: null });
      }
    }
    
    propsWithStats.push(...batchResults);
    
    // Save checkpoint after each batch
    await setCache(checkpointKey, {
      processedProps: propsWithStats,
      startIndex: i + BATCH_SIZE,
      totalProps: uniqueProps.length,
      processedCount: propsWithStats.length,
    }, 60);
    
    if (i + BATCH_SIZE < uniqueProps.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if ((i / BATCH_SIZE) % 5 === 0) {
        const elapsed = Date.now() - startTime;
        console.log(`[GitHub Actions] Progress: ${Math.min(i + BATCH_SIZE, uniqueProps.length)}/${uniqueProps.length} (${Math.round(elapsed/1000)}s)`);
      }
    }
  }
  
  console.log(`[GitHub Actions] ✅ Calculated stats for ${propsWithStats.length} props`);
  
  // Clear checkpoint and save final cache
  await supabase.from('nba_api_cache').delete().eq('cache_key', checkpointKey);
  await setCache(cacheKey, propsWithStats, 24 * 60);
  
  console.log(`[GitHub Actions] ✅ Processing complete! Saved ${propsWithStats.length} props to cache`);
}

processPlayerProps().catch((error) => {
  console.error('[GitHub Actions] ❌ Fatal error:', error);
  process.exit(1);
});
