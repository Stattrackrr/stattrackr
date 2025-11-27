/**
 * Complete NBA Cache Population Script
 * 
 * This script runs on a separate server/service (NOT Vercel) to populate
 * Supabase cache with ALL NBA API data:
 * 1. Defensive Rankings (play type + zone)
 * 2. Individual Player Shot Charts (all active players)
 * 
 * Since NBA API is unreachable from Vercel, this script must run from
 * a server that CAN reach NBA API.
 * 
 * Deployment options:
 * 1. Railway.app - Free tier, can run Node.js scripts
 * 2. Render.com - Free tier, can run scheduled jobs
 * 3. Your own server/VPS
 * 4. GitHub Actions (scheduled workflow)
 * 
 * Usage:
 *   node scripts/populate-all-nba-cache.js
 *   node scripts/populate-all-nba-cache.js --skip-players  # Skip individual players
 *   node scripts/populate-all-nba-cache.js --skip-rankings  # Skip defensive rankings
 * 
 * Or set up as a cron job to run every 6-12 hours
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

// Support both NEXT_PUBLIC_SUPABASE_URL (for Next.js) and SUPABASE_URL (for scripts/GitHub Actions)
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

// Parse command line arguments
const args = process.argv.slice(2);
const skipPlayers = args.includes('--skip-players');
const skipRankings = args.includes('--skip-rankings');
const processAllPlayers = args.includes('--all-players');

const METADATA_CACHE_TYPE = 'metadata';
const SHOT_CHART_LAST_DATE_KEY = 'shot_chart_last_date';

function normalizePlayerName(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatDateToISO(date) {
  return date.toISOString().split('T')[0];
}

function addDaysToISO(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateToISO(date);
}

function getEasternDateInfo(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const lookup = type => parts.find(p => p.type === type)?.value;
  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  const hour = parseInt(lookup('hour') || '0', 10);

  return {
    isoDate: `${year}-${month}-${day}`,
    hour
  };
}

function getEffectiveShotChartDate() {
  const { isoDate, hour } = getEasternDateInfo(new Date());
  let effectiveDate = isoDate;
  // If we're before 6 AM ET, use previous day to ensure games are completed
  if (hour < 6) {
    effectiveDate = addDaysToISO(isoDate, -1);
  }
  return effectiveDate;
}

function buildDateRange(startDate, endDate) {
  const dates = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addDaysToISO(current, 1);
  }
  return dates;
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

        // Handle redirects (301, 302, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectCount++;
          const redirectUrl = res.headers.location.startsWith('http') 
            ? res.headers.location 
            : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
          console.log(`    ↪️ Redirect ${res.statusCode} to: ${redirectUrl}`);
          // Follow redirect
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

async function getLastShotChartIngestDate() {
  try {
    const { data, error } = await supabase
      .from('nba_api_cache')
      .select('data')
      .eq('cache_key', SHOT_CHART_LAST_DATE_KEY)
      .eq('cache_type', METADATA_CACHE_TYPE)
      .single();

    if (error) return null;
    return data?.data?.lastDate || null;
  } catch (error) {
    console.warn(`⚠️  Unable to read last shot chart ingest date: ${error.message}`);
    return null;
  }
}

async function setLastShotChartIngestDate(dateString) {
  try {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);

    const { error } = await supabase
      .from('nba_api_cache')
      .upsert({
        cache_key: SHOT_CHART_LAST_DATE_KEY,
        cache_type: METADATA_CACHE_TYPE,
        data: { lastDate: dateString },
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'cache_key' });

    if (error) {
      console.warn(`⚠️  Unable to persist last shot chart ingest date: ${error.message}`);
    }
  } catch (error) {
    console.warn(`⚠️  Unable to persist last shot chart ingest date: ${error.message}`);
  }
}

// Load player ID mappings
let playerIdMappings = null;
let normalizedNameMap = null;

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

// Convert BDL player ID to NBA Stats ID
function getNbaStatsId(bdlPlayerId, playerName) {
  const mappings = loadPlayerIdMappings();
  const bdlIdStr = String(bdlPlayerId);
  const mapping = mappings.find(m => m.bdlId === bdlIdStr);
  
  if (mapping) {
    return mapping.nbaId;
  }

  if (playerName && normalizedNameMap) {
    const normalized = normalizePlayerName(playerName);
    const normalizedMatch = normalizedNameMap.get(normalized);
    if (normalizedMatch) {
      console.log(`  ℹ️  Matched ${playerName} to NBA ID ${normalizedMatch} via normalized name`);
      return normalizedMatch;
    }
  }
  
  console.warn(`  ⚠️  No NBA Stats ID mapping found for BDL ID ${bdlPlayerId}`);
  return null;
}

async function getPlayersWhoPlayedOnDate(dateString) {
  const isoDate = dateString || formatDateToISO(new Date());
  console.log(`\n📅 Fetching players who played on ${isoDate}...`);
  
  const playerIds = new Set();
  let cursor = null;
  let page = 1;
  
  while (true) {
    const statsUrl = new URL(`${BDL_BASE}/stats`);
    statsUrl.searchParams.set('start_date', isoDate);
    statsUrl.searchParams.set('end_date', isoDate);
    statsUrl.searchParams.set('per_page', '100');
    if (cursor) statsUrl.searchParams.set('cursor', cursor);
    
    try {
      const data = await fetchBDL(statsUrl.toString());
      const stats = Array.isArray(data?.data) ? data.data : [];
      
      for (const stat of stats) {
        const minutes = stat?.min || '0:00';
        if (minutes && minutes !== '0:00' && stat?.player?.id) {
          playerIds.add(stat.player.id);
        }
      }
      
      cursor = data?.meta?.next_cursor;
      if (!cursor) break;
      page++;
      await new Promise(resolve => setTimeout(resolve, 250));
    } catch (error) {
      console.error(`  ⚠️  Error fetching stats for ${isoDate}: ${error.message}`);
      break;
    }
  }
  
  console.log(`  Players found on ${isoDate}: ${playerIds.size}`);
  return { date: isoDate, playerIds };
}

// ============================================
// PART 1: DEFENSIVE RANKINGS
// ============================================

async function populatePlayTypeRankings(season = 2025) {
  console.log(`\n📊 [1/3] Populating play type defensive rankings for season ${season}...`);
  
  const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
  const PLAY_TYPES = [
    'PRBallHandler', 'Transition', 'Spotup', 'OffScreen', 'Isolation',
    'Postup', 'Cut', 'Handoff', 'Misc', 'PRRollman', 'OffRebound'
  ];

  const rankings = {};

  for (const playType of PLAY_TYPES) {
    try {
      console.log(`  Fetching ${playType}...`);
      const params = new URLSearchParams({
        LeagueID: '00',
        PerMode: 'PerGame',
        PlayerOrTeam: 'T',
        SeasonType: 'Regular Season',
        SeasonYear: seasonStr,
        PlayType: playType,
        TypeGrouping: 'defensive',
      });

      const url = `${NBA_STATS_BASE}/synergyplaytypes?${params.toString()}`;
      const data = await fetchNBAStats(url, 30000);
      const resultSet = data?.resultSets?.[0];

      if (resultSet) {
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];
        const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
        const pppIdx = headers.indexOf('PPP');

        if (teamAbbrIdx >= 0 && pppIdx >= 0) {
          const teamRankings = rows.map(row => ({
            team: (row[teamAbbrIdx] || '').toUpperCase(),
            ppp: parseFloat(row[pppIdx]) || 0
          })).filter(r => r.team);

          teamRankings.sort((a, b) => a.ppp - b.ppp);
          rankings[playType] = teamRankings;
          console.log(`    ✅ ${playType}: ${teamRankings.length} teams`);
        }
      }

      // Delay between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`    ❌ Error fetching ${playType}:`, error.message);
    }
  }

  // Cache all rankings together
  const cacheKey = `playtype_defensive_rankings_${seasonStr}`;
  await setCache(cacheKey, 'defense_rankings', rankings, 365 * 24 * 60); // 365 days
  console.log(`✅ Cached play type defensive rankings`);
}

async function populateShotZoneRankings(season = 2025) {
  console.log(`\n📊 [2/3] Populating shot zone defensive rankings for season ${season}...`);
  
  const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
  const ZONES = [
    'Restricted Area', 'Paint (Non-RA)', 'Mid-Range', 'Left Corner 3',
    'Right Corner 3', 'Above the Break 3'
  ];

  // NBA Teams mapping
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

  const allTeamsData = [];

  // Fetch shot chart data for each team (using shotchartdetail with OpponentTeamID)
  console.log(`  Fetching shot chart data for all teams...`);
  for (const [teamAbbr, teamId] of Object.entries(NBA_TEAM_MAP)) {
    try {
      const params = new URLSearchParams({
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

      const url = `${NBA_STATS_BASE}/shotchartdetail?${params.toString()}`;
      const data = await fetchNBAStats(url, 60000); // 60s timeout for shot chart data
      
      if (data?.resultSets?.[0]) {
        const resultSet = data.resultSets[0];
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];
        const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
        const shotZoneBasicIdx = headers.indexOf('SHOT_ZONE_BASIC');

        const zoneStats = {
          'Restricted Area': { made: 0, attempted: 0 },
          'In The Paint (Non-RA)': { made: 0, attempted: 0 },
          'Mid-Range': { made: 0, attempted: 0 },
          'Left Corner 3': { made: 0, attempted: 0 },
          'Right Corner 3': { made: 0, attempted: 0 },
          'Above the Break 3': { made: 0, attempted: 0 },
        };

        for (const row of rows) {
          const made = row[shotMadeIdx] === 1;
          const zone = row[shotZoneBasicIdx];
          if (zoneStats[zone]) {
            zoneStats[zone].attempted++;
            if (made) zoneStats[zone].made++;
          }
        }

        allTeamsData.push({
          team: teamAbbr,
          zones: zoneStats
        });
        
        console.log(`    ✅ ${teamAbbr}: ${rows.length} shots`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay between teams
    } catch (error) {
      console.error(`    ❌ Error fetching ${teamAbbr}:`, error.message);
    }
  }

  // Calculate rankings per zone
  const rankings = {};
  const zoneMap = {
    'Restricted Area': 'Restricted Area',
    'In The Paint (Non-RA)': 'Paint (Non-RA)',
    'Mid-Range': 'Mid-Range',
    'Left Corner 3': 'Left Corner 3',
    'Right Corner 3': 'Right Corner 3',
    'Above the Break 3': 'Above the Break 3'
  };

  for (const [apiZone, displayZone] of Object.entries(zoneMap)) {
    const zoneRankings = allTeamsData
      .map(teamData => {
        const zoneStat = teamData.zones[apiZone];
        if (!zoneStat || zoneStat.attempted === 0) return null;
        const fgPct = (zoneStat.made / zoneStat.attempted) * 100;
        return {
          team: teamData.team,
          fgPct: fgPct
        };
      })
      .filter(r => r !== null)
      .sort((a, b) => a.fgPct - b.fgPct); // Lower FG% = better defense

    rankings[displayZone] = zoneRankings;
    console.log(`    ✅ ${displayZone}: ${zoneRankings.length} teams`);
  }

  const cacheKey = `zone_defensive_rankings_${seasonStr}`;
  await setCache(cacheKey, 'defense_rankings', rankings, 365 * 24 * 60); // 365 days
  console.log(`✅ Cached shot zone defensive rankings`);
}

// ============================================
// PART 2: INDIVIDUAL PLAYER SHOT CHARTS
// ============================================

async function getAllActivePlayers() {
  console.log(`\n📋 Fetching all active players from BDL API...`);
  
  const allPlayers = [];
  let cursor = null;
  let page = 1;
  const maxPages = 60; // Safety limit

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
      console.log(`  Page ${page}: ${players.length} players (total: ${allPlayers.length})`);

      cursor = data?.meta?.next_cursor || null;
      if (!cursor) break;

      page++;
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between pages
    } catch (error) {
      console.error(`  ❌ Error fetching page ${page}:`, error.message);
      break;
    }
  }

  console.log(`✅ Found ${allPlayers.length} active players`);
  return allPlayers;
}

async function cachePlayerShotChart(playerId, season, seasonStr, playerName) {
  try {
    const nbaPlayerId = getNbaStatsId(playerId, playerName);
    
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

async function processPlayerShotChartsForList(playerList, season, seasonStr) {
  let success = 0;
  let fail = 0;
  let noData = 0;

  for (let i = 0; i < playerList.length; i++) {
    const player = playerList[i];
    const playerId = player.id;
    const playerName = `${player.first_name} ${player.last_name}`;

    console.log(`[${i + 1}/${playerList.length}] ${playerName} (ID: ${playerId})...`);

    const result = await cachePlayerShotChart(playerId, season, seasonStr, playerName);

    if (result.success) {
      console.log(`  ✅ Cached: ${result.shots} shots`);
      success++;
    } else if (result.shots === 0) {
      console.log(`  ⚠️  No shot data`);
      noData++;
    } else {
      console.log(`  ❌ Failed: ${result.error || 'Unknown error'}`);
      fail++;
    }

    if (i < playerList.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`   ➕ Player batch complete | Success: ${success}, No data: ${noData}, Failed: ${fail}`);
  return { success, fail, noData };
}

async function populateAllPlayerShotCharts(season = 2025, forceAllPlayers = false) {
  console.log(`\n📊 [3/3] Populating individual player shot charts for season ${season}...`);
  
  const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
  const players = await getAllActivePlayers();
  
  if (players.length === 0) {
    console.log('⚠️  No players found, skipping shot chart caching');
    return;
  }

  if (forceAllPlayers) {
    console.log('  --all-players flag detected. Processing every active player.');
    await processPlayerShotChartsForList(players, season, seasonStr);
    await setLastShotChartIngestDate(getEffectiveShotChartDate());
    return;
  }

  const todayEastern = getEffectiveShotChartDate();
  let lastProcessedDate = await getLastShotChartIngestDate();
  if (!lastProcessedDate) {
    lastProcessedDate = addDaysToISO(todayEastern, -1);
  }

  const startDate = addDaysToISO(lastProcessedDate, 1);
  if (startDate > todayEastern) {
    console.log(`✅ No new games to process (last processed ${lastProcessedDate}).`);
    return;
  }

  const datesToProcess = buildDateRange(startDate, todayEastern);
  console.log(`Processing shot charts from ${startDate} through ${todayEastern} (${datesToProcess.length} day(s))`);

  const playerMap = new Map(players.map(player => [player.id, player]));

  for (const date of datesToProcess) {
    const { playerIds } = await getPlayersWhoPlayedOnDate(date);

    if (!playerIds.size) {
      console.log(`  ⚠️  No player stats found for ${date}. Marking as processed.`);
      await setLastShotChartIngestDate(date);
      continue;
    }

    const subset = Array.from(playerIds).map(id => playerMap.get(id)).filter(Boolean);
    if (subset.length === 0) {
      console.log(`  ⚠️  No matching active players for ${date}. Marking as processed.`);
      await setLastShotChartIngestDate(date);
      continue;
    }

    console.log(`  📅 ${date}: processing ${subset.length} players`);
    await processPlayerShotChartsForList(subset, season, seasonStr);
    await setLastShotChartIngestDate(date);
  }

  console.log(`\n✅ Shot chart caching complete for pending dates.`);
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('🚀 Starting Complete NBA Cache Population...\n');
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Supabase URL: ${supabaseUrl ? '✅' : '❌'}`);
  console.log(`Supabase Key: ${supabaseServiceKey ? '✅' : '❌'}`);
  console.log(`BDL API Key: ${bdlApiKey ? '✅' : '❌'}\n`);

  const season = parseInt(process.env.NBA_SEASON || '2025');

  try {
    if (!skipRankings) {
      await populatePlayTypeRankings(season);
      await populateShotZoneRankings(season);
    } else {
      console.log('\n⏭️  Skipping defensive rankings (--skip-rankings)');
    }
    
    if (!skipPlayers) {
      await populateAllPlayerShotCharts(season, processAllPlayers);
    } else {
      console.log('\n⏭️  Skipping individual player shot charts (--skip-players)');
    }
    
    console.log('\n✅ Complete cache population finished!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cache population failed:', error);
    process.exit(1);
  }
}

main();

