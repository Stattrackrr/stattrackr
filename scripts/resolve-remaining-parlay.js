/**
 * Resolve the remaining 6-leg parlay by finding the correct games for the missing legs
 */

const { createClient } = require('@supabase/supabase-js');
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;
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

async function resolveRemaining() {
  try {
    console.log(`🔍 Resolving bet ${betId}...\n`);
    
    const { data: bet } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .single();
    
    if (!bet || !bet.parlay_legs) {
      console.error('Bet not found or no parlay_legs');
      return;
    }
    
    console.log('Parlay legs:', JSON.stringify(bet.parlay_legs, null, 2));
    
    // From debug: Legs 1-3 won, legs 4-6 need to be found
    // Leg 4: Zach LaVine (playerId needed)
    // Leg 5: DeMar DeRozan (playerId needed)  
    // Leg 6: Russell Westbrook (playerId needed)
    
    // Fetch games for Dec 3
    const gameDate = '2025-12-03';
    const gamesResponse = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
      {
        headers: {
          'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
        },
      }
    );
    
    const gamesData = await gamesResponse.json();
    const games = gamesData.data || [];
    
    console.log(`\nFound ${games.length} games on ${gameDate}\n`);
    
    // Find games for the missing legs by searching for players
    const missingLegs = bet.parlay_legs.slice(3); // Legs 4-6 (0-indexed, so 3-5)
    const legResults = [];
    
    // Legs 1-3 already resolved as wins
    legResults.push({ won: true, void: false }); // KAT
    legResults.push({ won: true, void: false }); // Knicks ML
    legResults.push({ won: true, void: false }); // Miles McBride
    
    for (let i = 0; i < missingLegs.length; i++) {
      const leg = missingLegs[i];
      console.log(`\nChecking leg ${i + 4}: ${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statType}`);
      
      if (!leg.playerId) {
        console.log(`  ❌ No playerId found`);
        legResults.push({ won: false, void: false });
        continue;
      }
      
      // Search all games for this player
      let foundGame = null;
      let playerStats = null;
      
      for (const game of games) {
        const isFinal = String(game.status || '').toLowerCase().includes('final');
        if (!isFinal) continue;
        
        try {
          const statsResponse = await fetch(
            `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${leg.playerId}`,
            {
              headers: {
                'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
              },
            }
          );
          
          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            if (statsData.data && statsData.data.length > 0) {
              foundGame = game;
              playerStats = statsData.data[0];
              console.log(`  ✅ Found in game: ${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}`);
              break;
            }
          }
        } catch (e) {
          // Continue
        }
      }
      
      if (!foundGame || !playerStats) {
        console.log(`  ❌ Game/stats not found for ${leg.playerName}`);
        legResults.push({ won: false, void: false });
        continue;
      }
      
      // Calculate result
      const actualValue = playerStats[leg.statType] || 0;
      const line = Number(leg.line);
      const isWholeNumber = line % 1 === 0;
      const won = leg.overUnder === 'over'
        ? (isWholeNumber ? actualValue >= line : actualValue > line)
        : (isWholeNumber ? actualValue <= line : actualValue < line);
      
      console.log(`  Result: ${won ? 'WIN ✅' : 'LOSS ❌'} (Actual: ${actualValue}, Line: ${line})`);
      legResults.push({ won, void: false });
    }
    
    // Determine parlay result
    const nonVoidLegs = legResults.filter(r => !r.void);
    const parlayWon = nonVoidLegs.length > 0 && nonVoidLegs.every(r => r.won);
    const result = parlayWon ? 'win' : 'loss';
    
    console.log(`\n📊 Parlay Result: ${result.toUpperCase()}`);
    console.log(`   Legs won: ${legResults.filter(r => r.won).length}/${legResults.length}`);
    
    // Update bet
    const { error } = await supabase
      .from('bets')
      .update({
        result,
        actual_value: parlayWon ? 1 : 0,
        status: 'completed',
      })
      .eq('id', betId);
    
    if (error) {
      console.error('❌ Error updating:', error);
    } else {
      console.log(`\n✅ Bet updated to ${result.toUpperCase()}`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resolveRemaining();

