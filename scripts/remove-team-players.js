#!/usr/bin/env node

/**
 * Remove team's own players from DvP store files
 * This updates existing games without deleting them
 */

const http = require('http');

// Process all teams (or specify a team with ?team=ATL)
const teamParam = process.argv[2] ? `&team=${process.argv[2]}` : '';
const url = `http://localhost:3000/api/dvp/remove-team-players?season=2025${teamParam}`;

console.log('Removing team players from DvP store files...');
console.log('URL:', url);
console.log('⏳ This will take 5-15 minutes for all 30 teams...');
console.log('');

// Add timeout (60 minutes max)
const timeout = setTimeout(() => {
  console.error('\n❌ Request timed out after 60 minutes');
  console.log('The process may still be running on the server. Check server logs.');
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
        console.log('✅ Process completed successfully!');
        console.log(`Teams processed: ${result.total}`);
        console.log(`Teams updated: ${result.successCount}`);
        console.log(`Total games updated: ${result.totalGamesUpdated}`);
        console.log(`Total players removed: ${result.totalPlayersRemoved}`);
        console.log('');
        
        if (result.results) {
          const withUpdates = result.results.filter(r => r.success && r.gamesUpdated > 0);
          const withErrors = result.results.filter(r => !r.success);
          
          if (withUpdates.length > 0) {
            console.log(`📊 Teams with updates:`);
            withUpdates.forEach(r => {
              console.log(`  ✅ ${r.team}: ${r.gamesUpdated} games updated, ${r.totalPlayersRemoved} players removed`);
            });
          } else {
            console.log('ℹ️  No games needed updates (all games already contain only opponent players)');
            // Show debug info for first team if available
            if (result.results && result.results.length > 0 && result.results[0].debugInfo) {
              console.log('\n🔍 Debug info:');
              result.results[0].debugInfo.forEach((msg) => {
                console.log(`  ${msg}`);
              });
            }
          }
          
          if (withErrors.length > 0) {
            console.log(`\n⚠️  Teams with errors: ${withErrors.length}`);
            withErrors.forEach(r => {
              console.log(`  ❌ ${r.team}: ${r.error || 'Unknown error'}`);
            });
          }
        }
      } else {
        console.log('❌ Process failed:', result.error || 'Unknown error');
      }
    } catch (e) {
      console.error('❌ Error parsing response:', e.message);
      console.log('Raw response:', data.substring(0, 500));
      if (data) {
        try {
          // Try to parse as text to see the error
          const errorData = JSON.parse(data);
          if (errorData.error) {
            console.error('Server error:', errorData.error);
          }
        } catch {}
      }
    }
  });
}).on('error', (e) => {
  clearTimeout(timeout);
  console.error('❌ Request failed:', e.message);
  console.log('Make sure your dev server is running on http://localhost:3000');
  process.exit(1);
});

