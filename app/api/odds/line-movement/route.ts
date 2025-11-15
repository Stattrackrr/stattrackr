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

    const startRangeDate = new Date(`${targetDate}T00:00:00Z`);
    startRangeDate.setUTCDate(startRangeDate.getUTCDate() - 1);
    const endRangeDate = new Date(`${targetDate}T23:59:59Z`);
    endRangeDate.setUTCDate(endRangeDate.getUTCDate() + 1);
    const startOfWindow = startRangeDate.toISOString();
    const endOfWindow = endRangeDate.toISOString();

    const { data: latestRows, error: latestError } = await (supabase
      .from('line_movement_latest') as any)
      .select('*')
      .eq('player_name', player)
      .eq('market', market)
      .gte('opening_recorded_at', startOfWindow)
      .lte('opening_recorded_at', endOfWindow);

    if (latestError) {
      console.error('line_movement_latest query error:', latestError);
      return NextResponse.json({
        success: false,
        error: 'Failed to load line movement data'
      }, { status: 500 });
    }

    if (!latestRows || latestRows.length === 0) {
      return await buildSnapshotResponse(targetDate, player, market, stat);
    }

    const compositeKeys = (latestRows as any[]).map((row: any) => row.composite_key);

    const { data: movementRows, error: movementError } = await (supabase
      .from('line_movement_events') as any)
      .select('*')
      .in('composite_key', compositeKeys)
      .gte('recorded_at', startOfWindow)
      .lte('recorded_at', endOfWindow)
      .order('recorded_at', { ascending: false });

    if (movementError) {
      console.error('line_movement_events query error:', movementError);
      return NextResponse.json({
        success: false,
        error: 'Failed to load line movement events'
      }, { status: 500 });
    }

    const pickPreferredBookmaker = (rows: any[]) => {
      const fanduel = rows.find((row) =>
        row.bookmaker?.toLowerCase().includes('fanduel')
      );
      return fanduel || rows[0];
    };

    // Use the same row (preferred bookmaker) for both opening and current
    // This ensures we're comparing the same bookmaker's opening_line vs current_line
    const preferredRow = pickPreferredBookmaker(latestRows);
    
    // If we have a preferred row, use it for both opening and current
    // Otherwise, try to find the best row with actual line movement
    let openingRow = preferredRow;
    let currentRow = preferredRow;
    
    // If preferred row doesn't have different opening/current, look for one that does
    if (preferredRow && preferredRow.opening_line === preferredRow.current_line) {
      // Find a row where opening and current are actually different
      const rowWithMovement = latestRows.find((row: any) => 
        row.opening_line !== null && 
        row.current_line !== null && 
        row.opening_line !== row.current_line
      );
      if (rowWithMovement) {
        openingRow = rowWithMovement;
        currentRow = rowWithMovement;
      }
    }

    // Calculate implied probabilities for both over and under
    // Compare them to determine which is more favorable
    const impliedProbsOver: number[] = [];
    const impliedProbsUnder: number[] = [];
    
    for (const row of latestRows) {
      const overOdds = row.current_over_odds;
      const underOdds = row.current_under_odds;
      
      if (typeof overOdds === 'number') {
        const prob = overOdds < 0
          ? (-overOdds) / (-overOdds + 100) * 100
          : 100 / (overOdds + 100) * 100;
        impliedProbsOver.push(prob);
      }
      
      if (typeof underOdds === 'number') {
        const prob = underOdds < 0
          ? (-underOdds) / (-underOdds + 100) * 100
          : 100 / (underOdds + 100) * 100;
        impliedProbsUnder.push(prob);
      }
    }

    const avgOverProb = impliedProbsOver.length > 0
      ? impliedProbsOver.reduce((a, b) => a + b, 0) / impliedProbsOver.length
      : null;
    
    const avgUnderProb = impliedProbsUnder.length > 0
      ? impliedProbsUnder.reduce((a, b) => a + b, 0) / impliedProbsUnder.length
      : null;

    // Return the over probability (for display), and indicate which is more favorable
    // More favorable = lower implied probability (better value)
    const impliedOdds = avgOverProb !== null ? Math.round(avgOverProb * 10) / 10 : null;
    const isOverFavorable = avgOverProb !== null && avgUnderProb !== null 
      ? avgOverProb < avgUnderProb 
      : null;

    const lineMovement = (movementRows || []).map((event: any) => ({
      bookmaker: event.bookmaker,
      line: event.new_line,
      change: event.change,
      timestamp: event.recorded_at,
    }));

    return NextResponse.json({
      success: true,
      hasOdds: true,
      data: {
        openingLine: openingRow
          ? {
              line: typeof openingRow.opening_line === 'number' ? openingRow.opening_line : null,
              bookmaker: openingRow.bookmaker,
              overOdds: openingRow.opening_over_odds ?? undefined,
              underOdds: openingRow.opening_under_odds ?? undefined,
              timestamp: openingRow.opening_recorded_at ?? null,
            }
          : null,
        currentLine: currentRow
          ? {
              line: typeof currentRow.current_line === 'number' ? currentRow.current_line : null,
              bookmaker: currentRow.bookmaker,
              overOdds: currentRow.current_over_odds ?? undefined,
              underOdds: currentRow.current_under_odds ?? undefined,
              timestamp: currentRow.current_recorded_at ?? null,
            }
          : null,
        impliedOdds: impliedOdds,
        isOverFavorable: isOverFavorable,
        lineMovement,
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

async function buildSnapshotResponse(
  targetDate: string,
  player: string,
  market: string,
  stat: string
) {
  const startRangeDate = new Date(`${targetDate}T00:00:00Z`);
  startRangeDate.setUTCDate(startRangeDate.getUTCDate() - 1);
  const endRangeDate = new Date(`${targetDate}T23:59:59Z`);
  endRangeDate.setUTCDate(endRangeDate.getUTCDate() + 1);
  const startOfWindow = startRangeDate.toISOString();
  const endOfWindow = endRangeDate.toISOString();

  const { data: snapshots, error } = await (supabase
    .from('odds_snapshots') as any)
    .select('*')
    .eq('player_name', player)
    .eq('market', market)
    .gte('snapshot_at', startOfWindow)
    .lte('snapshot_at', endOfWindow)
    .order('snapshot_at', { ascending: true });

  if (error) {
    console.error('Supabase fallback query error:', error);
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

  const opening = snapshots[0];

  const fanduelSnapshots = snapshots.filter((s: any) => s.bookmaker.toLowerCase().includes('fanduel'));
  const current = fanduelSnapshots.length > 0
    ? fanduelSnapshots[fanduelSnapshots.length - 1]
    : snapshots[snapshots.length - 1];

  const latestByBookmaker = new Map<string, typeof snapshots[0]>();
  for (const snap of snapshots) {
    latestByBookmaker.set(snap.bookmaker, snap);
  }

  const impliedProbs: number[] = [];
  for (const snap of latestByBookmaker.values()) {
    const overOdds = snap.over_odds;
    if (overOdds) {
      const prob = overOdds < 0
        ? (-overOdds) / (-overOdds + 100) * 100
        : 100 / (overOdds + 100) * 100;
      impliedProbs.push(prob);
    }
  }

  const impliedOdds = impliedProbs.length > 0
    ? impliedProbs.reduce((a, b) => a + b, 0) / impliedProbs.length
    : null;

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
}
