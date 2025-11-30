require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;
const season = process.argv[2] || '2025';

if (!BALLDONTLIE_API_KEY) {
  console.error('❌ BALLDONTLIE_API_KEY not found in environment');
  process.exit(1);
}

/**
 * Get today's date in local timezone (YYYY-MM-DD)
 */
function getTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert local date to Eastern Time date (for cache key lookup)
 */
function localToEasternDate(localDateStr) {
  const [year, month, day] = localDateStr.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0);
  const easternTime = new Date(localDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const easternYear = easternTime.getFullYear();
  const easternMonth = String(easternTime.getMonth() + 1).padStart(2, '0');
  const easternDay = String(easternTime.getDate()).padStart(2, '0');
  return `${easternYear}-${easternMonth}-${easternDay}`;
}

/**
 * Normalize team abbreviation
 */
function normalizeAbbr(abbr) {
  const map = {
    'PHX': 'PHO',
    'GSW': 'GS',
    'NOP': 'NO',
  };
  return map[abbr] || abbr;
}

/**
 * Check DvP store for a team's game on a specific date
 */
function checkTeamGame(teamAbbr, gameDate, opponentAbbr) {
  const storeFile = path.join(__dirname, '..', 'data', 'dvp_store', season, `${teamAbbr}.json`);
  
  if (!fs.existsSync(storeFile)) {
    return { found: false, reason: 'File not found' };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (!Array.isArray(data)) {
      return { found: false, reason: 'Invalid data format' };
    }
    
    // Find game matching date and opponent
    const game = data.find(g => {
      const gameDateStr = g.date ? new Date(g.date).toISOString().split('T')[0] : null;
      return gameDateStr === gameDate && 
             (g.opponent === opponentAbbr || g.oppAbbr === opponentAbbr);
    });
    
    if (!game) {
      return { found: false, reason: 'Game not found in store' };
    }
    
    // Check for BasketballMonsters data
    const players = Array.isArray(game.players) ? game.players : [];
    const bmPlayers = players.filter(p => p.bmPosition);
    const bmPlayersCount = game.bmPlayersCount || bmPlayers.length;
    const source = game.source || 'unknown';
    const lineupVerified = game.lineupVerified || false;
    const hasBMData = bmPlayersCount > 0 || source.includes('basketballmonsters') || bmPlayers.length > 0;
    
    return {
      found: true,
      hasBMData,
      bmPlayersCount,
      totalPlayers: players.length,
      source,
      lineupVerified,
      bmPositions: bmPlayers.map(p => `${p.name} (${p.bmPosition})`).slice(0, 5),
      date: game.date,
      opponent: game.opponent || game.oppAbbr
    };
  } catch (error) {
    return { found: false, reason: `Error reading file: ${error.message}` };
  }
}

/**
 * Main function
 */
async function checkTodaysIngest() {
  const todayLocal = getTodayLocal();
  const todayEastern = localToEasternDate(todayLocal);
  
  console.log(`\n🔍 Checking BasketballMonsters ingestion`);
  console.log(`   Local date: ${todayLocal}`);
  console.log(`   Eastern date (for cache): ${todayEastern}\n`);
  console.log('='.repeat(60));
  
  // Fetch games for local date
  const gamesUrl = `https://api.balldontlie.io/v1/games?dates[]=${todayLocal}&per_page=100`;
  
  console.log(`\n📡 Fetching games from Ball Don't Lie API...`);
  const gamesResponse = await fetch(gamesUrl, {
    headers: {
      'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`
    }
  });
  
  if (!gamesResponse.ok) {
    console.error(`❌ Failed to fetch games: ${gamesResponse.status} ${gamesResponse.statusText}`);
    process.exit(1);
  }
  
  const gamesData = await gamesResponse.json();
  const games = gamesData.data || [];
  
  if (games.length === 0) {
    console.log(`\n✅ No games found for ${todayLocal}`);
    return;
  }
  
  console.log(`\n📊 Found ${games.length} game(s) today:\n`);
  
  const results = [];
  
  for (const game of games) {
    const homeTeam = game.home_team?.abbreviation;
    const visitorTeam = game.visitor_team?.abbreviation;
    const gameStatus = game.status || 'Scheduled';
    
    if (!homeTeam || !visitorTeam) {
      console.log(`⚠️  Skipping game: Missing team data`);
      continue;
    }
    
    console.log(`\n🏀 ${visitorTeam} @ ${homeTeam}`);
    console.log(`   Status: ${gameStatus}`);
    console.log(`   Game ID: ${game.id}`);
    
    // Get the actual game date from BDL
    // BDL returns the date the game was played (in America/Eastern timezone)
    // We need to use this date to check the DvP store
    let gameDateForStore = todayLocal; // Default fallback
    if (game.date) {
      try {
        // BDL date is typically in ISO format, extract YYYY-MM-DD
        gameDateForStore = game.date.split('T')[0];
        console.log(`   Game date from BDL: ${gameDateForStore}`);
      } catch (e) {
        console.log(`   ⚠️  Could not parse game date`);
      }
    }
    
    // Check both teams using the actual game date from BDL
    const homeResult = checkTeamGame(homeTeam, gameDateForStore, visitorTeam);
    const visitorResult = checkTeamGame(visitorTeam, gameDateForStore, homeTeam);
    
    // Home team
    console.log(`\n   📋 ${homeTeam}:`);
    if (homeResult.found) {
      if (homeResult.hasBMData) {
        console.log(`      ✅ BasketballMonsters data found!`);
        console.log(`         - BM Players: ${homeResult.bmPlayersCount}/${homeResult.totalPlayers}`);
        console.log(`         - Source: ${homeResult.source}`);
        console.log(`         - Lineup Verified: ${homeResult.lineupVerified ? '✅ YES' : '⚠️  PROJECTED'}`);
        if (homeResult.bmPositions.length > 0) {
          console.log(`         - Sample positions: ${homeResult.bmPositions.join(', ')}`);
        }
        results.push({ team: homeTeam, opponent: visitorTeam, hasBM: true, verified: homeResult.lineupVerified });
      } else {
        console.log(`      ❌ No BasketballMonsters data found`);
        console.log(`         - Source: ${homeResult.source}`);
        console.log(`         - BM Players: ${homeResult.bmPlayersCount}`);
        results.push({ team: homeTeam, opponent: visitorTeam, hasBM: false });
      }
    } else {
      console.log(`      ⚠️  ${homeResult.reason}`);
      results.push({ team: homeTeam, opponent: visitorTeam, hasBM: false, reason: homeResult.reason });
    }
    
    // Visitor team
    console.log(`\n   📋 ${visitorTeam}:`);
    if (visitorResult.found) {
      if (visitorResult.hasBMData) {
        console.log(`      ✅ BasketballMonsters data found!`);
        console.log(`         - BM Players: ${visitorResult.bmPlayersCount}/${visitorResult.totalPlayers}`);
        console.log(`         - Source: ${visitorResult.source}`);
        console.log(`         - Lineup Verified: ${visitorResult.lineupVerified ? '✅ YES' : '⚠️  PROJECTED'}`);
        if (visitorResult.bmPositions.length > 0) {
          console.log(`         - Sample positions: ${visitorResult.bmPositions.join(', ')}`);
        }
        results.push({ team: visitorTeam, opponent: homeTeam, hasBM: true, verified: visitorResult.lineupVerified });
      } else {
        console.log(`      ❌ No BasketballMonsters data found`);
        console.log(`         - Source: ${visitorResult.source}`);
        console.log(`         - BM Players: ${visitorResult.bmPlayersCount}`);
        results.push({ team: visitorTeam, opponent: homeTeam, hasBM: false });
      }
    } else {
      console.log(`      ⚠️  ${visitorResult.reason}`);
      results.push({ team: visitorTeam, opponent: homeTeam, hasBM: false, reason: visitorResult.reason });
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n📊 SUMMARY:\n`);
  
  const withBM = results.filter(r => r.hasBM);
  const verified = results.filter(r => r.hasBM && r.verified);
  const withoutBM = results.filter(r => !r.hasBM);
  
  console.log(`   ✅ Teams with BM data: ${withBM.length}/${results.length}`);
  console.log(`   ✅ Teams with VERIFIED lineups: ${verified.length}/${results.length}`);
  console.log(`   ❌ Teams without BM data: ${withoutBM.length}/${results.length}`);
  
  if (withoutBM.length > 0) {
    console.log(`\n   ⚠️  Teams missing BM data:`);
    withoutBM.forEach(r => {
      console.log(`      - ${r.team} vs ${r.opponent}${r.reason ? ` (${r.reason})` : ''}`);
    });
  }
  
  if (verified.length < withBM.length) {
    console.log(`\n   ⚠️  Teams with PROJECTED (not verified) lineups:`);
    results.filter(r => r.hasBM && !r.verified).forEach(r => {
      console.log(`      - ${r.team} vs ${r.opponent}`);
    });
  }
  
  console.log(`\n${'='.repeat(60)}\n`);
}

checkTodaysIngest().catch(console.error);

