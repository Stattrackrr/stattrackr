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

    // Search through all games for this player's props
    for (const game of oddsCache.games) {
      const playerPropsByBookmaker = game.playerPropsByBookmaker || {};
      
      // Check each bookmaker
      for (const [bookmakerName, players] of Object.entries(playerPropsByBookmaker)) {
        const bookmakerPlayers = players as Record<string, any>;
        
        // Find matching player (case-insensitive)
        for (const [cachedPlayerName, props] of Object.entries(bookmakerPlayers)) {
          if (cachedPlayerName.toLowerCase().includes(playerName.toLowerCase()) ||
              playerName.toLowerCase().includes(cachedPlayerName.toLowerCase())) {
            
            const statProps = props[statKey];
            if (statProps && statProps.line && statProps.over && statProps.under) {
              // Convert American odds to decimal
              const overDecimal = americanToDecimal(parseFloat(statProps.over));
              const underDecimal = americanToDecimal(parseFloat(statProps.under));
              
              playerProps.push({
                bookmaker: bookmakerName,
                line: parseFloat(statProps.line),
                overPrice: overDecimal,
                underPrice: underDecimal,
              });
            }
            break; // Found player, move to next bookmaker
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
