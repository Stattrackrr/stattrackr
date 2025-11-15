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
          
          if (withNewGames.length > 0) {
            console.log(`\n📊 Teams with new games: ${withNewGames.length}`);
            withNewGames.forEach(r => {
              console.log(`  ✅ ${r.team}: ${r.data.stored_games} new game(s)`);
            });
          } else {
            console.log('\nℹ️  No new games found (all games already ingested)');
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

