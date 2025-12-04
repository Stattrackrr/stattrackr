/**
 * Manually trigger the check-journal-bets API
 */

require('dotenv').config({ path: '.env.local' });

const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function triggerCheck() {
  try {
    console.log('🔄 Triggering check-journal-bets API...\n');
    
    // Call the API endpoint
    const response = await fetch(`${API_URL}/api/check-journal-bets`, {
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

