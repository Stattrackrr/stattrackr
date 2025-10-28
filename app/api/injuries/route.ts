import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const revalidate = 3600; // Cache for 1 hour

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

// Team ID mapping for balldontlie API (these are the BDL team IDs)
const TEAM_ID_MAP: Record<string, number> = {
  ATL: 1, BOS: 2, BKN: 3, CHA: 4, CHI: 5, CLE: 6, DAL: 7, DEN: 8, DET: 9,
  GSW: 10, HOU: 11, IND: 12, LAC: 13, LAL: 14, MEM: 15, MIA: 16, MIL: 17,
  MIN: 18, NOP: 19, NYK: 20, OKC: 21, ORL: 22, PHI: 23, PHX: 24, POR: 25,
  SAC: 26, SAS: 27, TOR: 28, UTA: 29, WAS: 30
};

interface InjuryData {
  player: {
    id: number;
    first_name: string;
    last_name: string;
    position: string;
    height: string;
    weight: string;
    jersey_number: string;
    college: string;
    country: string;
    draft_year: number;
    draft_round: number;
    draft_number: number;
    team_id: number;
  };
  return_date: string | null;
  description: string;
  status: string;
}

function normalizeInjury(injury: any): InjuryData {
  return {
    player: {
      id: injury?.player?.id || 0,
      first_name: injury?.player?.first_name || "",
      last_name: injury?.player?.last_name || "",
      position: injury?.player?.position || "",
      height: injury?.player?.height || "",
      weight: injury?.player?.weight || "",
      jersey_number: injury?.player?.jersey_number || "",
      college: injury?.player?.college || "",
      country: injury?.player?.country || "",
      draft_year: injury?.player?.draft_year || 0,
      draft_round: injury?.player?.draft_round || 0,
      draft_number: injury?.player?.draft_number || 0,
      team_id: injury?.player?.team_id || 0,
    },
    return_date: injury?.return_date || null,
    description: injury?.description || "",
    status: injury?.status || "Unknown"
  };
}

/**
 * Fetch injuries with pagination support
 */
async function fetchInjuriesPaged(teamIds: number[], maxPages = 10) {
  const allInjuries: any[] = [];
  let currentPage = 1;
  
  while (currentPage <= maxPages) {
    const url = new URL(`${BDL_BASE}/player_injuries`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", currentPage.toString());
    
    // Add team filter if specified
    if (teamIds.length > 0) {
      // BallDontLie API expects multiple team_ids[] parameters
      teamIds.forEach(id => {
        url.searchParams.append("team_ids[]", id.toString());
      });
    }

    const res = await fetch(url, { 
      headers: authHeaders(), 
      next: { revalidate: 3600 } // Cache for 1 hour
    });

    if (!res.ok) {
      const text = await res.text();
      
      // Handle rate limiting gracefully
      if (res.status === 429) {
        console.warn(`Rate limited by BDL API. Returning partial data if available.`);
        // Return what we have so far instead of throwing
        return allInjuries;
      }
      
      throw new Error(`BDL ${res.status}: ${text || res.statusText}`);
    }

    const json = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    
    if (data.length === 0) break; // No more data
    
    allInjuries.push(...data);
    
    // Check if there are more pages
    const meta = json?.meta;
    if (!meta?.next_page || currentPage >= (meta?.total_pages || 1)) {
      break;
    }
    
    currentPage++;
  }

  return allInjuries;
}

export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }
  
  const { searchParams } = new URL(req.url);
  
  // Support both team abbreviations and team IDs
  const teams = searchParams.get("teams")?.split(",") || [];
  const teamIds = searchParams.get("team_ids")?.split(",").map(id => parseInt(id)) || [];
  const perPage = Math.min(parseInt(searchParams.get("per_page") || "25", 10) || 25, 100);

  try {
    // Convert team abbreviations to team IDs
    const resolvedTeamIds: number[] = [];
    
    // Add team IDs from abbreviations
    for (const team of teams) {
      const teamAbbr = team.trim().toUpperCase();
      const teamId = TEAM_ID_MAP[teamAbbr];
      if (teamId) {
        resolvedTeamIds.push(teamId);
      }
    }
    
    // Add direct team IDs
    resolvedTeamIds.push(...teamIds.filter(id => !isNaN(id)));
    
    // Remove duplicates
    const uniqueTeamIds = [...new Set(resolvedTeamIds)];

    console.log(`Fetching injuries for team IDs: ${uniqueTeamIds.join(", ")}`);

    // Fetch all injuries for the specified teams
    const allInjuries = await fetchInjuriesPaged(uniqueTeamIds);
    
    // Normalize the injury data
    const normalizedInjuries = allInjuries.map(normalizeInjury);
    
    // Group by team for easier frontend consumption
    const injuriesByTeam: Record<string, InjuryData[]> = {};
    
    // Get team abbreviations for grouping (reverse lookup)
    const teamIdToAbbr: Record<number, string> = {};
    Object.entries(TEAM_ID_MAP).forEach(([abbr, id]) => {
      teamIdToAbbr[id] = abbr;
    });
    
    normalizedInjuries.forEach(injury => {
      const teamAbbr = teamIdToAbbr[injury.player.team_id] || `TEAM_${injury.player.team_id}`;
      if (!injuriesByTeam[teamAbbr]) {
        injuriesByTeam[teamAbbr] = [];
      }
      injuriesByTeam[teamAbbr].push(injury);
    });

    return NextResponse.json({
      success: true,
      total: normalizedInjuries.length,
      injuries: normalizedInjuries.slice(0, perPage),
      injuriesByTeam,
      requestedTeams: uniqueTeamIds.map(id => teamIdToAbbr[id]).filter(Boolean)
    });

  } catch (error: any) {
    console.error("Injuries fetch error:", error);
    
    // Check if it's a rate limit error
    const isRateLimit = error?.message?.includes('429');
    
    return NextResponse.json({
      success: false,
      error: isRateLimit 
        ? "Rate limit reached. Please try again in a few moments." 
        : error?.message || "Failed to fetch injuries",
      injuries: [],
      injuriesByTeam: {},
      requestedTeams: [],
      rateLimited: isRateLimit
    }, { status: isRateLimit ? 429 : 500 });
  }
}