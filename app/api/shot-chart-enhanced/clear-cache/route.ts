import { NextRequest, NextResponse } from 'next/server';
import { cache } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function clearCache(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const season = searchParams.get('season') || '2025';
    
    if (!playerId) {
      // Clear ALL shot chart enhanced cache
      let cleared = 0;
      const allKeys = Array.from((cache as any).cache?.keys() || []) as string[];
      for (const key of allKeys) {
        if (key.startsWith('shot_enhanced_')) {
          cache.delete(key);
          cleared++;
        }
      }
      
      return NextResponse.json({ 
        success: true, 
        message: `Cleared ${cleared} shot chart cache entries` 
      });
    }
    
    // Clear specific player's cache (all opponents)
    let cleared = 0;
    const patterns = [
      `shot_enhanced_${playerId}_none_${season}`,
      `shot_enhanced_${playerId}_DET_${season}`,
      `shot_enhanced_${playerId}_MIL_${season}`,
      // Add more teams as needed
    ];
    
    // Also try to clear all entries for this player
    const allKeys = Array.from((cache as any).cache?.keys() || []) as string[];
    for (const key of allKeys) {
      if (key.includes(`shot_enhanced_${playerId}_`)) {
        cache.delete(key);
        cleared++;
        console.log(`[Shot Chart Cache] Cleared: ${key}`);
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Cleared ${cleared} cache entries for player ${playerId}`,
      playerId,
      season
    });
  } catch (error) {
    console.error('[Shot Chart Cache] Error clearing cache:', error);
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}

// Support both GET (for browsers) and POST
export async function GET(request: NextRequest) {
  return clearCache(request);
}

export async function POST(request: NextRequest) {
  return clearCache(request);
}

