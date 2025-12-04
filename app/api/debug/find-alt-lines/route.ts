import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';
import { getNBACache } from '@/lib/nbaCache';
import type { OddsCache } from '@/app/api/odds/refresh/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ODDS_CACHE_KEY = 'all_nba_odds';

export async function GET(req: NextRequest) {
  try {
    // Get cached odds data
    let oddsCache: OddsCache | null = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
    });
    
    if (!oddsCache) {
      oddsCache = cache.get(ODDS_CACHE_KEY);
    }

    if (!oddsCache || !oddsCache.games) {
      return NextResponse.json({
        error: 'No odds data available',
        players: []
      });
    }

    // Find players with multiple lines from the same bookmaker
    const playersWithAltLines: Array<{
      player: string;
      stat: string;
      bookmaker: string;
      lines: number[];
      game: string;
    }> = [];

    for (const game of oddsCache.games) {
      const gameLabel = `${game.homeTeam} vs ${game.awayTeam}`;
      const playerPropsByBookmaker = (game as any).playerPropsByBookmaker || {};

      for (const [bookmakerName, playerProps] of Object.entries(playerPropsByBookmaker)) {
        const props = playerProps as Record<string, Record<string, any>>;
        
        for (const [playerName, stats] of Object.entries(props)) {
          for (const [statKey, statData] of Object.entries(stats)) {
            // Check if statData is an array (multiple lines)
            const entries = Array.isArray(statData) ? statData : [statData];
            
            if (entries.length > 1) {
              const lines = entries
                .map((e: any) => parseFloat(e.line))
                .filter((line: number) => !isNaN(line))
                .sort((a: number, b: number) => b - a);
              
              if (lines.length > 1) {
                playersWithAltLines.push({
                  player: playerName,
                  stat: statKey,
                  bookmaker: bookmakerName,
                  lines,
                  game: gameLabel
                });
              }
            }
          }
        }
      }
    }

    // Sort by number of lines (most first)
    playersWithAltLines.sort((a, b) => b.lines.length - a.lines.length);

    return NextResponse.json({
      success: true,
      count: playersWithAltLines.length,
      players: playersWithAltLines.slice(0, 20), // Top 20
      message: playersWithAltLines.length > 0 
        ? `Found ${playersWithAltLines.length} players with alt lines`
        : 'No players with multiple lines found. The Odds API may not provide alt lines for regular bookmakers.'
    });

  } catch (error: any) {
    console.error('Debug alt lines error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to find alt lines' },
      { status: 500 }
    );
  }
}


