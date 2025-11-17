export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
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
  BLK: { line: string; over: string; under: string };
  STL: { line: string; over: string; under: string };
  TO: { line: string; over: string; under: string };
  DD: { yes: string; no: string };
  TD: { yes: string; no: string };
  PRA: { line: string; over: string; under: string };
  PR: { line: string; over: string; under: string };
  PA: { line: string; over: string; under: string };
  RA: { line: string; over: string; under: string };
  FIRST_BASKET: { yes: string; no: string };
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
    let oddsCache: OddsCache | null = cache.get(ODDS_CACHE_KEY);
    
    // If no cache, trigger background refresh but don't wait for it
    if (!oddsCache) {
      console.warn('No odds data in cache - triggering background refresh');
      // Trigger refresh in background (don't await - return immediately)
      ensureOddsCache({ source: 'api/odds' }).catch(err => {
        console.error('Background odds refresh failed:', err);
      });
      
      // Return immediately with empty data - UI will show loading state
      return NextResponse.json({
        success: true,
        data: [],
        loading: true,
        message: 'Odds data loading in background'
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
        
        // Debug: Log all bookmakers in playerPropsByBookmaker
        const allBookmakersInProps = Object.keys(playerPropsByBookmaker);
        const prizepicksBookmakers = allBookmakersInProps.filter(b => b.toLowerCase().includes('prizepicks'));
        if (prizepicksBookmakers.length > 0) {
          console.log(`[API DEBUG] PrizePicks bookmakers found in cache for game ${game.gameId}:`, prizepicksBookmakers);
          // Log all players in PrizePicks
          for (const ppBook of prizepicksBookmakers) {
            const allPlayers = Object.keys(playerPropsByBookmaker[ppBook] || {});
            console.log(`[API DEBUG] PrizePicks ${ppBook} has props for players:`, allPlayers);
            // Check if requested player matches any (case-insensitive)
            const matchingPlayer = allPlayers.find(p => p.toLowerCase() === player.toLowerCase());
            if (matchingPlayer) {
              console.log(`[API DEBUG] Found matching player! Requested: "${player}", Found: "${matchingPlayer}"`);
              console.log(`[API DEBUG] PrizePicks props for ${matchingPlayer}:`, playerPropsByBookmaker[ppBook][matchingPlayer]);
            } else {
              console.log(`[API DEBUG] No exact match for "${player}". Available players:`, allPlayers);
            }
          }
        }
        
        // Check if this player has props in any bookmaker
        const allBookNames = new Set<string>();
        for (const book of game.bookmakers) allBookNames.add(book.name);
        for (const bookName of Object.keys(playerPropsByBookmaker)) {
          // Try exact match first
          if (playerPropsByBookmaker[bookName]?.[player]) {
            allBookNames.add(bookName);
          } else {
            // Try case-insensitive match
            const matchingPlayerKey = Object.keys(playerPropsByBookmaker[bookName] || {}).find(
              p => p.toLowerCase() === player.toLowerCase()
            );
            if (matchingPlayerKey) {
              allBookNames.add(bookName);
            }
          }
        }
        
        // Debug: Check for PrizePicks
        if (player && Array.from(allBookNames).some(name => name.toLowerCase().includes('prizepicks'))) {
          console.log(`[API DEBUG] PrizePicks found for player ${player} in game ${game.gameId}:`, {
            bookNames: Array.from(allBookNames).filter(n => n.toLowerCase().includes('prizepicks')),
            props: playerPropsByBookmaker[Array.from(allBookNames).find(n => n.toLowerCase().includes('prizepicks')) || '']?.[player],
          });
        }

        const hasPlayerProps = Array.from(allBookNames).some(name => {
          // Try exact match first
          if (playerPropsByBookmaker[name]?.[player]) return true;
          // Try case-insensitive match
          const matchingPlayerKey = Object.keys(playerPropsByBookmaker[name] || {}).find(
            p => p.toLowerCase() === player.toLowerCase()
          );
          return !!matchingPlayerKey;
        });
        
        if (hasPlayerProps) {
          // Convert player props to BookRow format - include DFS-only books as needed
          const bookRows: any[] = [];
          
          const statKeysWithLines = new Set(['PTS','REB','AST','THREES','BLK','STL','TO','PRA','PR','PA','RA']);
          const cloneRow = (row: BookRow): BookRow => JSON.parse(JSON.stringify(row));

          for (const bookName of allBookNames) {
            const baseBook = game.bookmakers.find((b: any) => b.name === bookName);
            // Try to find the actual player key (case-insensitive match)
            const actualPlayerKey = playerPropsByBookmaker[bookName]?.[player] 
              ? player 
              : Object.keys(playerPropsByBookmaker[bookName] || {}).find(
                  p => p.toLowerCase() === player.toLowerCase()
                );
            if (!actualPlayerKey) continue;
            
            const bookmakerProps = playerPropsByBookmaker[bookName]?.[actualPlayerKey];
            if (!bookmakerProps || Object.keys(bookmakerProps).length === 0) continue;

            const blankRow: BookRow = {
              name: bookName,
              H2H: { home: 'N/A', away: 'N/A' },
              Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
              Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
              PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
              REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
              AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
              THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
              BLK: { line: 'N/A', over: 'N/A', under: 'N/A' },
              STL: { line: 'N/A', over: 'N/A', under: 'N/A' },
              TO: { line: 'N/A', over: 'N/A', under: 'N/A' },
              PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
              PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
              PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
              RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
              DD: { yes: 'N/A', no: 'N/A' },
              TD: { yes: 'N/A', no: 'N/A' },
              FIRST_BASKET: { yes: 'N/A', no: 'N/A' },
            };

            for (const [statKey, statValue] of Object.entries(bookmakerProps)) {
              if (!statValue) continue;

              if (statKeysWithLines.has(statKey)) {
                const entries = Array.isArray(statValue) ? statValue : [statValue];
                for (const entry of entries) {
                  // Debug PrizePicks goblin/demon lines
                  const entryAny = entry as any;
                  if (bookName.toLowerCase().includes('prizepicks') && entryAny?.variantLabel) {
                    console.log(`[API DEBUG] PrizePicks ${statKey} line for ${player}:`, {
                      line: entryAny?.line,
                      over: entryAny?.over,
                      under: entryAny?.under,
                      variantLabel: entryAny?.variantLabel,
                      isPickem: entryAny?.isPickem,
                    });
                  }
                  
                  const row = cloneRow(baseBook || blankRow);
                  (row as any)[statKey] = {
                    line: entryAny?.line ?? 'N/A',
                    over: entryAny?.over ?? 'N/A',
                    under: entryAny?.under ?? 'N/A',
                  };
                  (row as any).meta = {
                    baseName: baseBook?.name || bookName,
                    isPickem: entryAny?.isPickem ?? false,
                    variantLabel: entryAny?.variantLabel ?? null,
                    stat: statKey,
                  };
                  bookRows.push(row);
                }
              } else {
                const row = cloneRow(baseBook || blankRow);
                (row as any)[statKey] = statValue;
                (row as any).meta = {
                  baseName: baseBook?.name || bookName,
                  isPickem: false,
                  variantLabel: null,
                  stat: statKey,
                };
                bookRows.push(row);
              }
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
