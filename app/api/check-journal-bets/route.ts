import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

interface PlayerStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
}

export async function GET() {
  try {
    // Fetch all pending journal bets with NBA player props
    const { data: journalBets, error } = await supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .eq('result', 'pending')
      .not('player_id', 'is', null)
      .not('game_date', 'is', null);

    console.log('Fetched journal bets:', journalBets?.length || 0);
    if (error) {
      console.error('Error fetching journal bets:', error);
      throw error;
    }

    if (!journalBets || journalBets.length === 0) {
      console.log('No pending journal bets found');
      return NextResponse.json({ message: 'No pending journal bets', updated: 0 });
    }

    let updatedCount = 0;

    // Group by game date to minimize API calls
    const gamesByDate = journalBets.reduce((acc: any, bet) => {
      const date = bet.game_date;
      if (!acc[date]) acc[date] = [];
      acc[date].push(bet);
      return acc;
    }, {});

    for (const [gameDate, bets] of Object.entries(gamesByDate)) {
      // Fetch games for this date
      const gamesResponse = await fetch(
        `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
        {
          headers: {
            'Authorization': BALLDONTLIE_API_KEY!,
          },
        }
      );

      if (!gamesResponse.ok) {
        console.error(`Failed to fetch games for ${gameDate}`);
        continue;
      }

      const gamesData = await gamesResponse.json();
      const games = gamesData.data;

      // Process each bet for this date
      for (const bet of bets as any[]) {
        // Find the game with matching teams
        const game = games.find((g: any) => {
          const homeMatch = g.home_team.full_name === bet.team || g.home_team.abbreviation === bet.team;
          const visitorMatch = g.visitor_team.full_name === bet.team || g.visitor_team.abbreviation === bet.team;
          const homeOppMatch = g.home_team.full_name === bet.opponent || g.home_team.abbreviation === bet.opponent;
          const visitorOppMatch = g.visitor_team.full_name === bet.opponent || g.visitor_team.abbreviation === bet.opponent;
          
          return (homeMatch && visitorOppMatch) || (visitorMatch && homeOppMatch);
        });

        if (!game) {
          console.log(`Game not found for ${bet.team} vs ${bet.opponent}`);
          continue;
        }

        // Check game status using same logic as tracked bets
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        
        // Check if game is live by looking at tipoff time
        let isLive = false;
        const tipoffTime = Date.parse(rawStatus);
        if (!Number.isNaN(tipoffTime)) {
          const now = Date.now();
          const timeSinceTipoff = now - tipoffTime;
          const threeHoursMs = 3 * 60 * 60 * 1000;
          // Game is live if it started and hasn't been 3 hours yet
          isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
        }
        
        // If game is live but not final, update status to 'live'
        if (isLive && !gameStatus.includes('final')) {
          await supabaseAdmin
            .from('bets')
            .update({ status: 'live' })
            .eq('id', bet.id)
            .eq('result', 'pending'); // Only update if still pending
          
          console.log(`Game ${bet.team} vs ${bet.opponent} is live, updated status`);
          continue;
        }
        
        // Check if game is final
        if (!gameStatus.includes('final')) {
          console.log(`Game ${bet.team} vs ${bet.opponent} is ${game.status}, not final yet`);
          continue;
        }

        // Fetch player stats for this game
        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${bet.player_id}`,
          {
            headers: {
              'Authorization': BALLDONTLIE_API_KEY!,
            },
          }
        );

        if (!statsResponse.ok) {
          console.error(`Failed to fetch stats for player ${bet.player_id}`);
          continue;
        }

        const statsData = await statsResponse.json();
        
        if (!statsData.data || statsData.data.length === 0) {
          console.log(`No stats found for player ${bet.player_name}`);
          continue;
        }

        const playerStat = statsData.data[0];
        
        // Check if player played 0 minutes - if so, mark as void
        const minutesPlayed = playerStat.min || '0:00';
        const [mins, secs] = minutesPlayed.split(':').map(Number);
        const totalMinutes = (mins || 0) + ((secs || 0) / 60);
        
        if (totalMinutes === 0) {
          // Player didn't play - void the bet
          const { error: updateError } = await supabaseAdmin
            .from('bets')
            .update({
              status: 'completed',
              result: 'void',
              actual_value: 0,
            })
            .eq('id', bet.id);

          if (updateError) {
            console.error(`Failed to update bet ${bet.id}:`, updateError);
          } else {
            console.log(`Voided ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${bet.line}: player played 0 minutes`);
            updatedCount++;
          }
          continue;
        }
        
        const stats: PlayerStats = {
          pts: playerStat.pts || 0,
          reb: playerStat.reb || 0,
          ast: playerStat.ast || 0,
          stl: playerStat.stl || 0,
          blk: playerStat.blk || 0,
          fg3m: playerStat.fg3m || 0,
        };

        // Calculate combined stats if needed
        let actualValue = 0;
        switch (bet.stat_type) {
          case 'pts':
            actualValue = stats.pts;
            break;
          case 'reb':
            actualValue = stats.reb;
            break;
          case 'ast':
            actualValue = stats.ast;
            break;
          case 'pr':
            actualValue = stats.pts + stats.reb;
            break;
          case 'pra':
            actualValue = stats.pts + stats.reb + stats.ast;
            break;
          case 'ra':
            actualValue = stats.reb + stats.ast;
            break;
          case 'stl':
            actualValue = stats.stl;
            break;
          case 'blk':
            actualValue = stats.blk;
            break;
          case 'fg3m':
            actualValue = stats.fg3m;
            break;
          default:
            console.log(`Unknown stat type: ${bet.stat_type}`);
            continue;
        }

        // Determine result
        let result: 'win' | 'loss';
        if (bet.over_under === 'over') {
          result = actualValue > bet.line ? 'win' : 'loss';
        } else {
          result = actualValue < bet.line ? 'win' : 'loss';
        }

        // Update the journal bet with result
        const { error: updateError } = await supabaseAdmin
          .from('bets')
          .update({
            status: 'completed',
            result,
            actual_value: actualValue,
          })
          .eq('id', bet.id);

        if (updateError) {
          console.error(`Failed to update bet ${bet.id}:`, updateError);
        } else {
          console.log(`Updated ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${bet.line}: ${result} (actual: ${actualValue})`);
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      message: `Checked ${journalBets.length} journal bets, updated ${updatedCount}`,
      updated: updatedCount,
      total: journalBets.length,
    });

  } catch (error: any) {
    console.error('Error checking journal bets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check journal bets' },
      { status: 500 }
    );
  }
}
