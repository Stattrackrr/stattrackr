/**
 * Check journal bets locally (bypasses deployment timeout)
 * 
 * Usage:
 *   node scripts/check-journal-bets-local.js
 *   node scripts/check-journal-bets-local.js recalculate
 */

require('dotenv').config({ path: '.env.local' });

const API_URL = 'http://localhost:3000';

async function triggerCheck() {
  try {
    const args = process.argv.slice(2);
    const recalculate = args.includes('recalculate');
    
    const url = `${API_URL}/api/check-journal-bets${recalculate ? '?recalculate=true' : ''}`;
    
    console.log('🔄 Checking journal bets locally...');
    if (recalculate) {
      console.log('   Mode: RECALCULATE (will re-check already resolved bets)\n');
    } else {
      console.log('   Mode: NORMAL (will only check pending bets)\n');
    }
    
    console.log(`   URL: ${url}\n`);
    
    // Call the API endpoint
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ API call failed: ${response.status} ${response.statusText}`);
      console.error(`Response: ${text}`);
      return;
    }
    
    const data = await response.json();
    console.log('✅ API Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.updated) {
      console.log(`\n✅ Updated ${data.updated} bet(s)`);
    }
  } catch (error) {
    console.error('❌ Error calling API:', error.message);
    console.log('\n💡 Make sure the dev server is running:');
    console.log('   npm run dev');
  }
}

triggerCheck();

