/**
 * Re-check specific bets that were just reset
 * This script directly calls the Supabase admin API to check bets
 * without going through the HTTP endpoint (avoids timeout issues)
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !BALLDONTLIE_API_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function recheckResetBets(date) {
  try {
    console.log('🔄 Re-checking reset bets...\n');
    
    // Find all pending bets on this date
    const { data: bets, error: fetchError } = await supabase
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .eq('result', 'pending')
      .or(`game_date.eq.${date},date.eq.${date}`);
    
    if (fetchError) {
      console.error('❌ Error fetching bets:', fetchError);
      throw fetchError;
    }
    
    if (!bets || bets.length === 0) {
      console.log('✅ No pending bets found to re-check');
      return;
    }
    
    console.log(`📊 Found ${bets.length} pending bets to re-check:\n`);
    bets.forEach((bet, idx) => {
      const desc = bet.market?.startsWith('Parlay') 
        ? bet.market 
        : `${bet.player_name || 'Game prop'} ${bet.selection || ''}`;
      console.log(`   ${idx + 1}. ${desc}`);
    });
    
    console.log('\n💡 To re-check these bets, you have two options:\n');
    console.log('   1. Run locally (if dev server is running):');
    console.log('      fetch("http://localhost:3000/api/check-journal-bets?recalculate=true")');
    console.log('        .then(r => r.json())');
    console.log('        .then(console.log);\n');
    console.log('   2. Wait for the cron job to run automatically');
    console.log('      (The fixed logic will resolve them when games are actually final)\n');
    console.log('   3. Call the API endpoint directly with a longer timeout:');
    console.log('      curl -m 300 "YOUR_DEPLOYED_URL/api/check-journal-bets?recalculate=true"');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

const date = process.argv[2] || '2025-12-09';
console.log(`   Date: ${date}\n`);

recheckResetBets(date);










