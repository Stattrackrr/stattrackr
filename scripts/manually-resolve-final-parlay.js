/**
 * Manually resolve the final 6-leg parlay by directly fetching player stats
 */

const { createClient } = require('@supabase/supabase-js');
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey || !BALLDONTLIE_API_KEY) {
  console.error('Missing credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const betId = 'faec9a48-3c1f-4590-9285-0e56e2a62fc5';
const gameDate = '2025-12-03';

async function resolveFinal() {
  try {
    console.log(`🔧 Resolving bet ${betId}...\n`);
    
    const { data: bet } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .single();
    
    if (!bet || !bet.parlay_legs) {
      console.error('Bet not found');
      return;
    }
    
    // Fetch all games for Dec 3
    console.log('📊 Fetching games...');
    const gamesResponse = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
      {
        headers: {
          'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
        },
      }
    );
    
    if (!gamesResponse.ok) {
      console.error(`Failed to fetch games: ${gamesResponse.status}`);
      return;
    }
    
    const gamesData = await gamesResponse.json();
    const games = gamesData.data || [];
    console.log(`✅ Found ${games.length} games\n`);
    
    const legResults = [];
    
    // Process each leg
    for (let i = 0; i < bet.parlay_legs.length; i++) {
      const leg = bet.parlay_legs[i];
      console.log(`\nLeg ${i + 1}: ${leg.playerName || leg.team} ${leg.overUnder} ${leg.line} ${leg.statType}`);
      
      if (leg.isGameProp) {
        // Game prop - Knicks ML
        const game = games.find(g => {
          const gDate = g.date ? g.date.split('T')[0] : null;
          if (gDate !== gameDate) return false;
          const homeMatch = g.home_team?.abbreviation === 'NYK' || g.home_team?.full_name?.includes('Knicks');
          const visitorMatch = g.visitor_team?.abbreviation === 'NYK' || g.visitor_team?.full_name?.includes('Knicks');
          const opponentMatch = g.home_team?.full_name?.includes('Hornets') || g.visitor_team?.full_name?.includes('Hornets');
          return (homeMatch || visitorMatch) && opponentMatch;
        });
        
        if (game && String(game.status || '').toLowerCase().includes('final')) {
          const homeScore = game.home_team_score || 0;
          const visitorScore = game.visitor_team_score || 0;
          const isHome = game.home_team?.abbreviation === 'NYK' || game.home_team?.full_name?.includes('Knicks');
          const won = isHome ? (homeScore > visitorScore) : (visitorScore > homeScore);
          console.log(`  ✅ Game Prop: ${won ? 'WIN' : 'LOSS'} (${game.home_team?.abbreviation} ${homeScore} - ${visitorScore} ${game.visitor_team?.abbreviation})`);
          legResults.push({ won, void: false });
        } else {
          console.log(`  ⏳ Game not found or not final`);
          legResults.push({ won: false, void: false });
        }
      } else if (leg.playerId) {
        // Player prop - search all games for this player
        let found = false;
        for (const game of games) {
          const gDate = game.date ? game.date.split('T')[0] : null;
          if (gDate !== gameDate) continue;
          
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
                const playerStat = statsData.data[0];
                const actualValue = playerStat[leg.statType] || 0;
                const line = Number(leg.line);
                const isWholeNumber = line % 1 === 0;
                const won = leg.overUnder === 'over'
                  ? (isWholeNumber ? actualValue >= line : actualValue > line)
                  : (isWholeNumber ? actualValue <= line : actualValue < line);
                
                console.log(`  ✅ Player Prop: ${won ? 'WIN' : 'LOSS'} (Actual: ${actualValue}, Line: ${line})`);
                console.log(`     Game: ${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}`);
                legResults.push({ won, void: false });
                found = true;
                break;
              }
            }
          } catch (e) {
            // Continue
          }
        }
        
        if (!found) {
          console.log(`  ❌ Player stats not found`);
          legResults.push({ won: false, void: false });
        }
      } else {
        console.log(`  ⏳ No playerId`);
        legResults.push({ won: false, void: false });
      }
    }
    
    // Determine result
    const nonVoidLegs = legResults.filter(r => !r.void);
    const parlayWon = nonVoidLegs.length > 0 && nonVoidLegs.every(r => r.won);
    const result = parlayWon ? 'win' : 'loss';
    
    console.log(`\n📊 Summary:`);
    console.log(`   Legs won: ${legResults.filter(r => r.won).length}/${legResults.length}`);
    console.log(`   Non-void legs: ${nonVoidLegs.length}`);
    console.log(`   All non-void won: ${nonVoidLegs.every(r => r.won)}`);
    console.log(`   Result: ${result.toUpperCase()}\n`);
    
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
      console.error('❌ Error:', error);
    } else {
      console.log(`✅ Bet updated to ${result.toUpperCase()}`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resolveFinal();

