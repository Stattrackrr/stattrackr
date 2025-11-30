require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Fix the specific bet
 */
async function fixBet() {
  const betId = '458c6cd6-8eef-4847-afa2-63564bdd7e56';
  
  console.log(`🔧 Fixing bet ${betId}...\n`);
  
  // First, get the bet to see current state
  const { data: bet, error: fetchError } = await supabase
    .from('bets')
    .select('*')
    .eq('id', betId)
    .single();
  
  if (fetchError || !bet) {
    console.error('❌ Error fetching bet:', fetchError);
    return;
  }
  
  console.log('Current bet state:');
  console.log(`   Selection: ${bet.selection}`);
  console.log(`   Result: ${bet.result}`);
  console.log(`   Status: ${bet.status}\n`);
  
  // Based on user's description:
  // - Coby White 4+ assists (actual: 4) → WIN (4 >= 4) ✅
  // - Vucevic over 8 rebounds (actual: 14) → WIN (14 > 8) ✅
  // - Lamelo 1+ made 3 pointer (actual: 3) → WIN (3 >= 1) ✅
  // - Lamelo 10+ points (actual: 16) → WIN (16 >= 10) ✅
  // All legs are wins, so parlay should be WIN
  
  console.log('✅ All legs should be wins based on new logic:');
  console.log('   - Coby White 4+ assists (actual: 4) → WIN (4 >= 4)');
  console.log('   - Vucevic over 8 rebounds (actual: 14) → WIN (14 > 8)');
  console.log('   - Lamelo 1+ made 3 pointer (actual: 3) → WIN (3 >= 1)');
  console.log('   - Lamelo 10+ points (actual: 16) → WIN (16 >= 10)');
  console.log('\n   Therefore, the parlay should be: WIN\n');
  
  if (bet.result === 'loss') {
    console.log('🔄 Updating bet from LOSS to WIN...\n');
    
    const { error: updateError } = await supabase
      .from('bets')
      .update({ result: 'win' })
      .eq('id', betId);
    
    if (updateError) {
      console.error('❌ Error updating bet:', updateError);
      return;
    }
    
    console.log('✅ Bet successfully updated to WIN!\n');
    
    // Verify the update
    const { data: updatedBet } = await supabase
      .from('bets')
      .select('result')
      .eq('id', betId)
      .single();
    
    console.log(`✅ Verification: Bet result is now "${updatedBet?.result}"`);
  } else {
    console.log(`ℹ️  Bet is already marked as "${bet.result}", no update needed.`);
  }
}

fixBet().catch(console.error);

