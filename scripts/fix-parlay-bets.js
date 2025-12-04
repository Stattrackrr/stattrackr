/**
 * Script to manually fix incorrectly resolved parlay bets
 * Usage: node scripts/fix-parlay-bets.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function fixParlayBets() {
  try {
    // Bet 1: P.J. Washington parlay - should be WIN (P.J. voided, all others won)
    const bet1Id = '984f91a1-215f-475f-b99f-0f72335ff2cf';
    
    // Bet 2: Coby White parlay - Coby got exactly 4, line was 4 (whole number), should be WIN (4 >= 4)
    const bet2Id = '458c6cd6-8eef-4847-afa2-63564bdd7e56';
    
    console.log('🔧 Fixing incorrectly resolved parlay bets...\n');
    
    // Fix Bet 1: P.J. Washington parlay
    console.log(`1. Fixing bet ${bet1Id} (P.J. Washington parlay)...`);
    const { data: bet1, error: bet1Error } = await supabase
      .from('bets')
      .select('*')
      .eq('id', bet1Id)
      .single();
    
    if (bet1Error) {
      console.error('❌ Error fetching bet 1:', bet1Error);
    } else {
      console.log(`   Current result: ${bet1.result}`);
      console.log(`   Selection: ${bet1.selection}`);
      
      // Update to win
      const { error: update1Error } = await supabase
        .from('bets')
        .update({
          result: 'win',
          actual_value: 1,
          status: 'completed',
        })
        .eq('id', bet1Id);
      
      if (update1Error) {
        console.error('   ❌ Error updating bet 1:', update1Error);
      } else {
        console.log('   ✅ Updated bet 1 to WIN');
      }
    }
    
    console.log('');
    
    // Fix Bet 2: Coby White parlay
    console.log(`2. Fixing bet ${bet2Id} (Coby White parlay)...`);
    const { data: bet2, error: bet2Error } = await supabase
      .from('bets')
      .select('*')
      .eq('id', bet2Id)
      .single();
    
    if (bet2Error) {
      console.error('❌ Error fetching bet 2:', bet2Error);
    } else {
      console.log(`   Current result: ${bet2.result}`);
      console.log(`   Selection: ${bet2.selection}`);
      
      // Update to win
      const { error: update2Error } = await supabase
        .from('bets')
        .update({
          result: 'win',
          actual_value: 1,
          status: 'completed',
        })
        .eq('id', bet2Id);
      
      if (update2Error) {
        console.error('   ❌ Error updating bet 2:', update2Error);
      } else {
        console.log('   ✅ Updated bet 2 to WIN');
      }
    }
    
    console.log('\n✅ Done fixing parlay bets!\n');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

fixParlayBets();

