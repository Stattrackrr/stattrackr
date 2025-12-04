#!/usr/bin/env node

/**
 * Ingest all games for all teams with players playing 1+ minutes
 * This will process every game this season for every team
 * 
 * Usage:
 *   node scripts/ingest-all-games-1min.js [--season 2025] [--base http://localhost:3000]
 */

const http = require('http');
const https = require('https');

const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    season: null,
    base: process.env.BASE_URL || 'http://localhost:3000',
    refresh: true // Default to refresh to re-process all games
  };
  
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--season') {
      out.season = parseInt(args[++i], 10);
    } else if (a === '--base' || a === '--url') {
      out.base = args[++i];
    } else if (a === '--no-refresh') {
      out.refresh = false;
    }
  }
  return out;
}

function currentSeason() {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  if (m === 9 && d >= 15) return now.getFullYear();
  return m >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    const req = lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        // Check if response is HTML (error page)
        if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
          resolve({ 
            success: false, 
            error: `Server returned HTML instead of JSON. Status: ${res.statusCode}. Make sure the server is running and the endpoint exists.`,
            status: res.statusCode,
            body: data.substring(0, 200)
          });
          return;
        }
        
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ 
            success: false, 
            status: res.statusCode, 
            body: data.substring(0, 500), 
            error: `Invalid JSON: ${e.message}` 
          });
        }
      });
    });
    req.on('error', (e) => {
      reject(new Error(`Request failed: ${e.message}. Make sure the server is running at ${url.split('/api')[0]}`));
    });
    req.setTimeout(300000, () => { // 5 minute timeout per team
      req.destroy();
      reject(new Error('Request timeout after 5 minutes'));
    });
  });
}

async function checkServer(base) {
  try {
    const testUrl = `${base.replace(/\/$/, '')}/api/health`;
    const result = await fetchJson(testUrl).catch(() => null);
    return true; // If we can make a request, server is up
  } catch (e) {
    // Try a simple endpoint to verify server is running
    try {
      const testUrl = `${base.replace(/\/$/, '')}/api/dvp/ingest-nba?team=ATL&season=2025`;
      const result = await fetchJson(testUrl);
      // If we get any response (even error), server is running
      return true;
    } catch (err) {
      return false;
    }
  }
}

(async () => {
  const { season, base, refresh } = parseArgs();
  const seasonYear = season || currentSeason();
  
  console.log('='.repeat(60));
  console.log('DvP Ingest: All Games with 1+ Minute Players');
  console.log('='.repeat(60));
  console.log(`Season: ${seasonYear}`);
  console.log(`Base URL: ${base}`);
  console.log(`Refresh: ${refresh ? 'Yes (re-process all games)' : 'No (only new games)'}`);
  console.log(`Teams: ${TEAMS.length}`);
  console.log('');
  
  // Check if server is running
  console.log('Checking if server is running...');
  const serverRunning = await checkServer(base);
  if (!serverRunning) {
    console.log('');
    console.log('❌ ERROR: Cannot connect to server!');
    console.log(`   Make sure your Next.js dev server is running at ${base}`);
    console.log('   Run: npm run dev');
    console.log('');
    process.exit(1);
  }
  console.log('✅ Server is running');
  console.log('');
  
  console.log('⏳ This will process ALL games for ALL teams...');
  console.log('   Each team may take 5-15 minutes depending on number of games.');
  console.log('   Total time: ~2-4 hours for all 30 teams.');
  console.log('');
  
  const results = [];
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i];
    const url = `${base.replace(/\/$/, '')}/api/dvp/ingest-nba?team=${team}&season=${seasonYear}${refresh ? '&refresh=1' : ''}`;
    
    console.log(`[${i + 1}/${TEAMS.length}] Processing ${team}...`);
    console.log(`  URL: ${url}`);
    
    try {
      const result = await fetchJson(url);
      
      if (result.success || (result.serverless && result.stored_games !== undefined)) {
        const games = result.stored_games || 0;
        console.log(`  ✅ ${team}: ${games} game(s) processed`);
        successCount++;
        results.push({ team, success: true, games, data: result });
      } else {
        const errorMsg = result.error || result.body || 'Unknown error';
        console.log(`  ❌ ${team}: ${errorMsg}`);
        if (result.body && result.body.includes('<!DOCTYPE')) {
          console.log(`  ⚠️  Server returned HTML - make sure your dev server is running!`);
          console.log(`  💡 Run: npm run dev`);
          process.exit(1);
        }
        failCount++;
        results.push({ team, success: false, error: errorMsg });
      }
    } catch (e) {
      console.log(`  ❌ ${team}: ${e.message}`);
      if (e.message.includes('ECONNREFUSED') || e.message.includes('Request failed')) {
        console.log(`  ⚠️  Cannot connect to server - make sure it's running!`);
        console.log(`  💡 Run: npm run dev`);
        process.exit(1);
      }
      failCount++;
      results.push({ team, success: false, error: e.message });
    }
    
    // Small delay between teams to avoid overwhelming the server
    if (i < TEAMS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const totalGames = results.reduce((sum, r) => sum + (r.games || 0), 0);
  
  console.log('');
  console.log('='.repeat(60));
  console.log('Ingest Complete!');
  console.log('='.repeat(60));
  console.log(`Time elapsed: ${elapsed} minutes`);
  console.log(`Success: ${successCount} teams`);
  console.log(`Failed: ${failCount} teams`);
  console.log(`Total games processed: ${totalGames}`);
  console.log('');
  
  if (failCount > 0) {
    console.log('Failed teams:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  ❌ ${r.team}: ${r.error}`);
    });
    console.log('');
  }
  
  // Summary by team
  console.log('Summary by team:');
  results.forEach(r => {
    if (r.success) {
      console.log(`  ${r.team}: ${r.games || 0} games`);
    }
  });
})();

