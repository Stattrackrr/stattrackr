import { NextRequest, NextResponse } from 'next/server';

/**
 * Similar players feature removed to reduce Supabase egress.
 * Returns empty data so any existing UI or bookmarks don't error.
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    data: [],
  });
}
