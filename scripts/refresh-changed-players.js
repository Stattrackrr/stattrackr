#!/usr/bin/env node

/**
 * Refresh only players/teams with changed stats
 * Runs at midnight to update only what changed
 * 
 * Usage:
 *   node scripts/refresh-changed-players.js
 */

const https = require('https');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

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
const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/stats/',
  'Origin': 'https://www.nba.com',
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

// Get current NBA season
function currentNbaSeason() {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 9 && day >= 15) return now.getFullYear();
  return month >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

function formatSeason(seasonYear) {
  const nextYear = (seasonYear + 1).toString().slice(-2);
  return `${seasonYear}-${nextYear}`;
}

// Fetch from NBA API
function fetchNBAStats(url, timeout = 20000, retries = 2) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const maxAttempts = retries + 1;

    function makeRequest() {
      attempt++;
      console.log(`  Fetching NBA API (attempt ${attempt}/${maxAttempts})...`);
      
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: NBA_HEADERS,
        timeout: timeout
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              resolve(json);
            } catch (e) {
              reject(new Error(`Failed to parse JSON: ${e.message}`));
            }
          } else if (res.statusCode >= 500 && attempt < maxAttempts) {
            const delay = 1000 * attempt;
            console.log(`  Server error ${res.statusCode}, retrying after ${delay}ms...`);
            setTimeout(makeRequest, delay);
          } else {
            reject(new Error(`NBA API ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        if ((error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) && attempt < maxAttempts) {
          const delay = 1000 * attempt;
          console.log(`  Network error, retrying after ${delay}ms...`);
          setTimeout(makeRequest, delay);
        } else {
          reject(error);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < maxAttempts) {
          console.log(`  Timeout, retrying...`);
          setTimeout(makeRequest, 1000 * attempt);
        } else {
          reject(new Error(`Request timeout after ${timeout}ms`));
        }
      });

      req.end();
    }

    makeRequest();
  });
}

// Save to Supabase cache
async function setNBACache(cacheKey, cacheType, data, ttlMinutes = 1440) {
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

// Get refresh queue from Supabase
async function getRefreshQueue() {
  const { data, error } = await supabase
    .from('nba_api_cache')
    .select('data')
    .eq('cache_key', 'cache_refresh_queue')
    .single();

  if (error || !data) {
    console.log('No refresh queue found (no games played today)');
    return { playerIds: [], teamAbbrs: [] };
  }

  return data.data || { playerIds: [], teamAbbrs: [] };
}

// Load player ID mappings
let playerIdMappings = null;
function loadPlayerIdMappings() {
  if (playerIdMappings) return playerIdMappings;
  
  try {
    const fs = require('fs');
    const path = require('path');
    const mappingPath = path.join(__dirname, 'player-id-mappings.json');
    const data = fs.readFileSync(mappingPath, 'utf8');
    playerIdMappings = JSON.parse(data);
    return playerIdMappings;
  } catch (error) {
    console.warn(`Warning: Could not load player ID mappings: ${error.message}`);
    return [];
  }
}

// Convert BDL player ID to NBA Stats ID
function getNbaStatsId(bdlPlayerId) {
  const mappings = loadPlayerIdMappings();
  const bdlIdStr = String(bdlPlayerId);
  const mapping = mappings.find(m => m.bdlId === bdlIdStr);
  
  if (mapping) {
    return mapping.nbaId;
  }
  
  // If no mapping found, return the BDL ID (some players might have same ID)
  // The NBA API might accept it, or it will fail and we'll skip that player
  console.warn(`  ⚠️  No NBA Stats ID mapping found for BDL ID ${bdlPlayerId}`);
  return bdlIdStr;
}

// Cache shot chart for a player
async function cachePlayerShotChart(playerId, season, seasonStr) {
  try {
    const nbaPlayerId = await getNbaStatsId(playerId);
    
    const params = new URLSearchParams({
      LeagueID: '00',
      PlayerID: nbaPlayerId,
      Season: seasonStr,
      SeasonType: 'Regular Season',
      TeamID: '0',
      Outcome: '',
      Location: '',
      Month: '0',
      SeasonSegment: '',
      DateFrom: '',
      DateTo: '',
      OpponentTeamID: '0',
      VsConference: '',
      VsDivision: '',
      GameSegment: '',
      Period: '0',
      LastNGames: '0',
      ContextMeasure: 'FGA',
      RookieYear: '',
      Position: '',
    });

    const url = `${NBA_STATS_BASE}/shotchartdetail?${params.toString()}`;
    const data = await fetchNBAStats(url, 20000, 2);

    if (data?.resultSets?.[0]) {
      const resultSet = data.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];

      const shotZoneBasicIdx = headers.indexOf('SHOT_ZONE_BASIC');
      const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');

      const zoneStats = {
        restrictedArea: { made: 0, attempted: 0 },
        paint: { made: 0, attempted: 0 },
        midRange: { made: 0, attempted: 0 },
        leftCorner3: { made: 0, attempted: 0 },
        rightCorner3: { made: 0, attempted: 0 },
        aboveBreak3: { made: 0, attempted: 0 },
      };

      for (const row of rows) {
        const zone = row[shotZoneBasicIdx];
        const made = row[shotMadeIdx] === 1;
        
        if (zone === 'Restricted Area') {
          zoneStats.restrictedArea.attempted++;
          if (made) zoneStats.restrictedArea.made++;
        } else if (zone === 'In The Paint (Non-RA)') {
          zoneStats.paint.attempted++;
          if (made) zoneStats.paint.made++;
        } else if (zone === 'Mid-Range') {
          zoneStats.midRange.attempted++;
          if (made) zoneStats.midRange.made++;
        } else if (zone === 'Left Corner 3') {
          zoneStats.leftCorner3.attempted++;
          if (made) zoneStats.leftCorner3.made++;
        } else if (zone === 'Right Corner 3') {
          zoneStats.rightCorner3.attempted++;
          if (made) zoneStats.rightCorner3.made++;
        } else if (zone === 'Above the Break 3') {
          zoneStats.aboveBreak3.attempted++;
          if (made) zoneStats.aboveBreak3.made++;
        }
      }

      const totalFGA = Object.values(zoneStats).reduce((sum, z) => sum + z.attempted, 0);
      
      if (totalFGA > 0) {
        const response = {
          playerId: nbaPlayerId,
          season: seasonStr,
          shotZones: {
            restrictedArea: {
              fgm: zoneStats.restrictedArea.made,
              fga: zoneStats.restrictedArea.attempted,
              fgPct: zoneStats.restrictedArea.attempted > 0 ? (zoneStats.restrictedArea.made / zoneStats.restrictedArea.attempted) * 100 : 0,
              pts: zoneStats.restrictedArea.made * 2
            },
            paint: {
              fgm: zoneStats.paint.made,
              fga: zoneStats.paint.attempted,
              fgPct: zoneStats.paint.attempted > 0 ? (zoneStats.paint.made / zoneStats.paint.attempted) * 100 : 0,
              pts: zoneStats.paint.made * 2
            },
            midRange: {
              fgm: zoneStats.midRange.made,
              fga: zoneStats.midRange.attempted,
              fgPct: zoneStats.midRange.attempted > 0 ? (zoneStats.midRange.made / zoneStats.midRange.attempted) * 100 : 0,
              pts: zoneStats.midRange.made * 2
            },
            leftCorner3: {
              fgm: zoneStats.leftCorner3.made,
              fga: zoneStats.leftCorner3.attempted,
              fgPct: zoneStats.leftCorner3.attempted > 0 ? (zoneStats.leftCorner3.made / zoneStats.leftCorner3.attempted) * 100 : 0,
              pts: zoneStats.leftCorner3.made * 3
            },
            rightCorner3: {
              fgm: zoneStats.rightCorner3.made,
              fga: zoneStats.rightCorner3.attempted,
              fgPct: zoneStats.rightCorner3.attempted > 0 ? (zoneStats.rightCorner3.made / zoneStats.rightCorner3.attempted) * 100 : 0,
              pts: zoneStats.rightCorner3.made * 3
            },
            aboveBreak3: {
              fgm: zoneStats.aboveBreak3.made,
              fga: zoneStats.aboveBreak3.attempted,
              fgPct: zoneStats.aboveBreak3.attempted > 0 ? (zoneStats.aboveBreak3.made / zoneStats.aboveBreak3.attempted) * 100 : 0,
              pts: zoneStats.aboveBreak3.made * 3
            },
          },
          opponentTeam: null,
          opponentDefense: null,
          cachedAt: new Date().toISOString()
        };

        const cacheKey = `shot_enhanced_${nbaPlayerId}_none_${season}`;
        await setNBACache(cacheKey, 'shot_chart', response, 1440);
        console.log(`  ✅ Cached: ${totalFGA} shots`);
        return true;
      } else {
        console.log(`  ⚠️  No shot data`);
        return false;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    return false;
  }
}

// Main function
async function main() {
  console.log('========================================');
  console.log('Refreshing Changed Players/Teams');
  console.log('========================================');
  console.log('');
  
  const queue = await getRefreshQueue();
  const { playerIds, teamAbbrs } = queue;
  
  if (playerIds.length === 0 && teamAbbrs.length === 0) {
    console.log('No players/teams to refresh (no games played today)');
    return;
  }
  
  const season = currentNbaSeason();
  const seasonStr = formatSeason(season);
  
  console.log(`Players to refresh: ${playerIds.length}`);
  console.log(`Teams to refresh: ${teamAbbrs.length}`);
  console.log('');
  
  let shotChartSuccess = 0;
  let shotChartFail = 0;
  
  // Refresh shot charts for players who played
  if (playerIds.length > 0) {
    console.log('[1/2] Refreshing Shot Charts for Changed Players...');
    console.log('========================================');
    
    for (let i = 0; i < playerIds.length; i++) {
      const playerId = playerIds[i];
      console.log(`[${i + 1}/${playerIds.length}] Player ${playerId}...`);
      
      const success = await cachePlayerShotChart(playerId, season, seasonStr);
      if (success) {
        shotChartSuccess++;
      } else {
        shotChartFail++;
      }
      
      if (i < playerIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
      }
    }
  }
  
  // TODO: Refresh team tracking stats for teams that played
  // This would require calling the team tracking stats endpoint
  
  console.log('');
  console.log('========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Shot Charts: ${shotChartSuccess} success, ${shotChartFail} failed`);
  console.log('');
  console.log('✅ Refresh complete!');
  console.log('');
  console.log('Note: Unchanged players/teams remain cached.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };

