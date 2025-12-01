import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { normalizeAbbr, NBA_TEAMS } from '@/lib/nbaAbbr';

// BDL team ID mapping (from ingest-nba route)
const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  'ATL': 1, 'BOS': 2, 'BKN': 3, 'CHA': 4, 'CHI': 5, 'CLE': 6,
  'DAL': 7, 'DEN': 8, 'DET': 9, 'GSW': 10, 'HOU': 11, 'IND': 12,
  'LAC': 13, 'LAL': 14, 'MEM': 15, 'MIA': 16, 'MIL': 17, 'MIN': 18,
  'NOP': 19, 'NYK': 20, 'OKC': 21, 'ORL': 22, 'PHI': 23, 'PHX': 24,
  'POR': 25, 'SAC': 26, 'SAS': 27, 'TOR': 28, 'UTA': 29, 'WAS': 30
};

// Normalize player name (from ingest-nba route)
function normName(s: string): string {
  const base = String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv)\b/g,' ').replace(/\s+/g,' ').trim();
  const parts = base.split(' ').filter(Boolean);
  if (parts.length>=2){ 
    const last = parts[parts.length-1]; 
    const first = parts.slice(0,-1); 
    let acc=''; 
    const out:string[]=[]; 
    for (const w of first){ 
      if (w.length===1) acc+=w; 
      else { 
        if (acc){ out.push(acc); acc=''; } 
        out.push(w);
      } 
    } 
    if (acc) out.push(acc); 
    out.push(last); 
    return out.join(' ');
  } 
  return base;
}

export const runtime = "nodejs";

/**
 * Remove team's own players from DvP store files
 * This updates existing games to only contain opponent players
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamParam = searchParams.get('team');
    const seasonParam = searchParams.get('season') || '2025';
    
    // Check if we're in a serverless environment
    const isServerless = process.env.VERCEL === '1' || 
                         process.env.VERCEL_ENV !== undefined || 
                         process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
                         process.env.VERCEL_URL !== undefined;
    
    if (isServerless) {
      return NextResponse.json({ 
        success: false, 
        error: 'This operation requires file system access. Run locally or use GitHub Actions.' 
      });
    }
    
    // Validate NBA_TEAMS is available
    if (!NBA_TEAMS || typeof NBA_TEAMS !== 'object') {
      return NextResponse.json({ 
        success: false, 
        error: 'NBA_TEAMS not available' 
      }, { status: 500 });
    }
    
    const teams = teamParam ? [teamParam] : Object.keys(NBA_TEAMS);
    const results: any[] = [];
    
    for (const team of teams) {
      const abbr = normalizeAbbr(team);
      if (!abbr || !(abbr in NBA_TEAMS)) {
        results.push({ team, success: false, error: 'Invalid team' });
        continue;
      }
      
      const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', seasonParam);
      const storeFile = path.join(storeDir, `${abbr}.json`);
      
      // Load existing games
      let games: any[];
      try {
        const raw = fs.readFileSync(storeFile, 'utf8');
        games = JSON.parse(raw);
        if (!Array.isArray(games)) {
          results.push({ team: abbr, success: false, error: 'Invalid data format' });
          continue;
        }
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          results.push({ team: abbr, success: false, error: 'No stored data found' });
          continue;
        }
        results.push({ team: abbr, success: false, error: `Failed to read file: ${e.message}` });
        continue;
      }
      
      const teamIdBdl = ABBR_TO_TEAM_ID_BDL[abbr];
      if (!teamIdBdl) {
        results.push({ team: abbr, success: false, error: 'Team ID not found' });
        continue;
      }
      
      let gamesUpdated = 0;
      let totalPlayersRemoved = 0;
      const debugInfo: string[] = [];
      
      // Process each game
      for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
        const game = games[gameIndex];
        const players = Array.isArray(game?.players) ? game.players : [];
        const originalCount = players.length;
        
        // We need to identify which players are from the team vs opponent
        // Since we don't have team info in the stored player data, we'll use a different approach:
        // Fetch the game stats from BDL to identify team vs opponent players
        const gameId = game?.gameId;
        if (!gameId) continue;
        
        // Add small delay to avoid rate limiting (every 10 games)
        if (gameIndex > 0 && gameIndex % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        try {
          // Fetch game stats to identify team vs opponent players
          // Use same authentication as ingest-nba route
          const BDL_BASE = 'https://api.balldontlie.io/v1';
          const BDL_HEADERS: Record<string, string> = {
            Accept: 'application/json',
            'User-Agent': 'StatTrackr/1.0',
            Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
          };
          
          const statsUrl = new URL(`${BDL_BASE}/stats`);
          statsUrl.searchParams.append('game_ids[]', String(gameId));
          statsUrl.searchParams.set('per_page', '100');
          
          const statsRes = await fetch(statsUrl.toString(), { headers: BDL_HEADERS, cache: 'no-store' });
          if (!statsRes.ok) {
            const errorText = await statsRes.text().catch(() => '');
            console.error(`[remove-team-players] Failed to fetch stats for game ${gameId}: ${statsRes.status} ${statsRes.statusText} - ${errorText.substring(0, 100)}`);
            continue;
          }
          
          const statsData = await statsRes.json();
          const statsRows = Array.isArray(statsData?.data) ? statsData.data : [];
          
          if (statsRows.length === 0) {
            console.error(`[remove-team-players] No stats rows found for game ${gameId}`);
            continue;
          }
          
          // Build set of opponent player IDs (players NOT from the team)
          const opponentPlayerIds = new Set<number>();
          const teamPlayerIds = new Set<number>();
          
          for (const row of statsRows) {
            const playerId = Number(row?.player?.id || 0);
            const rowTeamId = Number(row?.team?.id || 0);
            
            if (playerId && rowTeamId) {
              if (rowTeamId === teamIdBdl) {
                teamPlayerIds.add(playerId);
              } else {
                opponentPlayerIds.add(playerId);
              }
            }
          }
          
          // Debug: Log team vs opponent counts for first few games
          if (gameIndex < 3) {
            const debugMsg = `Game ${gameId} (${abbr} vs ${game.opponent}): Team ID: ${teamIdBdl}, Team players in BDL: ${teamPlayerIds.size}, Opponent players in BDL: ${opponentPlayerIds.size}, Stored players: ${originalCount}`;
            console.log(`[remove-team-players] ${debugMsg}`);
            debugInfo.push(debugMsg);
            if (teamPlayerIds.size === 0 && opponentPlayerIds.size === 0) {
              const warnMsg = `WARNING: No players found in BDL stats for game ${gameId}!`;
              console.error(`[remove-team-players] ${warnMsg}`);
              debugInfo.push(warnMsg);
            }
          }
          
          // Filter players: keep only opponent players
          // Use playerId to match, but also check player name as fallback
          const filteredPlayers = players.filter((p: any) => {
            const pid = Number(p?.playerId || 0);
            const playerName = String(p?.name || '').trim();
            
            // If we have a playerId, use it for matching
            if (pid > 0) {
              if (teamPlayerIds.has(pid)) {
                return false; // Remove team player
              }
              if (opponentPlayerIds.has(pid)) {
                return true; // Keep opponent player
              }
            }
            
            // If playerId matching failed, check by name in stats rows
            // This is a fallback for cases where playerId might be missing or incorrect
            if (playerName) {
              const nameKey = normName(playerName);
              // Check if this player appears in opponent stats
              const isOpponentPlayer = statsRows.some((row: any) => {
                const rowTeamId = Number(row?.team?.id || 0);
                const rowPlayerName = `${row?.player?.first_name || ''} ${row?.player?.last_name || ''}`.trim();
                return rowTeamId !== teamIdBdl && normName(rowPlayerName) === nameKey;
              });
              
              if (isOpponentPlayer) {
                return true; // Keep opponent player
              }
              
              // Check if this player appears in team stats
              const isTeamPlayer = statsRows.some((row: any) => {
                const rowTeamId = Number(row?.team?.id || 0);
                const rowPlayerName = `${row?.player?.first_name || ''} ${row?.player?.last_name || ''}`.trim();
                return rowTeamId === teamIdBdl && normName(rowPlayerName) === nameKey;
              });
              
              if (isTeamPlayer) {
                return false; // Remove team player
              }
            }
            
            // If we can't determine, keep it (to be safe - don't remove data we're not sure about)
            // But log a warning
            if (playerName && pid > 0) {
              console.warn(`[remove-team-players] Could not determine team for player: ${playerName} (ID: ${pid}) in game ${gameId}`);
            }
            return true; // Keep unknown players (safer than removing)
          });
          
          const removedCount = originalCount - filteredPlayers.length;
          
          // Debug: Log what we found for first few games
          if (gameIndex < 3) {
            const teamPlayersFound = players.filter((p: any) => {
              const pid = Number(p?.playerId || 0);
              return pid > 0 && teamPlayerIds.has(pid);
            });
            const opponentPlayersFound = players.filter((p: any) => {
              const pid = Number(p?.playerId || 0);
              return pid > 0 && opponentPlayerIds.has(pid);
            });
            const unmatchedPlayers = players.filter((p: any) => {
              const pid = Number(p?.playerId || 0);
              return pid > 0 && !teamPlayerIds.has(pid) && !opponentPlayerIds.has(pid);
            });
            
            const matchMsg = `Game ${gameId}: Team players found: ${teamPlayersFound.length}, Opponent players found: ${opponentPlayersFound.length}, Unmatched: ${unmatchedPlayers.length}`;
            console.log(`[remove-team-players] ${matchMsg}`);
            debugInfo.push(matchMsg);
            
            if (teamPlayersFound.length > 0) {
              const teamList = teamPlayersFound.map((p: any) => `${p.name} (ID: ${p.playerId})`).join(', ');
              console.log(`[remove-team-players] Team players to remove: ${teamList}`);
              debugInfo.push(`Team players to remove: ${teamList}`);
            }
            if (unmatchedPlayers.length > 0 && unmatchedPlayers.length < 10) {
              const unmatchedList = unmatchedPlayers.slice(0, 5).map((p: any) => `${p.name} (ID: ${p.playerId})`).join(', ');
              console.log(`[remove-team-players] Unmatched players: ${unmatchedList}`);
              debugInfo.push(`Unmatched players: ${unmatchedList}`);
            }
          }
          
          if (removedCount > 0) {
            // Recalculate buckets to only include opponent points
            const newBuckets: Record<'PG'|'SG'|'SF'|'PF'|'C', number> = { 
              PG: 0, SG: 0, SF: 0, PF: 0, C: 0 
            };
            
            for (const player of filteredPlayers) {
              const bucket = player?.bucket;
              const pts = Number(player?.pts || 0);
              if (bucket && ['PG','SG','SF','PF','C'].includes(bucket)) {
                newBuckets[bucket as 'PG'|'SG'|'SF'|'PF'|'C'] += pts;
              }
            }
            
            // Update game
            game.players = filteredPlayers;
            game.buckets = newBuckets;
            
            gamesUpdated++;
            totalPlayersRemoved += removedCount;
          }
        } catch (e: any) {
          console.error(`[remove-team-players] Error processing game ${gameId} for ${abbr}:`, e.message);
          // Continue with next game
        }
      }
      
      // Save updated games
      try {
        fs.writeFileSync(storeFile, JSON.stringify(games, null, 2));
        results.push({
          team: abbr,
          success: true,
          gamesUpdated,
          totalPlayersRemoved,
          totalGames: games.length,
          debugInfo: debugInfo.slice(0, 20) // Include first 20 debug messages
        });
      } catch (e: any) {
        results.push({
          team: abbr,
          success: false,
          error: `Failed to write file: ${e.message}`
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const totalPlayersRemoved = results.reduce((sum, r) => sum + (r.totalPlayersRemoved || 0), 0);
    const totalGamesUpdated = results.reduce((sum, r) => sum + (r.gamesUpdated || 0), 0);
    
    return NextResponse.json({
      success: true,
      total: teams.length,
      successCount,
      totalGamesUpdated,
      totalPlayersRemoved,
      results
    });
  } catch (e: any) {
    return NextResponse.json({ 
      success: false, 
      error: e?.message || 'Failed to remove team players' 
    }, { status: 500 });
  }
}

