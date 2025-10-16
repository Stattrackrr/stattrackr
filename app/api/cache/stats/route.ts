import { NextRequest, NextResponse } from 'next/server';
import cache from '@/lib/cache';

export async function GET(request: NextRequest) {
  try {
    // Get cache statistics
    const stats = cache.getStats();
    
    // Calculate cache efficiency
    const hitRate = stats.totalEntries > 0 
      ? ((stats.validEntries / stats.totalEntries) * 100).toFixed(1)
      : '0.0';
    
    return NextResponse.json({
      status: 'healthy',
      cache: {
        totalEntries: stats.totalEntries,
        validEntries: stats.validEntries,
        expiredEntries: stats.expiredEntries,
        hitRate: `${hitRate}%`,
        keys: stats.keys
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    return NextResponse.json(
      { error: 'Failed to get cache statistics' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Clear all cache entries
    cache.clear();
    
    return NextResponse.json({
      status: 'success',
      message: 'Cache cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}