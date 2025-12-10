import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * API endpoint to reset bets that were prematurely resolved
 * 
 * Query parameters:
 *   - date: Date to reset bets for (YYYY-MM-DD) - required
 *   - endDate: Optional end date for date range (YYYY-MM-DD)
 *   - playerName: Optional player name to filter by
 * 
 * Example:
 *   GET /api/reset-bets?date=2025-12-09
 *   GET /api/reset-bets?date=2025-12-09&endDate=2025-12-10
 *   GET /api/reset-bets?date=2025-12-09&playerName=Norman Powell
 */
export async function GET(request: Request) {
  try {
    // Check authentication
    const supabase = await createClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    
    if (!session || authError) {
      return NextResponse.json(
        { error: 'Unauthorized - Must be authenticated' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const endDate = url.searchParams.get('endDate');
    const playerName = url.searchParams.get('playerName');

    if (!date) {
      return NextResponse.json(
        { error: 'Missing required parameter: date (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    if (endDate && !dateRegex.test(endDate)) {
      return NextResponse.json(
        { error: 'Invalid endDate format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    console.log(`[reset-bets] Resetting bets for date: ${date}${endDate ? ` to ${endDate}` : ''}${playerName ? `, player: ${playerName}` : ''}`);

    // Build query to find bets that were resolved
    let query = supabaseAdmin
      .from('bets')
      .select('id, player_name, market, selection, game_date, result, status, actual_value, user_id')
      .eq('sport', 'NBA')
      .in('result', ['win', 'loss'])
      .eq('status', 'completed')
      .eq('user_id', session.user.id); // Only reset user's own bets

    // Filter by date
    if (endDate) {
      query = query.gte('game_date', date).lte('game_date', endDate);
    } else {
      query = query.eq('game_date', date);
    }

    // Filter by player name if provided
    if (playerName) {
      query = query.ilike('player_name', `%${playerName}%`);
    }

    const { data: bets, error: fetchError } = await query;

    if (fetchError) {
      console.error('[reset-bets] Error fetching bets:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch bets', details: fetchError.message },
        { status: 500 }
      );
    }

    if (!bets || bets.length === 0) {
      return NextResponse.json({
        message: 'No bets found to reset',
        reset: 0,
        bets: [],
      });
    }

    console.log(`[reset-bets] Found ${bets.length} bets to reset`);

    // Reset bets back to pending
    const betIds = bets.map(b => b.id);

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('bets')
      .update({
        result: 'pending',
        status: 'pending',
        actual_value: null,
      })
      .in('id', betIds)
      .eq('user_id', session.user.id); // Ensure we only update user's own bets

    if (updateError) {
      console.error('[reset-bets] Error resetting bets:', updateError);
      return NextResponse.json(
        { error: 'Failed to reset bets', details: updateError.message },
        { status: 500 }
      );
    }

    const betDetails = bets.map(bet => ({
      id: bet.id,
      description: bet.market?.startsWith('Parlay')
        ? bet.market
        : `${bet.player_name || 'Game prop'} ${bet.selection || ''}`,
      previousResult: bet.result,
      gameDate: bet.game_date,
    }));

    return NextResponse.json({
      message: `Successfully reset ${bets.length} bets back to pending status`,
      reset: bets.length,
      bets: betDetails,
      nextStep: 'Call /api/check-journal-bets?recalculate=true to re-check these bets with the fixed logic',
    });

  } catch (error: any) {
    console.error('[reset-bets] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reset bets' },
      { status: 500 }
    );
  }
}

