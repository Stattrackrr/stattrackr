import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

export interface BookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  PTS: { line: string; over: string; under: string };
  REB: { line: string; over: string; under: string };
  AST: { line: string; over: string; under: string };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sport = searchParams.get('sport') || 'basketball_nba';
    const player = searchParams.get('player');
    const market = searchParams.get('market') || 'player_points';
    
    const cacheKey = getCacheKey.odds(sport, player || 'unknown', market);
    
    // Check cache first
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }
    
    // TODO: Replace this with your actual odds API integration
    const ODDS_API_KEY = process.env.ODDS_API_KEY;
    
    if (!ODDS_API_KEY) {
      console.warn('ODDS_API_KEY not configured - returning empty data');
      const emptyResponse = {
        success: false,
        error: 'Odds API key not configured',
        data: []
      };
      
      // Cache empty response to avoid repeated API key checks
      cache.set(cacheKey, emptyResponse, 10); // 10 minutes
      
      return NextResponse.json(emptyResponse);
    }

    // Example structure for the odds API call
    // Replace with actual odds API endpoint and parameters
    const oddsApiUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds`;
    const oddsParams = new URLSearchParams({
      apiKey: ODDS_API_KEY,
      regions: 'us', // or 'us,uk,au' for multiple regions
      markets: 'h2h,spreads,totals,player_points,player_rebounds,player_assists',
      oddsFormat: 'american',
      dateFormat: 'iso',
    });

    console.log('Fetching odds from API...');
    
    // Uncomment and modify when ready to use real API:
    /*
    const response = await fetch(`${oddsApiUrl}?${oddsParams}`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Odds API error: ${response.status}`);
    }

    const oddsData = await response.json();
    
    // Transform the API response into BookRow format
    const transformedData: BookRow[] = transformOddsApiResponse(oddsData);
    
    return NextResponse.json({
      success: true,
      data: transformedData,
      count: transformedData.length
    });
    */

    // For now, return empty data while API is being set up
    const pendingResponse = {
      success: true,
      message: 'Odds API integration pending - mock data removed',
      data: [],
      count: 0
    };
    
    // Cache the pending response
    cache.set(cacheKey, pendingResponse, CACHE_TTL.ODDS);
    
    return NextResponse.json(pendingResponse);

  } catch (error) {
    console.error('Error fetching odds:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch odds',
      data: []
    }, { status: 500 });
  }
}

// Helper function to transform odds API response to BookRow format
function transformOddsApiResponse(apiData: any[]): BookRow[] {
  // TODO: Implement transformation logic based on your odds API structure
  // This will depend on the specific format of your purchased odds API
  
  const bookmakers: BookRow[] = [];
  
  // Example transformation logic (adjust based on actual API structure):
  /*
  for (const game of apiData) {
    for (const bookmaker of game.bookmakers) {
      const bookRow: BookRow = {
        name: bookmaker.title,
        H2H: {
          home: bookmaker.markets.find(m => m.key === 'h2h')?.outcomes[0]?.price || '+100',
          away: bookmaker.markets.find(m => m.key === 'h2h')?.outcomes[1]?.price || '+100'
        },
        Spread: {
          line: bookmaker.markets.find(m => m.key === 'spreads')?.outcomes[0]?.point || '0',
          over: bookmaker.markets.find(m => m.key === 'spreads')?.outcomes[0]?.price || '-110',
          under: bookmaker.markets.find(m => m.key === 'spreads')?.outcomes[1]?.price || '-110'
        },
        Total: {
          line: bookmaker.markets.find(m => m.key === 'totals')?.outcomes[0]?.point || '200',
          over: bookmaker.markets.find(m => m.key === 'totals')?.outcomes[0]?.price || '-110',
          under: bookmaker.markets.find(m => m.key === 'totals')?.outcomes[1]?.price || '-110'
        },
        PTS: {
          line: bookmaker.markets.find(m => m.key === 'player_points')?.outcomes[0]?.point || '20',
          over: bookmaker.markets.find(m => m.key === 'player_points')?.outcomes[0]?.price || '-110',
          under: bookmaker.markets.find(m => m.key === 'player_points')?.outcomes[1]?.price || '-110'
        },
        REB: {
          line: bookmaker.markets.find(m => m.key === 'player_rebounds')?.outcomes[0]?.point || '8',
          over: bookmaker.markets.find(m => m.key === 'player_rebounds')?.outcomes[0]?.price || '-110',
          under: bookmaker.markets.find(m => m.key === 'player_rebounds')?.outcomes[1]?.price || '-110'
        },
        AST: {
          line: bookmaker.markets.find(m => m.key === 'player_assists')?.outcomes[0]?.point || '5',
          over: bookmaker.markets.find(m => m.key === 'player_assists')?.outcomes[0]?.price || '-110',
          under: bookmaker.markets.find(m => m.key === 'player_assists')?.outcomes[1]?.price || '-110'
        }
      };
      bookmakers.push(bookRow);
    }
  }
  */
  
  return bookmakers;
}