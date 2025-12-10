export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const COMBINED_STATS = ['pra', 'pa', 'pr', 'ra'];

export async function GET(request: NextRequest) {
  try {
    const baseUrl = request.nextUrl.origin;
    const results: Array<{ position: string; metric: string; success: boolean; error?: string }> = [];
    
    console.log('[DVP Warm Combined] Starting to warm combined stats DvP for all positions...');
    
    // Warm all combinations of positions and combined stats
    for (const pos of POSITIONS) {
      for (const metric of COMBINED_STATS) {
        try {
          const url = `${baseUrl}/api/dvp/rank?pos=${pos}&metric=${metric}&refresh=1`;
          const response = await fetch(url, { 
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache'
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              results.push({ position: pos, metric, success: true });
              console.log(`[DVP Warm Combined] ✅ Warmed ${metric} for ${pos}`);
            } else {
              results.push({ position: pos, metric, success: false, error: data.error || 'Unknown error' });
              console.warn(`[DVP Warm Combined] ❌ Failed to warm ${metric} for ${pos}:`, data.error);
            }
          } else {
            const errorText = await response.text().catch(() => '');
            results.push({ position: pos, metric, success: false, error: `HTTP ${response.status}: ${errorText}` });
            console.warn(`[DVP Warm Combined] ❌ HTTP error ${response.status} for ${metric} ${pos}`);
          }
          
          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          results.push({ position: pos, metric, success: false, error: error.message || 'Unknown error' });
          console.error(`[DVP Warm Combined] ❌ Error warming ${metric} for ${pos}:`, error);
        }
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log(`[DVP Warm Combined] Complete! Success: ${successCount}, Failed: ${failCount}`);
    
    return NextResponse.json({
      success: true,
      message: `Warmed combined stats DvP for all positions`,
      total: results.length,
      successful: successCount,
      failed: failCount,
      results
    });
    
  } catch (error: any) {
    console.error('[DVP Warm Combined] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to warm combined stats'
    }, { status: 500 });
  }
}
