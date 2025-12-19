#!/usr/bin/env node

/**
 * Verify that all teams' DvP data is accessible through the API
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

const SEASON = 2025;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const req = lib.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return resolve({ success: false, error: `Server returned status ${res.statusCode}`, status: res.statusCode, body: data.substring(0, 200) });
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: `Server returned invalid JSON. Status: ${res.statusCode}`, status: res.statusCode, body: data.substring(0, 200) });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function checkTeam(team) {
  const url = `${BASE_URL.replace(/\/$/, '')}/api/dvp?team=${team}&season=${SEASON}&metric=pts`;
  
  try {
    const result = await fetchUrl(url);
    
    if (result.success && result.perGame) {
      const hasData = Object.values(result.perGame).some(v => v > 0);
      const games = result.sample_games || 0;
      
      return {
        team,
        success: true,
        hasData,
        games,
        perGame: result.perGame,
        totals: result.totals
      };
    } else {
      return {
        team,
        success: false,
        error: result.error || 'Unknown error',
        hasData: false,
        games: 0
      };
    }
  } catch (e) {
    return {
      team,
      success: false,
      error: e.message,
      hasData: false,
      games: 0
    };
  }
}

(async () => {
  console.log('='.repeat(80));
  console.log('DvP API Verification');
  console.log('='.repeat(80));
  console.log(`Season: ${SEASON}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Teams: ${TEAMS.length}`);
  console.log('');

  const results = [];
  let successCount = 0;
  let failCount = 0;
  let totalGames = 0;

  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i];
    process.stdout.write(`[${i + 1}/${TEAMS.length}] Checking ${team}... `);
    
    const result = await checkTeam(team);
    results.push(result);
    
    if (result.success && result.hasData) {
      successCount++;
      totalGames += result.games;
      console.log(`✅ ${result.games} games`);
    } else {
      failCount++;
      console.log(`❌ ${result.error || 'No data'}`);
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Summary');
  console.log('='.repeat(80));
  console.log(`Total Teams: ${TEAMS.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total Games: ${totalGames}`);
  console.log(`Average Games per Team: ${(totalGames / successCount).toFixed(1)}`);
  console.log('');

  if (failCount > 0) {
    console.log('Failed Teams:');
    results.filter(r => !r.success || !r.hasData).forEach(r => {
      console.log(`  ❌ ${r.team}: ${r.error || 'No data'}`);
    });
    console.log('');
  }

  // Show sample data for first successful team
  const firstSuccess = results.find(r => r.success && r.hasData);
  if (firstSuccess) {
    console.log(`Sample Data (${firstSuccess.team}):`);
    console.log(`  Games: ${firstSuccess.games}`);
    console.log(`  Per Game Averages:`);
    Object.entries(firstSuccess.perGame).forEach(([pos, avg]) => {
      console.log(`    ${pos}: ${avg.toFixed(2)}`);
    });
    console.log('');
  }

  if (failCount === 0 && successCount === TEAMS.length) {
    console.log('✅ All teams are accessible and have data!');
    process.exit(0);
  } else {
    console.log(`⚠️  ${failCount} team(s) failed verification`);
    process.exit(1);
  }
})();























