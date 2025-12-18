#!/usr/bin/env node

/**
 * Full NBA-wide refresh for all player shot charts and play type analysis
 * Runs from GitHub Actions to update ALL players' caches
 * 
 * This script calls NBA API directly (not through Vercel) and caches to Supabase
 * 
 * Usage:
 *   node scripts/refresh-all-player-caches.js
 */

const https = require('https');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');
// Try to load .env.local, but don't fail if it doesn't exist (GitHub Actions uses secrets)
try {
  require('dotenv').config({ path: '.env.local' });
} catch (e) {
  // Ignore - environment variables will come from GitHub Actions secrets
}

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
  const year = now.getFullYear();
  // NBA season starts in October (month 9)
  return month >= 9 ? year : year - 1;
}

function formatSeason(season) {
  return `${season}-${String(season + 1).slice(-2)}`;
}

// Fetch from NBA Stats API
function fetchNBAStats(url, timeout = 20000, retries = 2) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    
    const makeRequest = () => {
      attempt++;
      const urlObj = new URL(url);
      
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: NBA_HEADERS,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse JSON: ${e.message}`));
            }
          } else if (res.statusCode >= 500 && attempt <= retries) {
            console.log(`[NBA API] Server error ${res.statusCode} on attempt ${attempt}, retrying...`);
            setTimeout(makeRequest, 2000 * attempt);
          } else {
            reject(new Error(`NBA API ${res.statusCode}: ${res.statusText}`));
          }
        });
      });

      req.on('error', (error) => {
        if (attempt <= retries) {
          console.log(`[NBA API] Error on attempt ${attempt}, retrying...`);
          setTimeout(makeRequest, 1000 * attempt);
        } else {
          reject(error);
        }
      });

      req.setTimeout(timeout, () => {
        req.destroy();
        if (attempt <= retries) {
          console.log(`[NBA API] Timeout on attempt ${attempt}, retrying...`);
          setTimeout(makeRequest, 1000 * attempt);
        } else {
          reject(new Error(`Request timeout after ${timeout}ms`));
        }
      });

      req.end();
    };

    makeRequest();
  });
}

// Fetch from BDL API
async function fetchBDL(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`BDL API ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// Get all active players from BDL
async function getAllActivePlayers() {
  console.log(`[Refresh All Player Caches] Fetching all active players from BDL API...`);
  
  const allPlayers = [];
  let cursor = null;
  let page = 1;
  const maxPages = 60;

  while (page <= maxPages) {
    try {
      const url = new URL(`${BDL_BASE}/players/active`);
      url.searchParams.set('per_page', '100');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const data = await fetchBDL(url.toString());
      const players = Array.isArray(data?.data) ? data.data : [];
      
      allPlayers.push(...players);
      console.log(`[Refresh All Player Caches] Page ${page}: ${players.length} players (total: ${allPlayers.length})`);

      cursor = data?.meta?.next_cursor || null;
      if (!cursor) break;

      page++;
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[Refresh All Player Caches] Error fetching page ${page}:`, error.message);
      break;
    }
  }

  console.log(`[Refresh All Player Caches] ✅ Found ${allPlayers.length} active players`);
  return allPlayers;
}

// Load player ID mappings
let playerIdMappings = null;
function loadPlayerIdMappings() {
  if (playerIdMappings) return playerIdMappings;
  
  try {
    const fs = require('fs');
    const path = require('path');
    const mappingPath = path.join(__dirname, 'player-id-mappings.json');
    if (fs.existsSync(mappingPath)) {
      const data = fs.readFileSync(mappingPath, 'utf8');
      playerIdMappings = JSON.parse(data);
      return playerIdMappings;
    }
  } catch (error) {
    console.warn(`Warning: Could not load player ID mappings: ${error.message}`);
  }
  return [];
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
  console.warn(`  ⚠️  No NBA Stats ID mapping found for BDL ID ${bdlPlayerId}`);
  return bdlIdStr;
}

// Cache shot chart for a player
async function cachePlayerShotChart(playerId, season, seasonStr) {
  try {
    const nbaPlayerId = getNbaStatsId(playerId);
    
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
        const shotZones = {
          restrictedArea: {
            fgm: zoneStats.restrictedArea.made,
            fga: zoneStats.restrictedArea.attempted,
            fgPct: (zoneStats.restrictedArea.made / zoneStats.restrictedArea.attempted) * 100,
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
          }
        };

        const response = {
          playerId: nbaPlayerId,
          originalPlayerId: playerId !== nbaPlayerId ? playerId : undefined,
          season: seasonStr,
          shotZones,
          opponentTeam: null,
          opponentDefense: null,
          opponentRankings: null,
          cachedAt: new Date().toISOString()
        };

        // Cache to Supabase (365 days TTL)
        const cacheKey = `shot_enhanced_${nbaPlayerId}_none_${season}`;
        const ttlMinutes = 365 * 24 * 60;
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

        const { error: cacheError } = await supabase
          .from('nba_api_cache')
          .upsert({
            cache_key: cacheKey,
            cache_type: 'shot_chart',
            data: response,
            expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'cache_key'
          });

        if (cacheError) {
          console.error(`  ❌ Failed to cache shot chart: ${cacheError.message}`);
          return false;
        }

        console.log(`  ✅ Cached shot chart for player ${playerId} (NBA: ${nbaPlayerId})`);
        return true;
      } else {
        console.log(`  ⚠️  No shot data for player ${playerId}`);
        return false;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`  ❌ Error caching shot chart for player ${playerId}:`, error.message);
    return false;
  }
}

// Cache play type analysis for a player (simplified - just trigger the endpoint logic)
// For now, we'll call the production endpoint with bypassCache and X-Allow-NBA-API header
async function cachePlayerPlayType(playerId, season, seasonStr) {
  // This is complex - for now, we'll skip it and let the bulk cache handle it
  // The bulk cache refresh already handles play types
  return true;
}

// Main function
async function main() {
  console.log('========================================');
  console.log('Refresh All Player Shot Charts & Play Types');
  console.log('========================================');
  console.log('');
  
  const season = currentNbaSeason();
  const seasonStr = formatSeason(season);
  
  console.log(`Season: ${seasonStr}`);
  console.log('');
  
  // Get all active players
  const players = await getAllActivePlayers();
  
  if (players.length === 0) {
    console.log('No active players found');
    return;
  }
  
  console.log(`Processing ${players.length} players...`);
  console.log('');
  
  let shotChartSuccess = 0;
  let shotChartFail = 0;
  
  // Process in batches
  const batchSize = 10;
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(players.length / batchSize)} (players ${i + 1}-${Math.min(i + batchSize, players.length)})...`);
    
    const batchPromises = batch.map(async (player) => {
      const success = await cachePlayerShotChart(player.id, season, seasonStr);
      return { playerId: player.id, success };
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const result of batchResults) {
      if (result.success) shotChartSuccess++;
      else shotChartFail++;
    }
    
    // Delay between batches
    if (i + batchSize < players.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('');
  console.log('========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Shot Charts: ${shotChartSuccess} success, ${shotChartFail} failed`);
  console.log('');
  console.log('✅ Refresh complete!');
  console.log('');
  console.log('Note: Play type analysis is handled by bulk cache refresh.');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };

