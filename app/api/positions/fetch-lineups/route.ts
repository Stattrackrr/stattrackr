import { NextRequest, NextResponse } from 'next/server';

/**
 * Fetch starting lineups from NBA API
 * This endpoint tries multiple possible NBA API endpoints to get starting lineups
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  
  // Try different possible endpoints based on common NBA API patterns
  const endpoints = [
    // Core API endpoints
    `https://core-api.nba.com/cp/api/v1.9/lineups?date=${date}&platform=web`,
    `https://core-api.nba.com/cp/api/v1.9/starting-lineups?date=${date}&platform=web`,
    `https://core-api.nba.com/cp/api/v1.9/games/${date}/lineups?platform=web`,
    
    // Stats API endpoints
    `https://stats.nba.com/stats/leaguedashlineups?DateFrom=${date}&DateTo=${date}&GameSegment=&LastNGames=0&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PaceAdjust=N&PerMode=Totals&Period=0&PlusMinus=N&Rank=N&Season=2025-26&SeasonSegment=&SeasonType=Regular+Season&VsConference=&VsDivision=`,
    
    // Alternative patterns
    `https://cdn.nba.com/static/json/liveData/lineups/${date}.json`,
    `https://data.nba.com/data/10s/v2015/json/mobile_teams/nba/2025/teams/lineups_${date}.json`,
  ];
  
  const results: any = {};
  let foundEndpoint: string | null = null;
  
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.nba.com/players/todays-lineups',
          'Origin': 'https://www.nba.com',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (res.ok) {
        const data = await res.json();
        const dataStr = JSON.stringify(data);
        
        // Check if response looks like lineup data
        if (dataStr.includes('lineup') || dataStr.includes('starter') || dataStr.includes('position') || 
            (Array.isArray(data) && data.length > 0) || 
            (data?.games && Array.isArray(data.games)) ||
            (data?.resultSets && Array.isArray(data.resultSets))) {
          foundEndpoint = endpoint;
          results[endpoint] = {
            status: res.status,
            success: true,
            dataPreview: dataStr.substring(0, 2000), // First 2000 chars
            dataSize: dataStr.length
          };
          break; // Found it!
        } else {
          results[endpoint] = {
            status: res.status,
            success: false,
            note: 'Response OK but doesn\'t look like lineup data',
            preview: dataStr.substring(0, 500)
          };
        }
      } else {
        results[endpoint] = {
          status: res.status,
          success: false,
          error: `HTTP ${res.status}`
        };
      }
    } catch (e: any) {
      results[endpoint] = {
        success: false,
        error: e.message
      };
    }
  }
  
  return NextResponse.json({ 
    date, 
    foundEndpoint,
    results,
    message: foundEndpoint ? `✅ Found working endpoint: ${foundEndpoint}` : '❌ No working endpoint found. Check Network tab for actual API call.'
  });
}

