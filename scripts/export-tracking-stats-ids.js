#!/usr/bin/env node

/**
 * Export all player IDs from NBA Tracking Stats API
 * 
 * This script fetches all players from the NBA tracking stats
 * and exports them to a JSON file for manual mapping.
 * 
 * Usage:
 *   node scripts/export-tracking-stats-ids.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

console.log('🏀 Exporting NBA Tracking Stats Player IDs\n');

const params = new URLSearchParams({
  College: "",
  Conference: "",
  Country: "",
  DateFrom: "",
  DateTo: "",
  Division: "",
  DraftPick: "",
  DraftYear: "",
  GameScope: "",
  Height: "",
  LastNGames: "0",
  LeagueID: "00",
  Location: "",
  Month: "0",
  OpponentTeamID: "0",
  Outcome: "",
  PORound: "0",
  PerMode: "PerGame",
  PlayerExperience: "",
  PlayerOrTeam: "Player",
  PlayerPosition: "",
  PtMeasureType: "Passing",
  Season: "2025-26",
  SeasonSegment: "",
  SeasonType: "Regular Season",
  StarterBench: "",
  TeamID: "0",
  VsConference: "",
  VsDivision: "",
  Weight: "",
});

const url = `https://stats.nba.com/stats/leaguedashptstats?${params.toString()}`;

console.log('📡 Fetching tracking stats players...\n');

https.get(url, { headers: NBA_HEADERS }, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`❌ HTTP ${res.statusCode}: ${data}`);
      process.exit(1);
    }
    
    try {
      const json = JSON.parse(data);
      const resultSet = json.resultSets[0];
      const headers = resultSet.headers;
      const rows = resultSet.rowSet;
      
      const playerIdIdx = headers.indexOf('PLAYER_ID');
      const playerNameIdx = headers.indexOf('PLAYER_NAME');
      const teamIdIdx = headers.indexOf('TEAM_ID');
      const teamAbbIdx = headers.indexOf('TEAM_ABBREVIATION');
      
      const players = rows.map(row => ({
        nbaId: String(row[playerIdIdx]),
        name: row[playerNameIdx],
        teamId: row[teamIdIdx],
        team: row[teamAbbIdx],
      }));
      
      // Sort by name
      players.sort((a, b) => a.name.localeCompare(b.name));
      
      // Save to file
      const outputPath = path.join(__dirname, 'tracking-stats-players.json');
      fs.writeFileSync(outputPath, JSON.stringify(players, null, 2), 'utf8');
      
      console.log(`✅ Found ${players.length} players`);
      console.log(`📄 Exported to: scripts/tracking-stats-players.json\n`);
      
      // Show first 20 players as sample
      console.log('Sample (first 20 players):');
      console.log('─'.repeat(70));
      players.slice(0, 20).forEach(p => {
        console.log(`${p.name.padEnd(30)} | NBA ID: ${p.nbaId.padEnd(10)} | ${p.team}`);
      });
      console.log('─'.repeat(70));
      console.log(`\n... and ${players.length - 20} more players\n`);
      
      console.log('Next steps:');
      console.log('1. Open scripts/tracking-stats-players.json');
      console.log('2. Find player IDs you need');
      console.log('3. Add them to lib/playerIdMapping.ts');
      
      process.exit(0);
    } catch (err) {
      console.error('❌ Error parsing response:', err.message);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error('❌ Request failed:', err.message);
  process.exit(1);
}).setTimeout(30000, function() {
  console.error('❌ Request timeout');
  this.destroy();
  process.exit(1);
});


