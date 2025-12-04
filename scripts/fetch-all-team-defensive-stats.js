#!/usr/bin/env node
/**
 * Pre-fetch all NBA teams' defensive stats from NBA API
 * This populates the cache so the opponent breakdown loads faster
 * Run: node scripts/fetch-all-team-defensive-stats.js
 */

require('dotenv').config({ path: '.env.local' });

const NBA_TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
];

// Use localhost for local development, or production URL if explicitly set
const BASE_URL = process.env.FETCH_BASE_URL || 'http://localhost:3000';

async function fetchTeamStats(team) {
  try {
    const url = `${BASE_URL}/api/team-defensive-stats?team=${team}`;
    console.log(`📊 Fetching ${team}...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'StatTrackr-Cache-Warmup/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.success) {
      console.log(`✅ ${team}: ${data.perGame.pts.toFixed(1)} pts, ${data.perGame.reb.toFixed(1)} reb, ${data.sample_games} games`);
      return { team, success: true, data };
    } else {
      console.error(`❌ ${team}: ${data.error || 'Unknown error'}`);
      return { team, success: false, error: data.error };
    }
  } catch (error) {
    console.error(`❌ ${team}: ${error.message}`);
    return { team, success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Starting to fetch all NBA team defensive stats...\n');
  console.log(`📍 Using base URL: ${BASE_URL}\n`);

  const results = [];
  
  // Fetch all teams with a small delay between requests to avoid rate limiting
  for (let i = 0; i < NBA_TEAMS.length; i++) {
    const team = NBA_TEAMS[i];
    const result = await fetchTeamStats(team);
    results.push(result);
    
    // Small delay between requests (except for the last one)
    if (i < NBA_TEAMS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
    }
  }

  // Summary
  console.log('\n📈 Summary:');
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Successful: ${successful}/${NBA_TEAMS.length}`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}/${NBA_TEAMS.length}`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.team}: ${r.error}`);
    });
  }
  
  console.log('\n✨ Cache populated! All team defensive stats are now cached for 24 hours.');
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

