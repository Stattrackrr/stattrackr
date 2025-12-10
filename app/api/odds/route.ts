export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
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

// Versioned key to avoid stale The Odds API cache
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const player = searchParams.get('player');
    const team = searchParams.get('team');
    const forceRefresh = searchParams.get('refresh') === '1';
    
    // Check cache FIRST before rate limiting - we can serve cached data even if rate limited
    // Get bulk cached odds data - check Supabase first (persistent, shared across instances)
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000, // 10s timeout for odds cache
      jsTimeoutMs: 10000,
    });
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      oddsCache = cache.get(ODDS_CACHE_KEY);
    }
    
    // If we have cached data, we can serve it even if rate limited
    // Only check rate limit if we need to refresh or don't have cache
    if (!oddsCache || forceRefresh) {
      const rateLimitResult = checkRateLimit(request);
      if (!rateLimitResult.allowed) {
        // If rate limited but we have cache, serve it anyway
        if (oddsCache) {
          console.log('[Odds API] Rate limited but serving cached data');
        } else {
          // No cache and rate limited - return error
          return rateLimitResult.response!;
        }
      }
    }
    
    // If force refresh is requested, clear cache and refresh
    if (forceRefresh) {
      console.log('[Odds API] Force refresh requested - clearing cache and refreshing...');
      // Clear the in-memory cache
      cache.delete(ODDS_CACHE_KEY);
      // Trigger refresh (this will overwrite the Supabase cache)
      ensureOddsCache({ source: 'api/odds/refresh' }).catch(err => {
        console.error('Background odds refresh failed:', err);
      });
      return NextResponse.json({
        success: true,
        data: [],
        loading: true,
        message: 'Cache cleared, refreshing odds data...'
      });
    }
    
    // If no cache, trigger background refresh but don't wait for it
    if (!oddsCache) {
      console.warn('No odds data in cache (Supabase or in-memory) - triggering background refresh');
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
        console.log(`[Odds API] No game found for team: ${team}. Available games:`, oddsCache.games.map((g: any) => `${g.homeTeam} vs ${g.awayTeam}`));
        return NextResponse.json({
          success: true,
          data: [],
          message: 'No game found for team'
        });
      }
      
      console.log('[Odds API] Returning game odds for team:', {
        team,
        gameHomeTeam: game.homeTeam,
        gameAwayTeam: game.awayTeam,
        bookmakerCount: game.bookmakers?.length || 0,
        hasHomeTeam: !!game.homeTeam,
        hasAwayTeam: !!game.awayTeam
      });
      
      // Ensure we always return homeTeam and awayTeam
      const response = {
        success: true,
        data: game.bookmakers || [],
        homeTeam: game.homeTeam || null,
        awayTeam: game.awayTeam || null,
        lastUpdated: oddsCache.lastUpdated,
        nextUpdate: oddsCache.nextUpdate
      };
      
      console.log('[Odds API] Response structure:', {
        hasData: !!response.data,
        dataLength: response.data?.length || 0,
        homeTeam: response.homeTeam,
        awayTeam: response.awayTeam
      });
      
      return NextResponse.json(response);
    }
    
    // Helper function for fuzzy player name matching
    const normalizePlayerNameForMatching = (name: string): string => {
      return name.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9]/g, ' ') // Replace non-alphanumeric with space
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    };

    const getPlayerNameVariations = (name: string): string[] => {
      const normalized = normalizePlayerNameForMatching(name);
      const parts = normalized.split(' ').filter(Boolean);
      if (parts.length < 2) return [normalized];
      
      const firstName = parts[0];
      const lastName = parts[parts.length - 1];
      const variations: string[] = [normalized, `${firstName} ${lastName}`];
      
      // Handle common name variations
      if (firstName === 'alexandre' || firstName === 'alex') {
        variations.push(`alex ${lastName}`, `alexandre ${lastName}`);
      }
      if (firstName === 'nicolas' || firstName === 'nic') {
        variations.push(`nic ${lastName}`, `nicolas ${lastName}`);
      }
      if (firstName === 'michael' || firstName === 'mike') {
        variations.push(`mike ${lastName}`, `michael ${lastName}`);
      }
      if (firstName === 'christopher' || firstName === 'chris') {
        variations.push(`chris ${lastName}`, `christopher ${lastName}`);
      }
      if (firstName === 'william' || firstName === 'will') {
        variations.push(`will ${lastName}`, `william ${lastName}`);
      }
      if (firstName === 'james' || firstName === 'jim' || firstName === 'jimmy') {
        variations.push(`james ${lastName}`, `jim ${lastName}`, `jimmy ${lastName}`);
      }
      
      return [...new Set(variations)]; // Remove duplicates
    };

    const findMatchingPlayerKey = (playerName: string, availableKeys: string[]): string | null => {
      const searchVariations = getPlayerNameVariations(playerName);
      
      // Try exact match first (case-insensitive)
      const exactMatch = availableKeys.find(
        p => p.toLowerCase() === playerName.toLowerCase()
      );
      if (exactMatch) return exactMatch;
      
      // Try normalized exact match
      const normalizedSearch = normalizePlayerNameForMatching(playerName);
      const normalizedMatch = availableKeys.find(
        p => normalizePlayerNameForMatching(p) === normalizedSearch
      );
      if (normalizedMatch) return normalizedMatch;
      
      // Try variations
      for (const variation of searchVariations) {
        const match = availableKeys.find(
          p => normalizePlayerNameForMatching(p) === variation
        );
        if (match) return match;
      }
      
      // Try partial match (contains) - more lenient
      const partialMatch = availableKeys.find(
        p => {
          const normalizedP = normalizePlayerNameForMatching(p);
          return normalizedP.includes(normalizedSearch) || normalizedSearch.includes(normalizedP);
        }
      );
      if (partialMatch) return partialMatch;
      
      // Try matching by last name only (for cases like "T. Herro" vs "Tyler Herro")
      const searchParts = normalizedSearch.split(' ').filter(Boolean);
      if (searchParts.length >= 2) {
        const searchLastName = searchParts[searchParts.length - 1];
        const lastNameMatch = availableKeys.find(
          p => {
            const normalizedP = normalizePlayerNameForMatching(p);
            const pParts = normalizedP.split(' ').filter(Boolean);
            if (pParts.length >= 2) {
              const pLastName = pParts[pParts.length - 1];
              // Match if last names are the same and first initial matches
              if (pLastName === searchLastName) {
                const searchFirstInitial = searchParts[0][0];
                const pFirstInitial = pParts[0][0];
                return searchFirstInitial === pFirstInitial || pParts[0].startsWith(searchFirstInitial) || searchParts[0].startsWith(pFirstInitial);
              }
            }
            return false;
          }
        );
        if (lastNameMatch) return lastNameMatch;
      }
      
      return null;
    };

    // If player is provided, find their props across all games
    if (player) {
      // Search all games for this player's props
      for (const game of oddsCache.games) {
        const playerPropsByBookmaker = game.playerPropsByBookmaker || {};
        
        // Check if this player has props in any bookmaker
        const allBookNames = new Set<string>();
        for (const book of game.bookmakers) allBookNames.add(book.name);
        for (const bookName of Object.keys(playerPropsByBookmaker)) {
          const availablePlayerKeys = Object.keys(playerPropsByBookmaker[bookName] || {});
          const matchingKey = findMatchingPlayerKey(player, availablePlayerKeys);
          if (matchingKey) {
            allBookNames.add(bookName);
          }
        }

        const hasPlayerProps = Array.from(allBookNames).some(name => {
          const availablePlayerKeys = Object.keys(playerPropsByBookmaker[name] || {});
          return !!findMatchingPlayerKey(player, availablePlayerKeys);
        });
        
        if (hasPlayerProps) {
          // Convert player props to BookRow format - include DFS-only books as needed
          const bookRows: any[] = [];
          
          const statKeysWithLines = new Set(['PTS','REB','AST','THREES','BLK','STL','TO','PRA','PR','PA','RA']);
          const cloneRow = (row: BookRow): BookRow => JSON.parse(JSON.stringify(row));

          for (const bookName of allBookNames) {
            const baseBook = game.bookmakers.find((b: any) => b.name === bookName);
            // Try to find the actual player key using fuzzy matching
            const availablePlayerKeys = Object.keys(playerPropsByBookmaker[bookName] || {});
            const actualPlayerKey = findMatchingPlayerKey(player, availablePlayerKeys);
            if (!actualPlayerKey) {
              // Debug: log when player not found for a bookmaker (only for first few to avoid spam)
              if (availablePlayerKeys.length > 0 && Math.random() < 0.1) { // Log 10% of misses to reduce noise
                console.log(`[Odds API] Player "${player}" not found in ${bookName}. Available keys (sample):`, availablePlayerKeys.slice(0, 3));
              }
              continue;
            }
            
            const bookmakerProps = playerPropsByBookmaker[bookName]?.[actualPlayerKey];
            if (!bookmakerProps || Object.keys(bookmakerProps).length === 0) {
              continue;
            }

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
                  const entryAny = entry as any;
                  
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
    // Debug: Collect vendor information
    const allVendors = new Set<string>();
    const allPlayerPropVendors = new Set<string>();
    oddsCache.games.forEach((game: any) => {
      game.bookmakers?.forEach((b: any) => allVendors.add(b.name));
      Object.keys(game.playerPropsByBookmaker || {}).forEach(v => {
        allVendors.add(v);
        allPlayerPropVendors.add(v);
      });
    });
    
    console.log(`[Odds API] Returning ${oddsCache.games.length} games with ${allVendors.size} total vendors: ${Array.from(allVendors).sort().join(', ')}`);
    console.log(`[Odds API] Player prop vendors: ${allPlayerPropVendors.size} - ${Array.from(allPlayerPropVendors).sort().join(', ')}`);
    
    return NextResponse.json({
      success: true,
      data: oddsCache.games,
      lastUpdated: oddsCache.lastUpdated,
      nextUpdate: oddsCache.nextUpdate,
      _debug: {
        totalVendors: allVendors.size,
        vendors: Array.from(allVendors).sort(),
        playerPropVendors: Array.from(allPlayerPropVendors).sort(),
        gamesCount: oddsCache.games.length
      }
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
