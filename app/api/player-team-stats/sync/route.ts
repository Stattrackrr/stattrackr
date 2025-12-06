import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR, currentNbaSeason } from '@/lib/nbaConstants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  return h;
}

// Convert minutes string (MM:SS) to decimal minutes
function parseMinutes(minStr: string | null | undefined): number | null {
  if (!minStr || minStr === '0:00') return null;
  const parts = minStr.split(':');
  const minutes = Number.isFinite(Number(parts[0])) ? Number(parts[0]) : 0;
  const seconds = parts[1] && Number.isFinite(Number(parts[1])) ? Number(parts[1]) : 0;
  return minutes + (seconds / 60);
}

/**
 * Get all games for a player and extract stats vs each team
 * Only keeps the most recent game per team
 */
async function getPlayerStatsVsTeams(playerId: number, season: number): Promise<Map<string, any>> {
  const statsByTeam = new Map<string, any>(); // team_abbreviation -> { game_date, stats }
  
  try {
    // Fetch all player stats for this season
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    const allGameStats: any[] = [];
    
    while (hasMore && page <= 50) {
      const url = new URL(`${BDL_BASE}/stats`);
      url.searchParams.set('player_ids[]', String(playerId));
      url.searchParams.set('seasons[]', String(season));
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      
      const response = await fetch(url.toString(), {
        headers: authHeaders(),
        cache: 'no-store'
      });
      
      if (!response.ok) {
        console.warn(`[Player Stats Sync] Failed to fetch stats for player ${playerId} page ${page}: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const stats = data.data || [];
      allGameStats.push(...stats);
      
      if (stats.length < perPage) {
        hasMore = false;
      } else {
        page++;
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
      }
    }
    
    console.log(`[Player Stats Sync] Fetched ${allGameStats.length} game stats for player ${playerId}`);
    
    // Process each game stat
    for (const gameStat of allGameStats) {
      const game = gameStat.game;
      if (!game) continue;
      
      // Get opponent team
      const homeTeamId = game.home_team?.id ?? (game as any)?.home_team_id;
      const visitorTeamId = game.visitor_team?.id ?? (game as any)?.visitor_team_id;
      const playerTeamId = gameStat.team?.id ?? (gameStat as any)?.team_id;
      
      // Determine opponent
      let opponentAbbr: string | null = null;
      if (homeTeamId && visitorTeamId && playerTeamId) {
        // Player's team is one of the teams, opponent is the other
        if (playerTeamId === homeTeamId && visitorTeamId) {
          opponentAbbr = TEAM_ID_TO_ABBR[visitorTeamId] || null;
        } else if (playerTeamId === visitorTeamId && homeTeamId) {
          opponentAbbr = TEAM_ID_TO_ABBR[homeTeamId] || null;
        }
      }
      
      // Fallback: try to get from abbreviations
      if (!opponentAbbr) {
        const homeAbbr = normalizeAbbr(game.home_team?.abbreviation || '');
        const visitorAbbr = normalizeAbbr(game.visitor_team?.abbreviation || '');
        const playerTeamAbbr = normalizeAbbr(gameStat.team?.abbreviation || '');
        
        if (playerTeamAbbr === homeAbbr && visitorAbbr) {
          opponentAbbr = visitorAbbr;
        } else if (playerTeamAbbr === visitorAbbr && homeAbbr) {
          opponentAbbr = homeAbbr;
        }
      }
      
      if (!opponentAbbr) {
        continue; // Can't determine opponent, skip this game
      }
      
      const gameDate = game.date ? game.date.split('T')[0] : null;
      if (!gameDate) continue;
      
      // Check if we already have stats for this player/team combo
      const existing = statsByTeam.get(opponentAbbr);
      
      // Keep only the most recent game (replace older games)
      if (!existing || new Date(gameDate) > new Date(existing.game_date)) {
        statsByTeam.set(opponentAbbr, {
          player_id: playerId,
          team_abbreviation: opponentAbbr,
          game_date: gameDate,
          game_id: game.id || null,
          pts: gameStat.pts || 0,
          reb: gameStat.reb || 0,
          ast: gameStat.ast || 0,
          fg3m: gameStat.fg3m || 0,
          stl: gameStat.stl || 0,
          blk: gameStat.blk || 0,
          turnovers: gameStat.turnover || gameStat.to || 0,
          fg_pct: gameStat.fg_pct || null,
          fg3_pct: gameStat.fg3_pct || null,
          min: gameStat.min || null,
          min_decimal: parseMinutes(gameStat.min),
        });
      }
    }
    
  } catch (error) {
    console.error(`[Player Stats Sync] Error fetching stats for player ${playerId}:`, error);
  }
  
  return statsByTeam;
}

/**
 * Sync all player stats vs all teams
 * Fetches stats for every active player and stores the most recent game vs each team
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? parseInt(seasonParam, 10) : currentNbaSeason();
    const limit = searchParams.get('limit'); // Optional limit for testing
    
    console.log(`🔄 Starting player-team stats sync for season ${season}...`);
    
    // Get all active players from Supabase
    const { data: players, error: playersError } = await supabaseAdmin
      .from('players')
      .select('id, first_name, last_name')
      .order('id', { ascending: true });
    
    if (playersError) {
      console.error('[Player Stats Sync] Error fetching players:', playersError);
      
      // PGRST205 = table doesn't exist
      if (playersError.code === 'PGRST205') {
        return NextResponse.json(
          { 
            success: false, 
            error: `Table 'players' does not exist. Please run migrations first.`,
            code: playersError.code,
            steps: [
              '1. Run migration: migrations/create_players_table.sql',
              '2. Sync players: GET /api/players/sync',
              '3. Then run this sync: GET /api/player-team-stats/sync'
            ]
          },
          { status: 500 }
        );
      }
      
      return NextResponse.json(
        { success: false, error: `Failed to fetch players: ${playersError.message}`, code: playersError.code },
        { status: 500 }
      );
    }
    
    if (!players || players.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No players found. Please run the migrations and sync players first.',
          steps: [
            '1. Run migration: migrations/create_players_table.sql',
            '2. Sync players: GET /api/players/sync',
            '3. Then run this sync: GET /api/player-team-stats/sync'
          ]
        },
        { status: 400 }
      );
    }
    
    const playersToProcess = limit ? players.slice(0, parseInt(limit, 10)) : players;
    console.log(`📥 Processing ${playersToProcess.length} players...`);
    
    let totalStatsInserted = 0;
    let playersProcessed = 0;
    let playersSkipped = 0;
    
    // Process players in batches to avoid overwhelming the API
    const BATCH_SIZE = 5;
    const DELAY_MS = 500;
    
    for (let i = 0; i < playersToProcess.length; i += BATCH_SIZE) {
      const batch = playersToProcess.slice(i, i + BATCH_SIZE);
      
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      
      const batchPromises = batch.map(async (player) => {
        try {
          const statsByTeam = await getPlayerStatsVsTeams(player.id, season);
          
          if (statsByTeam.size === 0) {
            playersSkipped++;
            return;
          }
          
          // Convert map to array for upsert
          const statsToUpsert = Array.from(statsByTeam.values());
          
          // Upsert stats (will replace older games with newer ones due to UNIQUE constraint)
          const { error: upsertError } = await supabaseAdmin
            .from('player_team_stats')
            .upsert(statsToUpsert, {
              onConflict: 'player_id,team_abbreviation',
              ignoreDuplicates: false
            });
          
          if (upsertError) {
            // PGRST205 = table doesn't exist
            if (upsertError.code === 'PGRST205') {
              console.error(`[Player Stats Sync] Table 'player_team_stats' does not exist. Please run migration: migrations/create_player_team_stats_table.sql`);
              throw new Error(`Table 'player_team_stats' does not exist. Please run migration: migrations/create_player_team_stats_table.sql`);
            }
            console.error(`[Player Stats Sync] Error upserting stats for player ${player.id}:`, upsertError);
            return;
          }
          
          totalStatsInserted += statsToUpsert.length;
          playersProcessed++;
          
          if (playersProcessed % 10 === 0) {
            console.log(`📊 Progress: ${playersProcessed}/${playersToProcess.length} players processed, ${totalStatsInserted} stats records`);
          }
          
        } catch (error: any) {
          console.error(`[Player Stats Sync] Error processing player ${player.id}:`, error);
          playersSkipped++;
        }
      });
      
      await Promise.all(batchPromises);
    }
    
    console.log(`✅ Sync complete! Processed: ${playersProcessed}, Skipped: ${playersSkipped}, Stats inserted: ${totalStatsInserted}`);
    
    return NextResponse.json({
      success: true,
      message: `Synced player-team stats for ${playersProcessed} players`,
      stats: {
        playersProcessed,
        playersSkipped,
        totalStatsInserted,
        totalPlayers: playersToProcess.length
      }
    });
    
  } catch (error: any) {
    console.error('❌ Error in player-team stats sync:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

