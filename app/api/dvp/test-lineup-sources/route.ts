/**
 * Test different lineup websites to find a reliable source
 * Tests: Rotowire, Underdog, DraftKings, FanDuel, Yahoo, TheScore, etc.
 * 
 * Usage: /api/dvp/test-lineup-sources?team=MIL&date=2025-11-26
 */

import { NextRequest, NextResponse } from 'next/server';

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Test Rotowire
async function testRotowire(teamAbbr: string, date: string) {
  try {
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    console.log(`[Test] Trying Rotowire: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.rotowire.com/'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'Rotowire', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    // Check if page has lineup data
    const hasLineups = html.includes('lineup') || html.includes('starting') || html.includes('PG') || html.includes('SG');
    
    return {
      source: 'Rotowire',
      success: hasLineups,
      url,
      note: hasLineups ? 'Page structure found - may need parsing' : 'No lineup structure detected',
      sample: html.substring(0, 500)
    };
  } catch (e: any) {
    return { source: 'Rotowire', success: false, error: e.message };
  }
}

// Test Underdog Fantasy
async function testUnderdog(teamAbbr: string, date: string) {
  try {
    const url = `https://underdogfantasy.com/pick-em/nba`;
    console.log(`[Test] Trying Underdog: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Referer': 'https://underdogfantasy.com/'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'Underdog Fantasy', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const hasLineups = html.includes('lineup') || html.includes('starting') || html.includes('PG');
    
    return {
      source: 'Underdog Fantasy',
      success: hasLineups,
      url,
      note: hasLineups ? 'Page structure found' : 'No lineup structure detected',
      sample: html.substring(0, 500)
    };
  } catch (e: any) {
    return { source: 'Underdog Fantasy', success: false, error: e.message };
  }
}

// Test TheScore
async function testTheScore(teamAbbr: string, date: string) {
  try {
    // TheScore might have an API or structured data
    const url = `https://www.thescore.com/nba`;
    console.log(`[Test] Trying TheScore: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'TheScore', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const hasLineups = html.includes('lineup') || html.includes('starting');
    
    return {
      source: 'TheScore',
      success: hasLineups,
      url,
      note: hasLineups ? 'Page structure found' : 'No lineup structure detected'
    };
  } catch (e: any) {
    return { source: 'TheScore', success: false, error: e.message };
  }
}

// Test Yahoo Fantasy
async function testYahoo(teamAbbr: string, date: string) {
  try {
    const url = `https://sports.yahoo.com/nba/scoreboard/`;
    console.log(`[Test] Trying Yahoo: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'Yahoo Sports', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const hasLineups = html.includes('lineup') || html.includes('starting');
    
    return {
      source: 'Yahoo Sports',
      success: hasLineups,
      url,
      note: hasLineups ? 'Page structure found' : 'No lineup structure detected'
    };
  } catch (e: any) {
    return { source: 'Yahoo Sports', success: false, error: e.message };
  }
}

// Test FantasyPros
async function testFantasyPros(teamAbbr: string, date: string) {
  try {
    const url = `https://www.fantasypros.com/nba/lineups/`;
    console.log(`[Test] Trying FantasyPros: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'FantasyPros', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const hasLineups = html.includes('lineup') || html.includes('starting') || html.includes('PG');
    
    return {
      source: 'FantasyPros',
      success: hasLineups,
      url,
      note: hasLineups ? 'Page structure found' : 'No lineup structure detected',
      sample: html.substring(0, 500)
    };
  } catch (e: any) {
    return { source: 'FantasyPros', success: false, error: e.message };
  }
}

// Test DraftKings (they show lineups)
async function testDraftKings(teamAbbr: string, date: string) {
  try {
    const url = `https://www.draftkings.com/lineup/nba`;
    console.log(`[Test] Trying DraftKings: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'DraftKings', success: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const hasLineups = html.includes('lineup') || html.includes('starting') || html.includes('PG');
    
    return {
      source: 'DraftKings',
      success: hasLineups,
      url,
      note: hasLineups ? 'Page structure found' : 'No lineup structure detected'
    };
  } catch (e: any) {
    return { source: 'DraftKings', success: false, error: e.message };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    const dateParam = searchParams.get('date');
    const testDate = dateParam || formatDate(new Date());
    
    console.log(`[Test Lineup Sources] Testing sources for ${teamAbbr} on ${testDate}`);
    
    const results = [];
    
    // Test all sources in parallel
    const tests = await Promise.allSettled([
      testRotowire(teamAbbr, testDate),
      testUnderdog(teamAbbr, testDate),
      testTheScore(teamAbbr, testDate),
      testYahoo(teamAbbr, testDate),
      testFantasyPros(teamAbbr, testDate),
      testDraftKings(teamAbbr, testDate)
    ]);
    
    for (const test of tests) {
      if (test.status === 'fulfilled') {
        results.push(test.value);
      } else {
        results.push({ source: 'Unknown', success: false, error: test.reason?.message || 'Test failed' });
      }
    }
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    return NextResponse.json({
      team: teamAbbr,
      date: testDate,
      summary: {
        total: results.length,
        successful: successful.length,
        failed: failed.length
      },
      successfulSources: successful,
      failedSources: failed,
      recommendation: successful.length > 0 
        ? `Found ${successful.length} potential source(s). Review the 'successfulSources' to see which has the best data structure.`
        : 'No sources found with detectable lineup structure. May need to check URLs or add different sources.'
    });
    
  } catch (error: any) {
    console.error('[Test Lineup Sources] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to test sources' },
      { status: 500 }
    );
  }
}

