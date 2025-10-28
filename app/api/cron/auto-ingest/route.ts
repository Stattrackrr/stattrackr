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

async function checkIfAllGamesComplete(): Promise<boolean> {
  try {
    // Check BDL API for today's games
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    const url = `https://api.balldontlie.io/v1/games?start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) return false;
    
    const data = await res.json();
    const games = Array.isArray(data?.data) ? data.data : [];
    
    if (games.length === 0) {
      console.log('[auto-ingest] No games scheduled for today');
      return false; // No games today, skip
    }

    // Check if all games have "Final" status
    const allComplete = games.every((game: any) => {
      const status = String(game?.status || '').toLowerCase();
      return status.includes('final');
    });

    console.log(`[auto-ingest] Games today: ${games.length}, All complete: ${allComplete}`);
    return allComplete;
  } catch (e: any) {
    console.error('[auto-ingest] Error checking games:', e.message);
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret (for security)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || 'your-secret-key-here';
    
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[auto-ingest] Cron job triggered');

    // Check if all games are complete
    const allComplete = await checkIfAllGamesComplete();

    if (!allComplete) {
      return NextResponse.json({
        success: true,
        message: 'Games not yet complete, skipping ingest',
        ingested: false,
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
