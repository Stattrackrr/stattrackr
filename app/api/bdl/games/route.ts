import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('start_date') || '';
  const endDate = searchParams.get('end_date') || '';
  
  // Create cache key for this games request
  const cacheKey = getCacheKey.games(startDate, endDate);
  
  // Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return NextResponse.json(cachedData);
  }
  
  try {
    console.log(`🌐 Fresh API call for games: ${startDate} to ${endDate}`);
    
    // Build Ball Don't Lie API URL
    const upstream = new URL("https://api.balldontlie.io/v1/games");
    
    // Forward all query parameters
    searchParams.forEach((value, key) => {
      upstream.searchParams.append(key, value);
    });
    
    console.log('🏀 Fetching games from Ball Don\'t Lie:', upstream.toString());
    
    const response = await fetch(upstream.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        'Authorization': 'Bearer 9823adcf-57dc-4036-906d-aeb9f0003cfd',
      },
    });
    
    console.log('🏀 Games API Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('🏀 Games API Error:', errorText);
      
      // If Ball Don't Lie fails, return mock schedule for upcoming games
      if (response.status === 404) {
        console.log('🏀 Ball Don\'t Lie games not available, using mock schedule');
        return NextResponse.json({
          data: generateMockSchedule(),
          meta: {
            total_pages: 1,
            current_page: 1,
            next_page: null,
            per_page: 25,
            total_count: 15
          }
        });
      }
      
      return NextResponse.json({
        error: `Games API error! status: ${response.status}`,
        message: errorText
      }, { status: response.status });
    }
    
    const data = await response.json();
    console.log('🏀 Games API Response:', JSON.stringify(data, null, 2));
    
    // Cache the successful response
    cache.set(cacheKey, data, CACHE_TTL.GAMES);
    console.log(`✅ Games cached for ${CACHE_TTL.GAMES} minutes`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('🏀 Error in games API:', error);
    
    // Fallback to mock schedule if API fails
    console.log('🏀 Using mock schedule as fallback');
    return NextResponse.json({
      data: generateMockSchedule(),
      meta: {
        total_pages: 1,
        current_page: 1,
        next_page: null,
        per_page: 25,
        total_count: 15
      }
    });
  }
}

// Generate mock schedule for 2025-26 season opening week
function generateMockSchedule() {
  const games = [
    // October 21, 2025 - Season Opening Night
    {
      id: 1,
      datetime: '2025-10-21T19:30:00.000Z',
      season: 2025,
      status: '2025-10-21T19:30:00.000Z',
      home_team: { id: 1, abbreviation: 'BOS', full_name: 'Boston Celtics', name: 'Celtics' },
      visitor_team: { id: 17, abbreviation: 'MIL', full_name: 'Milwaukee Bucks', name: 'Bucks' }
    },
    {
      id: 2,
      datetime: '2025-10-21T22:00:00.000Z',
      season: 2025,
      status: '2025-10-21T22:00:00.000Z',
      home_team: { id: 14, abbreviation: 'LAL', full_name: 'Los Angeles Lakers', name: 'Lakers' },
      visitor_team: { id: 11, abbreviation: 'GSW', full_name: 'Golden State Warriors', name: 'Warriors' }
    },
    // October 22, 2025
    {
      id: 3,
      datetime: '2025-10-22T19:00:00.000Z',
      season: 2025,
      status: '2025-10-22T19:00:00.000Z',
      home_team: { id: 20, abbreviation: 'NYK', full_name: 'New York Knicks', name: 'Knicks' },
      visitor_team: { id: 26, abbreviation: 'PHI', full_name: 'Philadelphia 76ers', name: '76ers' }
    },
    {
      id: 4,
      datetime: '2025-10-22T19:30:00.000Z',
      season: 2025,
      status: '2025-10-22T19:30:00.000Z',
      home_team: { id: 16, abbreviation: 'MIA', full_name: 'Miami Heat', name: 'Heat' },
      visitor_team: { id: 2, abbreviation: 'BKN', full_name: 'Brooklyn Nets', name: 'Nets' }
    },
    {
      id: 5,
      datetime: '2025-10-22T20:00:00.000Z',
      season: 2025,
      status: '2025-10-22T20:00:00.000Z',
      home_team: { id: 6, abbreviation: 'CHI', full_name: 'Chicago Bulls', name: 'Bulls' },
      visitor_team: { id: 8, abbreviation: 'DET', full_name: 'Detroit Pistons', name: 'Pistons' }
    },
    // October 23, 2025
    {
      id: 6,
      datetime: '2025-10-23T19:00:00.000Z',
      season: 2025,
      status: '2025-10-23T19:00:00.000Z',
      home_team: { id: 7, abbreviation: 'CLE', full_name: 'Cleveland Cavaliers', name: 'Cavaliers' },
      visitor_team: { id: 12, abbreviation: 'IND', full_name: 'Indiana Pacers', name: 'Pacers' }
    },
    {
      id: 7,
      datetime: '2025-10-23T19:30:00.000Z',
      season: 2025,
      status: '2025-10-23T19:30:00.000Z',
      home_team: { id: 4, abbreviation: 'ATL', full_name: 'Atlanta Hawks', name: 'Hawks' },
      visitor_team: { id: 5, abbreviation: 'CHA', full_name: 'Charlotte Hornets', name: 'Hornets' }
    },
    {
      id: 8,
      datetime: '2025-10-23T21:00:00.000Z',
      season: 2025,
      status: '2025-10-23T21:00:00.000Z',
      home_team: { id: 21, abbreviation: 'OKC', full_name: 'Oklahoma City Thunder', name: 'Thunder' },
      visitor_team: { id: 9, abbreviation: 'DEN', full_name: 'Denver Nuggets', name: 'Nuggets' }
    },
    // October 24, 2025
    {
      id: 9,
      datetime: '2025-10-24T22:00:00.000Z',
      season: 2025,
      status: '2025-10-24T22:00:00.000Z',
      home_team: { id: 28, abbreviation: 'SAC', full_name: 'Sacramento Kings', name: 'Kings' },
      visitor_team: { id: 25, abbreviation: 'POR', full_name: 'Portland Trail Blazers', name: 'Trail Blazers' }
    },
    {
      id: 10,
      datetime: '2025-10-24T22:30:00.000Z',
      season: 2025,
      status: '2025-10-24T22:30:00.000Z',
      home_team: { id: 27, abbreviation: 'PHX', full_name: 'Phoenix Suns', name: 'Suns' },
      visitor_team: { id: 15, abbreviation: 'LAC', full_name: 'Los Angeles Clippers', name: 'Clippers' }
    }
  ];
  
  return games;
}
