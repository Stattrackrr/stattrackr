/**
 * Manually resolve the 3 pending parlays based on debug output
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

async function resolveParlays() {
  try {
    console.log('🔧 Manually resolving pending parlays...\n');
    
    // Bet 1: 8-leg parlay - Based on debug: Leg 1 lost (Jalen Duren 6 < 6.5), others won but some games not found
    // Since leg 1 already lost, parlay is a loss
    const bet1Id = 'bac54db3-c1e9-453a-b299-b91f22413a1e';
    console.log(`1. Resolving bet ${bet1Id}...`);
    const { error: e1 } = await supabase
      .from('bets')
      .update({
        result: 'loss',
        actual_value: 0,
        status: 'completed',
      })
      .eq('id', bet1Id);
    if (e1) {
      console.error('   ❌ Error:', e1);
    } else {
      console.log('   ✅ Updated to LOSS (Jalen Duren got 6 rebounds, needed 6.5+)');
    }
    
    // Bet 2: 6-leg parlay - Based on debug: 3 legs resolved (all won), 3 legs couldn't find games
    // Need to check if we can resolve the remaining legs or if they're truly missing
    // For now, let's try to resolve what we can - but since not all legs resolved, it should stay pending
    // Actually, let me check the debug output again - Leg 1-3 all won, but legs 4-6 couldn't find games
    // Since we can't verify all legs, we should try to find those games or mark as pending
    // But the user said games are finished, so let's try to resolve
    
    // Bet 3: 8-leg parlay - Based on debug: Leg 8 lost (Zach LaVine got 2 points, needed 9.5+)
    // Since one leg lost, parlay is a loss
    const bet3Id = 'e355debd-608f-42a9-917b-347341fc3240';
    console.log(`\n2. Resolving bet ${bet3Id}...`);
    const { error: e3 } = await supabase
      .from('bets')
      .update({
        result: 'loss',
        actual_value: 0,
        status: 'completed',
      })
      .eq('id', bet3Id);
    if (e3) {
      console.error('   ❌ Error:', e3);
    } else {
      console.log('   ✅ Updated to LOSS (Zach LaVine got 2 points, needed 9.5+)');
    }
    
    // For bet 2, we need more info - let's leave it for now or try to resolve
    // Actually, from the debug: Legs 1-3 all won, but legs 4-6 couldn't find games
    // Since we can't verify all legs, it should stay pending until we can find those games
    // But the user said games are finished, so maybe those players didn't play or the team data is wrong
    
    console.log('\n✅ Done!');
    console.log('\nNote: Bet 2 (6-leg parlay) still needs investigation - 3 legs couldn\'t find games.');
    console.log('The fallback I added should help find those games when the API runs next time.');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resolveParlays();

