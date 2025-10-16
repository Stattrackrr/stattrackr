// app/api/stats/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BDL_BASE = "https://api.balldontlie.io/v1";
// Optional: set in your .env.local
// BALLDONTLIE_API_KEY=<your key for paid tier or v2 proxy if you have one>
const API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Builds a BallDon'tLie URL for stats
 * We use array-style params so it works across BDL versions that accept it.
 */
function buildStatsUrl(playerId: string, season: number, page = 1, perPage = 40, postseason = false) {
  const url = new URL(`${BDL_BASE}/stats`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.append("player_ids[]", String(playerId));
  url.searchParams.append("seasons[]", String(season));
  // Include postseason filter when requested
  url.searchParams.set("postseason", postseason ? "true" : "false");
  return url;
}

async function bdlFetch(url: URL) {
  // Some deployments require a Bearer token, some don’t (public tier).
  const headers: Record<string, string> = {};
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  // If BDL returns a rate-limit message or 4xx, surface it gracefully
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`BallDon'tLie ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get("player_id");
    const seasonParam = searchParams.get("season");
    const perPageParam = Number(searchParams.get("per_page") || 40);
    const maxPages = Number(searchParams.get("max_pages") || 3); // cap requests
    const postseason = (searchParams.get("postseason") || "false").toLowerCase() === "true";

    if (!playerId) {
      return NextResponse.json(
        { error: "Missing required query param: player_id" },
        { status: 400 }
      );
    }

    // Default to a safe recent season if not provided
    const season = Number(seasonParam || 2023);

    const all: any[] = [];
    let page = 1;

    while (page <= maxPages) {
      const url = buildStatsUrl(playerId, season, page, perPageParam, postseason);
      const json = await bdlFetch(url);

      // Expect shape: { data: [], meta: { next_page, total_pages, current_page } }
      const batch = Array.isArray(json?.data) ? json.data : [];
      all.push(...batch);

      const nextPage =
        json?.meta?.next_page ?? (json?.meta?.current_page < json?.meta?.total_pages ? page + 1 : null);

      if (!nextPage) break;
      page = nextPage;
    }

    return NextResponse.json({ data: all }, { status: 200 });
  } catch (err: any) {
    // Never throw raw – always return a JSON error so the client can show it
    return NextResponse.json(
      { error: err?.message || "Internal error fetching stats" },
      { status: 200 } // Return 200 with an error payload so your client can render “No data”
    );
  }
}
