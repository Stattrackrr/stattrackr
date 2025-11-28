require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const TEAM = process.argv[2] || 'LAL';
const CATEGORY = process.argv[3] || 'passing';

async function refreshTrackingStats() {
  const url = `${PROD_URL}/api/tracking-stats/team?team=${TEAM}&category=${CATEGORY}&refresh=1`;
  
  console.log(`🔄 Refreshing tracking stats for ${TEAM} (${CATEGORY})...`);
  console.log(`📡 Calling: ${url}`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Success!`);
      console.log(`   Players: ${data.players?.length || 0}`);
      console.log(`   Cache Status: ${response.headers.get('X-Cache-Status') || 'N/A'}`);
      console.log(`   Cache Source: ${response.headers.get('X-Cache-Source') || 'N/A'}`);
    } else {
      console.error(`❌ Error: ${data.error || response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Request failed:`, error.message);
  }
}

refreshTrackingStats();

