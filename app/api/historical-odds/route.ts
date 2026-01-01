import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkRateLimit, apiRateLimiter } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { authorizeAdminRequest } from '@/lib/adminAuth';

// Odds API base URL - you'll need to replace with your actual odds API endpoint
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const playerName = searchParams.get('playerName');
    const gameDate = searchParams.get('gameDate');
    const opponent = searchParams.get('opponent');
    const statType = searchParams.get('statType') || 'PTS';
    
    if (!playerId || !gameDate || !opponent) {
      return NextResponse.json(
        { error: 'playerId, gameDate, and opponent are required' },
        { status: 400 }
      );
    }
    
    // Validate and parse playerId
    const playerIdNum = parseInt(playerId, 10);
    if (isNaN(playerIdNum) || playerIdNum <= 0) {
      return NextResponse.json(
        { error: 'Invalid playerId' },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
      return NextResponse.json(
        { error: 'Invalid gameDate format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Validate opponent length
    if (opponent.length > 100) {
      return NextResponse.json(
        { error: 'Opponent name too long' },
        { status: 400 }
      );
    }

    // Check if we already have this data in Supabase
    const { data: existingOdds } = await supabaseAdmin
      .from('historical_odds')
      .select('*')
      .eq('player_id', playerIdNum)
      .eq('game_date', gameDate)
      .eq('opponent', opponent)
      .eq('stat_type', statType);
    
    if (existingOdds && existingOdds.length > 0) {
      return NextResponse.json({
        success: true,
        data: existingOdds,
        cached: true,
      });
    }
    
    // Fetch from odds API (you'll need to implement this based on your odds API)
    // For now, return empty - you'll need to integrate with your actual odds API
    // This is a placeholder structure
    
    // Example structure (replace with actual API call):
    /*
    const oddsResponse = await fetch(
      `${ODDS_API_BASE}/historical?player=${encodeURIComponent(playerName || '')}&date=${gameDate}&opponent=${opponent}&stat=${statType}`
    );
    
    if (!oddsResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch odds from API' },
        { status: 500 }
      );
    }
    
    const oddsData = await oddsResponse.json();
    */
    
    // For now, return that we need to fetch (frontend can trigger this)
    return NextResponse.json({
      success: true,
      data: [],
      cached: false,
      message: 'Odds not found in cache. Need to fetch from API.',
    });
  } catch (error: any) {
    console.error('Error fetching historical odds:', error);
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

export async function POST(request: NextRequest) {
  try {
    // Authentication check - require admin or authenticated user
    const authResult = await authorizeAdminRequest(request);
    if (!authResult.authorized) {
      // If admin auth failed, try user session
      try {
        const supabase = await createClient();
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!session || error) {
          return authResult.response; // Return admin auth error
        }
      } catch {
        return authResult.response; // Return admin auth error
      }
    }

    // Rate limiting
    const rateResult = checkRateLimit(request, apiRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const body = await request.json();
    const { playerId, playerName, gameDate, opponent, statType, line, overOdds, underOdds, bookmaker } = body;
    
    if (!playerId || !gameDate || !opponent || !statType || !line) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Validate inputs
    const playerIdNum = parseInt(String(playerId), 10);
    if (isNaN(playerIdNum) || playerIdNum <= 0) {
      return NextResponse.json(
        { error: 'Invalid playerId' },
        { status: 400 }
      );
    }

    const lineNum = parseFloat(String(line));
    if (isNaN(lineNum)) {
      return NextResponse.json(
        { error: 'Invalid line value' },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
      return NextResponse.json(
        { error: 'Invalid gameDate format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    if (opponent.length > 100) {
      return NextResponse.json(
        { error: 'Opponent name too long' },
        { status: 400 }
      );
    }

    if (statType.length > 20) {
      return NextResponse.json(
        { error: 'Stat type too long' },
        { status: 400 }
      );
    }

    if (playerName && playerName.length > 200) {
      return NextResponse.json(
        { error: 'Player name too long' },
        { status: 400 }
      );
    }

    if (bookmaker && bookmaker.length > 100) {
      return NextResponse.json(
        { error: 'Bookmaker name too long' },
        { status: 400 }
      );
    }

    const overOddsNum = overOdds ? parseFloat(String(overOdds)) : null;
    const underOddsNum = underOdds ? parseFloat(String(underOdds)) : null;

    if (overOddsNum !== null && (isNaN(overOddsNum) || overOddsNum < -10000 || overOddsNum > 10000)) {
      return NextResponse.json(
        { error: 'Invalid over odds value' },
        { status: 400 }
      );
    }

    if (underOddsNum !== null && (isNaN(underOddsNum) || underOddsNum < -10000 || underOddsNum > 10000)) {
      return NextResponse.json(
        { error: 'Invalid under odds value' },
        { status: 400 }
      );
    }

    // Insert or update historical odds
    const { data, error } = await supabaseAdmin
      .from('historical_odds')
      .upsert({
        player_id: playerIdNum,
        player_name: (playerName || '').substring(0, 200),
        game_date: gameDate,
        opponent: opponent.substring(0, 100),
        stat_type: statType.substring(0, 20),
        line: lineNum,
        over_odds: overOddsNum,
        under_odds: underOddsNum,
        bookmaker: (bookmaker || 'Unknown').substring(0, 100),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'player_id,game_date,opponent,stat_type,bookmaker',
      })
      .select();
    
    if (error) {
      console.error('Error storing historical odds:', error);
      const isProduction = process.env.NODE_ENV === 'production';
      return NextResponse.json(
        { 
          error: isProduction 
            ? 'Failed to store historical odds' 
            : error.message 
        },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('Error storing historical odds:', error);
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


