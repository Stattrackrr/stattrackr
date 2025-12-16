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
      console.warn('No odds data in cache - triggering refresh and waiting...');
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
        console.error('Odds refresh failed or timed out:', err);
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
      console.log(`[Odds API] Searching for team: ${team}. Total games in cache: ${oddsCache.games.length}`);
      console.log(`[Odds API] Available games in cache:`, oddsCache.games.map((g: any) => ({
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        gameId: g.gameId,
        bookmakersCount: g.bookmakers?.length || 0
      })));
      
      const game = oddsCache.games.find((g: any) => {
        // Log each comparison attempt
        const homeMatch = gameInvolvesTeam(g.homeTeam, g.awayTeam, team);
        const awayMatch = gameInvolvesTeam(g.awayTeam, g.homeTeam, team);
        const matches = homeMatch || awayMatch;
        
        if (matches) {
          console.log(`[Odds API] ✅ Match found! ${g.homeTeam} vs ${g.awayTeam} matches ${team}`);
        } else {
          // Log why it didn't match for debugging
          console.log(`[Odds API] ❌ No match: "${g.homeTeam}" vs "${g.awayTeam}" for "${team}"`);
          console.log(`[Odds API]   - Home team normalized: "${g.homeTeam.toUpperCase().trim()}"`);
          console.log(`[Odds API]   - Away team normalized: "${g.awayTeam.toUpperCase().trim()}"`);
          console.log(`[Odds API]   - Search term normalized: "${team.toUpperCase().trim()}"`);
        }
        return matches;
      });
      
      if (!game) {
        console.log(`[Odds API] ❌ No game found for team: ${team}`);
        console.log(`[Odds API] Team names in cache:`, oddsCache.games.map((g: any) => `Home: "${g.homeTeam}", Away: "${g.awayTeam}"`));
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
      console.log(`[Odds API] Searching for player: "${player}". Total games: ${oddsCache.games.length}`);
      
      // Search all games for this player's props
      for (const game of oddsCache.games) {
        const playerPropsByBookmaker = game.playerPropsByBookmaker || {};
        const bookmakerNames = Object.keys(playerPropsByBookmaker);
        
        console.log(`[Odds API] Checking game: ${game.homeTeam} vs ${game.awayTeam}`);
        console.log(`[Odds API] Bookmakers with props: ${bookmakerNames.length}`);
        
        if (bookmakerNames.length > 0) {
          // Log ALL player names from first bookmaker to help debug name matching
          const firstBookmaker = playerPropsByBookmaker[bookmakerNames[0]];
          const allPlayerNames = Object.keys(firstBookmaker || {});
          console.log(`[Odds API] All player names in cache (${allPlayerNames.length} total):`, allPlayerNames);
          
          // Check if we can find a case-insensitive match
          const playerLower = player.toLowerCase().trim();
          const matchingNames = allPlayerNames.filter(name => name.toLowerCase().trim() === playerLower);
          if (matchingNames.length > 0) {
            console.log(`[Odds API] ✅ Found case-insensitive match(es):`, matchingNames);
          } else {
            console.log(`[Odds API] ❌ No case-insensitive match for "${player}" (searched: "${playerLower}")`);
          }
        }
        
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
          console.log(`[Odds API] ✅ Found props for "${player}" in game: ${game.homeTeam} vs ${game.awayTeam}`);
          
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
              console.log(`[Odds API] Found exact match: "${player}" in bookmaker ${bookmakerName}`);
              break;
            }
            // Try case-insensitive match
            const cachedName = Object.keys(bookmakerProps).find(
              (name: string) => name.toLowerCase().trim() === playerLower
            );
            if (cachedName) {
              actualPlayerName = cachedName;
              console.log(`[Odds API] Found cached player name: "${cachedName}" for search "${player}" in bookmaker ${bookmakerName}`);
              break;
            }
          }
          
          if (!actualPlayerName) {
            console.warn(`[Odds API] ⚠️ Found hasPlayerProps=true but couldn't find actual player name for "${player}" in any bookmaker`);
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
              
              console.log(`[Odds API] Adding bookmaker ${book.name} with ${Object.keys(bookmakerProps).length} props for "${actualPlayerName}"`);
              bookRows.push({
                ...book,
                PTS: getPrimaryProp(bookmakerProps.PTS),
                REB: getPrimaryProp(bookmakerProps.REB),
                AST: getPrimaryProp(bookmakerProps.AST),
                THREES: getPrimaryProp(bookmakerProps.THREES),
                PRA: getPrimaryProp(bookmakerProps.PRA),
                PR: getPrimaryProp(bookmakerProps.PR),
                PA: getPrimaryProp(bookmakerProps.PA),
                RA: getPrimaryProp(bookmakerProps.RA),
              });
            } else {
              console.log(`[Odds API] Bookmaker ${book.name} has no props for "${actualPlayerName}"`);
            }
          }
          
          console.log(`[Odds API] ✅ Returning ${bookRows.length} bookmakers with props for "${player}" (actual name: "${actualPlayerName}")`);
          return NextResponse.json({
            success: true,
            data: bookRows,
            lastUpdated: oddsCache.lastUpdated,
            nextUpdate: oddsCache.nextUpdate
          });
        }
      }
      
      // Player not found in any game
      console.log(`[Odds API] ❌ No props found for player: "${player}" after checking ${oddsCache.games.length} games`);
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
