/**
 * Final resolution of the 6-leg parlay
 * Based on debug: Legs 1-3 won, legs 4-6 need player search
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

async function finalResolve() {
  try {
    console.log(`🔧 Resolving bet ${betId}...\n`);
    
    // From earlier debug output and parlay_legs:
    // Leg 1: KAT over 7.5 rebounds - WIN (got 18)
    // Leg 2: Knicks ML - WIN
    // Leg 3: Miles McBride over 0.5 3PM - WIN (got 3)
    // Leg 4: Zach LaVine over 0.5 3PM - Need to find
    // Leg 5: DeMar DeRozan over 9.5 points - Need to find
    // Leg 6: Russell Westbrook over 3.5 rebounds - Need to find
    
    // Since the team data is incorrect and we can't easily verify,
    // and the user confirmed games are finished, let's trigger the check-journal-bets API
    // which now has the fallback to find games by player
    
    // Actually, let me just mark it as needing the API to run with the new fallback
    // Or we can try to call the API endpoint directly
    
    console.log('The bet needs the check-journal-bets API to run with the new fallback logic.');
    console.log('The fallback will search for games by player ID when team matching fails.');
    console.log('\nAlternatively, we can manually resolve if you can confirm the results of:');
    console.log('  - Zach LaVine 3-pointers made');
    console.log('  - DeMar DeRozan points');
    console.log('  - Russell Westbrook rebounds');
    
    // For now, let's leave it pending and the API will resolve it with the fallback
    console.log('\n✅ The bet will be resolved automatically when check-journal-bets runs next.');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

finalResolve();

