export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';

// Store all odds data in a single cache entry
const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';

// Route segment config to prevent treating non-handler exports as routes
export const runtime = 'nodejs';

export interface PlayerPropLineEntry {
  line: string;
  over: string;
  under: string;
  isPickem?: boolean;
  variantLabel?: string | null; // 'Goblin' or 'Demon' - indicates the type of line
  multiplier?: number; // For PrizePicks pick'em, the actual multiplier calculated from counts
  goblinCount?: number; // Number of goblin boosts on this line
  demonCount?: number; // Number of demon discounts on this line
}

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
  DD: { yes: string; no: string }; // Double-double
  TD: { yes: string; no: string }; // Triple-double
  PRA: { line: string; over: string; under: string }; // Points + Rebounds + Assists
  PR: { line: string; over: string; under: string }; // Points + Rebounds
  PA: { line: string; over: string; under: string }; // Points + Assists
  RA: { line: string; over: string; under: string }; // Rebounds + Assists
  FIRST_BASKET: { yes: string; no: string };
  meta?: {
    baseName?: string;
    isPickem?: boolean;
    variantLabel?: string | null;
    stat?: string;
  };
}

export interface GameOdds {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: BookRow[];
  // Player props stored per bookmaker per player
  playerPropsByBookmaker: {
    [bookmakerName: string]: {
      [playerName: string]: {
        PTS?: PlayerPropLineEntry[];
        REB?: PlayerPropLineEntry[];
        AST?: PlayerPropLineEntry[];
        THREES?: PlayerPropLineEntry[];
        BLK?: PlayerPropLineEntry[];
        STL?: PlayerPropLineEntry[];
        TO?: PlayerPropLineEntry[];
        DD?: { yes: string; no: string };
        TD?: { yes: string; no: string };
        PRA?: PlayerPropLineEntry[];
        PR?: PlayerPropLineEntry[];
        PA?: PlayerPropLineEntry[];
        RA?: PlayerPropLineEntry[];
        FIRST_BASKET?: { yes: string; no: string };
      };
    };
  };
}

export interface OddsCache {
  games: GameOdds[];
  lastUpdated: string;
  nextUpdate: string;
}


/**
 * API endpoint wrapper
 */
export async function GET(request: NextRequest) {
  try {
    const { refreshOddsData } = await import('@/lib/refreshOdds');
    const result = await refreshOddsData({ source: 'api/odds/refresh', request });
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Odds refresh API error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to refresh odds'
    }, { status: 500 });
  }
}

