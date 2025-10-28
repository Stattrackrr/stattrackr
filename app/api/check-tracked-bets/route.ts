import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

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
    // Fetch all pending tracked props
    const { data: trackedProps, error } = await supabase
      .from('tracked_props')
      .select('*')
      .eq('status', 'pending');

    if (error) throw error;

    if (!trackedProps || trackedProps.length === 0) {
      return NextResponse.json({ message: 'No pending tracked bets', updated: 0 });
    }

    let updatedCount = 0;

    // Group by game date to minimize API calls
    const gamesByDate = trackedProps.reduce((acc: any, prop) => {
      const date = prop.game_date;
      if (!acc[date]) acc[date] = [];
      acc[date].push(prop);
      return acc;
    }, {});

    for (const [gameDate, props] of Object.entries(gamesByDate)) {
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

      // Process each prop for this date
      for (const prop of props as any[]) {
        // Find the game with matching teams
        const game = games.find((g: any) => 
          (g.home_team.full_name === prop.team && g.visitor_team.full_name === prop.opponent) ||
          (g.visitor_team.full_name === prop.team && g.home_team.full_name === prop.opponent)
        );

        if (!game) {
          console.log(`Game not found for ${prop.team} vs ${prop.opponent}`);
          continue;
        }

        // Check if game is final
        if (game.status !== 'Final') {
          console.log(`Game ${prop.team} vs ${prop.opponent} is ${game.status}, not final yet`);
          continue;
        }

        // Fetch player stats for this game
        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${prop.player_id}`,
          {
            headers: {
              'Authorization': BALLDONTLIE_API_KEY!,
            },
          }
        );

        if (!statsResponse.ok) {
          console.error(`Failed to fetch stats for player ${prop.player_id}`);
          continue;
        }

        const statsData = await statsResponse.json();
        
        if (!statsData.data || statsData.data.length === 0) {
          console.log(`No stats found for player ${prop.player_name}`);
          continue;
        }

        const playerStat = statsData.data[0];
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
        switch (prop.stat_type) {
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
            console.log(`Unknown stat type: ${prop.stat_type}`);
            continue;
        }

        // Determine result
        let result: 'win' | 'loss';
        if (prop.over_under === 'over') {
          result = actualValue > prop.line ? 'win' : 'loss';
        } else {
          result = actualValue < prop.line ? 'win' : 'loss';
        }

        // Update the tracked prop
        const { error: updateError } = await supabase
          .from('tracked_props')
          .update({
            status: 'completed',
            result,
            actual_value: actualValue,
          })
          .eq('id', prop.id);

        if (updateError) {
          console.error(`Failed to update prop ${prop.id}:`, updateError);
        } else {
          console.log(`Updated ${prop.player_name} ${prop.stat_type} ${prop.over_under} ${prop.line}: ${result} (actual: ${actualValue})`);
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      message: `Checked ${trackedProps.length} tracked bets, updated ${updatedCount}`,
      updated: updatedCount,
      total: trackedProps.length,
    });

  } catch (error: any) {
    console.error('Error checking tracked bets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check tracked bets' },
      { status: 500 }
    );
  }
}
