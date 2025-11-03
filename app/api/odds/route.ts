export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';
import { checkRateLimit } from '@/lib/rateLimit';
import { gameInvolvesTeam } from '@/lib/teamMapping';

export interface BookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  PTS: { line: string; over: string; under: string };
  REB: { line: string; over: string; under: string };
  AST: { line: string; over: string; under: string };
}

interface OddsCache {
  games: any[];
  lastUpdated: string;
  nextUpdate: string;
}

const ODDS_CACHE_KEY = 'all_nba_odds';

export async function GET(request: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }

  try {
    const { searchParams } = new URL(request.url);
    const player = searchParams.get('player');
    const team = searchParams.get('team');
    
    // Get bulk cached odds data
    const oddsCache: OddsCache | null = cache.get(ODDS_CACHE_KEY);
    
    // Debug: Check cache status
    const stats = cache.getStats();
    console.log('Cache stats:', { totalEntries: stats.totalEntries, validEntries: stats.validEntries, keys: stats.keys.slice(0, 5) });
    
    if (!oddsCache) {
      console.warn('No odds data in cache - bulk refresh may not have run yet');
      console.log('Available cache keys:', cache.keys());
      return NextResponse.json({
        success: false,
        error: 'Odds data not available - waiting for refresh',
        data: []
      });
    }
    
    // If team is provided, find game odds for that matchup
    if (team) {
      const game = oddsCache.games.find((g: any) => 
        gameInvolvesTeam(g.homeTeam, g.awayTeam, team)
      );
      
      if (!game) {
        console.log(`No game found for team: ${team}. Available games:`, oddsCache.games.map((g: any) => `${g.homeTeam} vs ${g.awayTeam}`));
        return NextResponse.json({
          success: true,
          data: [],
          message: 'No game found for team'
        });
      }
      
      return NextResponse.json({
        success: true,
        data: game.bookmakers || [],
        lastUpdated: oddsCache.lastUpdated,
        nextUpdate: oddsCache.nextUpdate
      });
    }
    
    // If player is provided, find their props across all games
    if (player) {
      // Search all games for this player's props
      for (const game of oddsCache.games) {
        const playerPropsByBookmaker = game.playerPropsByBookmaker || {};
        
        // Check if this player has props in any bookmaker
        const hasPlayerProps = Object.values(playerPropsByBookmaker).some(
          (bookmakerProps: any) => bookmakerProps[player]
        );
        
        if (hasPlayerProps) {
          // Convert player props to BookRow format - only include bookmakers that have props for this player
          const bookRows: any[] = [];
          
          for (const book of game.bookmakers) {
            const bookmakerProps = playerPropsByBookmaker[book.name]?.[player];
            
            // Only include this bookmaker if they have at least one prop for this player
            if (bookmakerProps && Object.keys(bookmakerProps).length > 0) {
              bookRows.push({
                ...book,
                PTS: bookmakerProps.PTS || { line: 'N/A', over: 'N/A', under: 'N/A' },
                REB: bookmakerProps.REB || { line: 'N/A', over: 'N/A', under: 'N/A' },
                AST: bookmakerProps.AST || { line: 'N/A', over: 'N/A', under: 'N/A' },
                THREES: bookmakerProps.THREES || { line: 'N/A', over: 'N/A', under: 'N/A' },
                PRA: bookmakerProps.PRA || { line: 'N/A', over: 'N/A', under: 'N/A' },
                PR: bookmakerProps.PR || { line: 'N/A', over: 'N/A', under: 'N/A' },
                PA: bookmakerProps.PA || { line: 'N/A', over: 'N/A', under: 'N/A' },
                RA: bookmakerProps.RA || { line: 'N/A', over: 'N/A', under: 'N/A' },
              });
            }
          }
          
          return NextResponse.json({
            success: true,
            data: bookRows,
            lastUpdated: oddsCache.lastUpdated,
            nextUpdate: oddsCache.nextUpdate
          });
        }
      }
      
      // Player not found in any game
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No props found for player'
      });
    }
    
    // No specific query - return all games
    return NextResponse.json({
      success: true,
      data: oddsCache.games,
      lastUpdated: oddsCache.lastUpdated,
      nextUpdate: oddsCache.nextUpdate
    });

  } catch (error) {
    console.error('Error fetching odds:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch odds',
      data: []
    }, { status: 500 });
  }
}

/**
 * Transform odds API response to BookRow format
 * This will need to be implemented based on your specific odds API structure
 * 
 * @param apiData - Raw data from odds API
 * @returns Array of BookRow objects formatted for the UI
 */
function transformOddsApiResponse(apiData: unknown[]): BookRow[] {
  // TODO: Implement transformation logic based on your odds API structure
  // Reference: https://the-odds-api.com/liveapi/guides/v4/#overview
  
  const bookmakers: BookRow[] = [];
  
  // When implementing, structure should match:
  // - Extract bookmaker name
  // - Map markets (h2h, spreads, totals, player props)
  // - Format odds according to BookRow interface
  
  return bookmakers;
}
