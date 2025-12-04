/**
 * Script to debug why a specific parlay isn't resolving
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

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

async function debugParlay() {
  try {
    console.log(`🔍 Debugging parlay bet: ${betId}\n`);
    
    // Get the bet
    const { data: bet, error: betError } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .single();
    
    if (betError || !bet) {
      console.error('Error fetching bet:', betError);
      return;
    }
    
    console.log('Bet Details:');
    console.log(`  Date: ${bet.date || bet.game_date}`);
    console.log(`  Selection: ${bet.selection}`);
    console.log(`  Result: ${bet.result}`);
    console.log(`  Status: ${bet.status}`);
    console.log(`  Parlay Legs: ${JSON.stringify(bet.parlay_legs, null, 2)}\n`);
    
    if (!bet.parlay_legs || bet.parlay_legs.length === 0) {
      console.log('❌ No parlay_legs data found');
      return;
    }
    
    const gameDate = bet.parlay_legs[0].gameDate || bet.date || bet.game_date;
    console.log(`📅 Game Date: ${gameDate}\n`);
    
    // Fetch games for this date
    console.log('📊 Fetching games from BallDontLie API...');
    const gamesResponse = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
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
    
    console.log(`✅ Found ${games.length} games on ${gameDate}\n`);
    
    // Check each leg
    for (let i = 0; i < bet.parlay_legs.length; i++) {
      const leg = bet.parlay_legs[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Leg ${i + 1}: ${leg.isGameProp ? 'GAME PROP' : 'PLAYER PROP'}`);
      console.log(`  ${leg.isGameProp ? `Team: ${leg.team} vs ${leg.opponent}` : `Player: ${leg.playerName} (${leg.playerId})`}`);
      console.log(`  Bet: ${leg.statType} ${leg.overUnder} ${leg.line}`);
      console.log(`  Game Date: ${leg.gameDate}\n`);
      
      // Find the game
      const gameDateStr = leg.gameDate || gameDate;
      const targetGame = games.find((g) => {
        const gDate = g.date ? g.date.split('T')[0] : null;
        if (gDate !== gameDateStr) return false;
        
        if (leg.isGameProp) {
          // For game props, match by team
          const homeMatch = g.home_team?.abbreviation === leg.team || g.home_team?.full_name === leg.team;
          const visitorMatch = g.visitor_team?.abbreviation === leg.team || g.visitor_team?.full_name === leg.team;
          const opponentMatch = leg.opponent && (
            g.home_team?.abbreviation === leg.opponent || g.home_team?.full_name === leg.opponent ||
            g.visitor_team?.abbreviation === leg.opponent || g.visitor_team?.full_name === leg.opponent
          );
          return (homeMatch || visitorMatch) && (!leg.opponent || opponentMatch);
        } else {
          // For player props, match by team
          const homeMatch = g.home_team?.abbreviation === leg.team || g.home_team?.full_name === leg.team;
          const visitorMatch = g.visitor_team?.abbreviation === leg.team || g.visitor_team?.full_name === leg.team;
          const opponentMatch = leg.opponent && (
            g.home_team?.abbreviation === leg.opponent || g.home_team?.full_name === leg.opponent ||
            g.visitor_team?.abbreviation === leg.opponent || g.visitor_team?.full_name === leg.opponent
          );
          return (homeMatch || visitorMatch) && (!leg.opponent || opponentMatch);
        }
      });
      
      if (!targetGame) {
        console.log(`  ❌ Game not found for ${leg.team} vs ${leg.opponent} on ${gameDateStr}`);
        continue;
      }
      
      console.log(`  ✅ Game found: ${targetGame.id}`);
      console.log(`     Status: ${targetGame.status}`);
      console.log(`     Home: ${targetGame.home_team?.abbreviation} (${targetGame.home_team_score || 0})`);
      console.log(`     Visitor: ${targetGame.visitor_team?.abbreviation} (${targetGame.visitor_team_score || 0})`);
      
      const isFinal = String(targetGame.status || '').toLowerCase().includes('final');
      console.log(`     Is Final: ${isFinal}`);
      
      if (leg.isGameProp) {
        // Game prop - check moneyline
        if (leg.statType === 'moneyline') {
          const homeScore = targetGame.home_team_score || 0;
          const visitorScore = targetGame.visitor_team_score || 0;
          const isHome = (targetGame.home_team?.abbreviation === leg.team || targetGame.home_team?.full_name === leg.team);
          const won = isHome ? (homeScore > visitorScore) : (visitorScore > homeScore);
          console.log(`     Moneyline Result: ${won ? 'WIN ✅' : 'LOSS ❌'}`);
          console.log(`     ${isHome ? 'Home' : 'Visitor'} team (${leg.team}) ${won ? 'won' : 'lost'}`);
        }
      } else {
        // Player prop - check stats
        if (!isFinal) {
          console.log(`  ⏳ Game not final yet, cannot resolve player prop`);
          continue;
        }
        
        console.log(`  📊 Fetching player stats...`);
        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${targetGame.id}&player_ids[]=${leg.playerId}`,
          {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          }
        );
        
        if (!statsResponse.ok) {
          console.log(`  ❌ Failed to fetch stats: ${statsResponse.status}`);
          continue;
        }
        
        const statsData = await statsResponse.json();
        if (!statsData.data || statsData.data.length === 0) {
          console.log(`  ❌ No stats found for player ${leg.playerId} in game ${targetGame.id}`);
          continue;
        }
        
        const playerStat = statsData.data[0];
        const actualValue = playerStat[leg.statType] || 0;
        const line = Number(leg.line);
        const isWholeNumber = line % 1 === 0;
        const won = leg.overUnder === 'over'
          ? (isWholeNumber ? actualValue >= line : actualValue > line)
          : (isWholeNumber ? actualValue <= line : actualValue < line);
        
        console.log(`  ✅ Player Stats Found:`);
        console.log(`     Points: ${playerStat.pts || 0}`);
        console.log(`     Actual Value: ${actualValue}`);
        console.log(`     Line: ${line} (${isWholeNumber ? 'whole number' : 'decimal'})`);
        console.log(`     Bet: ${leg.overUnder} ${line}`);
        console.log(`     Result: ${won ? 'WIN ✅' : 'LOSS ❌'}`);
        console.log(`     Comparison: ${actualValue} ${leg.overUnder === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${line} = ${won}`);
      }
    }
    
    console.log(`\n${'='.repeat(80)}\n`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugParlay();

