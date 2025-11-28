require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET;

async function testPrefetchLineups() {
  try {
    console.log(`\n🧪 Testing prefetch-lineups cron job`);
    console.log(`📡 Calling: ${PROD_URL}/api/cron/prefetch-lineups\n`);
    
    const url = `${PROD_URL}/api/cron/prefetch-lineups${CRON_SECRET ? `?secret=${CRON_SECRET}` : ''}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        ...(CRON_SECRET ? { 'Authorization': `Bearer ${CRON_SECRET}` } : {})
      }
    });
    
    const data = await response.json();
    
    console.log('✅ Response received:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log(`\n✅ Prefetch successful!`);
      console.log(`   - Games processed: ${data.gamesProcessed || 0}`);
      console.log(`   - Locked lineups: ${data.locked || 0}`);
      console.log(`   - Projected lineups: ${data.projected || 0}`);
      if (data.results && data.results.length > 0) {
        console.log(`\n📋 Sample results:`);
        data.results.slice(0, 5).forEach(r => {
          console.log(`   - ${r.team} (${r.date}): ${r.message}`);
        });
      }
    } else {
      console.log(`\n❌ Prefetch failed: ${data.error || 'Unknown error'}`);
    }
    
    console.log(`\n📋 Check your server logs for detailed BasketballMonsters lineup fetching logs.`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testPrefetchLineups();

