/**
 * Detailed debug script for the 6-leg parlay
 * This will show exactly what's happening with each leg
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

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

async function debugDetailed() {
  try {
    console.log(`🔍 Detailed debug for bet ${betId}\n`);
    
    // Fetch the bet
    const { data: bet, error: betError } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .single();
    
    if (betError || !bet) {
      console.error('❌ Error fetching bet:', betError);
      return;
    }
    
    console.log(`📋 Bet Details:`);
    console.log(`   Date: ${bet.date}`);
    console.log(`   Selection: ${bet.selection}`);
    console.log(`   Parlay Legs: ${JSON.stringify(bet.parlay_legs, null, 2)}\n`);
    
    // Get the bet date
    const betDate = bet.date || bet.game_date;
    const legGameDate = betDate.split('T')[0];
    
    console.log(`📅 Bet Date: ${betDate} (parsed: ${legGameDate})\n`);
    
    // Fetch all games for that date
    console.log(`🏀 Fetching games for ${legGameDate}...`);
    const gamesResponse = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${legGameDate}`,
      {
        headers: {
          'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
        },
      }
    );
    
    if (!gamesResponse.ok) {
      console.error(`❌ Failed to fetch games: ${gamesResponse.status}`);
      return;
    }
    
    const gamesData = await gamesResponse.json();
    const games = gamesData.data || [];
    
    console.log(`✅ Found ${games.length} games on ${legGameDate}\n`);
    
    // List all games
    games.forEach((game, idx) => {
      console.log(`   Game ${idx + 1}: ${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation} (ID: ${game.id}, Status: ${game.status})`);
    });
    
    console.log(`\n`);
    
    // Check each leg
    if (!bet.parlay_legs || !Array.isArray(bet.parlay_legs)) {
      console.error('❌ No parlay_legs data found');
      return;
    }
    
    console.log(`🔍 Checking ${bet.parlay_legs.length} legs:\n`);
    
    for (let i = 0; i < bet.parlay_legs.length; i++) {
      const leg = bet.parlay_legs[i];
      console.log(`\n--- Leg ${i + 1}: ${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statType} ---`);
      console.log(`   Player ID: ${leg.playerId}`);
      console.log(`   Team: ${leg.team}`);
      console.log(`   Opponent: ${leg.opponent}`);
      console.log(`   Game Date: ${leg.gameDate}`);
      console.log(`   Is Game Prop: ${leg.isGameProp}`);
      
      if (leg.isGameProp) {
        console.log(`   ⚠️  This is a game prop - skipping player search`);
        continue;
      }
      
      if (!leg.playerId) {
        console.log(`   ⚠️  No player ID - cannot search`);
        continue;
      }
      
      // Try to find game by team matching first
      const legGameDateParsed = leg.gameDate ? leg.gameDate.split('T')[0] : legGameDate;
      let targetGame = games.find((g) => {
        const gameDate = g.date ? g.date.split('T')[0] : null;
        if (gameDate !== legGameDateParsed) return false;
        
        const homeMatch = g.home_team?.abbreviation === leg.team || g.home_team?.full_name === leg.team;
        const visitorMatch = g.visitor_team?.abbreviation === leg.team || g.visitor_team?.full_name === leg.team;
        const opponentMatch = leg.opponent && (
          g.home_team?.abbreviation === leg.opponent || g.home_team?.full_name === leg.opponent ||
          g.visitor_team?.abbreviation === leg.opponent || g.visitor_team?.full_name === leg.opponent
        );
        
        return (homeMatch || visitorMatch) && (!leg.opponent || opponentMatch);
      });
      
      if (targetGame) {
        console.log(`   ✅ Found game by team matching: ${targetGame.home_team?.abbreviation} vs ${targetGame.visitor_team?.abbreviation} (ID: ${targetGame.id})`);
      } else {
        console.log(`   ❌ Game not found by team matching. Trying fallback...`);
        
        // Fallback: search all games for this player
        const gamesOnDate = games.filter(g => {
          const gameDate = g.date ? g.date.split('T')[0] : null;
          return gameDate === legGameDateParsed;
        });
        
        console.log(`   🔍 Searching ${gamesOnDate.length} games on ${legGameDateParsed} for player ${leg.playerId}...`);
        
        let foundGame = null;
        for (const game of gamesOnDate) {
          try {
            console.log(`      Checking game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation})...`);
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
                console.log(`      ✅ Found player ${leg.playerId} in game ${game.id}!`);
                console.log(`      Stats: ${JSON.stringify(statsData.data[0], null, 2)}`);
                break;
              } else {
                console.log(`      ❌ Player not found in this game`);
              }
            } else {
              console.log(`      ⚠️  API returned ${statsResponse.status}`);
            }
          } catch (e) {
            console.log(`      ⚠️  Error: ${e.message}`);
          }
        }
        
        if (foundGame) {
          console.log(`   ✅ Found game by player search: ${foundGame.home_team?.abbreviation} vs ${foundGame.visitor_team?.abbreviation} (ID: ${foundGame.id})`);
        } else {
          console.log(`   ❌ Game not found even with player search fallback`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugDetailed();

