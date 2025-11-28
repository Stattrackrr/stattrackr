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
        
        // Try exact match first
        if (bookmakerProps[playerName]) return true;
        
        // Try case-insensitive match
        const matchingPlayerKey = Object.keys(bookmakerProps).find(
          p => p.toLowerCase() === playerName.toLowerCase() ||
               p.toLowerCase().includes(playerName.toLowerCase()) ||
               playerName.toLowerCase().includes(p.toLowerCase())
        );
        return !!matchingPlayerKey;
      });
      
      if (!hasPlayerProps) continue;
      
      // Extract props for this player and stat
      for (const bookmakerName of allBookNames) {
        const bookmakerProps = playerPropsByBookmaker[bookmakerName];
        if (!bookmakerProps) continue;
        
        // Find the actual player key (case-insensitive match)
        const actualPlayerKey = bookmakerProps[playerName]
          ? playerName
          : Object.keys(bookmakerProps).find(
              p => p.toLowerCase() === playerName.toLowerCase() ||
                   p.toLowerCase().includes(playerName.toLowerCase()) ||
                   playerName.toLowerCase().includes(p.toLowerCase())
            );
        
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
