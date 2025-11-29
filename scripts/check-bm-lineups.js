require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const teams = ['MIL', 'NYK'];
const today = new Date();
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

async function checkBMLineups() {
  console.log(`\n🔍 Checking BasketballMonsters lineups for ${dateStr}:\n`);
  
  for (const team of teams) {
    try {
      const url = `${PROD_URL}/api/dvp/get-todays-lineup?team=${team}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success && data.lineup && Array.isArray(data.lineup) && data.lineup.length === 5) {
        const verifiedCount = data.lineup.filter(p => p.isVerified).length;
        console.log(`✅ ${team}: ${verifiedCount}/5 verified`);
        data.lineup.forEach(p => {
          console.log(`   ${p.name} (${p.position}) - ${p.isVerified ? 'VERIFIED' : 'PROJECTED'}`);
        });
      } else {
        console.log(`❌ ${team}: No lineup available`);
        if (data.error) console.log(`   Error: ${data.error}`);
      }
    } catch (error) {
      console.log(`❌ ${team}: Error - ${error.message}`);
    }
    console.log('');
  }
}

checkBMLineups().catch(console.error);
