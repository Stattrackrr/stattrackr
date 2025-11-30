require('dotenv').config({ path: '.env.local' });

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET;

async function checkJournalBets() {
  try {
    console.log(`\n🧪 Manually checking journal bets status`);
    console.log(`📡 Calling: ${PROD_URL}/api/check-journal-bets`);
    console.log(`\n📋 This will update pending journal bets to completed/live/win/loss based on game results\n`);
    
    const url = `${PROD_URL}/api/check-journal-bets${CRON_SECRET ? `?secret=${CRON_SECRET}` : ''}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        ...(CRON_SECRET ? { 'Authorization': `Bearer ${CRON_SECRET}` } : {})
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Error:', data.error || response.statusText);
      process.exit(1);
    }
    
    console.log('✅ Response received:');
    console.log(JSON.stringify(data, null, 2));
    
    // The endpoint returns a message and updated count
    if (response.ok && !data.error) {
      console.log(`\n✅ Journal bets check successful!`);
      console.log(`   ${data.message || 'Check completed'}`);
      console.log(`   - Total checked: ${data.total || 0}`);
      console.log(`   - Total updated: ${data.updated || 0}`);
      
      if (data.updated === 0 && data.total > 0) {
        console.log(`\n⚠️  Why weren't bets updated?`);
        console.log(`   Possible reasons:`);
        console.log(`   1. Games haven't finished yet (still pending/live)`);
        console.log(`   2. Games finished less than 10 minutes ago (10-minute buffer)`);
        console.log(`   3. Players not found in game stats (name mismatch)`);
        console.log(`   4. For parlays: Not all legs could be resolved`);
        console.log(`\n   💡 Check your server/Vercel logs for detailed debug information`);
        console.log(`   💡 The endpoint logs why each bet wasn't updated (game status, player matching, etc.)`);
      }
      
      if (data.updatedBets && data.updatedBets.length > 0) {
        console.log(`\n📝 Updated bets:`);
        data.updatedBets.forEach((bet, idx) => {
          console.log(`   ${idx + 1}. Bet ID ${bet.id}: ${bet.status} (${bet.result || 'N/A'})`);
        });
      }
    } else {
      console.error('❌ Check failed:', data.error || data.message || 'Unknown error');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    process.exit(1);
  }
}

checkJournalBets();

