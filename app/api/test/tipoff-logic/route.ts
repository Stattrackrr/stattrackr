export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache } from '@/lib/nbaCache';
import type { OddsCache } from '@/app/api/odds/refresh/route';

/**
 * Test endpoint to verify tipoff checking logic
 * Usage: GET /api/test/tipoff-logic?time=2025-01-15T14:15:00-05:00
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const testTimeStr = searchParams.get('time');
    const testTime = testTimeStr ? new Date(testTimeStr) : new Date();

    // Get odds cache
    const oddsCache = await getNBACache<OddsCache>('all_nba_odds_v2_bdl', {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: false,
    });

    if (!oddsCache) {
      return NextResponse.json({
        success: false,
        error: 'No odds cache available',
      }, { status: 404 });
    }

    // Helper function
    const getUSEasternDateString = (date: Date): string => {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      });
    };

    const todayUSET = getUSEasternDateString(testTime);
    const todayGames = oddsCache.games?.filter((game: any) => {
      if (!game.commenceTime) return false;
      const commenceStr = String(game.commenceTime).trim();
      let gameDateUSET: string;
      
      if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
        gameDateUSET = commenceStr;
      } else {
        const date = new Date(commenceStr);
        gameDateUSET = getUSEasternDateString(date);
      }
      
      return gameDateUSET === todayUSET;
    }) || [];

    // Find last tipoff (only games with actual times)
    let lastTipoff: Date | null = null;
    const gamesWithTimes: Array<{ game: string; tipoff: string }> = [];
    const gamesWithoutTimes: Array<{ game: string; reason: string }> = [];

    for (const game of todayGames) {
      if (!game.commenceTime) continue;
      const commenceStr = String(game.commenceTime).trim();
      const gameName = `${game.awayTeam} @ ${game.homeTeam}`;
      
      if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
        gamesWithoutTimes.push({
          game: gameName,
          reason: 'Date-only string (no time)'
        });
        continue;
      }
      
      const tipoffDate = new Date(commenceStr);
      if (isNaN(tipoffDate.getTime())) {
        gamesWithoutTimes.push({
          game: gameName,
          reason: 'Invalid time format'
        });
        continue;
      }
      
      gamesWithTimes.push({
        game: gameName,
        tipoff: tipoffDate.toISOString()
      });
      
      if (!lastTipoff || tipoffDate > lastTipoff) {
        lastTipoff = tipoffDate;
      }
    }

    const tipoffTime = lastTipoff?.getTime() || 0;
    const currentTime = testTime.getTime();
    const tenMinutesAfterTipoff = tipoffTime + (10 * 60 * 1000);
    const shouldTrigger = lastTipoff ? currentTime >= tenMinutesAfterTipoff : false;
    const minutesSinceTipoff = lastTipoff ? Math.floor((currentTime - tipoffTime) / (60 * 1000)) : null;
    const minutesUntilTrigger = lastTipoff ? Math.ceil((tenMinutesAfterTipoff - currentTime) / (60 * 1000)) : null;

    return NextResponse.json({
      success: true,
      testTime: testTime.toISOString(),
      testTimeET: testTime.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      todayUSET,
      totalGames: todayGames.length,
      gamesWithTimesCount: gamesWithTimes.length,
      gamesWithoutTimesCount: gamesWithoutTimes.length,
      lastTipoff: lastTipoff?.toISOString() || null,
      lastTipoffET: lastTipoff ? lastTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' }) : null,
      tenMinutesAfterTipoff: lastTipoff ? new Date(tenMinutesAfterTipoff).toISOString() : null,
      shouldTrigger,
      minutesSinceTipoff,
      minutesUntilTrigger,
      gamesWithTimes,
      gamesWithoutTimes,
      message: shouldTrigger 
        ? '✅ Would trigger workflow (10 minutes have passed since tipoff)'
        : lastTipoff 
          ? `⏳ Would not trigger yet (${minutesUntilTrigger} minutes remaining)`
          : '❌ Cannot determine (no games with actual tipoff times)'
    });

  } catch (error: any) {
    console.error('[Test Tipoff Logic] Error:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || 'Unknown error'
    }, { status: 500 });
  }
}

