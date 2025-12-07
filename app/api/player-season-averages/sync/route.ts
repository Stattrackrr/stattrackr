import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { currentNbaSeason } from '@/lib/nbaUtils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const CONCURRENT_REQUESTS = 5; // Process 5 players concurrently
const DELAY_MS = 1000; // Delay between batches (1 second)
const MAX_RETRIES = 3; // Max retries for 429 errors
const RETRY_DELAY_BASE = 5000; // Base delay for retries (exponential backoff: 5s, 10s, 20s)

export const dynamic = 'force-dynamic';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';

/**
 * Fetch season averages for a single player from BDL API
 */
async function fetchSeasonAverages(playerId: number, season: number, retryCount = 0): Promise<any> {
  const url = new URL(`${BDL_BASE}/season_averages`);
  url.searchParams.set('player_id', playerId.toString());
  url.searchParams.set('season', season.toString());
  
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (API_KEY) {
      headers['Authorization'] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
    }
    
    const response = await fetch(url.toString(), {
      headers,
      cache: 'no-store'
    });
    
    if (response.status === 429) {
      // Rate limited - retry with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
        console.log(`[Player Season Averages Sync] Rate limited (429) for player ${playerId}. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchSeasonAverages(playerId, season, retryCount + 1);
      } else {
        throw new Error(`Rate limited after ${MAX_RETRIES} retries`);
      }
    }
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error: any) {
    if (error.message?.includes('Rate limited') && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchSeasonAverages(playerId, season, retryCount + 1);
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { season: seasonParam, full_season } = await request.json().catch(() => ({}));
    const season = seasonParam || currentNbaSeason();
    
    console.log(`[Player Season Averages Sync] Starting sync for season ${season}...`);
    
    // Get all active players from Supabase cache
    const { data: players, error: playersError } = await supabaseAdmin
      .from('players')
      .select('id')
      .order('id', { ascending: true });
    
    if (playersError) {
      console.error(`[Player Season Averages Sync] Error fetching players:`, playersError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch players from cache. Please run /api/players/sync first.' },
        { status: 500 }
      );
    }
    
    if (!players || players.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No players found in cache. Please run /api/players/sync first.' },
        { status: 500 }
      );
    }
    
    console.log(`[Player Season Averages Sync] Found ${players.length} players to sync`);
    
    let totalSynced = 0;
    let totalErrors = 0;
    let totalSkipped = 0;
    
    // Process players with controlled concurrency
    for (let i = 0; i < players.length; i += CONCURRENT_REQUESTS) {
      const batch = players.slice(i, i + CONCURRENT_REQUESTS);
      
      console.log(`[Player Season Averages Sync] Processing batch ${Math.floor(i / CONCURRENT_REQUESTS) + 1} (players ${i + 1}-${Math.min(i + CONCURRENT_REQUESTS, players.length)})...`);
      
      // Process batch concurrently
      const promises = batch.map(async (player) => {
        try {
          const response = await fetchSeasonAverages(player.id, season);
          
          // BDL API returns { data: [...] } format, but for single player it might be different
          let seasonAvg: any = null;
          if (Array.isArray(response.data) && response.data.length > 0) {
            seasonAvg = response.data[0];
          } else if (response.data && !Array.isArray(response.data)) {
            seasonAvg = response.data;
          } else if (response.player_id || response.pts !== undefined) {
            // Direct response format
            seasonAvg = response;
          }
          
          if (!seasonAvg) {
            return null;
          }
          
          const playerId = seasonAvg.player_id || seasonAvg.player?.id || player.id;
          
          return {
            player_id: playerId,
            season: parseInt(String(season)),
            games_played: seasonAvg.games_played || seasonAvg.games || 0,
            pts: seasonAvg.pts || 0,
            reb: seasonAvg.reb || 0,
            ast: seasonAvg.ast || 0,
            fg_pct: seasonAvg.fg_pct || 0,
            fg3_pct: seasonAvg.fg3_pct || 0,
            fg3a: seasonAvg.fg3a || 0,
            fg3m: seasonAvg.fg3m || 0,
            fga: seasonAvg.fga || 0,
            fgm: seasonAvg.fgm || 0,
            ft_pct: seasonAvg.ft_pct || 0,
            fta: seasonAvg.fta || 0,
            ftm: seasonAvg.ftm || 0,
            stl: seasonAvg.stl || 0,
            blk: seasonAvg.blk || 0,
            turnover: seasonAvg.turnover || seasonAvg.to || 0, // Support both 'turnover' and 'to'
            pf: seasonAvg.pf || 0,
            oreb: seasonAvg.oreb || 0,
            dreb: seasonAvg.dreb || 0,
            updated_at: new Date().toISOString()
          };
        } catch (error: any) {
          console.warn(`[Player Season Averages Sync] Failed to fetch season averages for player ${player.id}: ${error?.message || error}`);
          return null;
        }
      });
      
      const results = await Promise.all(promises);
      const recordsToUpsert = results.filter((r: any) => r !== null);
      
      if (recordsToUpsert.length > 0) {
        const { error: upsertError } = await supabaseAdmin
          .from('player_season_averages')
          .upsert(recordsToUpsert, {
            onConflict: 'player_id,season',
            ignoreDuplicates: false
          });
        
        if (upsertError) {
          console.error(`[Player Season Averages Sync] Error upserting batch:`, upsertError);
          totalErrors += recordsToUpsert.length;
        } else {
          totalSynced += recordsToUpsert.length;
          console.log(`[Player Season Averages Sync] Synced ${recordsToUpsert.length} players (${totalSynced}/${players.length})`);
        }
      }
      
      // Count skipped players
      const syncedPlayerIds = new Set(recordsToUpsert.map((r: any) => r.player_id));
      const skippedCount = batch.filter(p => !syncedPlayerIds.has(p.id)).length;
      totalSkipped += skippedCount;
      
      // Delay between batches to avoid rate limiting
      if (i + CONCURRENT_REQUESTS < players.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
    
    console.log(`[Player Season Averages Sync] Complete! Synced: ${totalSynced}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`);
    
    return NextResponse.json({
      success: true,
      season,
      totalPlayers: players.length,
      synced: totalSynced,
      skipped: totalSkipped,
      errors: totalErrors,
      message: `Synced ${totalSynced} player season averages for season ${season}`
    });
    
  } catch (error: any) {
    console.error('[Player Season Averages Sync] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

