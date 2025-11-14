export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

/**
 * Auto-ingest cron job
 * Runs daily to check for completed games and ingest them
 * 
 * Deployment options:
 * 1. Vercel Cron: Add to vercel.json
 * 2. External cron service (cron-job.org, EasyCron)
 * 3. GitHub Actions scheduled workflow
 */

async function checkIfAnyGamesComplete(): Promise<{ shouldIngest: boolean; completedCount: number; totalCount: number; newGamesCount: number }> {
  try {
    // Check both today and yesterday's games (NBA games happen in US evening, which is next day in some timezones)
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // Fetch games for both days
    const url = `https://api.balldontlie.io/v1/games?start_date=${yesterdayStr}&end_date=${todayStr}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[auto-ingest] BDL API error: ${res.status}`);
      return { shouldIngest: false, completedCount: 0, totalCount: 0, newGamesCount: 0 };
    }
    
    const data = await res.json();
    const games = Array.isArray(data?.data) ? data.data : [];

    if (games.length === 0) {
      console.log('[auto-ingest] No games found for today/yesterday');
      return { shouldIngest: false, completedCount: 0, totalCount: 0, newGamesCount: 0 };
    }

    // Count completed games (final status or games that started more than 3 hours ago)
    const completedGames = games.filter((game: any) => {
      const rawStatus = String(game?.status || '');
      const status = rawStatus.toLowerCase();
      
      // Check if status explicitly says final/completed
      if (status.includes('final') || status.includes('completed')) {
        return true;
      }
      
      // Check if game date has passed and it's been more than 3 hours since tipoff
      const gameDate = game?.date ? new Date(game.date) : null;
      if (gameDate) {
        const now = new Date();
        const threeHoursMs = 3 * 60 * 60 * 1000;
        // If game was scheduled more than 3 hours ago, assume it's completed
        if (now.getTime() - gameDate.getTime() > threeHoursMs) {
          return true;
        }
      }
      
      // Some BDL responses return an ISO tipoff time in status
      const ts = Date.parse(rawStatus);
      if (!Number.isNaN(ts)) {
        const start = new Date(ts);
        const now = new Date();
        const threeHoursMs = 3 * 60 * 60 * 1000;
        return now.getTime() - start.getTime() > threeHoursMs;
      }
      
      return false;
    });

    const completedCount = completedGames.length;
    const totalCount = games.length;
    
    // Always ingest if there are completed games (the latest=1 flag will only ingest new ones)
    const shouldIngest = completedCount > 0;

    console.log(`[auto-ingest] Games found: ${totalCount}, Completed: ${completedCount}`);
    return { shouldIngest, completedCount, totalCount, newGamesCount: completedCount };
  } catch (e: any) {
    console.error('[auto-ingest] Error checking games:', e.message);
    return { shouldIngest: false, completedCount: 0, totalCount: 0, newGamesCount: 0 };
  }
}

export async function GET(req: NextRequest) {
  try {
    console.log('[auto-ingest] Cron job triggered');

    // Check if any games are complete
    const { shouldIngest, completedCount, totalCount, newGamesCount } = await checkIfAnyGamesComplete();

    if (!shouldIngest) {
      return NextResponse.json({
        success: true,
        message: 'No completed games yet, skipping ingest',
        ingested: false,
        completedGames: completedCount,
        totalGames: totalCount,
      });
    }

    // Trigger ingest with latest=1 to only ingest new games
    // Use production domain to avoid preview deployment authentication issues
    const host = req.headers.get('host') || '';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    
    // If it's a preview deployment (contains .vercel.app), use production domain instead
    const productionDomain = process.env.NEXT_PUBLIC_BASE_URL || 'stattrackr.co';
    const useProductionDomain = host.includes('.vercel.app') || host.includes('localhost');
    
    const ingestHost = useProductionDomain ? productionDomain : host;
    const ingestUrl = `${protocol}://${ingestHost}/api/dvp/ingest-nba-all?latest=1`;

    console.log('[auto-ingest] Triggering ingest:', ingestUrl);

    const ingestRes = await fetch(ingestUrl, { 
      cache: 'no-store',
      headers: {
        'User-Agent': 'StatTrackr-AutoIngest/1.0',
      }
    });
    
    if (!ingestRes.ok) {
      const errorText = await ingestRes.text().catch(() => 'Unknown error');
      throw new Error(`Ingest failed: ${ingestRes.status} - ${errorText}`);
    }
    
    const ingestData = await ingestRes.json();

    console.log('[auto-ingest] Ingest result:', JSON.stringify(ingestData, null, 2));

    return NextResponse.json({
      success: true,
      message: 'Auto-ingest completed',
      ingested: true,
      completedGames: completedCount,
      totalGames: totalCount,
      newGamesCount,
      result: ingestData,
    });
  } catch (e: any) {
    console.error('[auto-ingest] Error:', e.message);
    return NextResponse.json(
      { success: false, error: e?.message || 'Auto-ingest failed' },
      { status: 200 }
    );
  }
}
