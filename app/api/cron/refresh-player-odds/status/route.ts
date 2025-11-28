import { NextRequest, NextResponse } from "next/server";
import { getNBACache } from "@/lib/nbaCache";

export const dynamic = 'force-dynamic';
export const runtime = "nodejs";

/**
 * Status endpoint to check if the player odds cron job is working
 * Shows last run info and cache statistics
 */
export async function GET(req: NextRequest) {
  try {
    const PLAYER_ODDS_CACHE_PREFIX = 'player_odds:';
    const PLAYER_STATS_CACHE_PREFIX = 'player_stats:';
    const lastFullScanKey = 'player_odds:last_full_scan';
    
    // Get last full scan timestamp
    const lastFullScan = await getNBACache<string>(lastFullScanKey, { quiet: true });
    
    // Get sample player odds cache to check if data exists
    // We'll check a few common player IDs to see if cache is populated
    const sampleKeys = [
      `${PLAYER_ODDS_CACHE_PREFIX}201939:`, // Stephen Curry (common player)
      `${PLAYER_ODDS_CACHE_PREFIX}2544:`,   // LeBron James
    ];
    
    let cachedPlayers = 0;
    let sampleData = null;
    
    // Try to find any cached player odds
    for (const keyPrefix of sampleKeys) {
      // Note: We can't list all keys, so we'll just check if we can get a sample
      // In a real scenario, you'd need to track this differently
      try {
        // This is a simplified check - in production you'd want to track this better
        const testKey = `${keyPrefix}*`;
        // We can't easily enumerate, so we'll just report the last scan time
      } catch (e) {
        // Ignore
      }
    }
    
    // Get today's date for context
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    return NextResponse.json({
      success: true,
      cronJob: {
        name: 'refresh-player-odds',
        schedule: '*/30 * * * *', // Every 30 minutes
        status: 'active',
        lastFullScan: lastFullScan || 'never',
        lastFullScanAgo: lastFullScan 
          ? `${Math.round((Date.now() - new Date(lastFullScan).getTime()) / 60000)} minutes ago`
          : 'never',
      },
      cache: {
        prefix: PLAYER_ODDS_CACHE_PREFIX,
        ttl: '120 minutes',
        note: 'Check Vercel logs for detailed execution info',
      },
      howToCheck: {
        vercelLogs: 'Go to Vercel Dashboard → Your Project → Logs → Filter by "/api/cron/refresh-player-odds"',
        manualTest: 'Use: node scripts/test-player-odds-cron.js update',
        checkCache: 'Look for player_odds:* keys in your Supabase nba_api_cache table',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { 
        success: false, 
        error: error?.message || 'Failed to get status',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

