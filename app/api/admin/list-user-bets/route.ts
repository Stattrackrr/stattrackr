import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin endpoint to list all bets for a user by email
 * GET /api/admin/list-user-bets?email=user@example.com
 * 
 * Requires ADMIN_SECRET or authenticated admin user (email in ADMIN_EMAILS env var)
 */
export async function GET(request: Request) {
  try {
    // Check admin authorization
    const authResult = await authorizeAdminRequest(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    // Validate email input
    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter is required' },
        { status: 400 }
      );
    }

    // Validate email format and length
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Find user by email
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      console.error('Error fetching users:', authError);
      const isProduction = process.env.NODE_ENV === 'production';
      return NextResponse.json(
        { 
          error: isProduction 
            ? 'Failed to fetch users' 
            : authError.message 
        },
        { status: 500 }
      );
    }

    const user = authUsers.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
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
      const isProduction = process.env.NODE_ENV === 'production';
      return NextResponse.json(
        { 
          error: isProduction 
            ? 'Failed to fetch bets' 
            : betsError.message 
        },
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
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : error.message || 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

