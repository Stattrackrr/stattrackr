/**
 * Cache shot charts for specific players by name
 * 
 * Usage:
 *   node scripts/cache-specific-players.js "Alex Sarr" "Nic Claxton"
 */

require('dotenv').config({ path: '.env.local' });

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

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const { URL } = require('url');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bdlApiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const TARGET_SEASON = parseInt(process.env.NBA_SEASON || '2025');
const seasonStr = `${TARGET_SEASON}-${String(TARGET_SEASON + 1).slice(-2)}`;

function normalizePlayerName(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchNBAStats(url, timeout = 30000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let redirectCount = 0;
    
    const makeRequest = (requestUrl) => {
      if (redirectCount >= maxRedirects) {
        reject(new Error(`Too many redirects (${redirectCount})`));
        return;
      }
      
      const urlObj = new URL(requestUrl);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: NBA_HEADERS,
        timeout: timeout
      };

      const req = https.request(options, (res) => {
        let data = '';

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectCount++;
          const redirectUrl = res.headers.location.startsWith('http') 
            ? res.headers.location 
            : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
          console.log(`    ↪️ Redirect ${res.statusCode} to: ${redirectUrl}`);
          makeRequest(redirectUrl);
          return;
        }

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
          } else {
            reject(new Error(`NBA API ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${timeout}ms`));
      });

      req.end();
    };
    
    makeRequest(url);
  });
}

async function fetchBDL(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(bdlApiKey ? { 'Authorization': `Bearer ${bdlApiKey}` } : {})
      },
      timeout: 30000
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
        } else {
          reject(new Error(`BDL API ${res.statusCode}: ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout`));
    });

    req.end();
  });
}

async function setCache(cacheKey, cacheType, data, ttlMinutes) {
  try {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + ttlMinutes);

    const { error } = await supabase
      .from('nba_api_cache')
      .upsert({
        cache_key: cacheKey,
        cache_type: cacheType,
        data: data,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'cache_key'
      });

    if (error) {
      console.error(`❌ Error caching ${cacheKey}:`, error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`❌ Error setting cache: ${error.message}`);
    return false;
  }
}

// Load player ID mappings
let playerIdMappings = null;
let normalizedNameMap = null;
let nbaNameToIdMap = null;

function loadPlayerIdMappings() {
  if (playerIdMappings) return playerIdMappings;
  
  try {
    const fs = require('fs');
    const path = require('path');
    const mappingPath = path.join(__dirname, 'player-id-mappings.json');
    const data = fs.readFileSync(mappingPath, 'utf8');
    playerIdMappings = JSON.parse(data);
    normalizedNameMap = new Map();
    for (const entry of playerIdMappings) {
      if (entry?.name && entry?.nbaId) {
        normalizedNameMap.set(normalizePlayerName(entry.name), entry.nbaId);
      }
    }
    return playerIdMappings;
  } catch (error) {
    console.warn(`⚠️  Could not load player ID mappings: ${error.message}`);
    return [];
  }
}

async function loadNbaNameToIdMap() {
  if (nbaNameToIdMap) return nbaNameToIdMap;

  try {
    const params = new URLSearchParams({
      LeagueID: '00',
      Season: seasonStr,
      IsOnlyCurrentSeason: '0'
    });

    const url = `${NBA_STATS_BASE}/commonallplayers?${params.toString()}`;
    const data = await fetchNBAStats(url, 30000);
    const resultSet = data?.resultSets?.[0];
    if (!resultSet) throw new Error('Invalid response from NBA players list');

    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];
    const personIdx = headers.indexOf('PERSON_ID');
    const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');

    const map = new Map();
    rows.forEach(row => {
      const id = String(row[personIdx]);
      const name = row[nameIdx] || '';
      const normalized = normalizePlayerName(name);
      if (normalized) {
        map.set(normalized, id);
      }
    });

    nbaNameToIdMap = map;
    return nbaNameToIdMap;
  } catch (error) {
    console.warn(`⚠️  Could not load NBA player list: ${error.message}`);
    nbaNameToIdMap = null;
    return nbaNameToIdMap;
  }
}

async function getNbaStatsId(bdlPlayerId, playerName) {
  console.log(`  🔍 Looking up NBA Stats ID for "${playerName}" (BDL ID: ${bdlPlayerId})...`);
  
  const mappings = loadPlayerIdMappings();
  const bdlIdStr = String(bdlPlayerId);
  const mapping = mappings.find(m => m.bdlId === bdlIdStr);
  
  if (mapping) {
    console.log(`  ✅ Found in mapping file: NBA ID ${mapping.nbaId}`);
    return mapping.nbaId;
  }

  if (playerName && normalizedNameMap) {
    const normalized = normalizePlayerName(playerName);
    const normalizedMatch = normalizedNameMap.get(normalized);
    if (normalizedMatch) {
      console.log(`  ✅ Matched ${playerName} to NBA ID ${normalizedMatch} via normalized name`);
      return normalizedMatch;
    }
  }

  if (playerName) {
    console.log(`  🔍 Trying NBA player list...`);
    const normalized = normalizePlayerName(playerName);
    const nameMap = await loadNbaNameToIdMap();
    
    if (nameMap && nameMap.has(normalized)) {
      const nbaId = nameMap.get(normalized);
      console.log(`  ✅ Matched ${playerName} to NBA ID ${nbaId} via NBA player list`);
      return nbaId;
    } else {
      console.log(`  ⚠️  Normalized name "${normalized}" not found in NBA player list`);
      
      // Try variations: "Alexandre" -> "Alex", "Nicolas" -> "Nic"
      const nameParts = playerName.split(' ');
      if (nameParts.length >= 2) {
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];
        const lastNameNormalized = normalizePlayerName(lastName);
        
        // Try first name variations
        const variations = [
          firstName,
          firstName.replace(/e$/, ''), // Alexandre -> Alexandr
          firstName.replace(/as$/, ''), // Nicolas -> Nicol
          firstName.replace(/dre$/, ''), // Alexandre -> Alex
        ];
        
        for (const variant of variations) {
          const variantName = `${variant} ${lastName}`;
          const variantNormalized = normalizePlayerName(variantName);
          if (nameMap && nameMap.has(variantNormalized)) {
            const nbaId = nameMap.get(variantNormalized);
            console.log(`  ✅ Matched "${variantName}" (variant of ${playerName}) to NBA ID ${nbaId}`);
            return nbaId;
          }
        }
        
        // Show close matches by last name - search through all NBA players
        if (nameMap) {
          console.log(`  🔍 Searching for players with last name "${lastName}"...`);
          try {
            // Reload NBA player list to get actual names (not just normalized keys)
            const params = new URLSearchParams({
              LeagueID: '00',
              Season: seasonStr,
              IsOnlyCurrentSeason: '0'
            });
            const url = `${NBA_STATS_BASE}/commonallplayers?${params.toString()}`;
            const data = await fetchNBAStats(url, 30000);
            const resultSet = data?.resultSets?.[0];
            if (resultSet) {
              const headers = resultSet.headers || [];
              const rows = resultSet.rowSet || [];
              const personIdx = headers.indexOf('PERSON_ID');
              const nameIdx = headers.indexOf('DISPLAY_FIRST_LAST');
              
              const lastNameLower = lastName.toLowerCase();
              const matches = rows
                .map(row => {
                  const id = String(row[personIdx]);
                  const name = row[nameIdx] || '';
                  const nameLower = name.toLowerCase();
                  // Check if last name matches
                  if (nameLower.includes(lastNameLower) || nameLower.endsWith(` ${lastNameLower}`)) {
                    return { id, name };
                  }
                  return null;
                })
                .filter(Boolean)
                .slice(0, 5);
              
              if (matches.length > 0) {
                console.log(`  💡 Found ${matches.length} potential matches in NBA player list:`);
                matches.forEach(m => console.log(`     - ${m.name} (ID: ${m.id})`));
                
                // Score matches by how close they are to the original name
                const playerNameLower = playerName.toLowerCase();
                const playerFirstName = playerNameLower.split(' ')[0];
                const playerLastName = playerNameLower.split(' ').slice(-1)[0];
                
                const scoredMatches = matches.map(m => {
                  const matchNameLower = m.name.toLowerCase();
                  const matchFirstName = matchNameLower.split(' ')[0];
                  const matchLastName = matchNameLower.split(' ').slice(-1)[0];
                  let score = 0;
                  
                  // Exact match gets highest score
                  if (matchNameLower === playerNameLower) {
                    score = 1000;
                  }
                  // First name starts with player's first name (e.g., "Nicolas" -> "Nic")
                  else if (matchFirstName.startsWith(playerFirstName) || playerFirstName.startsWith(matchFirstName)) {
                    score = 500;
                  }
                  // First names are similar (common nicknames)
                  else if (
                    (playerFirstName === 'nicolas' && matchFirstName === 'nic') ||
                    (playerFirstName === 'nic' && matchFirstName === 'nicolas') ||
                    (playerFirstName === 'alexandre' && matchFirstName === 'alex') ||
                    (playerFirstName === 'alex' && matchFirstName === 'alexandre') ||
                    (playerFirstName.startsWith('alex') && matchFirstName.startsWith('alex'))
                  ) {
                    score = 450;
                  }
                  // Contains first name gets medium score
                  else if (matchNameLower.includes(playerFirstName) || playerNameLower.includes(matchFirstName)) {
                    score = 200;
                  }
                  // Just last name match gets low score
                  else if (matchLastName === playerLastName) {
                    score = 100;
                  }
                  
                  return { ...m, score };
                });
                
                // Sort by score (highest first)
                scoredMatches.sort((a, b) => b.score - a.score);
                const bestMatch = scoredMatches[0];
                
                if (bestMatch) {
                  console.log(`  ✅ Using best match: ${bestMatch.name} (ID: ${bestMatch.id}, score: ${bestMatch.score})`);
                  return bestMatch.id;
                }
              } else {
                console.log(`  ⚠️  No players found with last name "${lastName}" in NBA player list`);
              }
            }
          } catch (e) {
            console.log(`  ⚠️  Could not search NBA player list: ${e.message}`);
          }
        }
      }
    }
  }
  
  console.warn(`  ⚠️  No NBA Stats ID mapping found for BDL ID ${bdlPlayerId} (${playerName})`);
  return null;
}

async function findPlayerByName(playerName) {
  console.log(`\n🔍 Searching for "${playerName}"...`);
  
  // Try active players first
  let url = new URL(`${BDL_BASE}/players/active`);
  url.searchParams.set('search', playerName);
  url.searchParams.set('per_page', '100');
  
  try {
    let data = await fetchBDL(url.toString());
    let players = Array.isArray(data?.data) ? data.data : [];
    
    // If no results, try all players (not just active)
    if (players.length === 0) {
      console.log(`  Trying all players (not just active)...`);
      url = new URL(`${BDL_BASE}/players`);
      url.searchParams.set('search', playerName);
      url.searchParams.set('per_page', '100');
      data = await fetchBDL(url.toString());
      players = Array.isArray(data?.data) ? data.data : [];
    }
    
    // Try exact match first
    const exactMatch = players.find(p => {
      const fullName = `${p.first_name} ${p.last_name}`;
      return fullName.toLowerCase() === playerName.toLowerCase();
    });
    
    if (exactMatch) {
      console.log(`  ✅ Exact match found: ${exactMatch.first_name} ${exactMatch.last_name}`);
      return exactMatch;
    }
    
    // Try partial match (contains)
    const partialMatch = players.find(p => {
      const fullName = `${p.first_name} ${p.last_name}`;
      const nameLower = playerName.toLowerCase();
      const fullLower = fullName.toLowerCase();
      return fullLower.includes(nameLower) || nameLower.includes(fullLower);
    });
    
    if (partialMatch) {
      console.log(`  ✅ Partial match found: ${partialMatch.first_name} ${partialMatch.last_name}`);
      return partialMatch;
    }
    
    // Try last name only
    const lastName = playerName.split(' ').pop();
    if (lastName && lastName !== playerName) {
      const lastNameMatch = players.find(p => {
        return p.last_name && p.last_name.toLowerCase() === lastName.toLowerCase();
      });
      
      if (lastNameMatch) {
        console.log(`  ✅ Last name match found: ${lastNameMatch.first_name} ${lastNameMatch.last_name}`);
        return lastNameMatch;
      }
    }
    
    // Show what we found for debugging
    if (players.length > 0) {
      console.log(`  ⚠️  Found ${players.length} players, but no exact match:`);
      players.slice(0, 5).forEach(p => {
        console.log(`     - ${p.first_name} ${p.last_name} (ID: ${p.id})`);
      });
    }
    
    return null;
  } catch (error) {
    console.error(`  ❌ Error searching for player: ${error.message}`);
    return null;
  }
}

async function cachePlayerShotChart(playerId, season, seasonStr, playerName) {
  try {
    const nbaPlayerId = await getNbaStatsId(playerId, playerName);
    
    if (!nbaPlayerId) {
      return { success: false, error: 'No NBA Stats ID mapping' };
    }
    
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
    const data = await fetchNBAStats(url, 20000);

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
        await setCache(cacheKey, 'shot_chart', response, 365 * 24 * 60); // 365 days
        return { success: true, shots: totalFGA };
      } else {
        return { success: false, shots: 0 };
      }
    }
    
    return { success: false, shots: 0 };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  const playerNames = process.argv.slice(2);
  
  if (playerNames.length === 0) {
    // Default to Alex Sarr and Nic Claxton
    playerNames.push('Alex Sarr', 'Nic Claxton');
  }
  
  console.log('🚀 Caching shot charts for specific players...\n');
  console.log(`Season: ${seasonStr}`);
  console.log(`Players: ${playerNames.join(', ')}\n`);
  
  for (const playerName of playerNames) {
    let player;
    
    // Check if it's a BDL ID (numeric string)
    if (/^\d+$/.test(playerName.trim())) {
      console.log(`🔍 Looking up player by BDL ID: ${playerName}`);
      try {
        const url = `${BDL_BASE}/players/${playerName.trim()}`;
        const data = await fetchBDL(url);
        player = data.data || data;
        if (player && player.id) {
          console.log(`✅ Found by ID: ${player.first_name} ${player.last_name} (BDL ID: ${player.id})`);
        }
      } catch (error) {
        console.log(`❌ Could not fetch player by ID: ${error.message}`);
      }
    }
    
    // If not found by ID, try by name
    if (!player) {
      player = await findPlayerByName(playerName);
    }
    
    if (!player) {
      console.log(`❌ Player "${playerName}" not found`);
      continue;
    }
    
    const fullName = `${player.first_name} ${player.last_name}`;
    console.log(`✅ Found: ${fullName} (BDL ID: ${player.id})`);
    
    const result = await cachePlayerShotChart(player.id, TARGET_SEASON, seasonStr, fullName);
    
    if (result.success) {
      console.log(`  ✅ Cached: ${result.shots} shots\n`);
    } else if (result.shots === 0) {
      console.log(`  ⚠️  No shot data\n`);
    } else {
      console.log(`  ❌ Failed: ${result.error || 'Unknown error'}\n`);
    }
    
    // Small delay between players
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('✅ Complete!');
  process.exit(0);
}

main();

