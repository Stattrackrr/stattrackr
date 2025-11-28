require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const TEAM = process.argv[2] || 'LAL'; // Default to Lakers, or pass team as argument

async function testIngest() {
  try {
    console.log(`\n🧪 Testing ingest for team: ${TEAM}`);
    console.log(`📡 Calling: ${PROD_URL}/api/dvp/ingest-nba?team=${TEAM}&latest=1`);
    console.log(`\n📋 Note: This will process the latest game(s) for ${TEAM}`);
    console.log(`   For games that haven't played yet, check Vercel logs for BasketballMonsters lineup fetching.\n`);
    
    const url = `${PROD_URL}/api/dvp/ingest-nba?team=${TEAM}&latest=1`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    const data = await response.json();
    
    console.log('✅ Response received:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log(`\n✅ Ingest successful!`);
      console.log(`   - Team: ${data.team}`);
      console.log(`   - Games stored: ${data.stored_games || 0}`);
      if (data.serverless) {
        console.log(`   - Note: Serverless environment (read-only filesystem)`);
      }
    } else {
      console.log(`\n❌ Ingest failed: ${data.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testIngest();

