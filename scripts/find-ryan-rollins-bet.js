/**
 * Script to find Ryan Rollins + Bucks ML parlay
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function findBet() {
  try {
    // Search for bets with "Ryan Rollins" or "Rollins" in selection
    const { data: bets, error } = await supabase
      .from('bets')
      .select('*')
      .or('selection.ilike.%Ryan Rollins%,selection.ilike.%Rollins%,selection.ilike.%Bucks ML%')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    if (!bets || bets.length === 0) {
      console.log('No bets found with Ryan Rollins or Bucks ML');
      return;
    }
    
    console.log(`Found ${bets.length} bet(s):\n`);
    
    bets.forEach((bet, index) => {
      console.log(`${index + 1}. Bet ID: ${bet.id}`);
      console.log(`   User ID: ${bet.user_id}`);
      console.log(`   Date: ${bet.date || bet.game_date || 'N/A'}`);
      console.log(`   Market: ${bet.market || 'N/A'}`);
      console.log(`   Selection: ${bet.selection || 'N/A'}`);
      console.log(`   Result: ${bet.result || 'pending'}`);
      console.log(`   Status: ${bet.status || 'pending'}`);
      if (bet.parlay_legs) {
        console.log(`   Parlay Legs: ${JSON.stringify(bet.parlay_legs, null, 2)}`);
      }
      console.log('-'.repeat(100));
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

findBet();

