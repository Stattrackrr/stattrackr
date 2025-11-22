export const dynamic = 'force-dynamic';

// app/api/tracking-stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const NBA_BASE = "https://stats.nba.com/stats";

// Proper headers to avoid getting blocked
const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/stats/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};

function getCurrentSeasonYear(): number {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  // NBA season starts mid-October
  if (month === 9 && day >= 15) return now.getFullYear();
  return month >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

function formatSeason(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

async function nbaFetch(pathAndQuery: string, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  
  try {
    const url = `${NBA_BASE}/${pathAndQuery}`;
    console.log(`[NBA API] Fetching: ${url}`);
    
    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const res = await fetch(url, { 
      headers: NBA_HEADERS, 
      cache: "no-store",
      signal: ctrl.signal 
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[NBA API] Error ${res.status}:`, text);
      throw new Error(`NBA API ${res.status}: ${text || res.statusText}`);
    }
    
    const data = await res.json();
    console.log(`[NBA API] Success for: ${pathAndQuery}`);
    return data;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - NBA API took too long to respond');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/tracking-stats
 * 
 * Query params:
 * - player_id: NBA player ID (required)
 * - season: Season year (optional, defaults to current)
 * - per_mode: PerGame, Totals, or Per36 (optional, defaults to PerGame)
 * - season_type: Regular Season or Playoffs (optional, defaults to Regular Season)
 * 
 * Returns tracking stats including:
 * - Potential Assists (PASSES_MADE, PASSES_RECEIVED, AST_POINTS_CREATED, AST_ADJ, etc.)
 * - Contested Rebounds
 * - And more tracking data
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }

  try {
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get("player_id");
    
    if (!playerId) {
      return NextResponse.json(
        { error: "Missing required query param: player_id" },
        { status: 400 }
      );
    }

    const seasonYear = searchParams.get("season") 
      ? parseInt(searchParams.get("season")!) 
      : getCurrentSeasonYear();
    
    const season = formatSeason(seasonYear);
    const perMode = searchParams.get("per_mode") || "PerGame";
    const seasonType = searchParams.get("season_type") || "Regular Season";

    console.log(`[Tracking Stats] Fetching for player ${playerId}, season ${season}`);

    // Use LEAGUE-WIDE endpoint (same as stats.nba.com website)
    // Then filter for specific player
    
    // Fetch tracking passing stats for potential assists
    let passingData = null;
    try {
      // NBA API requires ALL these parameters (even if empty)
      const passingParams = new URLSearchParams({
        College: "",
        Conference: "",
        Country: "",
        DateFrom: "",
        DateTo: "",
        Division: "",
        DraftPick: "",
        DraftYear: "",
        GameScope: "",
        Height: "",
        LastNGames: "0",
        LeagueID: "00",
        Location: "",
        Month: "0",
        OpponentTeamID: "0",
        Outcome: "",
        PORound: "0",
        PerMode: perMode,
        PlayerExperience: "",
        PlayerOrTeam: "Player",
        PlayerPosition: "",
        PtMeasureType: "Passing",
        Season: season,
        SeasonSegment: "",
        SeasonType: seasonType,
        StarterBench: "",
        TeamID: "0",
        VsConference: "",
        VsDivision: "",
        Weight: "",
      });
      
      passingData = await nbaFetch(`leaguedashptstats?${passingParams.toString()}`);
      console.log("[Tracking Stats] Passing data fetched successfully");
    } catch (err: any) {
      console.error("[Tracking Stats] Could not fetch passing data:", err.message);
    }

    // Fetch rebounding tracking stats
    let reboundingData = null;
    try {
      // NBA API requires ALL these parameters (even if empty)
      const reboundingParams = new URLSearchParams({
        College: "",
        Conference: "",
        Country: "",
        DateFrom: "",
        DateTo: "",
        Division: "",
        DraftPick: "",
        DraftYear: "",
        GameScope: "",
        Height: "",
        LastNGames: "0",
        LeagueID: "00",
        Location: "",
        Month: "0",
        OpponentTeamID: "0",
        Outcome: "",
        PORound: "0",
        PerMode: perMode,
        PlayerExperience: "",
        PlayerOrTeam: "Player",
        PlayerPosition: "",
        PtMeasureType: "Rebounding",
        Season: season,
        SeasonSegment: "",
        SeasonType: seasonType,
        StarterBench: "",
        TeamID: "0",
        VsConference: "",
        VsDivision: "",
        Weight: "",
      });
      
      reboundingData = await nbaFetch(`leaguedashptstats?${reboundingParams.toString()}`);
      console.log("[Tracking Stats] Rebounding data fetched successfully");
    } catch (err: any) {
      console.error("[Tracking Stats] Could not fetch rebounding data:", err.message);
    }
    
    // Base stats not needed for tracking stats
    const data = null;

    // Parse the NBA API response format and filter for specific player
    const parseNBAResponse = (response: any, targetPlayerId: string) => {
      if (!response?.resultSets?.[0]) {
        console.warn("[Tracking Stats] No resultSets in response");
        return null;
      }
      
      const resultSet = response.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];
      
      if (rows.length === 0) {
        console.warn("[Tracking Stats] No rows in response");
        return null;
      }
      
      // Find PLAYER_ID column index
      const playerIdIdx = headers.findIndex((h: string) => 
        h === "PLAYER_ID" || h.toUpperCase() === "PLAYER_ID"
      );
      
      if (playerIdIdx === -1) {
        console.warn("[Tracking Stats] No PLAYER_ID column found in headers:", headers);
        return null;
      }
      
      // Find the specific player's row
      const playerRow = rows.find((row: any[]) => 
        String(row[playerIdIdx]) === String(targetPlayerId)
      );
      
      if (!playerRow) {
        // Log first few player IDs to help debug
        const sampleIds = rows.slice(0, 5).map((r: any[]) => r[playerIdIdx]);
        console.warn(`[Tracking Stats] Player ${targetPlayerId} not found in ${rows.length} rows. Sample IDs: ${sampleIds.join(', ')}`);
        
        // Try finding by player name as fallback
        const playerNameIdx = headers.findIndex((h: string) => 
          h === "PLAYER_NAME" || h.toUpperCase() === "PLAYER_NAME"
        );
        
        if (playerNameIdx !== -1) {
          // Log all player names to help identify the issue
          console.log(`[Tracking Stats] Available players (first 10):`, rows.slice(0, 10).map((r: any[]) => `${r[playerNameIdx]} (ID: ${r[playerIdIdx]})`));
        }
        
        return null;
      }
      
      // Convert to object
      const stats: Record<string, any> = {};
      headers.forEach((header: string, idx: number) => {
        stats[header] = playerRow[idx];
      });
      
      console.log(`[Tracking Stats] Found player! Parsed ${Object.keys(stats).length} stat fields`);
      console.log(`[Tracking Stats] Available stat fields:`, Object.keys(stats).join(', '));
      return stats;
    };

    const baseStats = null; // Not using base stats
    const passingStats = parseNBAResponse(passingData, playerId);
    const reboundingStats = parseNBAResponse(reboundingData, playerId);

    // Check if we got at least some data
    if (!baseStats && !passingStats && !reboundingStats) {
      console.error("[Tracking Stats] No data found for player");
      return NextResponse.json({
        error: "No tracking stats found for this player",
        details: `Player ID ${playerId} has no available tracking stats for ${season} ${seasonType}`,
        player_id: playerId,
        season,
      }, { status: 404 });
    }

    console.log("[Tracking Stats] Successfully returning data");
    return NextResponse.json({
      player_id: playerId,
      season,
      per_mode: perMode,
      season_type: seasonType,
      base_stats: baseStats,
      passing_stats: passingStats,
      rebounding_stats: reboundingStats,
    }, { 
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200'
      }
    });

  } catch (err: any) {
    console.error("[Tracking Stats API] Error:", err);
    
    // Return more helpful error messages
    const errorMessage = err?.message || "Internal error fetching tracking stats";
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('AbortError');
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('rate limit');
    
    return NextResponse.json(
      { 
        error: isTimeout 
          ? "Request timed out - NBA API is slow to respond" 
          : isRateLimit 
          ? "Too many requests - please wait a moment and try again"
          : errorMessage,
        details: isTimeout 
          ? "The NBA Stats API is taking too long to respond. Try again in a few seconds."
          : isRateLimit
          ? "We've made too many requests to the NBA API. Please wait 30 seconds and refresh."
          : "Failed to fetch NBA tracking statistics. The API might be temporarily unavailable or the player data is not available for this season."
      },
      { status: 500 }
    );
  }
}

