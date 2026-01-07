/**
 * Warmup endpoint to keep serverless functions warm
 * Call this periodically to prevent cold starts
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Check if this is a warmup request (from cron or health check)
  const isWarmup = req.headers.get('x-warmup') === 'true' || 
                   req.nextUrl.searchParams.get('warmup') === 'true';

  if (isWarmup) {
    // Optionally warm up critical endpoints by making internal requests
    // This keeps the functions warm and caches populated
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
                    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                    'http://localhost:3000';

    // Warm up critical endpoints in parallel (non-blocking)
    const warmupPromises = [
      // Warm up stats API (most critical)
      fetch(`${baseUrl}/api/stats?player_id=237&season=2024&per_page=10&max_pages=1&skip_dvp=1`, {
        headers: { 'x-warmup': 'true' }
      }).catch(() => null),
      
      // Warm up games API
      fetch(`${baseUrl}/api/bdl/games?start_date=${new Date().toISOString().split('T')[0]}&end_date=${new Date().toISOString().split('T')[0]}`, {
        headers: { 'x-warmup': 'true' }
      }).catch(() => null),
    ];

    // Don't await - let them run in background
    Promise.allSettled(warmupPromises).then(() => {
      console.log('[Warmup] ✅ Critical endpoints warmed up');
    });

    return NextResponse.json({ 
      status: 'warmed',
      timestamp: new Date().toISOString(),
      message: 'Warmup request processed'
    });
  }

  return NextResponse.json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
}

