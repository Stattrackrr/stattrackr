export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { getNBACache } from "@/lib/nbaCache";
import cache from "@/lib/cache";
import type { OddsCache } from "@/app/api/odds/refresh/route";

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

export async function GET(req: NextRequest) {
  try {
    // Get bulk cached odds data
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
    });
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      oddsCache = cache.get(ODDS_CACHE_KEY);
    }
    
    if (!oddsCache || !oddsCache.games || oddsCache.games.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No odds data in cache. Please refresh odds first.',
        bookmakers: [],
      });
    }
    
    // Collect all unique bookmakers from game odds and player props
    const gameBookmakers = new Set<string>();
    const playerPropsBookmakers = new Set<string>();
    const allBookmakers = new Set<string>();
    
    for (const game of oddsCache.games) {
      // Game odds bookmakers
      for (const bookmaker of game.bookmakers || []) {
        if (bookmaker.name) {
          gameBookmakers.add(bookmaker.name);
          allBookmakers.add(bookmaker.name);
        }
      }
      
      // Player props bookmakers
      if (game.playerPropsByBookmaker) {
        for (const bookmakerName of Object.keys(game.playerPropsByBookmaker)) {
          playerPropsBookmakers.add(bookmakerName);
          allBookmakers.add(bookmakerName);
        }
      }
    }
    
    // Sort alphabetically
    const sortedBookmakers = Array.from(allBookmakers).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    
    const sortedGameBookmakers = Array.from(gameBookmakers).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    
    const sortedPlayerPropsBookmakers = Array.from(playerPropsBookmakers).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    
    return NextResponse.json({
      success: true,
      totalUnique: allBookmakers.size,
      totalGames: oddsCache.games.length,
      lastUpdated: oddsCache.lastUpdated,
      nextUpdate: oddsCache.nextUpdate,
      bookmakers: sortedBookmakers,
      gameOddsBookmakers: sortedGameBookmakers,
      playerPropsBookmakers: sortedPlayerPropsBookmakers,
      breakdown: {
        gameOddsOnly: sortedGameBookmakers.filter(b => !playerPropsBookmakers.has(b)),
        playerPropsOnly: sortedPlayerPropsBookmakers.filter(b => !gameBookmakers.has(b)),
        both: sortedBookmakers.filter(b => gameBookmakers.has(b) && playerPropsBookmakers.has(b)),
      }
    });
  } catch (error: any) {
    console.error('[list-bookmakers] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to list bookmakers' },
      { status: 500 }
    );
  }
}

