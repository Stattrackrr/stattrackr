import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin endpoint to list all bets for a user by email
 * GET /api/admin/list-user-bets?email=user@example.com
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter is required' },
        { status: 400 }
      );
    }

    // Find user by email
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      console.error('Error fetching users:', authError);
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      );
    }

    const user = authUsers.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return NextResponse.json(
        { error: `User with email ${email} not found` },
        { status: 404 }
      );
    }

    // Fetch all bets for this user
    const { data: bets, error: betsError } = await supabaseAdmin
      .from('bets')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (betsError) {
      console.error('Error fetching bets:', betsError);
      return NextResponse.json(
        { error: 'Failed to fetch bets' },
        { status: 500 }
      );
    }

    // Format bets for easier reading
    const formattedBets = bets?.map(bet => ({
      id: bet.id,
      date: bet.date,
      sport: bet.sport,
      market: bet.market,
      selection: bet.selection,
      player_name: bet.player_name,
      player_id: bet.player_id,
      team: bet.team,
      opponent: bet.opponent,
      stat_type: bet.stat_type,
      line: bet.line,
      over_under: bet.over_under,
      game_date: bet.game_date,
      stake: bet.stake,
      currency: bet.currency,
      odds: bet.odds,
      result: bet.result,
      status: bet.status,
      actual_value: bet.actual_value,
      created_at: bet.created_at,
      updated_at: bet.updated_at,
    })) || [];

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
      },
      totalBets: formattedBets.length,
      bets: formattedBets,
    });
  } catch (error: any) {
    console.error('Error in list-user-bets:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

