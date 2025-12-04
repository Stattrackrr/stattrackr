/**
 * Script to manually resolve a specific parlay bet
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

const betId = '07be954b-d344-4499-a63b-d5f7e6dc612e';

async function manuallyResolve() {
  try {
    console.log(`🔧 Manually resolving parlay bet: ${betId}\n`);
    
    // Based on the debug output:
    // Leg 1: Ryan Rollins under 14.5 Points - got 22 points = LOSS
    // Leg 2: Bucks ML - Bucks won = WIN
    // Result: LOSS (one leg lost)
    
    const { error } = await supabase
      .from('bets')
      .update({
        result: 'loss',
        actual_value: 0,
        status: 'completed',
      })
      .eq('id', betId);
    
    if (error) {
      console.error('❌ Error updating bet:', error);
    } else {
      console.log('✅ Successfully updated bet to LOSS');
      console.log('   Reason: Ryan Rollins got 22 points (over 14.5), so the under leg lost');
      console.log('   Bucks ML won, but parlay requires all legs to win');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

manuallyResolve();

