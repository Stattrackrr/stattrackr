export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side logging endpoint
 * Accepts logs from the client and prints them to the server terminal
 * This prevents logs from being cleared by React's double render in development
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level = 'log', message, data, timestamp } = body;
    
    const time = timestamp || new Date().toISOString();
    const prefix = `[CLIENT ${level.toUpperCase()}]`;
    
    // Format the log message
    if (data) {
      console.log(`${prefix} [${time}] ${message}`, data);
    } else {
      console.log(`${prefix} [${time}] ${message}`);
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DEBUG LOG API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to log' },
      { status: 500 }
    );
  }
}

