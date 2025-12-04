/**
 * Script to debug why pending bets aren't resolving
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

const pendingBetIds = [
  'bac54db3-c1e9-453a-b299-b91f22413a1e', // 8-leg parlay
  'faec9a48-3c1f-4590-9285-0e56e2a62fc5', // 6-leg parlay
  'e355debd-608f-42a9-917b-347341fc3240', // 8-leg parlay
];

async function debugPendingBets() {
  try {
    for (const betId of pendingBetIds) {
      console.log(`\n${'='.repeat(100)}`);
      console.log(`🔍 Debugging bet: ${betId}`);
      console.log('='.repeat(100));
      
      const { data: bet, error } = await supabase
        .from('bets')
        .select('*')
        .eq('id', betId)
        .single();
      
      if (error || !bet) {
        console.error('Error fetching bet:', error);
        continue;
      }
      
      console.log(`\nBet Details:`);
      console.log(`  Date: ${bet.date || bet.game_date}`);
      console.log(`  Selection: ${bet.selection}`);
      console.log(`  Result: ${bet.result}`);
      console.log(`  Status: ${bet.status}`);
      
      if (!bet.parlay_legs || bet.parlay_legs.length === 0) {
        console.log('\n❌ No parlay_legs data found - this is a legacy parlay that needs text parsing');
        continue;
      }
      
      console.log(`\n📋 Parlay has ${bet.parlay_legs.length} legs:\n`);
      
      const gameDate = bet.parlay_legs[0].gameDate || bet.date || bet.game_date;
      
      // Fetch games for this date
      console.log(`📊 Fetching games from BallDontLie API for ${gameDate}...`);
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
        continue;
      }
      
      const gamesData = await gamesResponse.json();
      const games = gamesData.data || [];
      console.log(`✅ Found ${games.length} games\n`);
      
      let allLegsResolved = true;
      const legResults = [];
      
      // Check each leg
      for (let i = 0; i < bet.parlay_legs.length; i++) {
        const leg = bet.parlay_legs[i];
        console.log(`\nLeg ${i + 1}/${bet.parlay_legs.length}: ${leg.isGameProp ? 'GAME PROP' : 'PLAYER PROP'}`);
        console.log(`  ${leg.isGameProp ? `Team: ${leg.team} vs ${leg.opponent}` : `Player: ${leg.playerName} (${leg.playerId})`}`);
        console.log(`  Bet: ${leg.statType} ${leg.overUnder} ${leg.line}`);
        
        // Find the game
        const gameDateStr = leg.gameDate || gameDate;
        const targetGame = games.find((g) => {
          const gDate = g.date ? g.date.split('T')[0] : null;
          if (gDate !== gameDateStr) return false;
          
          const homeMatch = g.home_team?.abbreviation === leg.team || g.home_team?.full_name === leg.team;
          const visitorMatch = g.visitor_team?.abbreviation === leg.team || g.visitor_team?.full_name === leg.team;
          const opponentMatch = leg.opponent && (
            g.home_team?.abbreviation === leg.opponent || g.home_team?.full_name === leg.opponent ||
            g.visitor_team?.abbreviation === leg.opponent || g.visitor_team?.full_name === leg.opponent
          );
          return (homeMatch || visitorMatch) && (!leg.opponent || opponentMatch);
        });
        
        if (!targetGame) {
          console.log(`  ❌ Game not found for ${leg.team} vs ${leg.opponent} on ${gameDateStr}`);
          allLegsResolved = false;
          continue;
        }
        
        const isFinal = String(targetGame.status || '').toLowerCase().includes('final');
        console.log(`  ✅ Game found: ${targetGame.id} - Status: ${targetGame.status} (Final: ${isFinal})`);
        
        if (!isFinal) {
          console.log(`  ⏳ Game not final yet`);
          allLegsResolved = false;
          continue;
        }
        
        // Check if game completed at least 10 minutes ago
        const now = Date.now();
        const gameDateObj = new Date(targetGame.date || gameDateStr);
        const estimatedCompletionTime = gameDateObj.getTime() + (2.5 * 60 * 60 * 1000); // 2.5 hours after tipoff
        const tenMinutesAgo = now - (10 * 60 * 1000);
        
        if (estimatedCompletionTime > tenMinutesAgo) {
          const minutesAgo = Math.round((now - estimatedCompletionTime) / 60000);
          console.log(`  ⏳ Game completed ${Math.abs(minutesAgo)} minutes ago, waiting for 10-minute buffer`);
          allLegsResolved = false;
          continue;
        }
        
        if (leg.isGameProp) {
          // Game prop
          if (leg.statType === 'moneyline') {
            const homeScore = targetGame.home_team_score || 0;
            const visitorScore = targetGame.visitor_team_score || 0;
            const isHome = (targetGame.home_team?.abbreviation === leg.team || targetGame.home_team?.full_name === leg.team);
            const won = isHome ? (homeScore > visitorScore) : (visitorScore > homeScore);
            console.log(`  ✅ Game Prop Result: ${won ? 'WIN' : 'LOSS'}`);
            legResults.push({ won, void: false });
          } else {
            console.log(`  ⚠️  Game prop type ${leg.statType} - need to implement evaluation`);
            allLegsResolved = false;
          }
        } else {
          // Player prop
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
            allLegsResolved = false;
            continue;
          }
          
          const statsData = await statsResponse.json();
          if (!statsData.data || statsData.data.length === 0) {
            console.log(`  ❌ No stats found for player ${leg.playerId}`);
            allLegsResolved = false;
            continue;
          }
          
          const playerStat = statsData.data[0];
          const actualValue = playerStat[leg.statType] || 0;
          const line = Number(leg.line);
          const isWholeNumber = line % 1 === 0;
          const won = leg.overUnder === 'over'
            ? (isWholeNumber ? actualValue >= line : actualValue > line)
            : (isWholeNumber ? actualValue <= line : actualValue < line);
          
          console.log(`  ✅ Player Prop Result: ${won ? 'WIN' : 'LOSS'} (Actual: ${actualValue}, Line: ${line})`);
          legResults.push({ won, void: false });
        }
      }
      
      console.log(`\n📊 Summary:`);
      console.log(`  All legs resolved: ${allLegsResolved}`);
      console.log(`  Leg results: ${legResults.length}/${bet.parlay_legs.length}`);
      if (legResults.length === bet.parlay_legs.length) {
        const allWon = legResults.every(r => r.won);
        const nonVoidLegs = legResults.filter(r => !r.void);
        const parlayWon = nonVoidLegs.length > 0 && nonVoidLegs.every(r => r.won);
        console.log(`  All legs won: ${allWon}`);
        console.log(`  Parlay should be: ${parlayWon ? 'WIN' : 'LOSS'}`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugPendingBets();

