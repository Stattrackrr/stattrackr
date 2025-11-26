/**
 * Clear BasketballMonster lineup cache entries
 * Usage: GET /api/dvp/clear-basketballmonsters-cache?team=MIL (optional team filter)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamFilter = searchParams.get('team')?.toUpperCase();
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Find all cache entries that start with 'basketballmonsters:lineup:'
    // The table is 'nba_api_cache' based on nbaCache.ts
    const { data: entries, error: fetchError } = await supabase
      .from('nba_api_cache')
      .select('cache_key')
      .ilike('cache_key', 'basketballmonsters:lineup:%');
    
    if (fetchError) {
      throw fetchError;
    }
    
    if (!entries || entries.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No BasketballMonster cache entries found',
        deleted: 0
      });
    }
    
    // Filter by team if specified
    let keysToDelete = entries.map(e => e.cache_key);
    if (teamFilter) {
      keysToDelete = keysToDelete.filter(key => 
        key.includes(`:${teamFilter}:`)
      );
    }
    
    if (keysToDelete.length === 0) {
      return NextResponse.json({
        success: true,
        message: `No cache entries found for team ${teamFilter}`,
        deleted: 0
      });
    }
    
    // Delete the cache entries
    const { error: deleteError } = await supabase
      .from('nba_api_cache')
      .delete()
      .in('cache_key', keysToDelete);
    
    if (deleteError) {
      throw deleteError;
    }
    
    return NextResponse.json({
      success: true,
      message: `Cleared ${keysToDelete.length} BasketballMonster cache entries${teamFilter ? ` for team ${teamFilter}` : ''}`,
      deleted: keysToDelete.length,
      sampleKeys: keysToDelete.slice(0, 5)
    });
    
  } catch (error: any) {
    console.error('[Clear Cache] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to clear cache' },
      { status: 500 }
    );
  }
}

