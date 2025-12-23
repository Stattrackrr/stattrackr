#!/usr/bin/env node

/**
 * Test script to debug NBA API calls
 * Tests fetching a single game's pace and usage rate
 */

require('dotenv').config({ path: '.env.local' });

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/stats/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
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

async function fetchNBAStats(url) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const https = require('https');
    
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: NBA_HEADERS,
      timeout: 10000 // 10 second timeout
    };
    
    console.log(`\n🔗 Fetching: ${url}`);
    console.log(`⏱️  Timeout: 10 seconds`);
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`📊 Status: ${res.statusCode} ${res.statusMessage}`);
        
        if (res.statusCode !== 200) {
          console.log(`❌ Error response: ${data.substring(0, 500)}`);
          resolve(null);
          return;
        }
        
        try {
          const json = JSON.parse(data);
          console.log(`✅ Response received`);
          console.log(`📋 ResultSets: ${json?.resultSets?.length || 0}`);
          if (json?.resultSets) {
            json.resultSets.forEach((rs, i) => {
              console.log(`   [${i}] ${rs?.name || 'unnamed'}: ${rs?.rowSet?.length || 0} rows`);
            });
          }
          resolve(json);
        } catch (e) {
          console.error(`❌ Parse error: ${e.message}`);
          resolve(null);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`❌ Request error: ${error.message}`);
      resolve(null);
    });
    
    req.on('timeout', () => {
      console.error(`❌ Request timeout after 10 seconds`);
      req.destroy();
      resolve(null);
    });
    
    req.setTimeout(10000);
    req.end();
  });
}

async function testPlayerGameLog() {
  console.log('\n🧪 TEST 1: playergamelog');
  console.log('='.repeat(60));
  
  // Luka Doncic NBA ID: 1629029
  // Season: 2025-26
  const url = `${NBA_STATS_BASE}/playergamelog?PlayerID=1629029&Season=2025-26&SeasonType=Regular+Season`;
  const data = await fetchNBAStats(url);
  
  if (data?.resultSets?.[0]) {
    const rs = data.resultSets[0];
    const headers = rs.headers || [];
    const rows = rs.rowSet || [];
    
    console.log(`\n📊 Headers (${headers.length}):`, headers.slice(0, 10));
    console.log(`📊 Rows: ${rows.length}`);
    
    if (rows.length > 0) {
      const firstGame = rows[0];
      console.log(`\n🎮 First game data:`);
      headers.forEach((h, i) => {
        if (i < 15) { // Show first 15 columns
          console.log(`   ${h}: ${firstGame[i]}`);
        }
      });
      
      // Find game ID and usage rate
      const gameIdIdx = headers.indexOf('GAME_ID');
      const usgIdx = headers.indexOf('USG_PCT');
      const dateIdx = headers.indexOf('GAME_DATE');
      
      if (gameIdIdx >= 0) {
        console.log(`\n✅ Found GAME_ID at index ${gameIdIdx}: ${firstGame[gameIdIdx]}`);
      }
      if (usgIdx >= 0) {
        console.log(`✅ Found USG_PCT at index ${usgIdx}: ${firstGame[usgIdx]}`);
      }
      if (dateIdx >= 0) {
        console.log(`✅ Found GAME_DATE at index ${dateIdx}: ${firstGame[dateIdx]}`);
      }
    }
  }
}

async function testBoxscoreAdvanced() {
  console.log('\n🧪 TEST 2: boxscoreadvancedv2 (for pace)');
  console.log('='.repeat(60));
  
  // Try a known game ID format: 0022500048 (2025-26 season, game 48)
  const gameId = '0022500048';
  const url = `${NBA_STATS_BASE}/boxscoreadvancedv2?GameID=${gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`;
  const data = await fetchNBAStats(url);
  
  if (data?.resultSets?.[1]) {
    const rs = data.resultSets[1]; // Team stats
    const headers = rs.headers || [];
    const rows = rs.rowSet || [];
    
    console.log(`\n📊 Team Stats Headers (${headers.length}):`, headers);
    console.log(`📊 Teams: ${rows.length}`);
    
    if (rows.length > 0) {
      const paceIdx = headers.indexOf('PACE');
      const teamIdIdx = headers.indexOf('TEAM_ID');
      
      rows.forEach((row, i) => {
        console.log(`\n🏀 Team ${i + 1}:`);
        if (teamIdIdx >= 0) console.log(`   TEAM_ID: ${row[teamIdIdx]}`);
        if (paceIdx >= 0) console.log(`   PACE: ${row[paceIdx]}`);
      });
    }
  }
}

async function testBoxscoreUsage() {
  console.log('\n🧪 TEST 3: boxscoreusagev3 (for usage rate)');
  console.log('='.repeat(60));
  
  const gameId = '0022500048';
  const url = `${NBA_STATS_BASE}/boxscoreusagev3?GameID=${gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`;
  const data = await fetchNBAStats(url);
  
  if (data?.resultSets?.[0]) {
    const rs = data.resultSets[0]; // Player stats
    const headers = rs.headers || [];
    const rows = rs.rowSet || [];
    
    console.log(`\n📊 Player Stats Headers (${headers.length}):`, headers.slice(0, 15));
    console.log(`📊 Players: ${rows.length}`);
    
    // Find Luka Doncic (1629029)
    const playerIdIdx = headers.indexOf('PLAYER_ID');
    const usgIdx = headers.indexOf('USG_PCT');
    
    if (playerIdIdx >= 0 && usgIdx >= 0) {
      const luka = rows.find(row => String(row[playerIdIdx]) === '1629029');
      if (luka) {
        console.log(`\n✅ Found Luka Doncic:`);
        console.log(`   USG_PCT: ${luka[usgIdx]}`);
      } else {
        console.log(`\n⚠️ Luka Doncic not found in this game`);
        if (rows.length > 0) {
          console.log(`   Sample player IDs:`, rows.slice(0, 3).map(r => r[playerIdIdx]));
        }
      }
    }
  }
}

async function testScoreboard() {
  console.log('\n🧪 TEST 4: scoreboardv2 (for game IDs by date)');
  console.log('='.repeat(60));
  
  // Test with a recent date: 2025-10-21
  const date = '10/21/2025';
  const url = `${NBA_STATS_BASE}/scoreboardv2?GameDate=${encodeURIComponent(date)}&DayOffset=0`;
  const data = await fetchNBAStats(url);
  
  if (data?.resultSets?.[0]) {
    const rs = data.resultSets[0];
    const headers = rs.headers || [];
    const rows = rs.rowSet || [];
    
    console.log(`\n📊 Games on ${date}: ${rows.length}`);
    
    if (rows.length > 0) {
      const gameIdIdx = headers.indexOf('GAME_ID');
      const homeIdx = headers.indexOf('HOME_TEAM_ID');
      const visitorIdx = headers.indexOf('VISITOR_TEAM_ID');
      
      rows.forEach((row, i) => {
        console.log(`\n🎮 Game ${i + 1}:`);
        if (gameIdIdx >= 0) console.log(`   GAME_ID: ${row[gameIdIdx]}`);
        if (homeIdx >= 0) console.log(`   HOME_TEAM_ID: ${row[homeIdx]}`);
        if (visitorIdx >= 0) console.log(`   VISITOR_TEAM_ID: ${row[visitorIdx]}`);
      });
    }
  }
}

async function main() {
  console.log('🧪 NBA API Test Script');
  console.log('='.repeat(60));
  
  await testPlayerGameLog();
  await testBoxscoreAdvanced();
  await testBoxscoreUsage();
  await testScoreboard();
  
  console.log('\n✅ Tests complete!');
}

main().catch(console.error);

