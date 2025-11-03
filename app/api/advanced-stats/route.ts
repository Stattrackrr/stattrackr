export const dynamic = 'force-dynamic';

// app/api/advanced-stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Builds a Ball Don't Lie URL for advanced stats
 */
function buildAdvancedStatsUrl(playerIds: number[], season?: string, postseason = false) {
  const url = new URL(`${BDL_BASE}/stats/advanced`);
  
  // Add player IDs
  playerIds.forEach(id => url.searchParams.append('player_ids[]', id.toString()));
  
  // Add optional parameters
  if (season) {
    url.searchParams.append('seasons[]', season);
  }
  
  url.searchParams.set('postseason', postseason.toString());
  
  return url;
}

async function bdlFetch(url: URL) {
  const headers: Record<string, string> = {};
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`BallDontLie ${res.status}: ${txt || res.statusText}`);
  }
  
  return res.json();
}

export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }

  try {
    const { searchParams } = new URL(req.url);
    
    // Get player IDs (can be comma-separated)
    const playerIdsParam = searchParams.get("player_ids");
    if (!playerIdsParam) {
      return NextResponse.json(
        { error: "Missing required query param: player_ids" },
        { status: 400 }
      );
    }
    
    const playerIds = playerIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    if (playerIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid player_ids format" },
        { status: 400 }
      );
    }
    
    const season = searchParams.get("season") || undefined;
    const postseason = searchParams.get("postseason") === "true";
    
    const url = buildAdvancedStatsUrl(playerIds, season, postseason);
    const json = await bdlFetch(url);
    
    return NextResponse.json(json, { status: 200 });
  } catch (err: any) {
    console.error("Advanced stats API error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error fetching advanced stats" },
      { status: 500 }
    );
  }
}
