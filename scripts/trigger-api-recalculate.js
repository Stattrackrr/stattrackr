/**
 * Trigger check-journal-bets with recalculate=true
 */

require('dotenv').config({ path: '.env.local' });

const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function triggerRecalculate() {
  try {
    console.log('🔄 Triggering check-journal-bets API with recalculate=true...\n');
    
    const response = await fetch(`${API_URL}/api/check-journal-bets?recalculate=true`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ API call failed: ${response.status} ${response.statusText}`);
      console.error(`Response: ${text.substring(0, 500)}`);
      return;
    }
    
    const data = await response.json();
    console.log('✅ API Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.updated) {
      console.log(`\n✅ Updated ${data.updated} bet(s)`);
    } else {
      console.log(`\n⚠️  No bets were updated`);
    }
  } catch (error) {
    console.error('❌ Error calling API:', error.message);
  }
}

triggerRecalculate();

