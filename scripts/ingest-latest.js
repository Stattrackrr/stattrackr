#!/usr/bin/env node

/**
 * Ingest latest games for all teams
 * Only ingests new games that haven't been stored yet
 */

const http = require('http');

const url = 'http://localhost:3000/api/dvp/ingest-nba-all?latest=1&games=1';

console.log('Ingesting latest games for all teams...');
console.log('URL:', url);
console.log('');

http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      
      if (result.success) {
        console.log('✅ Ingest completed successfully!');
        console.log(`Teams processed: ${result.total}`);
        
        if (result.results) {
          const withNewGames = result.results.filter(r => r.data?.stored_games > 0);
          const withErrors = result.results.filter(r => !r.ok);
          const withBM = result.results.filter(r => r.data?.basketballmonsters?.games_using_bm > 0);
          
          if (withNewGames.length > 0) {
            console.log(`\n📊 Teams with new games: ${withNewGames.length}`);
            withNewGames.forEach(r => {
              const bmInfo = r.data?.basketballmonsters;
              const bmStatus = bmInfo ? ` (BM: ${bmInfo.games_using_bm} games, ${bmInfo.players_with_bm_positions} players)` : '';
              console.log(`  ✅ ${r.team}: ${r.data.stored_games} new game(s)${bmStatus}`);
            });
          } else {
            console.log('\nℹ️  No new games found (all games already ingested)');
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
        console.log('❌ Ingest failed:', result.error || 'Unknown error');
      }
    } catch (e) {
      console.error('❌ Error parsing response:', e.message);
      console.log('Raw response:', data.substring(0, 500));
    }
  });
}).on('error', (e) => {
  console.error('❌ Request failed:', e.message);
  console.log('Make sure your dev server is running on http://localhost:3000');
});

