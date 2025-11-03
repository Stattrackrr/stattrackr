// Script to retroactively void all bets where player played 0 minutes
// Run this once to clean up historical data

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BALLDONTLIE_API_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function voidZeroMinuteBets() {
  console.log('🔍 Fetching all completed NBA bets with player data...\n');

  // Fetch all completed journal bets with player info
  const { data: journalBets, error: journalError } = await supabaseAdmin
    .from('bets')
    .select('*')
    .eq('sport', 'NBA')
    .in('result', ['win', 'loss']) // Only check settled bets
    .not('player_id', 'is', null)
    .not('game_date', 'is', null);

  if (journalError) {
    console.error('Error fetching journal bets:', journalError);
    return;
  }

  console.log(`📊 Found ${journalBets.length} completed NBA journal bets to check\n`);

  let voidedCount = 0;
  let checkedCount = 0;
  let errorCount = 0;

  // Process bets in batches to avoid rate limiting
  for (const bet of journalBets) {
    checkedCount++;
    
    try {
      // Fetch games for the bet's date
      const gamesResponse = await fetch(
        `https://api.balldontlie.io/v1/games?dates[]=${bet.game_date}`,
        {
          headers: {
            'Authorization': BALLDONTLIE_API_KEY,
          },
        }
      );

      if (!gamesResponse.ok) {
        console.error(`❌ Failed to fetch games for ${bet.game_date}`);
        errorCount++;
        continue;
      }

      const gamesData = await gamesResponse.json();
      const games = gamesData.data;

      // Find the matching game
      const game = games.find((g) => {
        const homeMatch = g.home_team.full_name === bet.team || g.home_team.abbreviation === bet.team;
        const visitorMatch = g.visitor_team.full_name === bet.team || g.visitor_team.abbreviation === bet.team;
        const homeOppMatch = g.home_team.full_name === bet.opponent || g.home_team.abbreviation === bet.opponent;
        const visitorOppMatch = g.visitor_team.full_name === bet.opponent || g.visitor_team.abbreviation === bet.opponent;
        
        return (homeMatch && visitorOppMatch) || (visitorMatch && homeOppMatch);
      });

      if (!game) {
        console.log(`⚠️  Game not found for ${bet.player_name} (${bet.team} vs ${bet.opponent})`);
        continue;
      }

      // Check if game is final
      const gameStatus = String(game.status || '').toLowerCase();
      if (!gameStatus.includes('final')) {
        console.log(`⏸️  Game not final yet: ${bet.team} vs ${bet.opponent}`);
        continue;
      }

      // Fetch player stats
      const statsResponse = await fetch(
        `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${bet.player_id}`,
        {
          headers: {
            'Authorization': BALLDONTLIE_API_KEY,
          },
        }
      );

      if (!statsResponse.ok) {
        console.error(`❌ Failed to fetch stats for player ${bet.player_id}`);
        errorCount++;
        continue;
      }

      const statsData = await statsResponse.json();
      
      if (!statsData.data || statsData.data.length === 0) {
        console.log(`⚠️  No stats found for ${bet.player_name}`);
        continue;
      }

      const playerStat = statsData.data[0];
      
      // Check minutes played
      const minutesPlayed = playerStat.min || '0:00';
      const [mins, secs] = minutesPlayed.split(':').map(Number);
      const totalMinutes = (mins || 0) + ((secs || 0) / 60);

      if (totalMinutes === 0) {
        // Void this bet
        const { error: updateError } = await supabaseAdmin
          .from('bets')
          .update({
            result: 'void',
            actual_value: 0,
          })
          .eq('id', bet.id);

        if (updateError) {
          console.error(`❌ Failed to void bet ${bet.id}:`, updateError);
          errorCount++;
        } else {
          console.log(`✅ VOIDED: ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${bet.line} (${bet.date}) - played 0 minutes`);
          voidedCount++;
        }
      }

      // Rate limiting - wait 100ms between requests
      await sleep(100);

    } catch (error) {
      console.error(`❌ Error processing bet ${bet.id}:`, error.message);
      errorCount++;
    }

    // Progress update every 10 bets
    if (checkedCount % 10 === 0) {
      console.log(`\n📈 Progress: ${checkedCount}/${journalBets.length} bets checked, ${voidedCount} voided\n`);
    }
  }

  // Now check tracked_props
  console.log('\n🔍 Checking tracked props...\n');

  const { data: trackedProps, error: propsError } = await supabaseAdmin
    .from('tracked_props')
    .select('*')
    .eq('status', 'completed') // Only check completed props
    .in('result', ['win', 'loss']) // Only settled props (not pending)
    .not('player_id', 'is', null)
    .not('game_date', 'is', null);

  if (propsError) {
    console.error('Error fetching tracked props:', propsError);
  } else {
    console.log(`📊 Found ${trackedProps.length} completed tracked props to check\n`);

    for (const prop of trackedProps) {
      checkedCount++;
      
      try {
        const gamesResponse = await fetch(
          `https://api.balldontlie.io/v1/games?dates[]=${prop.game_date}`,
          {
            headers: {
              'Authorization': BALLDONTLIE_API_KEY,
            },
          }
        );

        if (!gamesResponse.ok) {
          errorCount++;
          continue;
        }

        const gamesData = await gamesResponse.json();
        const games = gamesData.data;

        const game = games.find((g) => {
          const homeMatch = g.home_team.full_name === prop.team || g.home_team.abbreviation === prop.team;
          const visitorMatch = g.visitor_team.full_name === prop.team || g.visitor_team.abbreviation === prop.team;
          const homeOppMatch = g.home_team.full_name === prop.opponent || g.home_team.abbreviation === prop.opponent;
          const visitorOppMatch = g.visitor_team.full_name === prop.opponent || g.visitor_team.abbreviation === prop.opponent;
          
          return (homeMatch && visitorOppMatch) || (visitorMatch && homeOppMatch);
        });

        if (!game) continue;

        const gameStatus = String(game.status || '').toLowerCase();
        if (!gameStatus.includes('final')) continue;

        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${prop.player_id}`,
          {
            headers: {
              'Authorization': BALLDONTLIE_API_KEY,
            },
          }
        );

        if (!statsResponse.ok) {
          errorCount++;
          continue;
        }

        const statsData = await statsResponse.json();
        
        if (!statsData.data || statsData.data.length === 0) continue;

        const playerStat = statsData.data[0];
        const minutesPlayed = playerStat.min || '0:00';
        const [mins, secs] = minutesPlayed.split(':').map(Number);
        const totalMinutes = (mins || 0) + ((secs || 0) / 60);

        if (totalMinutes === 0) {
          const { error: updateError } = await supabaseAdmin
            .from('tracked_props')
            .update({
              status: 'void',
              result: null,
              actual_value: 0,
              actual_pts: 0,
              actual_reb: 0,
              actual_ast: 0,
              actual_stl: 0,
              actual_blk: 0,
              actual_fg3m: 0,
            })
            .eq('id', prop.id);

          if (updateError) {
            errorCount++;
          } else {
            console.log(`✅ VOIDED: ${prop.player_name} ${prop.stat_type} ${prop.over_under} ${prop.line} (${prop.game_date}) - played 0 minutes`);
            voidedCount++;
          }
        }

        await sleep(100);

      } catch (error) {
        console.error(`❌ Error processing prop ${prop.id}:`, error.message);
        errorCount++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(60));
  console.log(`✅ Total bets checked: ${checkedCount}`);
  console.log(`🚫 Bets voided: ${voidedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log('='.repeat(60) + '\n');
}

// Run the script
voidZeroMinuteBets()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
