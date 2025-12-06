import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { currentNbaSeason } from '@/lib/nbaUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR } from '@/lib/nbaConstants';

// Lazy initialization to avoid blocking deployment
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin(): ReturnType<typeof createClient> {
  if (!supabaseAdmin) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }
    
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  }
  return supabaseAdmin;
}

// Convert height string to inches (handles "6'10", "6-10", or total inches)
function heightToInches(height: string | null | undefined): number | null {
  if (!height) return null;
  
  const heightStr = String(height).trim();
  
  // If it's just a number (total inches)
  if (/^\d+$/.test(heightStr)) {
    return parseInt(heightStr, 10);
  }
  
  // Parse "6'10" or "6-10" format
  const match = heightStr.match(/(\d+)['-](\d+)/);
  if (match) {
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    return feet * 12 + inches;
  }
  
  return null;
}

// Normalize name for matching (EXACT same as dashboard - handles diacritics, suffixes, etc.)
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get player's position from depth chart (PG, SG, SF, PF, C)
// Uses EXACT same logic as dashboard: starters first (depth 0), then by depth rows, tie-break by PG > SG > SF > PF > C
async function getPlayerPositionFromDepthChart(playerName: string, teamAbbr: string): Promise<'PG'|'SG'|'SF'|'PF'|'C' | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/depth-chart?team=${encodeURIComponent(teamAbbr)}`,
      { cache: 'no-store' }
    );
    
    if (!response.ok) {
      console.warn(`[Similar Players] Depth chart API failed for ${teamAbbr}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    if (!data.success) {
      console.warn(`[Similar Players] Depth chart API returned success=false for ${teamAbbr}`);
      return null;
    }
    
    const roster = data.depthChart as Record<'PG'|'SG'|'SF'|'PF'|'C', Array<{ name: string; jersey?: string }>>;
    if (!roster) {
      console.warn(`[Similar Players] Depth chart data missing for ${teamAbbr}`);
      return null;
    }
    
    // EXACT same logic as dashboard - use multiple name variations
    const fullName = playerName;
    const constructed = playerName; // We only have one name from BDL
    const names = [fullName, constructed].filter(Boolean) as string[];
    const normNames = names.map(normalizeName);
    const POS: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG', 'SG', 'SF', 'PF', 'C'];
    
    // Match function - EXACT same as dashboard
    const matchAt = (pos: 'PG'|'SG'|'SF'|'PF'|'C', idx: number): boolean => {
      const arr = Array.isArray(roster[pos]) ? roster[pos] : [];
      if (!arr[idx]) return false;
      const pn = normalizeName(String(arr[idx]?.name || ''));
      if (!pn) return false;
      // EXACT same matching logic as dashboard
      return normNames.some(cand => pn === cand || pn.endsWith(' ' + cand) || cand.endsWith(' ' + pn));
    };
    
    // 1) Starters first (EXACT same as dashboard)
    const starterMatches = POS.filter(pos => matchAt(pos, 0));
    if (starterMatches.length > 0) {
      // Tie-break by priority order: PG > SG > SF > PF > C (EXACT same as dashboard)
      for (const pos of POS) {
        if (starterMatches.includes(pos)) {
          console.log(`[Similar Players] Found ${playerName} as starter at position ${pos} in ${teamAbbr} depth chart`);
          return pos;
        }
      }
    }
    
    // 2) Scan by rows (depth index) then by POS order (EXACT same as dashboard)
    const maxDepth = Math.max(
      ...(POS.map(p => (Array.isArray(roster[p]) ? roster[p].length : 0)))
    );
    for (let depth = 1; depth < maxDepth; depth++) {
      for (const pos of POS) {
        if (matchAt(pos, depth)) {
          console.log(`[Similar Players] Found ${playerName} at position ${pos} (depth ${depth}) in ${teamAbbr} depth chart`);
          return pos;
        }
      }
    }
    
    console.warn(`[Similar Players] Could not find ${playerName} in ${teamAbbr} depth chart`);
    return null;
  } catch (error) {
    console.error(`[Similar Players] Error fetching depth chart position for ${playerName}:`, error);
    return null;
  }
}

// Map BDL position to depth chart position(s) - returns array because G/F can map to multiple
function mapBdlPositionToDepthChart(bdlPosition: string | null | undefined): Array<'PG'|'SG'|'SF'|'PF'|'C'> {
  if (!bdlPosition) return [];
  
  const pos = String(bdlPosition).toUpperCase().trim();
  
  // Direct matches
  if (pos === 'PG' || pos === 'SG' || pos === 'SF' || pos === 'PF' || pos === 'C') {
    return [pos as 'PG'|'SG'|'SF'|'PF'|'C'];
  }
  
  // Handle hyphenated positions (e.g., "G-F", "F-C")
  if (pos.includes('-')) {
    const parts = pos.split('-').map(p => p.trim());
    const allPositions: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
    
    for (const part of parts) {
      if (part === 'G') {
        allPositions.push('PG', 'SG');
      } else if (part === 'F') {
        allPositions.push('SF', 'PF');
      } else if (part === 'C') {
        allPositions.push('C');
      } else if (part === 'PG' || part === 'SG' || part === 'SF' || part === 'PF') {
        allPositions.push(part as 'PG'|'SG'|'SF'|'PF');
      }
    }
    
    // Remove duplicates and return
    return Array.from(new Set(allPositions));
  }
  
  // Generic mappings
  if (pos === 'G') return ['PG', 'SG']; // Guard can be either
  if (pos === 'F') return ['SF', 'PF']; // Forward can be either
  if (pos === 'C') return ['C'];
  
  return [];
}

// Get play type filters for a player - use direct NBA API call instead of internal API
async function getPlayerPlayTypes(playerId: string | number): Promise<string[]> {
  try {
    // Import the play type analysis logic directly or use a simpler approach
    // For now, return empty array - we'll fetch this differently
    // TODO: Implement direct NBA Stats API call or cache play types
    return [];
  } catch (error) {
    console.error('Error fetching play types:', error);
    return [];
  }
}

// Fetch all players from BDL API (fallback if Supabase cache is unavailable)
async function fetchAllPlayersFromBDL(): Promise<any[]> {
  const BDL_BASE = "https://api.balldontlie.io/v1";
  const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
  const authHeaders: Record<string, string> = {};
  if (API_KEY) {
    authHeaders["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  }
  
  const allPlayers: any[] = [];
  let cursor: string | null = null;
  const maxHops = 20; // Fetch all players (should be enough for ~2000 NBA players)
  
  let hops = 0;
  while (hops < maxHops) {
    const url = new URL(`${BDL_BASE}/players/active`);
    url.searchParams.set('per_page', '100');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }
    
    const pageResponse = await fetch(
      url.toString(),
      { 
        headers: authHeaders,
        cache: 'no-store' 
      }
    );
    
    if (!pageResponse.ok) {
      console.error(`[Similar Players] Failed to fetch players hop ${hops + 1}: ${pageResponse.status}`);
      break;
    }
    
    const pageData = await pageResponse.json();
    const players = pageData.data || [];
    allPlayers.push(...players);
    
    console.log(`[Similar Players] Fetched hop ${hops + 1}: ${players.length} players (total: ${allPlayers.length})`);
    
    const nextCursor = pageData.meta?.next_cursor ?? null;
    if (!nextCursor) break;
    
    cursor = String(nextCursor);
    hops++;
  }
  
  return allPlayers;
}

// Get player's average minutes this season - use BDL API directly
async function getPlayerMinutes(playerId: string | number): Promise<number | null> {
  try {
    const BDL_BASE = "https://api.balldontlie.io/v1";
    const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
    const authHeaders: Record<string, string> = {};
    if (API_KEY) {
      authHeaders["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
    }
    
    const response = await fetch(
      `${BDL_BASE}/stats?player_ids[]=${playerId}&seasons[]=${currentNbaSeason()}&per_page=100`,
      { 
        headers: authHeaders,
        cache: 'no-store' 
      }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const stats = Array.isArray(data.data) ? data.data : [];
    
    if (stats.length === 0) return null;
    
    // Calculate average minutes from all games
    const totalMinutes = stats.reduce((sum: number, game: any) => {
      const min = parseFloat(game.min || '0');
      return sum + (isNaN(min) ? 0 : min);
    }, 0);
    
    return stats.length > 0 ? totalMinutes / stats.length : null;
  } catch (error) {
    console.error('Error fetching minutes:', error);
    return null;
  }
}

export const maxDuration = 60; // Vercel Pro allows up to 60s

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const opponent = searchParams.get('opponent');
    const statType = searchParams.get('statType') || 'PTS';
    
    if (!playerId || !opponent) {
      return NextResponse.json(
        { success: false, error: 'playerId and opponent are required' },
        { status: 400 }
      );
    }
    
    // Ensure playerId is a valid number
    const playerIdNum = parseInt(String(playerId), 10);
    if (isNaN(playerIdNum) || playerIdNum <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid player ID' },
        { status: 400 }
      );
    }
    
    console.log(`[Similar Players] Finding similar players for playerId=${playerIdNum}, opponent=${opponent}, statType=${statType}`);
    
    // Get the target player's data - use correct BDL API base URL
    const BDL_BASE = "https://api.balldontlie.io/v1";
    const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
    const authHeaders: Record<string, string> = {};
    if (API_KEY) {
      authHeaders["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
    }
    
    const playerResponse = await fetch(
      `${BDL_BASE}/players/${playerIdNum}`,
      { 
        headers: authHeaders,
        cache: 'no-store' 
      }
    );
    
    if (!playerResponse.ok) {
      const errorText = await playerResponse.text().catch(() => '');
      console.error(`[Similar Players] Failed to fetch player ${playerIdNum}: ${playerResponse.status} - ${errorText}`);
      
      // If player not found, try to resolve by name from search params
      const playerName = searchParams.get('playerName');
      if (playerName && playerResponse.status === 404) {
        console.log(`[Similar Players] Player ID ${playerIdNum} not found, attempting to resolve by name: ${playerName}`);
        // Try to search for the player by name
        const searchUrl = new URL(`${BDL_BASE}/players/active`);
        searchUrl.searchParams.set('search', playerName);
        searchUrl.searchParams.set('per_page', '10');
        
        const searchResponse = await fetch(searchUrl.toString(), { 
          headers: authHeaders,
          cache: 'no-store' 
        });
        
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const foundPlayer = searchData.data?.[0];
          if (foundPlayer && foundPlayer.id) {
            console.log(`[Similar Players] Found player by name: ${foundPlayer.first_name} ${foundPlayer.last_name} (ID: ${foundPlayer.id})`);
            // Use the found player ID
            const targetPlayer = foundPlayer;
            // Continue with the found player...
          } else {
            return NextResponse.json(
              { success: false, error: `Player not found (ID: ${playerIdNum})` },
              { status: 404 }
            );
          }
        } else {
          return NextResponse.json(
            { success: false, error: `Player not found (ID: ${playerIdNum})` },
            { status: 404 }
          );
        }
      } else {
        return NextResponse.json(
          { success: false, error: `Player not found (ID: ${playerIdNum})` },
          { status: 404 }
        );
      }
    }
    
    let targetPlayer = await playerResponse.json();
    
    // If position or height is missing, try to get it from Supabase cache first (fastest)
    let targetPosition = targetPlayer.position;
    let targetHeightInches = heightToInches(targetPlayer.height);
    
    if (!targetPosition || !targetHeightInches) {
      console.log(`[Similar Players] Player ${playerIdNum} missing position/height, checking Supabase cache...`);
      try {
        const { data: cachedPlayer, error: cacheError } = await getSupabaseAdmin()
          .from('players')
          .select('position, height, height_inches')
          .eq('id', playerIdNum)
          .single();
        
        if (!cacheError && cachedPlayer) {
          console.log(`[Similar Players] Found player in Supabase cache with complete data`);
          const player = cachedPlayer as { position?: string; height?: string; height_inches?: number | null };
          if (!targetPosition && player.position) {
            targetPosition = player.position;
          }
          if (!targetHeightInches) {
            targetHeightInches = player.height_inches || heightToInches(player.height);
          }
        }
      } catch (err) {
        console.warn(`[Similar Players] Error checking Supabase cache:`, err);
      }
    }
    
    // If still missing, try to get it from the active players search
    if (!targetPosition || !targetHeightInches) {
      console.log(`[Similar Players] Player ${playerIdNum} still missing position/height, searching in active players...`);
      const searchUrl = new URL(`${BDL_BASE}/players/active`);
      searchUrl.searchParams.set('per_page', '100');
      const searchResponse = await fetch(searchUrl.toString(), { 
        headers: authHeaders,
        cache: 'no-store' 
      });
      
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        const foundPlayer = searchData.data?.find((p: any) => p.id === playerIdNum);
        if (foundPlayer) {
          console.log(`[Similar Players] Found player in active players list with complete data`);
          targetPlayer = foundPlayer;
          if (!targetPosition) targetPosition = foundPlayer.position;
          if (!targetHeightInches) targetHeightInches = heightToInches(foundPlayer.height);
        }
      }
    }
    
    // Skip play types for now to speed up the API
    const targetPlayTypes: string[] = [];
    const targetMinutes = await getPlayerMinutes(playerId);
    
    if (!targetPosition || !targetHeightInches) {
      console.error(`[Similar Players] Player ${playerIdNum} missing position (${targetPosition}) or height (${targetHeightInches})`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Player missing position or height data. This player may not be active or the data is incomplete.',
          playerName: `${targetPlayer.first_name || ''} ${targetPlayer.last_name || ''}`.trim() || 'Unknown'
        },
        { status: 400 }
      );
    }
    
    // Try to get position from depth chart (more accurate than BDL's generic G/F/C)
    const playerName = `${targetPlayer.first_name} ${targetPlayer.last_name}`;
    const teamAbbr = targetPlayer.team?.abbreviation || '';
    let depthChartPosition: 'PG'|'SG'|'SF'|'PF'|'C' | null = null;
    
    // If position is still missing, try to get it from Supabase cache
    if (!targetPosition) {
      try {
        const { data: cachedPlayer, error: cacheError } = await getSupabaseAdmin()
          .from('players')
          .select('position')
          .eq('id', playerIdNum)
          .single();
        
        if (!cacheError && cachedPlayer) {
          const player = cachedPlayer as { position?: string };
          if (player.position) {
            console.log(`[Similar Players] Got position from Supabase cache: ${player.position}`);
            targetPosition = player.position;
            targetPlayer.position = player.position; // Update targetPlayer for consistency
          }
        }
      } catch (err) {
        console.warn(`[Similar Players] Error checking Supabase for position:`, err);
      }
    }
    
    if (teamAbbr) {
      depthChartPosition = await getPlayerPositionFromDepthChart(playerName, teamAbbr);
      if (depthChartPosition) {
        console.log(`[Similar Players] Got position from depth chart: ${depthChartPosition}`);
        targetPosition = depthChartPosition;
      } else {
        // Fallback to mapped BDL position - if it's generic (G/F), we'll match against multiple positions
        const mappedPositions = mapBdlPositionToDepthChart(targetPlayer.position || targetPosition);
        if (mappedPositions.length === 1) {
          targetPosition = mappedPositions[0];
          console.log(`[Similar Players] Mapped BDL position ${targetPlayer.position || targetPosition} to ${mappedPositions[0]}`);
        } else if (mappedPositions.length > 1) {
          // Generic position (G or F) - use first one as primary, but we'll match against all
          targetPosition = mappedPositions[0];
          console.log(`[Similar Players] BDL position ${targetPlayer.position || targetPosition} maps to multiple: ${mappedPositions.join(', ')}, using ${targetPosition} as primary`);
        } else {
          console.warn(`[Similar Players] Could not determine position for ${playerName} (BDL: ${targetPlayer.position || 'undefined'})`);
        }
      }
    } else {
      // No team, try to map BDL position
      const mappedPositions = mapBdlPositionToDepthChart(targetPosition || targetPlayer.position);
      if (mappedPositions.length === 1) {
        targetPosition = mappedPositions[0];
      } else if (mappedPositions.length > 1) {
        targetPosition = mappedPositions[0];
      }
    }
    
    // Store the possible positions for matching
    // IMPORTANT: If we have a specific depth chart position, ONLY match that exact position
    // Only allow multiple positions if we have a generic BDL position (G, F, G-F, F-C) and NO depth chart position
    let possiblePositions: Array<'PG'|'SG'|'SF'|'PF'|'C'>;
    
    if (depthChartPosition) {
      // We have a specific depth chart position - ONLY match this exact position
      possiblePositions = [depthChartPosition];
      console.log(`[Similar Players] Using exact depth chart position: ${depthChartPosition} (no generic matching)`);
    } else {
      // No depth chart position - use BDL position mapping
      const bdlPos = targetPlayer.position || targetPosition;
      const mappedPositions = mapBdlPositionToDepthChart(bdlPos);
      
      // If BDL position maps to a single specific position (PG, SG, SF, PF, C), use only that
      // Only allow multiple positions if it's truly generic (G, F, G-F, F-C)
      if (mappedPositions.length === 1) {
        possiblePositions = mappedPositions;
        console.log(`[Similar Players] BDL position ${bdlPos} maps to single position: ${mappedPositions[0]}`);
      } else if (mappedPositions.length > 1) {
        // Generic position - allow matching any of the mapped positions
        possiblePositions = mappedPositions;
        console.log(`[Similar Players] BDL position ${bdlPos} is generic, allowing matches: ${mappedPositions.join(', ')}`);
      } else {
        // No position found - allow matching all positions as fallback (better than failing)
        console.warn(`[Similar Players] Could not determine position for ${playerName}. Allowing matches for all positions as fallback.`);
        possiblePositions = ['PG', 'SG', 'SF', 'PF', 'C'];
      }
    }
    
    console.log(`[Similar Players] Target player: ${playerName}, Position: ${targetPosition}, Possible positions: ${possiblePositions.join(', ')}, Height: ${targetHeightInches}"`);
    
    // Get all active players from Supabase cache (instant, no API calls)
    console.log(`[Similar Players] Fetching all players from Supabase cache...`);
    
    let allPlayers: any[] = [];
    try {
      const { data: cachedPlayers, error } = await getSupabaseAdmin()
        .from('players')
        .select('*')
        .order('id', { ascending: true });
      
      if (error) {
        console.warn(`[Similar Players] Error fetching from Supabase cache: ${error.message}. Falling back to BDL API...`);
        // Fallback to BDL API if Supabase fails
        allPlayers = await fetchAllPlayersFromBDL();
      } else if (!cachedPlayers || cachedPlayers.length === 0) {
        console.warn(`[Similar Players] No players in Supabase cache. Falling back to BDL API...`);
        // Fallback to BDL API if cache is empty
        allPlayers = await fetchAllPlayersFromBDL();
      } else {
        // Transform Supabase data to match BDL format
        // Use height_inches directly from database (already calculated, instant filtering!)
        allPlayers = cachedPlayers.map((p: any) => ({
          id: p.id,
          first_name: p.first_name,
          last_name: p.last_name,
          position: p.position,
          height: p.height, // Keep original for display
          height_inches: p.height_inches, // Use pre-calculated inches for fast filtering
          weight: p.weight,
          headshot_url: p.headshot_url || null, // Include headshot URL
          team: p.team_id ? {
            id: p.team_id,
            abbreviation: p.team_abbreviation
          } : null
        }));
        console.log(`[Similar Players] ✅ Loaded ${allPlayers.length} players from Supabase cache (instant!)`);
      }
    } catch (error: any) {
      console.warn(`[Similar Players] Error accessing Supabase cache: ${error.message}. Falling back to BDL API...`);
      // Fallback to BDL API
      allPlayers = await fetchAllPlayersFromBDL();
    }
    
    if (allPlayers.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No players available. Please run /api/players/sync to populate the cache.' 
        },
        { status: 500 }
      );
    }
    
    console.log(`[Similar Players] Total players available: ${allPlayers.length}`);
    
    // Filter and score similar players
    const normalizedOpponent = normalizeAbbr(opponent);
    const similarPlayers: Array<{
      player: any;
      similarityScore: number;
      heightDiff: number;
      playTypeMatches: number;
      minutesDiff: number | null;
    }> = [];
    
    // First pass: filter by height only (FAST - using pre-calculated height_inches from database!)
    const heightCandidates = allPlayers
      .filter(player => {
        if (player.id === parseInt(String(playerId))) return false;
        // Use height_inches directly from database (no conversion needed!)
        const playerHeightInches = player.height_inches ?? heightToInches(player.height);
        if (!playerHeightInches) return false;
        const heightDiff = Math.abs(playerHeightInches - targetHeightInches);
        return heightDiff <= 3;
      })
      .map(player => {
        // Use height_inches directly from database (instant!)
        const playerHeightInches = player.height_inches ?? heightToInches(player.height)!;
        const heightDiff = Math.abs(playerHeightInches - targetHeightInches);
        return { player, heightDiff };
      })
      .sort((a, b) => a.heightDiff - b.heightDiff) // Sort by height difference (closest first)
      .map(({ player }) => player); // Extract just the player objects
    
    console.log(`[Similar Players] Found ${heightCandidates.length} candidates matching height (±3")`);
    
    // Second pass: get positions from depth charts and filter by position
    // OPTIMIZATION: Limit to top 100 candidates by height similarity to avoid too many API calls
    const MAX_CANDIDATES_FOR_POSITION_CHECK = 100;
    const candidatesToCheck = heightCandidates.slice(0, MAX_CANDIDATES_FOR_POSITION_CHECK);
    console.log(`[Similar Players] Getting depth chart positions for ${candidatesToCheck.length} candidates (limited from ${heightCandidates.length} for performance)...`);
    
    // OPTIMIZATION: Batch depth chart requests by team (fetch each team's depth chart once, then match all players)
    const playersByTeam = new Map<string, Array<{ player: any; playerName: string }>>();
    for (const player of candidatesToCheck) {
      const playerName = `${player.first_name} ${player.last_name}`;
      const playerTeamAbbr = player.team?.abbreviation || '';
      if (playerTeamAbbr) {
        if (!playersByTeam.has(playerTeamAbbr)) {
          playersByTeam.set(playerTeamAbbr, []);
        }
        playersByTeam.get(playerTeamAbbr)!.push({ player, playerName });
      }
    }
    
    // Fetch depth charts for all unique teams in parallel
    const depthChartCache = new Map<string, Record<'PG'|'SG'|'SF'|'PF'|'C', Array<{ name: string; jersey?: string }>> | null>();
    const teamAbbrs = Array.from(playersByTeam.keys());
    console.log(`[Similar Players] Fetching depth charts for ${teamAbbrs.length} unique teams (instead of ${candidatesToCheck.length} individual requests)...`);
    
    const depthChartPromises = teamAbbrs.map(async (teamAbbr) => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/depth-chart?team=${encodeURIComponent(teamAbbr)}`,
          { cache: 'no-store' }
        );
        
        if (!response.ok) {
          console.warn(`[Similar Players] Depth chart API failed for ${teamAbbr}: ${response.status}`);
          depthChartCache.set(teamAbbr, null);
          return;
        }
        
        const data = await response.json();
        if (!data.success || !data.depthChart) {
          console.warn(`[Similar Players] Depth chart API returned no data for ${teamAbbr}`);
          depthChartCache.set(teamAbbr, null);
          return;
        }
        
        depthChartCache.set(teamAbbr, data.depthChart);
      } catch (error) {
        console.error(`[Similar Players] Error fetching depth chart for ${teamAbbr}:`, error);
        depthChartCache.set(teamAbbr, null);
      }
    });
    
    await Promise.all(depthChartPromises);
    
    // Helper function to find player position in a depth chart
    const findPlayerInDepthChart = (playerName: string, roster: Record<'PG'|'SG'|'SF'|'PF'|'C', Array<{ name: string; jersey?: string }>>): 'PG'|'SG'|'SF'|'PF'|'C' | null => {
      const names = [playerName].filter(Boolean) as string[];
      const normNames = names.map(normalizeName);
      const POS: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG', 'SG', 'SF', 'PF', 'C'];
      
      const matchAt = (pos: 'PG'|'SG'|'SF'|'PF'|'C', idx: number): boolean => {
        const arr = Array.isArray(roster[pos]) ? roster[pos] : [];
        if (!arr[idx]) return false;
        const pn = normalizeName(String(arr[idx]?.name || ''));
        if (!pn) return false;
        return normNames.some(cand => pn === cand || pn.endsWith(' ' + cand) || cand.endsWith(' ' + pn));
      };
      
      // 1) Starters first
      const starterMatches = POS.filter(pos => matchAt(pos, 0));
      if (starterMatches.length > 0) {
        for (const pos of POS) {
          if (starterMatches.includes(pos)) {
            return pos;
          }
        }
      }
      
      // 2) Scan by rows (depth index) then by POS order
      const maxDepth = Math.max(...(POS.map(p => (Array.isArray(roster[p]) ? roster[p].length : 0))));
      for (let depth = 1; depth < maxDepth; depth++) {
        for (const pos of POS) {
          if (matchAt(pos, depth)) {
            return pos;
          }
        }
      }
      
      return null;
    };
    
    // Now match all players to their positions using cached depth charts
    const playersWithPositions = candidatesToCheck.map((player) => {
      const playerName = `${player.first_name} ${player.last_name}`;
      const playerTeamAbbr = player.team?.abbreviation || '';
      let playerPos: 'PG'|'SG'|'SF'|'PF'|'C' | null = null;
      let positionSource: 'depth_chart' | 'bdl_specific' | 'bdl_generic' | null = null;
      let mappedPositions: Array<'PG'|'SG'|'SF'|'PF'|'C'> = [];
      
      if (playerTeamAbbr) {
        const roster = depthChartCache.get(playerTeamAbbr);
        if (roster) {
          playerPos = findPlayerInDepthChart(playerName, roster);
          if (playerPos) {
            positionSource = 'depth_chart';
            mappedPositions = [playerPos];
          }
        }
      }
      
      // Fallback to BDL position - but be strict about it
      if (!playerPos) {
        mappedPositions = mapBdlPositionToDepthChart(player.position);
        if (mappedPositions.length === 1) {
          // Single specific position (PG, SG, SF, PF, C) - use it
          playerPos = mappedPositions[0];
          positionSource = 'bdl_specific';
        } else if (mappedPositions.length > 1) {
          // Generic position (G, F, G-F, F-C) - store all mapped positions for matching
          positionSource = 'bdl_generic';
        }
      } else {
        // We have a depth chart position, so mappedPositions is just that one position
        mappedPositions = [playerPos];
      }
      
      return { player, position: playerPos, positionSource, mappedPositions };
    });
    
    // Filter by position match - STRICT matching:
    // - If target has a specific depth chart position, ONLY match candidates with that exact position
    // - If target has multiple possible positions (generic BDL), match any of them
    // - Reject candidates with generic BDL positions when target has a specific position
    const positionCandidates = playersWithPositions.filter(({ position, positionSource, mappedPositions }) => {
      if (!position && mappedPositions.length === 0) return false;
      
      // If target has a single specific position (from depth chart), be VERY strict
      if (possiblePositions.length === 1) {
        const targetPos = possiblePositions[0];
        
        // Candidate must have the exact target position
        if (position === targetPos) {
          // Good - exact match
          // But reject if candidate has generic BDL position (might be wrong)
          if (positionSource === 'bdl_generic') {
            // Candidate has generic BDL position (G, F, G-F, F-C) but we need specific
            // Only allow if the generic position includes the target position AND it's the only match
            if (mappedPositions.length > 1 && mappedPositions.includes(targetPos)) {
              // Generic position includes target, but has multiple options - too risky
              console.log(`[Similar Players] Rejecting ${position} - candidate has generic BDL position ${mappedPositions.join(', ')} but target requires specific ${targetPos}`);
              return false;
            }
          }
          return true;
        }
        
        // Position doesn't match - reject
        return false;
      }
      
      // Target has multiple possible positions (generic) - check if candidate matches any
      if (position) {
        return possiblePositions.includes(position);
      }
      
      // Candidate has generic BDL position - check if any mapped positions match
      if (mappedPositions.length > 0) {
        return mappedPositions.some(pos => possiblePositions.includes(pos));
      }
      
      return false;
    });
    console.log(`[Similar Players] Found ${positionCandidates.length} candidates matching position ${targetPosition} (possible: ${possiblePositions.join(', ')}) and height`);
    
    // Sort position candidates by height difference (they're already in order from heightCandidates, but re-sort to be sure)
    const sortedPositionCandidates = positionCandidates
      .map(({ player, position }) => {
        // Use height_inches directly from database (instant!)
        const playerHeightInches = player.height_inches ?? heightToInches(player.height)!;
        const heightDiff = Math.abs(playerHeightInches - targetHeightInches);
        return { player, position, heightDiff };
      })
      .sort((a, b) => a.heightDiff - b.heightDiff);
    
    // Third pass: check minutes (check all position candidates, already sorted by similarity)
    // OPTIMIZATION: Limit to top 50 candidates for minutes check to avoid too many API calls
    const MAX_CANDIDATES_FOR_MINUTES_CHECK = 50;
    const minutesCandidates = sortedPositionCandidates.slice(0, MAX_CANDIDATES_FOR_MINUTES_CHECK);
    console.log(`[Similar Players] Checking ${minutesCandidates.length} candidates for minutes similarity (limited from ${sortedPositionCandidates.length} for performance)...`);
    
    // OPTIMIZATION: Try to get minutes from season averages cache first (much faster!)
    const minutesFromCache = new Map<number, number | null>();
    try {
      const { data: cachedAverages } = await getSupabaseAdmin()
        .from('player_season_averages')
        .select('player_id, min')
        .in('player_id', minutesCandidates.map(c => c.player.id))
        .eq('season', currentNbaSeason());
      
      if (cachedAverages) {
        for (const avg of cachedAverages as Array<{ player_id: number; min?: number | null }>) {
          minutesFromCache.set(avg.player_id, avg.min || null);
        }
        console.log(`[Similar Players] ✅ Loaded ${minutesFromCache.size} minutes from season averages cache (instant!)`);
      }
    } catch (error) {
      console.warn(`[Similar Players] Error loading minutes from cache:`, error);
    }
    
    // Fetch minutes for candidates missing from cache (only those we need)
    const candidatesNeedingMinutes = minutesCandidates.filter(({ player }) => !minutesFromCache.has(player.id));
    console.log(`[Similar Players] Fetching minutes from API for ${candidatesNeedingMinutes.length} candidates (${minutesCandidates.length - candidatesNeedingMinutes.length} from cache)...`);
    
    const minutesPromises = candidatesNeedingMinutes.map(async ({ player, position }) => {
      try {
        const playerMinutes = await getPlayerMinutes(player.id);
        return { player, minutes: playerMinutes, position };
      } catch (error) {
        console.error(`[Similar Players] Error fetching minutes for player ${player.id}:`, error);
        return { player, minutes: null, position };
      }
    });
    
    const minutesResults = await Promise.all(minutesPromises);
    
    // Merge cached minutes with API results
    for (const { player, position } of minutesCandidates) {
      if (minutesFromCache.has(player.id)) {
        minutesResults.push({ player, minutes: minutesFromCache.get(player.id)!, position });
      }
    }
    
    for (const { player, minutes: playerMinutes, position: playerPos } of minutesResults) {
        // Use height_inches directly from database (instant!)
        const playerHeightInches = player.height_inches ?? heightToInches(player.height)!;
        const heightDiff = Math.abs(playerHeightInches - targetHeightInches);
      
      // Minutes must be within ±7 minutes (if we have data)
      let minutesDiff: number | null = null;
      if (targetMinutes !== null && playerMinutes !== null) {
        minutesDiff = Math.abs(playerMinutes - targetMinutes);
        if (minutesDiff > 7) continue;
      }
      
      // For now, skip play type matching to speed up the API
      // TODO: Add play type matching later with caching
      const playTypeMatches = 1; // Placeholder - assume match for now
      
      // Calculate similarity score (lower is better)
      const similarityScore = 
        heightDiff * 10 + // Height difference (0-30 points)
        (minutesDiff || 0) * 2; // Minutes difference (0-14 points)
      
      similarPlayers.push({
        player,
        similarityScore,
        heightDiff,
        playTypeMatches,
        minutesDiff,
      });
    }
    
    console.log(`[Similar Players] Found ${similarPlayers.length} similar players after filtering`);
    
    // Get game stats for all similar players vs the opponent (INSTANT - from cached stats!)
    console.log(`[Similar Players] Fetching game stats for ${similarPlayers.length} similar players vs ${normalizedOpponent}...`);
    
    // Fetch cached stats from Supabase (INSTANT - no API calls!)
    const playerIds = similarPlayers.map(s => s.player.id);
    
    let cachedStats: any[] = [];
    try {
      const { data, error } = await getSupabaseAdmin()
        .from('player_team_stats')
        .select('*')
        .in('player_id', playerIds)
        .eq('team_abbreviation', normalizedOpponent);
      
      if (error) {
        if (error.code === 'PGRST205') {
          console.warn(`[Similar Players] player_team_stats table not found. Please run migration: migrations/create_player_team_stats_table.sql`);
          console.warn(`[Similar Players] Falling back to BDL API...`);
        } else {
          console.error(`[Similar Players] Error fetching cached stats:`, error);
          console.warn(`[Similar Players] Falling back to BDL API...`);
        }
      } else {
        cachedStats = data || [];
        console.log(`[Similar Players] ✅ Loaded ${cachedStats.length} cached stats from Supabase (instant!)`);
      }
    } catch (error: any) {
      if (error?.code === 'PGRST205' || error?.message?.includes('player_team_stats')) {
        console.warn(`[Similar Players] player_team_stats table not found. Please run migration: migrations/create_player_team_stats_table.sql`);
      }
      console.warn(`[Similar Players] Falling back to BDL API...`);
    }
    
    // Create a map for fast lookup: player_id -> stats
    const statsMap = new Map<number, any>();
    for (const stat of cachedStats) {
      statsMap.set(stat.player_id, stat);
    }
    
    // Match cached stats with similar players
    const allOpponentGames: Array<{ game: any; similar: any }> = [];
    
    for (const similar of similarPlayers) {
      const cachedStat = statsMap.get(similar.player.id);
      if (cachedStat) {
        // Transform cached stat to match expected format
        allOpponentGames.push({
          game: {
            game: {
              date: cachedStat.game_date,
              id: cachedStat.game_id
            },
            pts: cachedStat.pts || 0,
            reb: cachedStat.reb || 0,
            ast: cachedStat.ast || 0,
            fg3m: cachedStat.fg3m || 0,
            stl: cachedStat.stl || 0,
            blk: cachedStat.blk || 0,
            turnover: cachedStat.turnovers || 0,
            to: cachedStat.turnovers || 0,
            fg_pct: cachedStat.fg_pct,
            fg3_pct: cachedStat.fg3_pct,
            min: cachedStat.min,
            min_decimal: cachedStat.min_decimal,
          },
          similar,
        });
      }
    }
    
    console.log(`[Similar Players] Found ${allOpponentGames.length} cached stats vs ${normalizedOpponent}`);
    
    // FALLBACK: If no cached stats, fetch from BDL API (old method)
    if (allOpponentGames.length === 0) {
      console.log(`[Similar Players] No cached stats found, fetching from BDL API...`);
      // Fetch games for all similar players in parallel
      const gamePromises = similarPlayers.map(async (similar) => {
      try {
        const gamesResponse = await fetch(
          `${BDL_BASE}/stats?player_ids[]=${similar.player.id}&seasons[]=${currentNbaSeason()}&per_page=100`,
          { 
            headers: authHeaders,
            cache: 'no-store' 
          }
        );
        
        if (!gamesResponse.ok) {
          console.error(`[Similar Players] Failed to fetch games for player ${similar.player.id}: ${gamesResponse.status}`);
          return [];
        }
        
        const gamesData = await gamesResponse.json();
        const games = gamesData.data || [];
        
        // Collect game IDs that need team info fetched
        const gamesNeedingDetails = new Set<number>();
        const gamesWithTeamInfo: any[] = [];
        
        // First pass: identify games that need team info
        for (const game of games) {
          // We need BOTH nested team objects to exist with abbreviations OR IDs we can map
          // The nested objects must actually exist (not just IDs in separate fields)
          const hasHomeTeamObject = !!game.game?.home_team;
          const hasVisitorTeamObject = !!game.game?.visitor_team;
          
          let hasBothTeams = false;
          
          // If both nested objects exist, check if they have usable data
          if (hasHomeTeamObject && hasVisitorTeamObject) {
            const homeAbbr = game.game.home_team?.abbreviation;
            const visitorAbbr = game.game.visitor_team?.abbreviation;
            const homeId = game.game.home_team?.id;
            const visitorId = game.game.visitor_team?.id;
            
            // We need either both abbreviations, or both IDs that can be mapped
            hasBothTeams = (homeAbbr && visitorAbbr) || 
                          (homeId && visitorId && TEAM_ID_TO_ABBR[homeId] && TEAM_ID_TO_ABBR[visitorId]) ||
                          (homeAbbr && visitorId && TEAM_ID_TO_ABBR[visitorId]) ||
                          (homeId && visitorAbbr && TEAM_ID_TO_ABBR[homeId]);
          }
          
          // If nested objects don't exist, we need to fetch them (even if we have separate ID fields)
          // because the filtering logic expects nested objects
          if (!hasBothTeams && game.game?.id) {
            gamesNeedingDetails.add(game.game.id);
          } else if (hasBothTeams) {
            gamesWithTeamInfo.push(game);
          }
          // If no game ID, we can't fetch details, so skip it
        }
        
        if (gamesNeedingDetails.size > 0) {
          console.log(`[Similar Players] ${gamesNeedingDetails.size} games need team info, ${gamesWithTeamInfo.length} already have it`);
        } else if (games.length > 0) {
          console.log(`[Similar Players] All ${games.length} games already have team info`);
        }
        
        // Fetch game details for games missing team info (batch by unique game IDs)
        const gameDetailsMap = new Map<number, any>();
        if (gamesNeedingDetails.size > 0) {
          console.log(`[Similar Players] Fetching team info for ${gamesNeedingDetails.size} games missing team data`);
          const uniqueGameIds = Array.from(gamesNeedingDetails);
          
          // Try to fetch games by date range using our internal API (more reliable)
          // Get date range from games
          const gameDates = games
            .filter((g: any) => g.game?.id && gamesNeedingDetails.has(g.game.id))
            .map((g: any) => g.game?.date)
            .filter(Boolean)
            .sort();
          
          if (gameDates.length > 0) {
            const startDate = gameDates[0].split('T')[0];
            const endDate = gameDates[gameDates.length - 1].split('T')[0];
            
            try {
              // Use our internal games API which has better team info
              const gamesApiUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/bdl/games?start_date=${startDate}&end_date=${endDate}&per_page=100`;
              const gamesApiResponse = await fetch(gamesApiUrl, { cache: 'no-store' });
              
              if (gamesApiResponse.ok) {
                const gamesApiData = await gamesApiResponse.json();
                const fetchedGames = gamesApiData.data || [];
                
                // Map games by ID
                for (const fetchedGame of fetchedGames) {
                  if (fetchedGame.id && gamesNeedingDetails.has(fetchedGame.id)) {
                    gameDetailsMap.set(fetchedGame.id, fetchedGame);
                  }
                }
                
                console.log(`[Similar Players] Fetched ${gameDetailsMap.size} games with team info from internal API`);
              }
            } catch (error) {
              console.error(`[Similar Players] Error fetching games from internal API:`, error);
            }
          }
          
          // Fallback: try BDL API directly for any games still missing
          // BUT: Skip if we're getting rate limited - it's better to have partial data than to fail completely
          const stillNeeding = uniqueGameIds.filter(id => !gameDetailsMap.has(id));
          if (stillNeeding.length > 0) {
            console.log(`[Similar Players] Trying BDL API directly for ${stillNeeding.length} games (with rate limiting)`);
            // Fetch games in smaller batches with delays to avoid rate limiting
            const BATCH_SIZE = 5; // Smaller batches
            const DELAY_MS = 200; // 200ms delay between batches
            
            for (let i = 0; i < stillNeeding.length; i += BATCH_SIZE) {
              const batch = stillNeeding.slice(i, i + BATCH_SIZE);
              
              // Add delay between batches (except first batch)
              if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
              }
              
              // Fetch with sequential delays to avoid rate limiting
              for (const gameId of batch) {
                try {
                  // Small delay between individual requests
                  if (batch.indexOf(gameId) > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                  
                  const gameResponse = await fetch(
                    `${BDL_BASE}/games/${gameId}`,
                    { 
                      headers: authHeaders,
                      cache: 'no-store' 
                    }
                  );
                  
                  if (gameResponse.ok) {
                    const gameData = await gameResponse.json();
                    gameDetailsMap.set(gameId, gameData);
                  } else if (gameResponse.status === 429) {
                    // Rate limited - stop trying and use what we have
                    console.warn(`[Similar Players] Rate limited (429) - stopping game detail fetching. Using ${gameDetailsMap.size} games with team info.`);
                    break; // Break out of batch loop
                  } else {
                    console.warn(`[Similar Players] BDL API returned ${gameResponse.status} for game ${gameId}`);
                  }
                } catch (error) {
                  console.error(`[Similar Players] Error fetching game ${gameId} from BDL:`, error);
                }
              }
              
              // If we hit rate limiting, break out of the outer loop too
              if (i < stillNeeding.length && gameDetailsMap.size === 0 && i > 0) {
                break;
              }
            }
          }
        }
        
        // Merge game details into games that needed them, and also enrich games with team info from IDs
        const allGames = games.map((game: any) => {
          // If we fetched game details for this game, merge them
          if (game.game?.id && gamesNeedingDetails.has(game.game.id)) {
            const gameDetails = gameDetailsMap.get(game.game.id);
            if (gameDetails) {
              // The fetched game details have home_team and visitor_team at the top level
              // We need to merge them into game.game.home_team and game.game.visitor_team
              const mergedGame = {
                ...game,
                game: {
                  ...game.game,
                  home_team: gameDetails.home_team || game.game?.home_team,
                  visitor_team: gameDetails.visitor_team || game.game?.visitor_team,
                }
              };
              
              // Log if we successfully merged team info
              if (gameDetails.home_team || gameDetails.visitor_team) {
                console.log(`[Similar Players] Merged team info for game ${game.game.id}: home=${gameDetails.home_team?.abbreviation || '?'}, visitor=${gameDetails.visitor_team?.abbreviation || '?'}`);
              }
              
              return mergedGame;
            }
          }
          
          // If nested objects don't exist but we have IDs, create the nested objects
          if (game.game && !game.game.home_team && !game.game.visitor_team) {
            const homeTeamId = (game.game as any)?.home_team_id;
            const visitorTeamId = (game.game as any)?.visitor_team_id;
            
            if (homeTeamId && visitorTeamId && TEAM_ID_TO_ABBR[homeTeamId] && TEAM_ID_TO_ABBR[visitorTeamId]) {
              return {
                ...game,
                game: {
                  ...game.game,
                  home_team: {
                    id: homeTeamId,
                    abbreviation: TEAM_ID_TO_ABBR[homeTeamId]
                  },
                  visitor_team: {
                    id: visitorTeamId,
                    abbreviation: TEAM_ID_TO_ABBR[visitorTeamId]
                  }
                }
              };
            }
          }
          
          return game;
        });
        
        // Filter games vs the opponent
        // Each game stat has a 'team' field showing which team the player was on in that game
        const opponentGames = allGames.filter((game: any) => {
          // Get team IDs first (more reliable than abbreviations)
          const homeTeamId = game.game?.home_team?.id ?? (game.game as any)?.home_team_id;
          const visitorTeamId = game.game?.visitor_team?.id ?? (game.game as any)?.visitor_team_id;
          
          // Get team abbreviations - try from nested object first, then from ID mapping
          const homeAbbr = normalizeAbbr(
            game.game?.home_team?.abbreviation || 
            (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : '') ||
            ''
          );
          const visitorAbbr = normalizeAbbr(
            game.game?.visitor_team?.abbreviation || 
            (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : '') ||
            ''
          );
          
          // If we can't get team abbreviations, skip this game
          if (!visitorAbbr && !homeAbbr) {
            return false;
          }
          
          // Check if opponent is in the game
          const opponentInGame = visitorAbbr === normalizedOpponent || homeAbbr === normalizedOpponent;
          if (!opponentInGame) return false;
          
          // Get the team the player was on in THIS specific game (from the stat record)
          const playerGameTeamId = game.team?.id ?? (game as any)?.team_id;
          const playerGameTeamAbbr = normalizeAbbr(
            game.team?.abbreviation || 
            (playerGameTeamId ? TEAM_ID_TO_ABBR[playerGameTeamId] : '') ||
            ''
          );
          
          if (!playerGameTeamAbbr) {
            // If no team info, skip this game
            return false;
          }
          
          // Make sure player's team in this game is different from opponent
          if (playerGameTeamAbbr === normalizedOpponent) return false;
          
          // Make sure player's team in this game is one of the teams playing
          const playerTeamInGame = visitorAbbr === playerGameTeamAbbr || homeAbbr === playerGameTeamAbbr;
          if (!playerTeamInGame) {
            // This shouldn't happen, but log it if it does
            console.warn(`[Similar Players] Player ${similar.player.id} team ${playerGameTeamAbbr} not in game (${visitorAbbr} vs ${homeAbbr})`);
            return false;
          }
          
          return true;
        });
        
        if (opponentGames.length > 0) {
          console.log(`[Similar Players] Found ${opponentGames.length} games vs ${normalizedOpponent} for player ${similar.player.first_name} ${similar.player.last_name}`);
        } else if (allGames.length > 0) {
          // Log sample of games to debug (use allGames, not games, so we see merged data)
          const sampleGame = allGames[0];
          const sampleOpponents = allGames.slice(0, 5).map((g: any) => {
            // Try multiple ways to get team abbreviations
            const visitorAbbr = normalizeAbbr(
              g.game?.visitor_team?.abbreviation || 
              (g.game?.visitor_team?.id ? TEAM_ID_TO_ABBR[g.game.visitor_team.id] : '') ||
              ''
            );
            const homeAbbr = normalizeAbbr(
              g.game?.home_team?.abbreviation || 
              (g.game?.home_team?.id ? TEAM_ID_TO_ABBR[g.game.home_team.id] : '') ||
              ''
            );
            const playerTeamAbbr = normalizeAbbr(g.team?.abbreviation || '');
            return `${visitorAbbr || '?'}@${homeAbbr || '?'} (player:${playerTeamAbbr})`;
          });
          console.log(`[Similar Players] No games vs ${normalizedOpponent} for ${similar.player.first_name} ${similar.player.last_name}. Total games: ${allGames.length}, sample opponents: ${sampleOpponents.join(', ')}`);
          // Also log the first game structure for debugging (use allGames)
          if (allGames.length > 0) {
            console.log(`[Similar Players] Sample game structure:`, {
              hasGame: !!allGames[0].game,
              visitorTeam: allGames[0].game?.visitor_team,
              homeTeam: allGames[0].game?.home_team,
              playerTeam: allGames[0].team,
              gameDate: allGames[0].game?.date,
              gameId: allGames[0].game?.id
            });
          }
        }
        
        return opponentGames.map((game: any) => ({
          game,
          similar,
        }));
      } catch (error) {
        console.error(`[Similar Players] Error fetching games for player ${similar.player.id}:`, error);
        return [];
      }
    });
    
      const gameResults = await Promise.all(gamePromises);
      const fallbackGames = gameResults.flat();
      allOpponentGames.push(...fallbackGames);
      
      console.log(`[Similar Players] Found ${allOpponentGames.length} games vs ${normalizedOpponent} (${cachedStats.length} cached, ${fallbackGames.length} from API)`);
    }
    
    // Initialize results array
    const results: any[] = [];
    
    // Get unique player IDs to fetch season averages from cache
    const uniquePlayerIds = Array.from(new Set(similarPlayers.map(s => s.player.id)));
    console.log(`[Similar Players] Fetching season averages from cache for ${uniquePlayerIds.length} players...`);
    
    // Fetch season averages from Supabase cache (INSTANT!)
    const seasonAveragesMap = new Map<number, any>();
    const season = currentNbaSeason();
    
    try {
      const { data: cachedAverages, error: avgError } = await getSupabaseAdmin()
        .from('player_season_averages')
        .select('*')
        .in('player_id', uniquePlayerIds)
        .eq('season', season);
      
      if (avgError) {
        if (avgError.code === 'PGRST205') {
          console.warn(`[Similar Players] player_season_averages table not found. Please run migration: migrations/create_player_season_averages_table.sql`);
        } else {
          console.error(`[Similar Players] Error fetching season averages from cache:`, avgError);
        }
      } else if (cachedAverages) {
        for (const avg of cachedAverages as Array<{ player_id: number; [key: string]: any }>) {
          seasonAveragesMap.set(avg.player_id, avg);
        }
        console.log(`[Similar Players] ✅ Loaded ${cachedAverages.length} season averages from cache (instant!)`);
      }
    } catch (error: any) {
      if (error?.code === 'PGRST205' || error?.message?.includes('player_season_averages')) {
        console.warn(`[Similar Players] player_season_averages table not found. Please run migration: migrations/create_player_season_averages_table.sql`);
      } else {
        console.error(`[Similar Players] Error accessing season averages cache:`, error);
      }
    }
    
    // Helper function to get season average for a stat type
    const getSeasonAverage = (playerId: number, statType: string): number | null => {
      const avg = seasonAveragesMap.get(playerId);
      if (!avg) return null;
      
      const statTypeLower = statType.toLowerCase();
      if (statTypeLower === 'pts') return avg.pts || null;
      if (statTypeLower === 'reb') return avg.reb || null;
      if (statTypeLower === 'ast') return avg.ast || null;
      if (statTypeLower === 'threes' || statTypeLower === 'fg3m') return avg.fg3m || null;
      // Calculate combo stats if not stored directly
      if (statTypeLower === 'pra') {
        if (avg.pra !== null && avg.pra !== undefined) return avg.pra;
        const pts = avg.pts || 0;
        const reb = avg.reb || 0;
        const ast = avg.ast || 0;
        return pts + reb + ast || null;
      }
      if (statTypeLower === 'pr') {
        if (avg.pr !== null && avg.pr !== undefined) return avg.pr;
        const pts = avg.pts || 0;
        const reb = avg.reb || 0;
        return pts + reb || null;
      }
      if (statTypeLower === 'pa') {
        if (avg.pa !== null && avg.pa !== undefined) return avg.pa;
        const pts = avg.pts || 0;
        const ast = avg.ast || 0;
        return pts + ast || null;
      }
      if (statTypeLower === 'ra') {
        if (avg.ra !== null && avg.ra !== undefined) return avg.ra;
        const reb = avg.reb || 0;
        const ast = avg.ast || 0;
        return reb + ast || null;
      }
      return null;
    };
    
    // Filter out players without season averages for the specific stat type - don't process them at all
    const playersWithStatAverage = new Set<number>();
    for (const similar of similarPlayers) {
      const avg = seasonAveragesMap.get(similar.player.id);
      if (!avg) continue; // Skip if no season average data at all
      
      const statTypeLower = statType.toLowerCase();
      let hasStat = false;
      
      // Check if the stat exists (either directly or can be calculated)
      if (statTypeLower === 'pts') hasStat = (avg.pts !== null && avg.pts !== undefined);
      else if (statTypeLower === 'reb') hasStat = (avg.reb !== null && avg.reb !== undefined);
      else if (statTypeLower === 'ast') hasStat = (avg.ast !== null && avg.ast !== undefined);
      else if (statTypeLower === 'threes' || statTypeLower === 'fg3m') hasStat = (avg.fg3m !== null && avg.fg3m !== undefined);
      else if (statTypeLower === 'pra') {
        // PRA can be calculated from pts + reb + ast
        hasStat = (avg.pts !== null && avg.pts !== undefined) && 
                  (avg.reb !== null && avg.reb !== undefined) && 
                  (avg.ast !== null && avg.ast !== undefined);
      }
      else if (statTypeLower === 'pr') {
        // PR can be calculated from pts + reb
        hasStat = (avg.pts !== null && avg.pts !== undefined) && 
                  (avg.reb !== null && avg.reb !== undefined);
      }
      else if (statTypeLower === 'pa') {
        // PA can be calculated from pts + ast
        hasStat = (avg.pts !== null && avg.pts !== undefined) && 
                  (avg.ast !== null && avg.ast !== undefined);
      }
      else if (statTypeLower === 'ra') {
        // RA can be calculated from reb + ast
        hasStat = (avg.reb !== null && avg.reb !== undefined) && 
                  (avg.ast !== null && avg.ast !== undefined);
      }
      
      if (hasStat) {
        playersWithStatAverage.add(similar.player.id);
      }
    }
    
    const filteredSimilarPlayers = similarPlayers.filter(s => playersWithStatAverage.has(s.player.id));
    const filteredOpponentGames = allOpponentGames.filter(({ similar }) => playersWithStatAverage.has(similar.player.id));
    
    if (filteredSimilarPlayers.length < similarPlayers.length) {
      const removed = similarPlayers.length - filteredSimilarPlayers.length;
      console.log(`[Similar Players] Filtered out ${removed} players without season averages for ${statType}`);
    }
    
    // Process games and use season averages only (only for players with averages)
    for (const { game, similar } of filteredOpponentGames) {
      const gameDate = game.game?.date;
      if (!gameDate) continue;
      
      // Get stat value based on statType
      let statValue = 0;
      const statTypeLower = statType.toLowerCase();
      if (statTypeLower === 'pts') statValue = game.pts || 0;
      else if (statTypeLower === 'reb') statValue = game.reb || 0;
      else if (statTypeLower === 'ast') statValue = game.ast || 0;
      else if (statTypeLower === 'threes' || statTypeLower === 'fg3m') statValue = game.fg3m || 0;
      else if (statTypeLower === 'pra') statValue = (game.pts || 0) + (game.reb || 0) + (game.ast || 0);
      else if (statTypeLower === 'pr') statValue = (game.pts || 0) + (game.reb || 0);
      else if (statTypeLower === 'pa') statValue = (game.pts || 0) + (game.ast || 0);
      else if (statTypeLower === 'ra') statValue = (game.reb || 0) + (game.ast || 0);
      else statValue = game[statTypeLower] || 0;
      
      // Filter out players with total 0
      if (statValue === 0) {
        continue;
      }
      
      // Get actual player height
      const playerHeightInches = similar.player.height_inches ?? heightToInches(similar.player.height);
      
      // Get season average for the stat
      const seasonAvg = getSeasonAverage(similar.player.id, statType);
      
      // Skip if no season average (shouldn't happen due to filtering, but safety check)
      if (seasonAvg === null || seasonAvg === undefined) {
        continue;
      }
      
      results.push({
        playerId: similar.player.id,
        playerName: `${similar.player.first_name} ${similar.player.last_name}`,
        gameDate,
        opponent: normalizedOpponent,
        playerTeam: similar.player.team?.abbreviation || '', // Player's team abbreviation
        headshotUrl: similar.player.headshot_url || null, // Headshot URL from cached player data
        statType,
        line: seasonAvg, // Only use season average
        overOdds: null,
        underOdds: null,
        actual: statValue,
        similarityScore: similar.similarityScore,
        heightDiff: similar.heightDiff,
        playerHeight: playerHeightInches, // Add actual player height in inches
        playTypeMatches: similar.playTypeMatches,
        minutesDiff: similar.minutesDiff,
      });
    }
    
    // Sort by game date (most recent first), then by similarity score as tiebreaker
    results.sort((a, b) => {
      const dateA = new Date(a.gameDate).getTime();
      const dateB = new Date(b.gameDate).getTime();
      // Most recent first
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      // If same date, use similarity score as tiebreaker (lower = more similar)
      return a.similarityScore - b.similarityScore;
    });
    
    console.log(`[Similar Players] Returning ${results.length} results`);
    
    return NextResponse.json({
      success: true,
      data: results,
      targetPlayer: {
        id: targetPlayer.id,
        name: `${targetPlayer.first_name} ${targetPlayer.last_name}`,
        position: targetPosition,
        height: targetHeightInches,
        playTypes: targetPlayTypes,
        minutes: targetMinutes,
      },
    });
  } catch (error: any) {
    console.error('[Similar Players] Error finding similar players:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Internal server error',
        data: []
      },
      { status: 500 }
    );
  }
}

