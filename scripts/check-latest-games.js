#!/usr/bin/env node

/**
 * Check latest games in DvP store and see if there are games scheduled for today
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

const SEASON = 2025;
const dvpDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(SEASON));
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
          return resolve({ success: false, error: `Server returned status ${res.statusCode}`, status: res.statusCode });
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: `Invalid JSON`, status: res.statusCode });
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

const today = new Date().toISOString().split('T')[0];
console.log('='.repeat(80));
console.log('Latest Games in DvP Store & Today\'s Schedule');
console.log('='.repeat(80));
console.log(`Today: ${today}`);
console.log('');

// Find latest games in store
const allGames = [];

for (const team of TEAMS) {
  const filePath = path.join(dvpDir, `${team}.json`);
  
  if (!fs.existsSync(filePath)) {
    continue;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const games = Array.isArray(data) ? data : [];
    
    games.forEach(game => {
      allGames.push({
        team,
        gameId: game.gameId,
        date: game.date,
        opponent: game.opponent,
        players: game.players?.length || 0
      });
    });
  } catch (e) {
    // Skip errors
  }
}

// Sort by date (newest first)
allGames.sort((a, b) => new Date(b.date) - new Date(a.date));

console.log('Latest 10 games in DvP store:');
allGames.slice(0, 10).forEach((game, idx) => {
  const isToday = game.date === today;
  const marker = isToday ? '⭐' : '  ';
  console.log(`${marker} ${idx + 1}. ${game.date} - ${game.team} vs ${game.opponent} (${game.players} players)`);
});

console.log('');

// Check BDL for today's games
(async () => {
  console.log('Checking BDL API for today\'s games...');
  try {
    const gamesUrl = `${BASE_URL.replace(/\/$/, '')}/api/bdl/games?start_date=${today}&end_date=${today}&per_page=100`;
    const gamesData = await fetchUrl(gamesUrl);
    
    if (gamesData && Array.isArray(gamesData.data) && gamesData.data.length > 0) {
      console.log(`✅ Found ${gamesData.data.length} game(s) scheduled for today:`);
      gamesData.data.forEach(game => {
        const home = game.home_team?.abbreviation || game.home_team?.name || 'Unknown';
        const away = game.visitor_team?.abbreviation || game.visitor_team?.name || 'Unknown';
        const status = game.status || 'Scheduled';
        console.log(`  ${away} @ ${home} - ${status}`);
      });
    } else {
      console.log('❌ No games scheduled for today according to BDL API');
    }
  } catch (e) {
    console.log(`⚠️  Could not check BDL API: ${e.message}`);
  }
  
  console.log('');
  console.log('='.repeat(80));
})();

