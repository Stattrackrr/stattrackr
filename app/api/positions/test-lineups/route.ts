import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  
  // Try different possible endpoints
  const endpoints = [
    `https://core-api.nba.com/cp/api/v1.9/lineups?date=${date}&platform=web`,
    `https://core-api.nba.com/cp/api/v1.9/starting-lineups?date=${date}&platform=web`,
    `https://core-api.nba.com/cp/api/v1.9/gameDetails?leagueId=00&date=${date}&platform=web`,
  ];
  
  const results: any = {};
  
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (res.ok) {
        const data = await res.json();
        results[endpoint] = {
          status: res.status,
          data: JSON.stringify(data).substring(0, 1000) // First 1000 chars
        };
      } else {
        results[endpoint] = {
          status: res.status,
          error: `HTTP ${res.status}`
        };
      }
    } catch (e: any) {
      results[endpoint] = {
        error: e.message
      };
    }
  }
  
  return NextResponse.json({ date, results });
}

