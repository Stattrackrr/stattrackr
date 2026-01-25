export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache } from '@/lib/nbaCache';
import { checkRateLimit } from '@/lib/rateLimit';
import { gameInvolvesTeam } from '@/lib/teamMapping';
import { ensureOddsCache } from '@/lib/refreshOdds';
import type { OddsCache } from '@/app/api/odds/refresh/route';

export interface BookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  PTS: { line: string; over: string; under: string };
  REB: { line: string; over: string; under: string };
  AST: { line: string; over: string; under: string };
  THREES: { line: string; over: string; under: string };
  STL: { line: string; over: string; under: string };
  BLK: { line: string; over: string; under: string };
  TO: { line: string; over: string; under: string };
  PRA: { line: string; over: string; under: string };
  PR: { line: string; over: string; under: string };
  PA: { line: string; over: string; under: string };
  RA: { line: string; over: string; under: string };
}

// Versioned key to avoid stale The Odds API cache
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const player = searchParams.get('player');
    const team = searchParams.get('team');
    const checkTimestamp = searchParams.get('check_timestamp') === '1';
    
    // Get bulk cached odds data - check Supabase first (persistent, shared across instances)
    // Always read from main key (staging is only used during refresh)
    // Reduce timeout to prevent long waits
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 5000, // 5s timeout for odds cache (reduced from 10s)
      jsTimeoutMs: 5000,
    });
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      oddsCache = cache.get(ODDS_CACHE_KEY);
    }
    
    // Note: We don't check staging key here because:
    // 1. Staging is only used during refresh (temporary)
    // 2. Main key should always have data (either old or new)
    // 3. This ensures users always see the stable main cache
    
    // If we have cached data, return it immediately (even if rate limited)
    if (oddsCache) {
      // Continue to process and return cached data below
    } else {
      // No cache - check rate limit before triggering refresh
      const rateLimitResult = checkRateLimit(request);
      if (!rateLimitResult.allowed) {
        // Rate limited and no cache - return 429 but with a helpful message
        return NextResponse.json({
          success: false,
          error: 'Rate limit exceeded',
          data: [],
          message: 'Too many requests. Please try again later.',
          loading: true
        }, { status: 429 });
      }
      
      // Not rate limited - trigger refresh
      try {
        // Wait for refresh with 30 second timeout
        const refreshPromise = ensureOddsCache({ source: 'api/odds', force: true });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Refresh timeout after 30s')), 30000)
        );
        
        await Promise.race([refreshPromise, timeoutPromise]);
        
        // Refresh completed - get the new cache
        oddsCache = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
          restTimeoutMs: 5000,
          jsTimeoutMs: 5000,
        });
        if (!oddsCache) {
          oddsCache = cache.get(ODDS_CACHE_KEY);
        }
        
        if (!oddsCache) {
          // Still no cache after refresh - return loading state
          return NextResponse.json({
            success: true,
            data: [],
            loading: true,
            message: 'Odds data loading in background'
          });
        }
        // Cache populated - continue to return data below
      } catch (err) {
        // Return loading state so UI can retry
        return NextResponse.json({
          success: true,
          data: [],
          loading: true,
          message: 'Odds data loading in background'
        });
      }
    }
    
    // If team is provided, find game odds for that matchup
    if (team) {
      const game = oddsCache.games.find((g: any) => {
        const homeMatch = gameInvolvesTeam(g.homeTeam, g.awayTeam, team);
        const awayMatch = gameInvolvesTeam(g.awayTeam, g.homeTeam, team);
        return homeMatch || awayMatch;
      });
      
      if (!game) {
        return NextResponse.json({
          success: true,
          data: [],
          message: 'No game found for team'
        });
      }
      
      console.log(`[Odds API] Found game: ${game.homeTeam} vs ${game.awayTeam}. Bookmakers: ${game.bookmakers?.length || 0}`);
      if (game.bookmakers && game.bookmakers.length > 0) {
        console.log(`[Odds API] Sample bookmaker:`, {
          name: game.bookmakers[0].name,
          hasH2H: !!game.bookmakers[0].H2H,
          hasSpread: !!game.bookmakers[0].Spread,
          hasTotal: !!game.bookmakers[0].Total
        });
      } else {
        console.warn(`[Odds API] ⚠️ Game found but has NO bookmakers!`);
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
        // Use case-insensitive matching since player names might be stored differently
        const playerLower = player.toLowerCase().trim();
        const hasPlayerProps = Object.values(playerPropsByBookmaker).some(
          (bookmakerProps: any) => {
            // Check exact match first
            if (bookmakerProps[player]) return true;
            // Check case-insensitive match
            return Object.keys(bookmakerProps).some(
              (cachedPlayerName: string) => cachedPlayerName.toLowerCase().trim() === playerLower
            );
          }
        );
        
        if (hasPlayerProps) {
          // Find the actual cached player name (case-insensitive match) - check ALL bookmakers, not just ones with props
          let actualPlayerName: string | null = null;
          // Check all bookmakers in the game, not just ones that have props
          const allBookmakerNames = Object.keys(playerPropsByBookmaker);
          for (const bookmakerName of allBookmakerNames) {
            const bookmakerProps = playerPropsByBookmaker[bookmakerName];
            if (!bookmakerProps) continue;
            
            // Try exact match first
            if (bookmakerProps[player]) {
              actualPlayerName = player;
              break;
            }
            // Try case-insensitive match
            const cachedName = Object.keys(bookmakerProps).find(
              (name: string) => name.toLowerCase().trim() === playerLower
            );
            if (cachedName) {
              actualPlayerName = cachedName;
              break;
            }
          }
          
          if (!actualPlayerName) {
            continue; // Skip this game, try next
          }
          
          // Convert player props to BookRow format - only include bookmakers that have props for this player
          const bookRows: any[] = [];
          
          for (const book of game.bookmakers) {
            const bookmakerProps = playerPropsByBookmaker[book.name]?.[actualPlayerName];
            
            // Only include this bookmaker if they have at least one prop for this player
            if (bookmakerProps && Object.keys(bookmakerProps).length > 0) {
              // Helper to get primary prop (first entry if array, or the value itself)
              const getPrimaryProp = (propData: any) => {
                if (!propData) return { line: 'N/A', over: 'N/A', under: 'N/A' };
                // If it's an array, get the first entry (primary line, not alt lines)
                if (Array.isArray(propData)) {
                  // Filter out alt lines (Goblin/Demon variants) to get the primary line
                  const primaryLine = propData.find((entry: any) => !entry.variantLabel) || propData[0];
                  return primaryLine || { line: 'N/A', over: 'N/A', under: 'N/A' };
                }
                // If it's already an object, return it
                return propData;
              };
              
              bookRows.push({
                ...book,
                PTS: getPrimaryProp(bookmakerProps.PTS),
                REB: getPrimaryProp(bookmakerProps.REB),
                AST: getPrimaryProp(bookmakerProps.AST),
                THREES: getPrimaryProp(bookmakerProps.THREES),
                STL: getPrimaryProp(bookmakerProps.STL),
                BLK: getPrimaryProp(bookmakerProps.BLK),
                TO: getPrimaryProp(bookmakerProps.TO),
                PRA: getPrimaryProp(bookmakerProps.PRA),
                PR: getPrimaryProp(bookmakerProps.PR),
                PA: getPrimaryProp(bookmakerProps.PA),
                RA: getPrimaryProp(bookmakerProps.RA),
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
