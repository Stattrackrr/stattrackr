export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache } from '@/lib/nbaCache';
import { ensureOddsCache } from '@/lib/refreshOdds';
import type { OddsCache } from '@/app/api/odds/refresh/route';

export const runtime = 'nodejs';

const ODDS_CACHE_KEY = 'all_nba_odds';

// Map stat types to our cache keys
const STAT_TO_KEY: Record<string, string> = {
  'pts': 'PTS',
  'reb': 'REB',
  'ast': 'AST',
  'fg3m': 'THREES',
  'stl': 'STL',
  'blk': 'BLK',
  'pr': 'PR',
  'pra': 'PRA',
  'ra': 'RA',
};

interface PlayerPropOdds {
  bookmaker: string;
  line: number;
  overPrice: number;
  underPrice: number;
}

// Convert American odds to decimal
function americanToDecimal(american: number): number {
  if (american > 0) {
    return (american / 100) + 1;
  } else {
    return (100 / Math.abs(american)) + 1;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const playerName = searchParams.get('player');
    const statType = searchParams.get('stat') || 'pts';
    
    if (!playerName) {
      return NextResponse.json({ error: 'Player name required' }, { status: 400 });
    }

    // Get cached odds data - check Supabase first (persistent, shared across instances)
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000, // 10s timeout for odds cache
      jsTimeoutMs: 10000,
    });
    
    // Fallback to in-memory cache
    if (!oddsCache) {
      oddsCache = cache.get(ODDS_CACHE_KEY);
    }
    
    if (!oddsCache) {
      try {
        oddsCache = await ensureOddsCache({ source: 'api/player-props' });
      } catch (refreshError) {
        console.error('Player props on-demand refresh failed:', refreshError);
      }
    }

    if (!oddsCache) {
      return NextResponse.json({ 
        error: 'Odds data not available - waiting for refresh',
        props: []
      }, { status: 503 });
    }

    // Helper function for fuzzy player name matching (same as /api/odds)
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
      
      // Try partial match (contains)
      const partialMatch = availableKeys.find(
        p => {
          const normalizedP = normalizePlayerNameForMatching(p);
          return normalizedP.includes(normalizedSearch) || normalizedSearch.includes(normalizedP);
        }
      );
      if (partialMatch) return partialMatch;
      
      return null;
    };

    const statKey = STAT_TO_KEY[statType] || 'PTS';
    const playerProps: PlayerPropOdds[] = [];

    // Search through all games for this player's props (same logic as /api/odds)
    for (const game of oddsCache.games) {
      const playerPropsByBookmaker = game.playerPropsByBookmaker || {};
      
      // Get all bookmaker names (from both game.bookmakers and playerPropsByBookmaker)
      const allBookNames = new Set<string>();
      for (const book of game.bookmakers) allBookNames.add(book.name);
      for (const bookName of Object.keys(playerPropsByBookmaker)) {
        allBookNames.add(bookName);
      }
      
      // Check if this player has props in any bookmaker
      const hasPlayerProps = Array.from(allBookNames).some(name => {
        const bookmakerProps = playerPropsByBookmaker[name];
        if (!bookmakerProps) return false;
        const availablePlayerKeys = Object.keys(bookmakerProps);
        return !!findMatchingPlayerKey(playerName, availablePlayerKeys);
      });
      
      if (!hasPlayerProps) continue;
      
      // Extract props for this player and stat
      for (const bookmakerName of allBookNames) {
        const bookmakerProps = playerPropsByBookmaker[bookmakerName];
        if (!bookmakerProps) continue;
        
        // Find the actual player key using fuzzy matching
        const availablePlayerKeys = Object.keys(bookmakerProps);
        const actualPlayerKey = findMatchingPlayerKey(playerName, availablePlayerKeys);
        
        if (!actualPlayerKey) continue;
        
        const playerData = bookmakerProps[actualPlayerKey] as any;
        if (!playerData) continue;
        
        // Get stat props - handle both single object and array
        const statData = playerData[statKey];
        if (!statData) continue;
        
        const statEntries = Array.isArray(statData) ? statData : [statData];
        
        // Extract each line for this stat
        for (const entry of statEntries) {
          const entryAny = entry as any;
          
          if (entryAny?.line && entryAny?.over && entryAny?.under) {
            // Parse odds (handle string or number)
            const overOdds = typeof entryAny.over === 'string' 
              ? parseFloat(entryAny.over.replace(/[^+\-\d]/g, ''))
              : entryAny.over;
            const underOdds = typeof entryAny.under === 'string'
              ? parseFloat(entryAny.under.replace(/[^+\-\d]/g, ''))
              : entryAny.under;
            
            if (!isNaN(overOdds) && !isNaN(underOdds) && !isNaN(parseFloat(entryAny.line))) {
              // Convert American odds to decimal
              const overDecimal = americanToDecimal(overOdds);
              const underDecimal = americanToDecimal(underOdds);
              
              playerProps.push({
                bookmaker: bookmakerName,
                line: parseFloat(entryAny.line),
                overPrice: overDecimal,
                underPrice: underDecimal,
              });
            }
          }
        }
      }
    }

    // Sort by line (descending)
    playerProps.sort((a, b) => b.line - a.line);

    return NextResponse.json({
      success: true,
      player: playerName,
      stat: statType,
      props: playerProps,
      count: playerProps.length,
      cachedAt: oddsCache.lastUpdated,
    });

  } catch (error: any) {
    console.error('Player props API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch player props' },
      { status: 500 }
    );
  }
}
