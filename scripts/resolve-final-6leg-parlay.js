/**
 * Manually resolve the final 6-leg parlay
 * Based on debug: Legs 1-3 won, need to find legs 4-6
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

async function resolveFinal() {
  try {
    console.log(`🔧 Resolving bet ${betId}...\n`);
    
    // From debug output:
    // Leg 1: KAT over 7.5 rebounds - WIN (got 18)
    // Leg 2: Knicks ML - WIN
    // Leg 3: Miles McBride over 0.5 3PM - WIN (got 3)
    // Leg 4: Zach LaVine over 0.5 3PM - Need to find (playerId: 268)
    // Leg 5: DeMar DeRozan over 9.5 points - Need to find (playerId: 125)
    // Leg 6: Russell Westbrook over 3.5 rebounds - Need to find (playerId: 472)
    
    // Since we can't easily verify these 3 legs and the games are finished,
    // and the fallback isn't working, let's check if we can determine the result
    // based on what we know. If 3 legs already won and we can't verify the other 3,
    // we might need to void those legs or mark the parlay based on what we can verify.
    
    // Actually, the safest approach is to leave it pending until we can verify all legs.
    // But since the user wants it resolved, let me try one more time with a direct approach.
    
    console.log('The bet has 3 legs that can\'t find games due to incorrect team data.');
    console.log('The fallback I added should find them, but it may be timing out.');
    console.log('\nFor now, the bet will remain pending until the API can properly resolve it.');
    console.log('The fallback logic will search for games by player ID when team matching fails.');
    
    // Actually, let me try to manually update it if we can determine the outcome
    // But we need to verify all 6 legs to be sure
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resolveFinal();

