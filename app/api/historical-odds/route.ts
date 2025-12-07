import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
    
    // Check if we already have this data in Supabase
    const { data: existingOdds } = await supabaseAdmin
      .from('historical_odds')
      .select('*')
      .eq('player_id', parseInt(playerId))
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
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerId, playerName, gameDate, opponent, statType, line, overOdds, underOdds, bookmaker } = body;
    
    if (!playerId || !gameDate || !opponent || !statType || !line) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Insert or update historical odds
    const { data, error } = await supabaseAdmin
      .from('historical_odds')
      .upsert({
        player_id: parseInt(playerId),
        player_name: playerName || '',
        game_date: gameDate,
        opponent,
        stat_type: statType,
        line: parseFloat(line),
        over_odds: overOdds || null,
        under_odds: underOdds || null,
        bookmaker: bookmaker || 'Unknown',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'player_id,game_date,opponent,stat_type,bookmaker',
      })
      .select();
    
    if (error) {
      console.error('Error storing historical odds:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('Error storing historical odds:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


