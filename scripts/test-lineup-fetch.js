require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const TEAM = process.argv[2] || 'LAL'; // Default to Lakers, or pass team as argument

async function testLineupFetch() {
  try {
    console.log(`\n🧪 Testing lineup fetch for team: ${TEAM}`);
    console.log(`📡 Calling: ${PROD_URL}/api/dvp/get-todays-lineup?team=${TEAM}&fetchIfMissing=true\n`);
    
    const url = `${PROD_URL}/api/dvp/get-todays-lineup?team=${TEAM}&fetchIfMissing=true`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    const data = await response.json();
    
    console.log('✅ Response received:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.lineup && Array.isArray(data.lineup) && data.lineup.length > 0) {
      console.log(`\n✅ Lineup found!`);
      console.log(`   - Players: ${data.lineup.length}`);
      data.lineup.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.name} (${p.position}) - ${p.isVerified ? '✅ Verified' : '📋 Projected'}`);
      });
    } else {
      console.log(`\n⚠️ No lineup found for ${TEAM}`);
      if (data.error) {
        console.log(`   Error: ${data.error}`);
      }
    }
    
    console.log(`\n📋 Check your server console for detailed BasketballMonsters scraping logs.`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testLineupFetch();

