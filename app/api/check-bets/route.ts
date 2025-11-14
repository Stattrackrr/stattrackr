export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Check if any NBA games finished recently (in the last hour)
 * Returns true if we should check bets, false otherwise
 */
async function shouldCheckBets(): Promise<{ shouldCheck: boolean; recentlyFinished: number; reason: string }> {
  try {
    // Check games from today and yesterday
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // Fetch games from yesterday and today
    const url = `https://api.balldontlie.io/v1/games?start_date=${yesterdayStr}&end_date=${todayStr}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': BALLDONTLIE_API_KEY || '',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.log('[check-bets] Failed to fetch games, checking bets anyway to be safe');
      return { shouldCheck: true, recentlyFinished: 0, reason: 'API error - checking to be safe' };
    }

    const data = await res.json();
    const games = Array.isArray(data?.data) ? data.data : [];

    if (games.length === 0) {
      return { shouldCheck: false, recentlyFinished: 0, reason: 'No games found' };
    }

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // 1 hour in milliseconds
    const twoHoursAgo = now - (2 * 60 * 60 * 1000); // 2 hours in milliseconds
    
    // Count games that finished recently (in the last hour)
    // Also check games that might finish soon (started 2-3 hours ago, likely finishing now)
    let recentlyFinished = 0;
    let gamesFinishingSoon = 0;

    for (const game of games) {
      const rawStatus = String(game?.status || '');
      const status = rawStatus.toLowerCase();
      
      // Check if game is final
      if (status.includes('final') || status.includes('completed')) {
        // Try to parse when the game ended from the status
        // BDL sometimes includes timestamp in status
        const statusTime = Date.parse(rawStatus);
        if (!Number.isNaN(statusTime)) {
          // If game finished in the last hour, count it
          if (statusTime > oneHourAgo && statusTime <= now) {
            recentlyFinished++;
          }
        } else {
          // If we can't parse time, check game date
          const gameDate = game?.date ? new Date(game.date) : null;
          if (gameDate) {
            // Assume game ended ~2.5 hours after tipoff
            const estimatedEndTime = gameDate.getTime() + (2.5 * 60 * 60 * 1000);
            if (estimatedEndTime > oneHourAgo && estimatedEndTime <= now) {
              recentlyFinished++;
            }
          }
        }
      } else {
        // Check if game started 2-3 hours ago (likely finishing now)
        const gameDate = game?.date ? new Date(game.date) : null;
        if (gameDate) {
          const gameStartTime = gameDate.getTime();
          const timeSinceStart = now - gameStartTime;
          // If game started 2-3 hours ago, it's likely finishing
          if (timeSinceStart > (2 * 60 * 60 * 1000) && timeSinceStart < (3.5 * 60 * 60 * 1000)) {
            gamesFinishingSoon++;
          }
        }
      }
    }

    // Check bets if:
    // 1. Games finished in the last hour, OR
    // 2. Games are finishing soon (started 2-3 hours ago), OR
    // 3. It's during NBA game hours (6 PM - 1 AM ET, roughly 23:00 - 06:00 UTC)
    const utcHour = new Date().getUTCHours();
    const isGameTime = utcHour >= 23 || utcHour <= 6;

    const shouldCheck = recentlyFinished > 0 || gamesFinishingSoon > 0 || isGameTime;
    const reason = recentlyFinished > 0 
      ? `${recentlyFinished} game(s) finished recently`
      : gamesFinishingSoon > 0
      ? `${gamesFinishingSoon} game(s) finishing soon`
      : 'During NBA game hours';

    return { shouldCheck, recentlyFinished: recentlyFinished + gamesFinishingSoon, reason };
  } catch (error: any) {
    console.error('[check-bets] Error checking game status:', error);
    // On error, check bets anyway to be safe
    return { shouldCheck: true, recentlyFinished: 0, reason: 'Error - checking to be safe' };
  }
}

export async function GET(req: Request) {
  try {
    // First, check if any games finished recently
    const { shouldCheck, recentlyFinished, reason } = await shouldCheckBets();
    
    if (!shouldCheck) {
      console.log(`[check-bets] Skipping bet checks: ${reason}`);
      return NextResponse.json({
        message: 'Bet checks skipped',
        reason,
        recentlyFinished,
        results: {
          trackedBets: { updated: 0, total: 0, error: null },
          journalBets: { updated: 0, total: 0, error: null },
        },
        totalUpdated: 0,
      });
    }

    console.log(`[check-bets] Checking bets: ${reason} (${recentlyFinished} games)`);

    const results = {
      trackedBets: { updated: 0, total: 0, error: null as string | null },
      journalBets: { updated: 0, total: 0, error: null as string | null },
    };

    // Use production domain to avoid preview deployment authentication issues
    const host = req.headers.get('host') || '';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const productionDomain = process.env.NEXT_PUBLIC_BASE_URL || 'stattrackr.co';
    const useProductionDomain = host.includes('.vercel.app') || host.includes('localhost');
    const baseUrl = useProductionDomain 
      ? `${protocol}://${productionDomain}`
      : (process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`);

    // Check tracked bets
    try {
      const trackedResponse = await fetch(`${baseUrl}/api/check-tracked-bets`);
      if (trackedResponse.ok) {
        const data = await trackedResponse.json();
        results.trackedBets = { updated: data.updated || 0, total: data.total || 0, error: null };
      } else {
        results.trackedBets.error = 'Failed to check tracked bets';
      }
    } catch (error: any) {
      results.trackedBets.error = error.message;
    }

    // Check journal bets
    try {
      const journalResponse = await fetch(`${baseUrl}/api/check-journal-bets`);
      if (journalResponse.ok) {
        const data = await journalResponse.json();
        results.journalBets = { updated: data.updated || 0, total: data.total || 0, error: null };
      } else {
        results.journalBets.error = 'Failed to check journal bets';
      }
    } catch (error: any) {
      results.journalBets.error = error.message;
    }

    return NextResponse.json({
      message: 'Bet checks completed',
      reason,
      recentlyFinished,
      results,
      totalUpdated: results.trackedBets.updated + results.journalBets.updated,
    });
  } catch (error: any) {
    console.error('Error checking bets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check bets' },
      { status: 500 }
    );
  }
}
