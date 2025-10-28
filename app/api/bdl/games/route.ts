import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';
import sharedCache from '@/lib/sharedCache';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('start_date') || '';
  const endDate = searchParams.get('end_date') || '';
  const seasons = searchParams.getAll('seasons[]').join(',') || '';
  const page = searchParams.get('page') || '1';
  const cursor = searchParams.get('cursor') || '';
  const perPage = searchParams.get('per_page') || '25';
  
  // Stable aggregated key (no cursor) when team_ids[] is provided
  const seasonsParams = searchParams.getAll('seasons[]');
  const teamParams = searchParams.getAll('team_ids[]');
  const seasonsCsv = seasonsParams.join(',');
  const teamsCsv = teamParams.join(',');
  const hasTeamFilter = teamParams.length > 0;

  const stableKey = hasTeamFilter
    ? `games:agg:seasons:${seasonsCsv || `${startDate}_${endDate}`}:teams:${teamsCsv}:per_page:${perPage}`
    : null;

  // Check shared cache first (Redis/Upstash) then process cache
  // TTL policy: prior seasons get very long TTL, current season shorter (overwritten by warm)
  const now = new Date();
  const month = now.getMonth();
  const currSeasonYear = (month === 9 ? now.getFullYear() : (month >= 10 ? now.getFullYear() : now.getFullYear() - 1));
  const seasonYears = seasonsParams.map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
  const includesCurrentSeason = seasonYears.includes(currSeasonYear);
  const LONG_TTL_SEC = 180 * 24 * 60 * 60; // 180 days for immutable seasons
  const DEFAULT_TTL_SEC = parseInt(process.env.SHARED_GAMES_TTL_SEC || String(CACHE_TTL.GAMES * 60), 10);
  const ttlForStable = includesCurrentSeason ? DEFAULT_TTL_SEC : LONG_TTL_SEC;

  if (stableKey) {
    const sharedHit = await sharedCache.getJSON<any>(stableKey);
    if (sharedHit) return NextResponse.json(sharedHit);
    const memHit = cache.get(stableKey);
    if (memHit) {
      sharedCache.setJSON(stableKey, memHit, ttlForStable).catch(() => {});
      return NextResponse.json(memHit);
    }
  } else {
    // Fallback to legacy key when no team filter provided
    const legacyKey = seasons 
      ? `games:seasons:${seasons}:cursor:${cursor}:per_page:${perPage}` 
      : getCacheKey.games(startDate, endDate);
    const sharedHit = await sharedCache.getJSON<any>(legacyKey);
    if (sharedHit) return NextResponse.json(sharedHit);
    const memHit = cache.get(legacyKey);
    if (memHit) return NextResponse.json(memHit);
  }
  
  try {
    const logParams = seasons ? `seasons: ${seasons}` : `${startDate} to ${endDate}`;
    console.log(`🌐 Fresh API call for games: ${logParams}`);
    
    // Build BDL URL base
    const base = new URL("https://api.balldontlie.io/v1/games");

    // Helper to trim payload
    const trimGame = (g: any) => ({
      id: g.id,
      date: g.date,
      season: g.season,
      status: g.status,
      datetime: g.datetime || g.date,
      home_team_score: g.home_team_score,
      visitor_team_score: g.visitor_team_score,
      home_team: g.home_team ? { id: g.home_team.id, abbreviation: g.home_team.abbreviation } : undefined,
      visitor_team: g.visitor_team ? { id: g.visitor_team.id, abbreviation: g.visitor_team.abbreviation } : undefined,
    });

    let finalData: any;

    if (stableKey) {
      // Aggregated, stable (team-scoped) path: single page is enough with per_page=100
      const p = new URLSearchParams();
      seasonsParams.forEach((v) => p.append('seasons[]', v));
      teamParams.forEach((v) => p.append('team_ids[]', v));
      p.set('per_page', perPage);
      const url = `${base.toString()}?${p.toString()}`;
      const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
      const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
      
      console.log('🏀 Fetching (aggregated, team) from BDL:', url);
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'StatTrackr/1.0',
          'Authorization': authHeader,
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error('🏀 Games API Error:', errorText);
        return NextResponse.json({ error: 'BDL error', message: errorText }, { status: response.status });
      }
      const json = await response.json();
      const trimmed = Array.isArray(json?.data) ? json.data.map(trimGame) : [];
      finalData = { data: trimmed, meta: { per_page: Number(perPage), total_count: trimmed.length } };

      // Cache under stable key
      cache.set(stableKey, finalData, CACHE_TTL.GAMES);
      await sharedCache.setJSON(stableKey, finalData, ttlForStable);
      console.log(`✅ Games cached (stable key) memory:${CACHE_TTL.GAMES}m shared:${Math.round(ttlForStable/60)}m`);
      return NextResponse.json(finalData);
    }

    // Legacy fallback (no team filter): forward query as is
    searchParams.forEach((value, key) => base.searchParams.append(key, value));
    const url = base.toString();
    const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
    const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
    
    console.log('🏀 Fetching (legacy) from BDL:', url);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StatTrackr/1.0',
        'Authorization': authHeader,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('🏀 Games API Error:', errorText);
      return NextResponse.json({ error: 'BDL error', message: errorText }, { status: response.status });
    }
    const data = await response.json();
    // Cache legacy result with legacy key
    const legacyKey = seasons 
      ? `games:seasons:${seasons}:cursor:${cursor}:per_page:${perPage}` 
      : getCacheKey.games(startDate, endDate);
    cache.set(legacyKey, data, CACHE_TTL.GAMES);
    await sharedCache.setJSON(legacyKey, data, DEFAULT_TTL_SEC);
    console.log(`✅ Games cached (legacy key) memory:${CACHE_TTL.GAMES}m shared:${Math.round(DEFAULT_TTL_SEC/60)}m`);
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
