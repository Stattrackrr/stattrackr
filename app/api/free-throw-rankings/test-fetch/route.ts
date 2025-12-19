// app/api/free-throw-rankings/test-fetch/route.ts
// Test endpoint to fetch and cache opponent free throw rankings
// This allows testing without running the full 45-minute refresh

import { NextRequest, NextResponse } from 'next/server';
import { setNBACache } from '@/lib/nbaCache';
import { cache, CACHE_TTL } from '@/lib/cache';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/stats/',
  'Origin': 'https://www.nba.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

async function fetchNBAStats(url: string, timeout = 120000, retries = 3) {
  let lastError: Error | null = null;
  const maxAttempts = retries + 1;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: NBA_HEADERS,
        signal: controller.signal,
        cache: 'no-store'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[Test Fetch] NBA API error ${response.status} (attempt ${attempt + 1}/${maxAttempts}):`, text.slice(0, 200));
        
        if (response.status >= 500 && attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`NBA API ${response.status}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${timeout}ms`);
        if (attempt < retries) {
          console.log(`[Test Fetch] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      lastError = error;
      if (attempt < retries) {
        console.log(`[Test Fetch] Error on attempt ${attempt + 1}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  
  throw lastError || new Error('Failed after retries');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    
    console.log(`[Test Fetch] Fetching opponent free throw rankings for season ${seasonStr}...`);
    
    // Fetch opponent free throw rankings (OPP FTM) in bulk
    const opponentStatsParams = new URLSearchParams({
      LeagueID: '00',
      Season: seasonStr,
      SeasonType: 'Regular Season',
      PerMode: 'PerGame',
      MeasureType: 'Opponent',
      TeamID: '0',
      PaceAdjust: 'N',
      PlusMinus: 'N',
      Rank: 'N',
      Outcome: '',
      Location: '',
      Month: '0',
      SeasonSegment: '',
      DateFrom: '',
      DateTo: '',
      OpponentTeamID: '0',
      VsConference: '',
      VsDivision: '',
      GameSegment: '',
      Period: '0',
      LastNGames: '0',
      GameScope: '',
    });
    
    const opponentStatsUrl = `${NBA_STATS_BASE}/leaguedashteamstats?${opponentStatsParams.toString()}`;
    console.log(`[Test Fetch] Calling NBA API: ${opponentStatsUrl}`);
    
    const opponentStatsData = await fetchNBAStats(opponentStatsUrl, 120000, 3);
    
    if (!opponentStatsData?.resultSets?.[0]) {
      return NextResponse.json({
        success: false,
        error: 'No data returned from NBA API',
        response: opponentStatsData,
      }, { status: 500 });
    }
    
    const resultSet = opponentStatsData.resultSets[0];
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];
    
    console.log(`[Test Fetch] Response: ${rows.length} rows, headers:`, headers);
    
    const teamIdIdx = headers.indexOf('TEAM_ID');
    const oppFtmIdx = headers.indexOf('OPP_FTM');
    
    console.log(`[Test Fetch] Column indices: TEAM_ID=${teamIdIdx}, OPP_FTM=${oppFtmIdx}`);
    
    if (teamIdIdx < 0 || oppFtmIdx < 0) {
      return NextResponse.json({
        success: false,
        error: 'Required columns not found',
        headers,
        teamIdIdx,
        oppFtmIdx,
      }, { status: 500 });
    }
    
    // NBA Stats API team ID to abbreviation mapping (different from BDL IDs)
    const TEAM_ID_TO_ABBR_NBA: Record<number, string> = {
      1610612737: 'ATL', 1610612738: 'BOS', 1610612751: 'BKN', 1610612766: 'CHA',
      1610612741: 'CHI', 1610612739: 'CLE', 1610612742: 'DAL', 1610612743: 'DEN',
      1610612765: 'DET', 1610612744: 'GSW', 1610612745: 'HOU', 1610612754: 'IND',
      1610612746: 'LAC', 1610612747: 'LAL', 1610612763: 'MEM', 1610612748: 'MIA',
      1610612749: 'MIL', 1610612750: 'MIN', 1610612740: 'NOP', 1610612752: 'NYK',
      1610612760: 'OKC', 1610612753: 'ORL', 1610612755: 'PHI', 1610612756: 'PHX',
      1610612757: 'POR', 1610612758: 'SAC', 1610612759: 'SAS', 1610612761: 'TOR',
      1610612762: 'UTA', 1610612764: 'WAS'
    };
    
    const opponentFreeThrowRankings: Array<{ team: string; oppFtm: number }> = [];
    
    rows.forEach((row: any[]) => {
      const teamId = parseInt(row[teamIdIdx]) || 0;
      const oppFtm = parseFloat(row[oppFtmIdx]) || 0;
      const teamAbbr = TEAM_ID_TO_ABBR_NBA[teamId];
      
      if (teamAbbr) {
        opponentFreeThrowRankings.push({ team: teamAbbr.toUpperCase(), oppFtm });
      } else {
        console.warn(`[Test Fetch] No abbreviation found for NBA team ID ${teamId}`);
      }
    });
    
    // Sort by OPP_FTM (ascending - lower OPP_FTM = better defense = rank 1)
    opponentFreeThrowRankings.sort((a, b) => a.oppFtm - b.oppFtm);
    
    console.log(`[Test Fetch] ✅ Fetched ${opponentFreeThrowRankings.length} teams`);
    console.log(`[Test Fetch] Sample rankings:`, opponentFreeThrowRankings.slice(0, 5));
    
    // Cache the data
    const opponentFreeThrowsCacheKey = `opponent_freethrows_rankings_${seasonStr}`;
    await setNBACache(opponentFreeThrowsCacheKey, 'opponent_freethrows_rankings', opponentFreeThrowRankings, CACHE_TTL.TRACKING_STATS);
    cache.set(opponentFreeThrowsCacheKey, opponentFreeThrowRankings, CACHE_TTL.TRACKING_STATS);
    
    console.log(`[Test Fetch] ✅ Cached opponent free throw rankings`);
    
    return NextResponse.json({
      success: true,
      season: seasonStr,
      totalTeams: opponentFreeThrowRankings.length,
      rankings: opponentFreeThrowRankings.map((r, idx) => ({
        rank: idx + 1,
        team: r.team,
        oppFtm: r.oppFtm,
      })),
      cacheKey: opponentFreeThrowsCacheKey,
    });
    
  } catch (error: any) {
    console.error('[Test Fetch] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }, { status: 500 });
  }
}

