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
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  const headers = {
    'Accept': 'application/json',
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, { headers });

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

// Cache play type analysis for a player
async function cachePlayerPlayTypeAnalysis(playerId, season, seasonStr) {
  try {
    const nbaPlayerId = getNbaStatsId(playerId);
    
    const PLAY_TYPES = [
      { key: 'PRBallHandler', displayName: 'PNR Ball Handler' },
      { key: 'Transition', displayName: 'Transition' },
      { key: 'Spotup', displayName: 'Spot Up' },
      { key: 'OffScreen', displayName: 'Off Screen' },
      { key: 'Isolation', displayName: 'Isolation' },
      { key: 'Postup', displayName: 'Post Up' },
      { key: 'Cut', displayName: 'Cut' },
      { key: 'Handoff', displayName: 'Handoff' },
      { key: 'Misc', displayName: 'Misc' },
      { key: 'PRRollman', displayName: 'PNR Roll Man' },
      { key: 'OffRebound', displayName: 'Putbacks' },
      { key: 'FreeThrows', displayName: 'Free Throws' },
    ];

    const playerPlayTypesData = [];
    let totalPoints = 0;

    for (const { key, displayName } of PLAY_TYPES) {
      const params = new URLSearchParams({
        LeagueID: '00',
        PerMode: 'PerGame',
        PlayerOrTeam: 'P',
        SeasonType: 'Regular Season',
        SeasonYear: seasonStr,
        PlayType: key,
        TypeGrouping: 'offensive',
        PlayerID: nbaPlayerId,
      });

      const url = `${NBA_STATS_BASE}/synergyplaytypes?${params.toString()}`;
      
      // Skip if no valid NBA Player ID
      if (!nbaPlayerId || nbaPlayerId === 'undefined' || nbaPlayerId === 'null') {
        console.log(`  ⚠️  Skipping play type ${key} - invalid NBA Player ID: ${nbaPlayerId}`);
        playerPlayTypesData.push({
          playType: key,
          displayName,
          points: 0,
          possessions: 0,
          ppp: 0,
          ftPossPct: 0,
        });
        continue;
      }
      
      let data;
      try {
        data = await fetchNBAStats(url, 20000, 2);
      } catch (error) {
        // If 400 error (bad request), player probably doesn't have data for this play type
        // Just add zeros and continue
        if (error.message && error.message.includes('400')) {
          console.log(`  ⚠️  Play type ${key} returned 400 (no data), using zeros`);
          playerPlayTypesData.push({
            playType: key,
            displayName,
            points: 0,
            possessions: 0,
            ppp: 0,
            ftPossPct: 0,
          });
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }
        throw error; // Re-throw if not a 400 error
      }
      
      const resultSet = data?.resultSets?.[0];

      if (resultSet) {
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];
        
        if (rows.length > 0) {
          const row = rows[0];
          const pointsIdx = headers.indexOf('PTS');
          const possessionsIdx = headers.indexOf('POSS');
          const pppIdx = headers.indexOf('PPP');
          const ftPossPctIdx = headers.indexOf('FT_POSS_PCT');

          const points = pointsIdx >= 0 ? row[pointsIdx] : 0;
          const possessions = possessionsIdx >= 0 ? row[possessionsIdx] : 0;
          const ppp = pppIdx >= 0 ? row[pppIdx] : 0;
          const ftPossPct = ftPossPctIdx >= 0 ? row[ftPossPctIdx] : 0;

          playerPlayTypesData.push({
            playType: key,
            displayName,
            points,
            possessions,
            ppp,
            ftPossPct,
          });
          totalPoints += points;
        } else {
          playerPlayTypesData.push({
            playType: key,
            displayName,
            points: 0,
            possessions: 0,
            ppp: 0,
            ftPossPct: 0,
          });
        }
      } else {
        playerPlayTypesData.push({
          playType: key,
          displayName,
          points: 0,
          possessions: 0,
          ppp: 0,
          ftPossPct: 0,
        });
      }
      await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between play types
    }

    if (playerPlayTypesData.length > 0) {
      const playTypeCacheData = {
        playerId: nbaPlayerId,
        season: seasonStr,
        playTypes: playerPlayTypesData,
        totalPoints,
        cachedAt: new Date().toISOString(),
      };
      
      const cacheKey = `playtype_analysis_${nbaPlayerId}_${season}`;
      const ttlMinutes = 365 * 24 * 60;
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

      const { error: cacheError } = await supabase
        .from('nba_api_cache')
        .upsert({
          cache_key: cacheKey,
          cache_type: 'play_type',
          data: playTypeCacheData,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'cache_key'
        });

      if (cacheError) {
        console.error(`  ❌ Failed to cache play type: ${cacheError.message}`);
        return false;
      }

      console.log(`  ✅ Cached play type analysis for player ${playerId} (NBA: ${nbaPlayerId})`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`  ❌ Error caching play type analysis for player ${playerId}:`, error.message);
    return false;
  }
}

// Cache team defense rankings (all 30 teams)
async function cacheTeamDefenseRankings(season, seasonStr) {
  try {
    const NBA_TEAM_MAP = {
      'ATL': '1610612737', 'BOS': '1610612738', 'BKN': '1610612751', 'CHA': '1610612766',
      'CHI': '1610612741', 'CLE': '1610612739', 'DAL': '1610612742', 'DEN': '1610612743',
      'DET': '1610612765', 'GSW': '1610612744', 'HOU': '1610612745', 'IND': '1610612754',
      'LAC': '1610612746', 'LAL': '1610612747', 'MEM': '1610612763', 'MIA': '1610612748',
      'MIL': '1610612749', 'MIN': '1610612750', 'NOP': '1610612740', 'NYK': '1610612752',
      'OKC': '1610612760', 'ORL': '1610612753', 'PHI': '1610612755', 'PHX': '1610612756',
      'POR': '1610612757', 'SAC': '1610612758', 'SAS': '1610612759', 'TOR': '1610612761',
      'UTA': '1610612762', 'WAS': '1610612764'
    };

    console.log(`  🔄 Fetching team defense rankings for all 30 teams...`);
    
    const allTeamsData = [];
    const teams = Object.keys(NBA_TEAM_MAP);
    
    // Process teams in batches of 5
    const batchSize = 5;
    for (let i = 0; i < teams.length; i += batchSize) {
      const batch = teams.slice(i, i + batchSize);
      console.log(`  Processing teams ${i + 1}-${Math.min(i + batchSize, teams.length)}/${teams.length}...`);
      
      const batchPromises = batch.map(async (teamAbbr) => {
        const teamId = NBA_TEAM_MAP[teamAbbr];
        const defenseParams = new URLSearchParams({
          LeagueID: '00',
          Season: seasonStr,
          SeasonType: 'Regular Season',
          TeamID: '0',
          PlayerID: '0',
          Outcome: '',
          Location: '',
          Month: '0',
          SeasonSegment: '',
          DateFrom: '',
          DateTo: '',
          OpponentTeamID: teamId,
          VsConference: '',
          VsDivision: '',
          GameSegment: '',
          Period: '0',
          LastNGames: '0',
          ContextMeasure: 'FGA',
          RookieYear: '',
          Position: '',
        });

        const defenseUrl = `${NBA_STATS_BASE}/shotchartdetail?${defenseParams.toString()}`;
        const defenseData = await fetchNBAStats(defenseUrl, 60000, 2); // 60s timeout

        if (defenseData?.resultSets?.[0]) {
          const resultSet = defenseData.resultSets[0];
          const headers = resultSet.headers || [];
          const rows = resultSet.rowSet || [];

          const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
          const shotZoneBasicIdx = headers.indexOf('SHOT_ZONE_BASIC');

          const zoneStats = {
            restrictedArea: { made: 0, attempted: 0 },
            paint: { made: 0, attempted: 0 },
            midRange: { made: 0, attempted: 0 },
            leftCorner3: { made: 0, attempted: 0 },
            rightCorner3: { made: 0, attempted: 0 },
            aboveBreak3: { made: 0, attempted: 0 },
          };

          for (const row of rows) {
            const made = row[shotMadeIdx] === 1;
            const zone = row[shotZoneBasicIdx];

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

          return {
            team: teamAbbr,
            restrictedArea: {
              fgPct: zoneStats.restrictedArea.attempted > 0 ? (zoneStats.restrictedArea.made / zoneStats.restrictedArea.attempted) * 100 : 0,
              fga: zoneStats.restrictedArea.attempted,
              fgm: zoneStats.restrictedArea.made
            },
            paint: {
              fgPct: zoneStats.paint.attempted > 0 ? (zoneStats.paint.made / zoneStats.paint.attempted) * 100 : 0,
              fga: zoneStats.paint.attempted,
              fgm: zoneStats.paint.made
            },
            midRange: {
              fgPct: zoneStats.midRange.attempted > 0 ? (zoneStats.midRange.made / zoneStats.midRange.attempted) * 100 : 0,
              fga: zoneStats.midRange.attempted,
              fgm: zoneStats.midRange.made
            },
            leftCorner3: {
              fgPct: zoneStats.leftCorner3.attempted > 0 ? (zoneStats.leftCorner3.made / zoneStats.leftCorner3.attempted) * 100 : 0,
              fga: zoneStats.leftCorner3.attempted,
              fgm: zoneStats.leftCorner3.made
            },
            rightCorner3: {
              fgPct: zoneStats.rightCorner3.attempted > 0 ? (zoneStats.rightCorner3.made / zoneStats.rightCorner3.attempted) * 100 : 0,
              fga: zoneStats.rightCorner3.attempted,
              fgm: zoneStats.rightCorner3.made
            },
            aboveBreak3: {
              fgPct: zoneStats.aboveBreak3.attempted > 0 ? (zoneStats.aboveBreak3.made / zoneStats.aboveBreak3.attempted) * 100 : 0,
              fga: zoneStats.aboveBreak3.attempted,
              fgm: zoneStats.aboveBreak3.made
            },
          };
        }
        return null;
      });

      const batchResults = await Promise.all(batchPromises);
      allTeamsData.push(...batchResults.filter(r => r !== null));
      
      // Small delay between batches
      if (i + batchSize < teams.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (allTeamsData.length > 0) {
      // Calculate rankings
      const zones = ['restrictedArea', 'paint', 'midRange', 'leftCorner3', 'rightCorner3', 'aboveBreak3'];
      const rankings = {};
      
      zones.forEach(zone => {
        const sorted = [...allTeamsData].sort((a, b) => b[zone].fgPct - a[zone].fgPct);
        sorted.forEach((team, index) => {
          if (!rankings[team.team]) {
            rankings[team.team] = {};
          }
          rankings[team.team][zone] = {
            rank: index + 1,
            fgPct: team[zone].fgPct,
            fga: team[zone].fga,
            fgm: team[zone].fgm,
            totalTeams: allTeamsData.length
          };
        });
      });

      const rankingsData = {
        season: seasonStr,
        rankings,
        teams: allTeamsData,
        cachedAt: new Date().toISOString()
      };

      const cacheKey = `team_defense_rankings_${season}`;
      const ttlMinutes = 365 * 24 * 60;
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

      const { error: cacheError } = await supabase
        .from('nba_api_cache')
        .upsert({
          cache_key: cacheKey,
          cache_type: 'team_defense',
          data: rankingsData,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'cache_key'
        });

      if (cacheError) {
        console.error(`  ❌ Failed to cache team defense rankings: ${cacheError.message}`);
        return false;
      }

      console.log(`  ✅ Cached team defense rankings for ${allTeamsData.length} teams`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`  ❌ Error caching team defense rankings:`, error.message);
    return false;
  }
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
  
  console.log(`Processing ${players.length} players in parallel batches...`);
  console.log('');
  
  // First, cache team defense rankings (once for all teams)
  console.log('Step 1: Caching team defense rankings...');
  await cacheTeamDefenseRankings(season, seasonStr);
  console.log('');
  
  // Process players in small batches (3 at a time) for speed
  const batchSize = 3;
  let shotChartSuccess = 0;
  let shotChartFail = 0;
  let playTypeSuccess = 0;
  let playTypeFail = 0;
  
  console.log(`Step 2: Processing ${players.length} players in batches of ${batchSize}...`);
  console.log('');
  
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(players.length / batchSize);
    
    console.log(`[Batch ${batchNum}/${totalBatches}] Processing players ${i + 1}-${Math.min(i + batchSize, players.length)}...`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (player) => {
      const results = {
        playerId: player.id,
        playerName: `${player.first_name} ${player.last_name}`,
        shotChart: false,
        playType: false
      };
      
      // Cache shot chart
      try {
        results.shotChart = await cachePlayerShotChart(player.id, season, seasonStr);
      } catch (error) {
        console.error(`  ❌ Shot chart error for ${results.playerName}:`, error.message);
      }
      
      // Cache play type analysis
      try {
        results.playType = await cachePlayerPlayTypeAnalysis(player.id, season, seasonStr);
      } catch (error) {
        console.error(`  ❌ Play type error for ${results.playerName}:`, error.message);
      }
      
      return results;
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // Count successes and failures
    for (const result of batchResults) {
      if (result.shotChart) shotChartSuccess++;
      else shotChartFail++;
      
      if (result.playType) playTypeSuccess++;
      else playTypeFail++;
    }
    
    // Shorter delay between batches (1 second instead of 3)
    if (i + batchSize < players.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('');
  console.log('========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Shot Charts: ${shotChartSuccess} success, ${shotChartFail} failed`);
  console.log(`Play Type Analysis: ${playTypeSuccess} success, ${playTypeFail} failed`);
  console.log('');
  console.log('✅ Refresh complete!');
  console.log('');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };

