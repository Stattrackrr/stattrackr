import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cron job to refresh Basketball Reference defensive stats cache
 * Runs daily at 7am UTC (5pm Sydney time, accounting for DST)
 * Fetches all team stats and rankings to warm the cache
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isLocal = process.env.NODE_ENV === 'development';

    if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !isLocal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Defensive Stats Cache Refresh] Starting refresh for all teams...');
    const startTime = Date.now();

    const origin = request.headers.get('host') 
      ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host')}`
      : 'http://localhost:3000';

    // Fetch all teams with rankings (this will cache the data)
    const response = await fetch(
      `${origin}/api/team-defensive-stats/bballref?all=1`,
      {
        headers: {
          'Authorization': cronSecret ? `Bearer ${cronSecret}` : '',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch defensive stats');
    }

    const duration = Date.now() - startTime;
    
    console.log(`[Defensive Stats Cache Refresh] Complete: ${duration}ms`);
    console.log(`[Defensive Stats Cache Refresh] Teams fetched: ${Object.keys(data.teamStats || {}).length}`);
    console.log(`[Defensive Stats Cache Refresh] Rankings calculated: ${Object.keys(data.rankings || {}).length}`);

    return NextResponse.json({
      success: true,
      message: 'Defensive stats cache refresh complete',
      teams: Object.keys(data.teamStats || {}).length,
      rankings: Object.keys(data.rankings || {}).length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Defensive Stats Cache Refresh] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to refresh defensive stats cache',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

