export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

/**
 * Cron job to refresh player props cache
 * Runs every 2 hours to ensure player props are processed and cached
 * 
 * This triggers the background update check, which will ensure
 * the cache is populated when odds change
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[CRON] 🕐 refresh-player-props started at ${timestamp}`);

  const authResult = authorizeCronRequest(req);
  if (!authResult.authorized) {
    console.log(`[CRON] ❌ refresh-player-props unauthorized`);
    return authResult.response;
  }

  try {
    // Call the server-side processing endpoint asynchronously (don't wait for completion)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000');
    
    const processUrl = `${baseUrl}/api/nba/player-props/process`;
    
    console.log(`[CRON] 🔄 Triggering async player props processing: ${processUrl}`);
    
    // Fire and forget - don't await the response
    // This allows the cron to return immediately while processing continues in background
    // Add async=1 parameter to make the processing endpoint return immediately
    fetch(`${processUrl}?async=1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-async': 'true',
      },
      cache: 'no-store',
    }).catch((error) => {
      // Log errors but don't block cron completion
      console.error(`[CRON] ⚠️ Background processing error (non-blocking):`, error);
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[CRON] ✅ refresh-player-props triggered (processing in background) - ${elapsed}ms`);
    
    return NextResponse.json({
      success: true,
      message: 'Player props processing triggered in background',
      elapsed: `${elapsed}ms`,
      timestamp,
      note: 'Processing will complete asynchronously and update cache when finished',
    });
    
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[CRON] ❌ refresh-player-props failed after ${elapsed}ms:`, e.message);
    return NextResponse.json(
      { 
        success: false, 
        error: e?.message || 'Refresh player props failed',
        elapsed: `${elapsed}ms`,
        timestamp 
      },
      { status: 500 }
    );
  }
}

