/**
 * Manually trigger the check-journal-bets API
 * 
 * Usage:
 *   node scripts/trigger-check-journal-bets.js
 *   node scripts/trigger-check-journal-bets.js recalculate
 */

require('dotenv').config({ path: '.env.local' });

const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function triggerCheck() {
  try {
    const args = process.argv.slice(2);
    const recalculate = args.includes('recalculate');
    const cronSecret = process.env.CRON_SECRET;
    
    // Build URL with secret if available
    let url = `${API_URL}/api/check-journal-bets`;
    const params = new URLSearchParams();
    if (recalculate) {
      params.append('recalculate', 'true');
    }
    if (cronSecret) {
      params.append('secret', cronSecret);
    }
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    console.log('🔄 Triggering check-journal-bets API...');
    if (recalculate) {
      console.log('   Mode: RECALCULATE (will re-check already resolved bets)\n');
    } else {
      console.log('   Mode: NORMAL (will only check pending bets)\n');
    }
    
    if (cronSecret) {
      console.log('   ✅ Using CRON_SECRET for authentication\n');
    } else {
      console.log('   ⚠️  No CRON_SECRET found - will rely on user session (may fail if not logged in)\n');
    }
    
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
    console.log('\n💡 If running locally, make sure the dev server is running on port 3000');
    console.log('   Or set NEXT_PUBLIC_APP_URL in .env.local to your deployed URL');
  }
}

triggerCheck();

