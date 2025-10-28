import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

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
  
  try {
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
    
    // Search through all team rosters
    for (const teamData of teams) {
      const teamInfo = teamData.team;
      const teamAbbr = teamInfo?.abbreviation?.toLowerCase();
      
      // If team filter is provided, only search that team (with alias normalization)
      if (team) {
        const filterCanon = normalizeEspnTeamCode(team);
        const teamCanon = normalizeEspnTeamCode(teamAbbr);
        if (filterCanon && teamCanon && teamCanon !== filterCanon) {
          continue;
        }
      }
      
      try {
        // Get roster for this team
        const rosterResponse = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamInfo.id}/roster`);
        const rosterData = await rosterResponse.json();
        
        const athletes = rosterData?.athletes || [];
        
        // Search for player in this team's roster
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
        
        if (foundPlayer) {
          break;
        }
      } catch (teamError) {
        // Continue to next team if this one fails
        console.warn(`Failed to fetch roster for team ${teamInfo.id}:`, teamError);
        continue;
      }
    }
    
    if (!foundPlayer) {
      return NextResponse.json(
        { error: `Player "${playerName}" not found`, data: null },
        { status: 404 }
      );
    }
    
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