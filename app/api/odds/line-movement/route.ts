export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export const runtime = 'nodejs';

/**
 * Get line movement for a player's stat in a specific game
 * Query params:
 * - player: Player name
 * - stat: 'pts', 'reb', 'ast', 'threes', etc.
 * - date (optional): Game date in YYYY-MM-DD format, defaults to today
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const player = searchParams.get('player');
    const stat = searchParams.get('stat');
    const dateParam = searchParams.get('date');

    if (!player || !stat) {
      return NextResponse.json({
        success: false,
        error: 'Missing required parameters: player, stat'
      }, { status: 400 });
    }
    
    // Use provided date or default to today
    const targetDate = dateParam || new Date().toISOString().split('T')[0];

    // Map stat key to market name
    const statToMarket: Record<string, string> = {
      'pts': 'player_points',
      'reb': 'player_rebounds',
      'ast': 'player_assists',
      'threes': 'player_threes',
      '3pm': 'player_threes',
      'blk': 'player_blocks',
      'stl': 'player_steals',
      'to': 'player_turnovers',
      'pra': 'player_points_rebounds_assists',
      'pr': 'player_points_rebounds',
      'pa': 'player_points_assists',
      'ra': 'player_rebounds_assists',
    };

    const market = statToMarket[stat.toLowerCase()];
    if (!market) {
      return NextResponse.json({
        success: false,
        error: `Invalid stat: ${stat}`
      }, { status: 400 });
    }

    // Fetch all snapshots for this player/stat on the target date
    // Query by player name and date range (snapshots from the target date)
    const startOfDay = `${targetDate}T00:00:00Z`;
    const endOfDay = `${targetDate}T23:59:59Z`;
    
    const { data: snapshots, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('player_name', player)
      .eq('market', market)
      .gte('snapshot_at', startOfDay)
      .lte('snapshot_at', endOfDay)
      .order('snapshot_at', { ascending: true });

    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json({
        success: false,
        error: 'Database query failed'
      }, { status: 500 });
    }

    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json({
        success: true,
        hasOdds: false,
        message: `No ${stat.toUpperCase()} odds available at this time, check back later!`,
        data: {
          openingLine: null,
          currentLine: null,
          impliedOdds: null,
          lineMovement: []
        }
      });
    }

    // Get opening line (first snapshot)
    const opening = snapshots[0];

    // Get current line from FanDuel if available, otherwise most recent
    const fanduelSnapshots = snapshots.filter(s => s.bookmaker.toLowerCase().includes('fanduel'));
    const current = fanduelSnapshots.length > 0 
      ? fanduelSnapshots[fanduelSnapshots.length - 1]
      : snapshots[snapshots.length - 1];

    // Calculate implied odds (average probability from multiple bookmakers)
    const latestByBookmaker = new Map<string, typeof snapshots[0]>();
    for (const snap of snapshots) {
      latestByBookmaker.set(snap.bookmaker, snap);
    }

    const impliedProbs: number[] = [];
    for (const snap of latestByBookmaker.values()) {
      const overOdds = snap.over_odds;
      if (overOdds) {
        // Convert American odds to implied probability
        const prob = overOdds < 0
          ? (-overOdds) / (-overOdds + 100) * 100
          : 100 / (overOdds + 100) * 100;
        impliedProbs.push(prob);
      }
    }

    const impliedOdds = impliedProbs.length > 0
      ? impliedProbs.reduce((a, b) => a + b, 0) / impliedProbs.length
      : null;

    // Build line movement timeline (only include when line actually changes)
    const lineMovement: Array<{
      bookmaker: string;
      line: number;
      change: number;
      timestamp: string;
    }> = [];

    const seenLines = new Map<string, number>();
    for (const snap of snapshots) {
      const prevLine = seenLines.get(snap.bookmaker);
      const currentLine = parseFloat(String(snap.line));
      
      // Only add if this is an actual line change (not the opening line)
      if (prevLine !== undefined && prevLine !== currentLine) {
        const change = currentLine - prevLine;
        lineMovement.push({
          bookmaker: snap.bookmaker,
          line: currentLine,
          change,
          timestamp: snap.snapshot_at
        });
      }
      seenLines.set(snap.bookmaker, currentLine);
    }

    return NextResponse.json({
      success: true,
      hasOdds: true,
      data: {
        openingLine: {
          line: parseFloat(String(opening.line)),
          bookmaker: opening.bookmaker,
          overOdds: opening.over_odds,
          underOdds: opening.under_odds,
          timestamp: opening.snapshot_at
        },
        currentLine: {
          line: parseFloat(String(current.line)),
          bookmaker: current.bookmaker,
          overOdds: current.over_odds,
          underOdds: current.under_odds,
          timestamp: current.snapshot_at
        },
        impliedOdds: impliedOdds ? Math.round(impliedOdds * 10) / 10 : null,
        lineMovement
      }
    });

  } catch (error) {
    console.error('Line movement API error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch line movement'
    }, { status: 500 });
  }
}
