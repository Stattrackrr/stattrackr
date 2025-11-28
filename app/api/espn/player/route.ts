export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import cache, { CACHE_TTL } from "@/lib/cache";

export const runtime = "nodejs";

// Normalize ESPN team codes and common synonyms to a canonical key for filtering
function normalizeEspnTeamCode(s: string | null | undefined): string {
  const v = (s || '').toString().trim().toLowerCase();
  if (!v) return '';
  // Pelicans variants -> 'no'
  const pelicans = new Set(['no', 'nop', 'noh', 'nok', 'nor', 'nola', 'new orleans', 'new-orleans', 'pelicans', 'new orleans pelicans']);
  if (pelicans.has(v)) return 'no';
  // Jazz variants -> 'uta'
  const jazz = new Set(['uta', 'utah', 'jazz', 'utah jazz', 'utah-jazz']);
  if (jazz.has(v)) return 'uta';
  return v;
}

// ESPN player lookup by name
export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }
  
  const { searchParams } = new URL(req.url);
  
  const playerName = searchParams.get("name")?.trim();
  const team = searchParams.get("team")?.trim()?.toLowerCase();
  
  if (!playerName) {
    return NextResponse.json(
      { error: "Player name is required", data: null },
      { status: 400 }
    );
  }
  
  // Check cache first
  const cacheKey = `espn_player_${playerName.toLowerCase()}_${team || 'any'}`;
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log(`✅ ESPN player cache HIT for ${playerName}`);
    return NextResponse.json({ data: cachedResult });
  }
  
  try {
    console.log(`🌐 Fetching ESPN player data for ${playerName}`);
    // ESPN NBA teams endpoint to get roster data
    const teamsResponse = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams");
    const teamsData = await teamsResponse.json();
    
    if (!teamsData?.sports?.[0]?.leagues?.[0]?.teams) {
      return NextResponse.json(
        { error: "Failed to fetch teams data", data: null },
        { status: 500 }
      );
    }
    
    const teams = teamsData.sports[0].leagues[0].teams;
    let foundPlayer = null;
    
    // Filter teams if team parameter provided (check multiple fields for better matching)
    const teamsToSearch = team
      ? teams.filter((teamData: any) => {
          const filterCanon = normalizeEspnTeamCode(team);
          if (!filterCanon) return false;
          
          // Check multiple fields: abbreviation, shortDisplayName, name, displayName
          const abbr = normalizeEspnTeamCode(teamData.team?.abbreviation);
          const shortName = normalizeEspnTeamCode(teamData.team?.shortDisplayName);
          const name = normalizeEspnTeamCode(teamData.team?.name);
          const displayName = normalizeEspnTeamCode(teamData.team?.displayName);
          
          return filterCanon === abbr || filterCanon === shortName || filterCanon === name || filterCanon === displayName;
        })
      : teams;
    
    // Fetch all rosters in parallel
    const rosterPromises = teamsToSearch.map((teamData: any) =>
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamData.team.id}/roster`)
        .then((res) => res.json())
        .catch(() => ({ athletes: [] }))
        .then((rosterData) => ({
          teamInfo: teamData.team,
          athletes: rosterData?.athletes || [],
        }))
    );
    
    const rosterResults = await Promise.all(rosterPromises);
    
    // Search through all results for player
    for (const { teamInfo, athletes } of rosterResults) {
      if (foundPlayer) break;
      
      for (const athlete of athletes) {
        const fullName = athlete.fullName || `${athlete.firstName || ''} ${athlete.lastName || ''}`.trim();
        
        if (fullName.toLowerCase().includes(playerName.toLowerCase()) || 
            playerName.toLowerCase().includes(fullName.toLowerCase())) {
          
          foundPlayer = {
            name: fullName,
            firstName: athlete.firstName,
            lastName: athlete.lastName,
            jersey: athlete.jersey,
            height: athlete.height,
            weight: athlete.weight,
            team: teamInfo.abbreviation,
            teamName: teamInfo.displayName,
            position: athlete.position?.abbreviation,
            espnId: athlete.id,
          };
          
          // Exact match gets priority
          if (fullName.toLowerCase() === playerName.toLowerCase()) {
            break;
          }
        }
      }
    }
    
    if (!foundPlayer) {
      return NextResponse.json(
        { error: `Player "${playerName}" not found`, data: null },
        { status: 404 }
      );
    }
    
    // Cache successful result for 24 hours
    cache.set(cacheKey, foundPlayer, CACHE_TTL.ESPN_PLAYER);
    console.log(`💾 ESPN player data cached for ${playerName}`);
    
    return NextResponse.json({
      data: foundPlayer
    });
    
  } catch (error: any) {
    console.error("ESPN player lookup error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch player data", data: null },
      { status: 500 }
    );
  }
}
