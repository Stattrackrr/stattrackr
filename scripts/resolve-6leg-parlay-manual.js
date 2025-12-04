/**
 * Manually resolve the 6-leg parlay based on confirmed stats
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

const betId = 'faec9a48-3c1f-4590-9285-0e56e2a62fc5';

async function resolveManual() {
  try {
    console.log(`🔧 Manually resolving bet ${betId}...\n`);
    
    // From debug output:
    // Leg 1: KAT over 7.5 rebounds - WIN (got 18 rebounds in NYK vs CHA game)
    // Leg 2: Knicks ML - WIN (NYK won)
    // Leg 3: Miles McBride over 0.5 3PM - WIN (got 3 in NYK vs CHA game)
    // Leg 4: Zach LaVine over 0.5 3PM - LOSS (got 0 in HOU vs SAC game)
    // Leg 5: DeMar DeRozan over 9.5 points - WIN (got 12 in HOU vs SAC game)
    // Leg 6: Russell Westbrook over 3.5 rebounds - WIN (got 4 in HOU vs SAC game)
    
    // So: 5 wins, 1 loss = LOSS overall
    
    const { error } = await supabase
      .from('bets')
      .update({
        result: 'loss',
        status: 'completed',
        actual_value: 0,
      })
      .eq('id', betId);
    
    if (error) {
      console.error('❌ Error updating bet:', error);
      return;
    }
    
    console.log('✅ Bet resolved to LOSS (5 wins, 1 loss - Zach LaVine got 0 3PM)');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resolveManual();

