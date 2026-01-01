// app/api/opponent-playtype-defense/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

// Play type categories from NBA Stats API
const PLAY_TYPES = [
  { key: 'Isolation', displayName: 'Isolation (1v1)' },
  { key: 'PRBallHandler', displayName: 'Pick & Roll (Ball Handler)' },
  { key: 'PRRollMan', displayName: 'Pick & Roll (Roll Man)' },
  { key: 'Postup', displayName: 'Post-Up' },
  { key: 'Spotup', displayName: 'Spot-Up' },
  { key: 'Handoff', displayName: 'Hand-Off' },
  { key: 'Cut', displayName: 'Cut' },
  { key: 'OffScreen', displayName: 'Off-Screen' },
  { key: 'Transition', displayName: 'Transition' },
];

async function fetchNBAStats(url: string, timeout = 20000, retries = 2) {
  let lastError: Error | null = null;
  
  const actualTimeout = Math.max(4000, Math.min(timeout, 120000)); // 120s max
  const actualRetries = Math.max(0, Math.min(retries, 3)); // 3 retries = 4 total attempts
  const maxAttempts = actualRetries + 1;
  
  for (let attempt = 0; attempt <= actualRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

    try {
      console.log(`[Play Type Defense] Fetching NBA API (attempt ${attempt + 1}/${maxAttempts})...`);
      
      const response = await fetch(url, {
        headers: NBA_HEADERS,
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const errorMsg = `NBA API ${response.status}: ${response.statusText}`;
        console.error(`[Play Type Defense] NBA API error ${response.status} (attempt ${attempt + 1}/${maxAttempts}):`, text.slice(0, 500));
        
        // Retry on 5xx errors or 429 (rate limit)
        if ((response.status >= 500 || response.status === 429) && attempt < actualRetries) {
          const delay = 1000 * (attempt + 1);
          console.log(`[Play Type Defense] Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.log(`[Play Type Defense] ✅ Successfully fetched NBA API data`);
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error('Request timeout');
        if (attempt < actualRetries) {
          console.log(`[Play Type Defense] Timeout on attempt ${attempt + 1}/${maxAttempts}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      } else {
        lastError = error;
      }
    }
  }
  
  throw lastError || new Error('Failed to fetch NBA API data after retries');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const bypassCache = searchParams.get('bypassCache') === 'true';

    if (!team) {
      return NextResponse.json(
        { error: 'Team abbreviation is required' },
        { status: 400 }
      );
    }

    // Check cache first (unless bypassing)
    const cacheKey = `playtype_defense_${team}_${season}`;
    
    if (bypassCache) {
      console.log(`[Play Type Defense] 🗑️ Bypassing cache for ${team}`);
      cache.delete(cacheKey);
    }
    
    const cached = cache.get<any>(cacheKey);
    
    if (cached && !bypassCache) {
      console.log(`[Play Type Defense] ✅ Cache hit for ${team}`);
      return NextResponse.json(cached, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }

    console.log(`[Play Type Defense] Fetching data for ${team}, season ${season}`);

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;

    // Fetch each play type individually (defensive endpoint requires PlayType parameter)
    // This matches how the cache endpoint fetches defensive rankings
    const teamData: Record<string, any[]> = {};
    let headers: string[] = [];
    let hasFGM = false;
    let fgmIdx = -1;
    let fgaIdx = -1;

    for (let i = 0; i < PLAY_TYPES.length; i++) {
      const { key } = PLAY_TYPES[i];
      console.log(`[Play Type Defense] Fetching ${key} (${i + 1}/${PLAY_TYPES.length})...`);
      
      try {
        const params = new URLSearchParams({
          LeagueID: '00',
          PerMode: 'PerGame',
          PlayerOrTeam: 'T', // Team data
          SeasonType: 'Regular Season',
          SeasonYear: seasonStr,
          PlayType: key,
          TypeGrouping: 'defensive',
        });

        const url = `${NBA_STATS_BASE}/synergyplaytypes?${params.toString()}`;
        const data = await fetchNBAStats(url, 20000, 2);
        const resultSet = data?.resultSets?.[0];
        
        if (!resultSet) {
          console.warn(`[Play Type Defense] No data for ${key}`);
          continue;
        }

        // Get headers from first successful response
        if (headers.length === 0) {
          headers = resultSet.headers || [];
          console.log(`[Play Type Defense] Available columns:`, headers);
          
          // Find column indices
          fgmIdx = headers.indexOf('FGM');
          fgaIdx = headers.indexOf('FGA');
          hasFGM = fgmIdx !== -1;
          console.log(`[Play Type Defense] FGM available: ${hasFGM}, FGA available: ${fgaIdx !== -1}`);
        }

        const rows = resultSet.rowSet || [];
        const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
        const ptsIdx = headers.indexOf('PTS');
        const fgPctIdx = headers.indexOf('FG_PCT');
        const freqIdx = headers.indexOf('POSS_PCT');

        if (teamAbbrIdx === -1) {
          console.warn(`[Play Type Defense] Missing TEAM_ABBREVIATION column for ${key}`);
          continue;
        }

        rows.forEach((row: any[]) => {
          const teamAbbr = (row[teamAbbrIdx] || '').toUpperCase();
          if (!teamAbbr) return;

          const points = row[ptsIdx] || 0;
          const fgPct = row[fgPctIdx] || 0;
          const freq = row[freqIdx] || 0;
          const fgm = hasFGM ? (row[fgmIdx] || 0) : null;
          const fga = fgaIdx !== -1 ? (row[fgaIdx] || 0) : null;

          if (!teamData[teamAbbr]) {
            teamData[teamAbbr] = [];
          }

          teamData[teamAbbr].push({
            playType: key,
            points,
            fgPct: fgPct * 100, // Convert to percentage
            frequency: freq * 100,
            fgm: fgm, // FGM per game (if available)
            fga: fga  // FGA per game (if available)
          });
        });

        console.log(`[Play Type Defense] ✅ ${key}: ${rows.length} teams`);
        
        // Small delay between requests to avoid rate limiting
        if (i < PLAY_TYPES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err: any) {
        console.warn(`[Play Type Defense] ❌ Error fetching ${key}:`, err.message);
        // Continue with other play types even if one fails
      }
    }

    if (Object.keys(teamData).length === 0) {
      console.warn(`[Play Type Defense] No data available for any play type`);
      
      // Return mock data for development
      const mockData = PLAY_TYPES.map((pt, idx) => ({
        playType: pt.key,
        displayName: pt.displayName,
        points: 10 + (Math.random() * 5),
        fgPct: 42 + (Math.random() * 8),
        rank: Math.floor(Math.random() * 30) + 1,
        frequency: 8 + (Math.random() * 12)
      }));

      const response = {
        team,
        season: seasonStr,
        playTypes: mockData,
        note: 'Using mock data - NBA API data not available'
      };

      cache.set(cacheKey, response, 60); // Cache for 1 hour
      
      return NextResponse.json(response, { 
        status: 200,
        headers: { 'X-Cache-Status': 'MOCK' }
      });
    }

    // Calculate rankings for each play type
    // Use FGM per game if available, otherwise fall back to points
    const playTypeRankings: Record<string, any[]> = {};
    
    PLAY_TYPES.forEach(({ key }) => {
      const allTeamsForPlayType = Object.entries(teamData)
        .map(([teamAbbr, playTypes]) => {
          const pt = playTypes.find(p => p.playType === key);
          return {
            team: teamAbbr,
            points: pt?.points || 999,
            fgPct: pt?.fgPct || 0,
            frequency: pt?.frequency || 0,
            fgm: pt?.fgm || (hasFGM ? 999 : null), // Use FGM per game if available
            fga: pt?.fga || null
          };
        })
        .sort((a, b) => {
          // Sort by FGM per game if available (lower = better defense), otherwise by points
          if (hasFGM && a.fgm !== null && b.fgm !== null) {
            return a.fgm - b.fgm;
          }
          return a.points - b.points;
        });

      playTypeRankings[key] = allTeamsForPlayType.map((item, idx) => ({
        ...item,
        rank: idx + 1
      }));
      
      // Log sample data for first play type
      if (key === PLAY_TYPES[0].key && allTeamsForPlayType.length > 0) {
        console.log(`[Play Type Defense] Sample ${key} rankings (top 3):`, 
          allTeamsForPlayType.slice(0, 3).map(t => ({
            team: t.team,
            rank: allTeamsForPlayType.indexOf(t) + 1,
            fgm: t.fgm,
            points: t.points
          }))
        );
      }
    });

    // Get data for requested team
    const teamPlayTypes = PLAY_TYPES.map(({ key, displayName }) => {
      const ranking = playTypeRankings[key]?.find(r => r.team === team);
      
      return {
        playType: key,
        displayName,
        points: ranking?.points || 0.0,
        fgPct: ranking?.fgPct || 45.0,
        rank: ranking?.rank || 15,
        frequency: ranking?.frequency || 10.0,
        fgm: ranking?.fgm || null, // FGM per game (if available)
        fga: ranking?.fga || null  // FGA per game (if available)
      };
    }).sort((a, b) => b.frequency - a.frequency); // Sort by frequency (most common first)

    const response = {
      team,
      season: seasonStr,
      playTypes: teamPlayTypes,
      cachedAt: new Date().toISOString()
    };

    // Cache the result
    cache.set(cacheKey, response, CACHE_TTL.TRACKING_STATS);
    console.log(`[Play Type Defense] 💾 Cached ${team} play type defense`);

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    console.error('[Play Type Defense] Error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    
    return NextResponse.json(
      {
        error: isProduction 
          ? 'Failed to fetch play type defense data. Please try again later.' 
          : 'Failed to fetch play type defense data',
        ...(isProduction ? {} : { details: error.message })
      },
      { status: 500 }
    );
  }
}


