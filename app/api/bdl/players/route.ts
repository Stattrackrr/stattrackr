export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

export const runtime = "nodejs";

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  return h;
}

function normalizePlayer(p: any) {
  return {
    id: p?.id,
    full: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim(),
    team: p?.team?.abbreviation ?? "",
    pos: p?.position ?? "",
  };
}

/**
 * Fetch pages from /players/active using cursor-based pagination.
 * - maxHops controls how many cursors we follow (safety cap).
 */
async function fetchActivePaged(url: URL, maxHops = 10) {
  const all: any[] = [];
  let hops = 0;
  let cursor: string | null = url.searchParams.get("cursor");

  while (hops < maxHops) {
    if (cursor) url.searchParams.set("cursor", cursor);
    else url.searchParams.delete("cursor");

    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BDL ${res.status}: ${text || res.statusText}`);
    }

    const json = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    all.push(...data);

    const nextCursor = json?.meta?.next_cursor ?? null;
    if (!nextCursor) break;

    cursor = String(nextCursor);
    hops += 1;
  }

  return all;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") || "").trim(); // name search
  const team = (searchParams.get("team") || "").trim(); // optional team abbr filter
  const perPage = Math.min(parseInt(searchParams.get("per_page") || "25", 10) || 25, 100);
  const cursor = searchParams.get("cursor") || ""; // pass-through for client-controlled paging
  const all = (searchParams.get("all") || "false").toLowerCase() === "true"; // crawl multiple cursors
  const maxHops = Math.min(parseInt(searchParams.get("max_hops") || "10", 10) || 10, 60);

  try {
    // -------- ALL ACTIVE (server-side crawl) --------
    if (all) {
      const cacheKey = `all_active_players_${team || 'all'}_${q || 'all'}`;
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(cachedData);
      }

      const url = new URL(`${BDL_BASE}/players/active`);
      url.searchParams.set("per_page", String(perPage));
      // You can optionally add name filter while crawling:
      if (q) url.searchParams.set("search", q);

      const data = await fetchActivePaged(url, maxHops);
      let results = data.map(normalizePlayer).filter((p: any) => p.id && p.full);

      if (team) {
        const T = team.toUpperCase();
        results = results.filter((p: any) => (p.team || "").toUpperCase() === T);
      }

      const responseData = { results, best: null };
      cache.set(cacheKey, responseData, CACHE_TTL.PLAYER_SEARCH);
      return NextResponse.json(responseData, { status: 200 });
    }

    // -------- SEARCH ACTIVE --------
    // Check cache for search queries (not for cursor-based pagination)
    if (q && !cursor) {
      const cacheKey = getCacheKey.playerSearch(q + (team ? `_${team}` : ''));
      const cachedData = cache.get(cacheKey);
      if (cachedData) {
        return NextResponse.json(cachedData);
      }
    }
    
    // One-shot (or client controls next cursor)
    const url = new URL(`${BDL_BASE}/players/active`);
    url.searchParams.set("per_page", String(perPage));
    if (q) url.searchParams.set("search", q);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `BDL ${res.status}: ${text || res.statusText}`, results: [], best: null },
        { status: 200 }
      );
    }

    const json = await res.json();
    // Limit to 20 results immediately for faster frontend rendering
    let results = (Array.isArray(json?.data) ? json.data : []).slice(0, 20).map(normalizePlayer).filter((p: any) => p.id && p.full);

    if (team) {
      const T = team.toUpperCase();
      results = results.filter((p: any) => (p.team || "").toUpperCase() === T);
    }

    const qLower = q.toLowerCase();
    const best =
      (q
        ? results.find((r: any) => r.full.toLowerCase() === qLower) ||
          results.find((r: any) => r.full.toLowerCase().startsWith(qLower)) ||
          results[0]
        : results[0]) || null;

    // If you want to expose next cursor back to the client:
    const next_cursor = json?.meta?.next_cursor ?? null;
    
    const responseData = { results, best, next_cursor };
    
    // Cache search responses (but not cursor-based pagination)
    if (q && !cursor) {
      const cacheKey = getCacheKey.playerSearch(q + (team ? `_${team}` : ''));
      cache.set(cacheKey, responseData, CACHE_TTL.PLAYER_SEARCH);
    }

    return NextResponse.json(responseData, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "players fetch failed", results: [], best: null },
      { status: 200 }
    );
  }
}
