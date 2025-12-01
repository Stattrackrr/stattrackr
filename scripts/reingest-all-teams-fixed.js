#!/usr/bin/env node

/**
 * Re-ingest all teams to remove 0-minute players and fix position mapping
 * This will re-process all stored games with the new filtering logic
 */

const http = require('http');

// Process all games with refresh=1 to force re-processing
const url = 'http://localhost:3000/api/dvp/ingest-nba-all?games=82&refresh=1';

console.log('Re-ingesting all games to remove 0-minute players and fix position mapping...');
console.log('URL:', url);
console.log('⏳ This will take 15-30 minutes for all 30 teams and all games...');
console.log('');

// Add timeout (60 minutes max)
const timeout = setTimeout(() => {
  console.error('\n❌ Request timed out after 60 minutes');
  console.log('The ingest may still be running on the server. Check server logs.');
  process.exit(1);
}, 60 * 60 * 1000);

http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    clearTimeout(timeout);
    try {
      const result = JSON.parse(data);
      
      if (result.success) {
        console.log('✅ Re-ingest completed successfully!');
        console.log(`Teams processed: ${result.total}`);
        console.log('');
        
        if (result.results) {
          const withGames = result.results.filter(r => r.data?.stored_games > 0);
          const withErrors = result.results.filter(r => !r.ok);
          const withBM = result.results.filter(r => r.data?.basketballmonsters?.games_using_bm > 0);
          
          if (withGames.length > 0) {
            console.log(`📊 Teams with updated games: ${withGames.length}`);
            const totalGames = withGames.reduce((sum, r) => sum + (r.data?.stored_games || 0), 0);
            console.log(`   Total games processed: ${totalGames}`);
            withGames.forEach(r => {
              const bmInfo = r.data?.basketballmonsters;
              const bmStatus = bmInfo ? ` (BM: ${bmInfo.games_using_bm} games, ${bmInfo.players_with_bm_positions} players)` : '';
              console.log(`  ✅ ${r.team}: ${r.data.stored_games} game(s)${bmStatus}`);
            });
          }
          
          if (withBM.length > 0) {
            console.log(`\n🏀 Teams using BasketballMonsters lineups: ${withBM.length}`);
            const totalBMGames = withBM.reduce((sum, r) => sum + (r.data?.basketballmonsters?.games_using_bm || 0), 0);
            const totalBMVerified = withBM.reduce((sum, r) => sum + (r.data?.basketballmonsters?.games_verified || 0), 0);
            const totalBMPlayers = withBM.reduce((sum, r) => sum + (r.data?.basketballmonsters?.players_with_bm_positions || 0), 0);
            console.log(`   Total: ${totalBMGames} games (${totalBMVerified} verified, ${totalBMGames - totalBMVerified} projected), ${totalBMPlayers} players`);
          }
          
          if (withErrors.length > 0) {
            console.log(`\n⚠️  Teams with errors: ${withErrors.length}`);
            withErrors.forEach(r => {
              console.log(`  ❌ ${r.team}: ${r.error || 'Unknown error'}`);
            });
          }
        }
      } else {
        console.log('❌ Re-ingest failed:', result.error || 'Unknown error');
      }
    } catch (e) {
      console.error('❌ Error parsing response:', e.message);
      console.log('Raw response:', data.substring(0, 500));
    }
  });
}).on('error', (e) => {
  clearTimeout(timeout);
  console.error('❌ Request failed:', e.message);
  console.log('Make sure your dev server is running on http://localhost:3000');
  process.exit(1);
});

