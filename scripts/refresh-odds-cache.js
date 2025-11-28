require('dotenv').config({ path: '.env.local' });

const BASE_URL = process.env.PROD_URL || 'http://localhost:3000';
const team = process.argv[2] || 'MIL';

const url = `${BASE_URL}/api/odds?team=${team}&refresh=1`;

console.log(`🔄 Refreshing odds cache for ${team}...`);
console.log(`📡 Calling: ${url}`);

fetch(url)
  .then(res => res.json())
  .then(data => {
    console.log('✅ Response:', JSON.stringify(data, null, 2));
    if (data.loading) {
      console.log('⏳ Cache is being refreshed in the background. Wait a few seconds and refresh the page.');
    } else {
      console.log('✅ Cache refreshed!');
    }
  })
  .catch(error => {
    console.error('❌ Error:', error);
  });

