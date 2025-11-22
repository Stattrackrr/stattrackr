// Test endpoint to verify maxDuration is working
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Simulate a long-running task
  await new Promise(resolve => setTimeout(resolve, 55000)); // 55 seconds
  
  const elapsed = Date.now() - startTime;
  
  return NextResponse.json({
    success: true,
    message: 'Function completed successfully',
    elapsedSeconds: Math.round(elapsed / 1000),
    maxDuration: 60,
    timestamp: new Date().toISOString()
  });
}

