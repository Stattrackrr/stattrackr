// Quick script to check if specific players have odds in the cached data
// This checks the API endpoint which reads from cache

const players = [
  { name: 'Cade Cunningham', bdlId: '17896075' },
  { name: 'James Harden', bdlId: '192' },
  { name: 'Ryan Rollins', bdlId: '38017712' }
];

async function checkPlayerOdds(playerName) {
  try {
    const encodedName = encodeURIComponent(playerName);
    const response = await fetch(`http://localhost:3000/api/odds?player=${encodedName}`);
    const data = await response.json();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Player: ${playerName}`);
    console.log(`Success: ${data.success}`);
    console.log(`Data length: ${data.data?.length || 0}`);
    console.log(`Loading: ${data.loading || false}`);
    console.log(`Message: ${data.message || 'N/A'}`);
    
    if (data.data && data.data.length > 0) {
      console.log(`\n✅ FOUND ODDS!`);
      console.log(`Bookmakers with odds: ${data.data.length}`);
      
      // Show sample of bookmakers
      const bookmakers = new Set();
      const statTypes = new Set();
      data.data.forEach(book => {
        bookmakers.add(book.name || book.meta?.baseName || 'Unknown');
        if (book.meta?.stat) statTypes.add(book.meta.stat);
      });
      
      console.log(`Bookmakers: ${Array.from(bookmakers).join(', ')}`);
      console.log(`Stat types: ${Array.from(statTypes).join(', ')}`);
      
      // Show first bookmaker's props
      if (data.data[0]) {
        const firstBook = data.data[0];
        console.log(`\nSample from ${firstBook.name || firstBook.meta?.baseName}:`);
        ['PTS', 'REB', 'AST', 'THREES'].forEach(stat => {
          if (firstBook[stat] && firstBook[stat].line !== 'N/A') {
            console.log(`  ${stat}: ${firstBook[stat].line} (O: ${firstBook[stat].over}, U: ${firstBook[stat].under})`);
          }
        });
      }
    } else {
      console.log(`\n❌ NO ODDS FOUND`);
      if (data.loading) {
        console.log(`(Still loading in background...)`);
      }
    }
  } catch (error) {
    console.error(`\n❌ Error checking ${playerName}:`, error.message);
  }
}

async function checkAll() {
  console.log('🔍 Checking player odds in cached data...\n');
  
  for (const player of players) {
    await checkPlayerOdds(player.name);
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Check complete!');
}

checkAll();

