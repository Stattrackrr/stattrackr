/**
 * NBA Cache Population Script
 * 
 * This script runs on a separate server/service (NOT Vercel) to populate
 * Supabase cache with NBA API data. Since NBA API is unreachable from Vercel,
 * this script must run from a server that CAN reach NBA API.
 * 
 * Deployment options:
 * 1. Railway.app - Free tier, can run Node.js scripts
 * 2. Render.com - Free tier, can run scheduled jobs
 * 3. Your own server/VPS
 * 4. GitHub Actions (scheduled workflow)
 * 
 * Usage:
 *   node scripts/populate-nba-cache.js
 * 
 * Or set up as a cron job to run every 6-12 hours
 */

require('dotenv').config({ path: '.env.local' });

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

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function fetchNBAStats(url, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`NBA API ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

async function setCache(cacheKey, cacheType, data, ttlMinutes) {
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
}

async function populatePlayTypeRankings(season = 2025) {
  console.log(`\n📊 Populating play type defensive rankings for season ${season}...`);
  
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
  await setCache(cacheKey, 'defense_rankings', rankings, 24 * 60); // 24 hours
  console.log(`✅ Cached play type defensive rankings`);
}

async function populateShotZoneRankings(season = 2025) {
  console.log(`\n📊 Populating shot zone defensive rankings for season ${season}...`);
  
  const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
  const ZONES = [
    'Restricted Area', 'Paint (Non-RA)', 'Mid-Range', 'Left Corner 3',
    'Right Corner 3', 'Above the Break 3'
  ];

  const rankings = {};

  for (const zone of ZONES) {
    try {
      console.log(`  Fetching ${zone}...`);
      const params = new URLSearchParams({
        LeagueID: '00',
        PerMode: 'PerGame',
        PlayerOrTeam: 'T',
        SeasonType: 'Regular Season',
        SeasonYear: seasonStr,
        ZoneRange: zone,
        ContextMeasure: 'FGA',
      });

      const url = `${NBA_STATS_BASE}/leaguedashptshotdefend?${params.toString()}`;
      const data = await fetchNBAStats(url, 30000);
      const resultSet = data?.resultSets?.[0];

      if (resultSet) {
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];
        const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
        const fgPctIdx = headers.indexOf('FG_PCT');

        if (teamAbbrIdx >= 0 && fgPctIdx >= 0) {
          const zoneRankings = rows.map(row => ({
            team: (row[teamAbbrIdx] || '').toUpperCase(),
            fgPct: parseFloat(row[fgPctIdx]) || 0
          })).filter(r => r.team);

          zoneRankings.sort((a, b) => a.fgPct - b.fgPct); // Lower FG% = better defense
          rankings[zone] = zoneRankings;
          console.log(`    ✅ ${zone}: ${zoneRankings.length} teams`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`    ❌ Error fetching ${zone}:`, error.message);
    }
  }

  const cacheKey = `shot_zone_defense_rankings_${seasonStr}`;
  await setCache(cacheKey, 'defense_rankings', rankings, 24 * 60); // 24 hours
  console.log(`✅ Cached shot zone defensive rankings`);
}

async function main() {
  console.log('🚀 Starting NBA cache population...\n');
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`Supabase URL: ${supabaseUrl ? '✅' : '❌'}`);
  console.log(`Supabase Key: ${supabaseServiceKey ? '✅' : '❌'}\n`);

  const season = parseInt(process.env.NBA_SEASON || '2025');

  try {
    await populatePlayTypeRankings(season);
    await populateShotZoneRankings(season);
    
    console.log('\n✅ Cache population complete!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cache population failed:', error);
    process.exit(1);
  }
}

main();

