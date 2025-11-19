export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { cleanupFinishedGameSnapshots } from '@/lib/cleanupOddsSnapshots';

export const runtime = 'nodejs';

/**
 * API endpoint to manually trigger cleanup of finished game snapshots
 * Can be called via cron job or manually
 */
export async function GET(request: NextRequest) {
  try {
    // Check authorization for manual calls (Vercel cron doesn't send auth headers)
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret') || authHeader?.replace('Bearer ', '');
    
    // Only check secret if provided (allows Vercel cron to work without auth)
    // For manual calls, require secret if CLEANUP_SECRET_KEY is set
    const expectedSecret = process.env.CLEANUP_SECRET_KEY || process.env.CRON_SECRET;
    if (expectedSecret && secret && secret !== expectedSecret) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }

    console.log('🧹 Cleanup cron job triggered');
    const result = await cleanupFinishedGameSnapshots();
    
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Cleanup API error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cleanup snapshots'
    }, { status: 500 });
  }
}

