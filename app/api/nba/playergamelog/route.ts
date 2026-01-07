import { NextRequest, NextResponse } from 'next/server';

const NBA_BASE = "https://stats.nba.com/stats";
const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/stats/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};

async function nbaFetch(pathAndQuery: string, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${NBA_BASE}/${pathAndQuery}`, {
      headers: NBA_HEADERS,
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`NBA API ${res.status}: ${errorText.substring(0, 200)}`);
    }
    return await res.json();
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw e;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get('player_id');
    const season = searchParams.get('season') || '2025-26';
    const seasonType = searchParams.get('season_type') || 'Regular Season';
    
    // Input validation
    if (!playerId) {
      return NextResponse.json({ error: 'player_id is required' }, { status: 400 });
    }

    // Validate playerId format (should be numeric, max 10 digits)
    if (!/^\d{1,10}$/.test(playerId)) {
      return NextResponse.json(
        { error: 'Invalid player_id format. Must be numeric (1-10 digits)' },
        { status: 400 }
      );
    }

    // Validate season format (YYYY-YY)
    if (season && !/^\d{4}-\d{2}$/.test(season)) {
      return NextResponse.json(
        { error: 'Invalid season format. Use YYYY-YY (e.g., 2025-26)' },
        { status: 400 }
      );
    }

    // Validate seasonType (whitelist allowed values)
    const allowedSeasonTypes = ['Regular Season', 'Playoffs', 'Pre Season'];
    if (seasonType && !allowedSeasonTypes.includes(seasonType)) {
      return NextResponse.json(
        { error: `Invalid season_type. Must be one of: ${allowedSeasonTypes.join(', ')}` },
        { status: 400 }
      );
    }
    
    const url = `playergamelog?PlayerID=${playerId}&Season=${encodeURIComponent(season)}&SeasonType=${encodeURIComponent(seasonType)}`;
    const data = await nbaFetch(url);
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Player Game Log API] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch player game log' },
      { status: 500 }
    );
  }
}
















