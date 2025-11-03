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

async function checkIfAnyGamesComplete(): Promise<{ shouldIngest: boolean; completedCount: number; totalCount: number }> {
  try {
    // Check BDL API for yesterday's games (NBA games happen in US evening, which is next day in Australia/Asia)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    
    const url = `https://api.balldontlie.io/v1/games?start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) return { shouldIngest: false, completedCount: 0, totalCount: 0 };
    
    const data = await res.json();
    const games = Array.isArray(data?.data) ? data.data : [];
    
    if (games.length === 0) {
      console.log('[auto-ingest] No games scheduled for today');
      return { shouldIngest: false, completedCount: 0, totalCount: 0 };
    }

    // Count completed games
    const completedGames = games.filter((game: any) => {
      const rawStatus = String(game?.status || '');
      const status = rawStatus.toLowerCase();
      console.log(`[auto-ingest] Game ${game.id}: ${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}, status: "${rawStatus}"`);
      if (status.includes('final') || status.includes('completed')) return true;
      // Some BDL responses return an ISO tipoff time in status; treat games older than ~3h as completed
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
    const shouldIngest = completedCount > 0;

    console.log(`[auto-ingest] Games today: ${totalCount}, Completed: ${completedCount}`);
    return { shouldIngest, completedCount, totalCount };
  } catch (e: any) {
    console.error('[auto-ingest] Error checking games:', e.message);
    return { shouldIngest: false, completedCount: 0, totalCount: 0 };
  }
}

export async function GET(req: NextRequest) {
  try {
    console.log('[auto-ingest] Cron job triggered');

    // Check if any games are complete
    const { shouldIngest, completedCount, totalCount } = await checkIfAnyGamesComplete();

    if (!shouldIngest) {
      return NextResponse.json({
        success: true,
        message: 'No completed games yet, skipping ingest',
        ingested: false,
        completedGames: completedCount,
        totalGames: totalCount,
      });
    }

    // All games complete - trigger ingest
    const host = req.headers.get('host') || '';
    const ingestUrl = `http://${host}/api/dvp/ingest-nba-all?latest=1`;

    console.log('[auto-ingest] Triggering ingest:', ingestUrl);

    const ingestRes = await fetch(ingestUrl, { cache: 'no-store' });
    const ingestData = await ingestRes.json();

    console.log('[auto-ingest] Ingest result:', ingestData);

    return NextResponse.json({
      success: true,
      message: 'Auto-ingest completed',
      ingested: true,
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
