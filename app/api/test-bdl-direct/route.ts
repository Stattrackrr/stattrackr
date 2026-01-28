import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BDL_BASE_V2 = "https://api.balldontlie.io/nba/v2";
const BDL_BASE_V1 = "https://api.balldontlie.io/nba/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const testType = searchParams.get('test') || 'games';
    
    let testUrl: URL;
    let testName: string;
    
    if (testType === 'season_averages') {
      // Test team season averages for tracking/defense
      testUrl = new URL(`${BDL_BASE_V1}/team_season_averages/tracking`);
      testUrl.searchParams.set('season', '2025');
      testUrl.searchParams.set('season_type', 'regular');
      testUrl.searchParams.set('type', 'defense');
      testUrl.searchParams.set('per_page', '5');
      testName = 'Team Season Averages (Tracking/Defense)';
    } else if (testType === 'advanced_stats') {
      // Test advanced stats V2 to see estimated_usage_percentage
      testUrl = new URL(`${BDL_BASE_V2}/stats/advanced`);
      testUrl.searchParams.append('player_ids[]', '237'); // Anthony Edwards
      testUrl.searchParams.append('seasons[]', '2025');
      testUrl.searchParams.set('postseason', 'false');
      testUrl.searchParams.set('per_page', '5');
      testName = 'Advanced Stats V2 (Check estimated_usage_percentage)';
    } else {
      // Test with a simple games endpoint call
      testUrl = new URL(`${BDL_BASE_V2}/games`);
      testUrl.searchParams.set('per_page', '5');
      testUrl.searchParams.set('postseason', 'false');
      testName = 'Games';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (API_KEY) {
      headers["Authorization"] = `Bearer ${API_KEY}`;
    }

    const response = await fetch(testUrl, { 
      headers, 
      cache: "no-store" 
    });

    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      testName,
      hasApiKey: !!API_KEY,
      apiKeyLength: API_KEY ? API_KEY.length : 0,
      apiKeyPrefix: API_KEY ? `${API_KEY.substring(0, 8)}...` : 'none',
      response: responseData,
      _debug: {
        url: testUrl.toString(),
        headersSent: Object.keys(headers),
        sampleData: testType === 'season_averages' && responseData?.data?.[0] ? {
          team: responseData.data[0].team,
          statsKeys: Object.keys(responseData.data[0].stats || {}),
          sampleStats: responseData.data[0].stats,
        } : testType === 'advanced_stats' && responseData?.data?.[0] ? {
          player: responseData.data[0].player,
          game: responseData.data[0].game,
          usage_percentage: responseData.data[0].usage_percentage,
          estimated_usage_percentage: responseData.data[0].estimated_usage_percentage,
          pace: responseData.data[0].pace,
          estimated_pace: responseData.data[0].estimated_pace,
          allKeys: Object.keys(responseData.data[0]),
        } : null,
      }
    }, { 
      status: response.ok ? 200 : response.status 
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
      hasApiKey: !!API_KEY,
      apiKeyLength: API_KEY ? API_KEY.length : 0,
    }, { status: 500 });
  }
}
