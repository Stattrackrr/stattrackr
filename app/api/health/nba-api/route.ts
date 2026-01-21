// app/api/health/nba-api/route.ts
// Health check endpoint to test NBA API connectivity from production
import { NextRequest, NextResponse } from 'next/server';

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

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const results: any = {
    timestamp: new Date().toISOString(),
    tests: [],
  };

  // Test 1: Simple endpoint (scoreboard)
  try {
    const testUrl = `${NBA_STATS_BASE}/scoreboardv2?GameDate=2025-11-22&DayOffset=0`;
    console.log(`[NBA Health Check] Testing: ${testUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(testUrl, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      results.tests.push({
        name: 'Scoreboard API',
        status: 'success',
        statusCode: response.status,
        duration: `${duration}ms`,
        hasData: !!data?.resultSets,
      });
    } else {
      const text = await response.text();
      results.tests.push({
        name: 'Scoreboard API',
        status: 'failed',
        statusCode: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        error: text.slice(0, 200),
      });
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    results.tests.push({
      name: 'Scoreboard API',
      status: 'error',
      error: error.message,
      errorType: error.name,
      duration: `${duration}ms`,
    });
  }

  // Test 2: Player stats endpoint
  try {
    const testUrl = `${NBA_STATS_BASE}/commonplayerinfo?PlayerID=203924`;
    console.log(`[NBA Health Check] Testing: ${testUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(testUrl, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
    
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      results.tests.push({
        name: 'Player Info API',
        status: 'success',
        statusCode: response.status,
        duration: `${duration}ms`,
        hasData: !!data?.resultSets,
      });
    } else {
      const text = await response.text();
      results.tests.push({
        name: 'Player Info API',
        status: 'failed',
        statusCode: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        error: text.slice(0, 200),
      });
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    results.tests.push({
      name: 'Player Info API',
      status: 'error',
      error: error.message,
      errorType: error.name,
      duration: `${duration}ms`,
    });
  }

  // Summary
  const successCount = results.tests.filter((t: any) => t.status === 'success').length;
  const totalTests = results.tests.length;
  results.summary = {
    total: totalTests,
    successful: successCount,
    failed: totalTests - successCount,
    allPassed: successCount === totalTests,
  };

  const statusCode = results.summary.allPassed ? 200 : 503;
  
  return NextResponse.json(results, { 
    status: statusCode,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

