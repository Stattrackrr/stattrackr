// app/api/cron/cleanup-odds-snapshots/route.ts
// Automatic cleanup of odds snapshots older than 24 hours
// This should be called by Vercel Cron daily (or hourly)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: NextRequest) {
  // Vercel Cron automatically handles authorization
  // Optional: Add CRON_SECRET check if needed
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Supabase credentials not configured' },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  try {
    console.log('[Odds Cleanup] Starting automatic cleanup of snapshots older than 24 hours...');

    // Call the cleanup function
    const { data: deletedCount, error } = await supabaseAdmin.rpc(
      'cleanup_old_odds_snapshots_24h'
    );

    if (error) {
      console.error('[Odds Cleanup] Error:', error);
      return NextResponse.json(
        { 
          success: false, 
          error: error.message,
          deleted: 0
        },
        { status: 500 }
      );
    }

    const count = deletedCount || 0;
    console.log(`[Odds Cleanup] ✅ Successfully deleted ${count} odds snapshots older than 24 hours`);

    return NextResponse.json({
      success: true,
      deleted: count,
      timestamp: new Date().toISOString(),
      message: `Deleted ${count} odds snapshots older than 24 hours`
    });
  } catch (error: any) {
    console.error('[Odds Cleanup] Unexpected error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to cleanup odds snapshots',
        deleted: 0
      },
      { status: 500 }
    );
  }
}

