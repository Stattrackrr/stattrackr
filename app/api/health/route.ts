// Simple health check endpoint
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    // Safe to expose: only whether RESEND_API_KEY is set (for debugging email auth in production)
    resendConfigured: !!process.env.RESEND_API_KEY,
  });
}

