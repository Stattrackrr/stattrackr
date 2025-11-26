/**
 * Test parsing lineup data from different sources
 * Checks which source has the most parseable lineup structure
 * 
 * Usage: /api/dvp/test-lineup-parsing?source=rotowire&team=MIL&date=2025-11-26
 */

import { NextRequest, NextResponse } from 'next/server';

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

async function testRotowireParsing(teamAbbr: string, date: string) {
  try {
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Referer': 'https://www.rotowire.com/'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'Rotowire', parseable: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    
    // Look for team name in HTML
    const teamFound = html.toLowerCase().includes(teamAbbr.toLowerCase());
    
    // Look for position indicators
    const hasPositions = html.includes('PG') || html.includes('SG') || html.includes('SF') || html.includes('PF') || html.includes('C');
    
    // Look for player name patterns (common NBA player names)
    const hasPlayerNames = html.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)?.length || 0;
    
    // Try to find lineup table or structure
    const hasTable = html.includes('<table') || html.includes('lineup') || html.includes('starting');
    
    // Check if it's JavaScript-rendered (harder to parse)
    const isJS = html.includes('react') || html.includes('__NEXT_DATA__') || html.includes('window.__INITIAL_STATE__');
    
    return {
      source: 'Rotowire',
      parseable: teamFound && hasPositions && hasTable,
      url,
      analysis: {
        teamFound,
        hasPositions,
        hasTable,
        playerNameCount: hasPlayerNames,
        isJavaScriptRendered: isJS,
        htmlLength: html.length
      },
      sample: html.substring(0, 1000)
    };
  } catch (e: any) {
    return { source: 'Rotowire', parseable: false, error: e.message };
  }
}

async function testFantasyProsParsing(teamAbbr: string, date: string) {
  try {
    const url = `https://www.fantasypros.com/nba/lineups/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'FantasyPros', parseable: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const teamFound = html.toLowerCase().includes(teamAbbr.toLowerCase());
    const hasPositions = html.includes('PG') || html.includes('SG') || html.includes('SF') || html.includes('PF') || html.includes('C');
    const hasPlayerNames = html.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)?.length || 0;
    const hasTable = html.includes('<table') || html.includes('lineup') || html.includes('starting');
    const isJS = html.includes('react') || html.includes('__NEXT_DATA__') || html.includes('window.__INITIAL_STATE__');
    
    // Check for date in title (suggests daily lineups)
    const hasDate = html.includes(date) || html.includes(new Date(date).toLocaleDateString('en-US', { weekday: 'long' }));
    
    return {
      source: 'FantasyPros',
      parseable: teamFound && hasPositions && hasTable,
      url,
      analysis: {
        teamFound,
        hasPositions,
        hasTable,
        playerNameCount: hasPlayerNames,
        isJavaScriptRendered: isJS,
        hasDateInContent: hasDate,
        htmlLength: html.length
      },
      sample: html.substring(0, 1000)
    };
  } catch (e: any) {
    return { source: 'FantasyPros', parseable: false, error: e.message };
  }
}

async function testYahooParsing(teamAbbr: string, date: string) {
  try {
    const url = `https://sports.yahoo.com/nba/scoreboard/`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'Yahoo Sports', parseable: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const teamFound = html.toLowerCase().includes(teamAbbr.toLowerCase());
    const hasPositions = html.includes('PG') || html.includes('SG') || html.includes('SF') || html.includes('PF') || html.includes('C');
    const hasPlayerNames = html.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)?.length || 0;
    const hasTable = html.includes('<table') || html.includes('lineup');
    const isJS = html.includes('react') || html.includes('__NEXT_DATA__') || html.includes('window.__INITIAL_STATE__');
    
    return {
      source: 'Yahoo Sports',
      parseable: teamFound && hasPositions && hasTable,
      url,
      analysis: {
        teamFound,
        hasPositions,
        hasTable,
        playerNameCount: hasPlayerNames,
        isJavaScriptRendered: isJS,
        htmlLength: html.length
      },
      sample: html.substring(0, 1000)
    };
  } catch (e: any) {
    return { source: 'Yahoo Sports', parseable: false, error: e.message };
  }
}

async function testTheScoreParsing(teamAbbr: string, date: string) {
  try {
    const url = `https://www.thescore.com/nba`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return { source: 'TheScore', parseable: false, error: `HTTP ${response.status}` };
    }
    
    const html = await response.text();
    const teamFound = html.toLowerCase().includes(teamAbbr.toLowerCase());
    const hasPositions = html.includes('PG') || html.includes('SG') || html.includes('SF') || html.includes('PF') || html.includes('C');
    const hasPlayerNames = html.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)?.length || 0;
    const hasTable = html.includes('<table') || html.includes('lineup');
    const isJS = html.includes('react') || html.includes('__NEXT_DATA__') || html.includes('window.__INITIAL_STATE__');
    
    return {
      source: 'TheScore',
      parseable: teamFound && hasPositions && hasTable,
      url,
      analysis: {
        teamFound,
        hasPositions,
        hasTable,
        playerNameCount: hasPlayerNames,
        isJavaScriptRendered: isJS,
        htmlLength: html.length
      },
      sample: html.substring(0, 1000)
    };
  } catch (e: any) {
    return { source: 'TheScore', parseable: false, error: e.message };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    const dateParam = searchParams.get('date');
    const testDate = dateParam || new Date().toISOString().split('T')[0];
    
    console.log(`[Test Parsing] Testing parsing for ${teamAbbr} on ${testDate}`);
    
    const results = await Promise.allSettled([
      testRotowireParsing(teamAbbr, testDate),
      testFantasyProsParsing(teamAbbr, testDate),
      testYahooParsing(teamAbbr, testDate),
      testTheScoreParsing(teamAbbr, testDate)
    ]);
    
    const parsed = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        parsed.push(result.value);
      }
    }
    
    const parseable = parsed.filter(r => r.parseable);
    const notParseable = parsed.filter(r => !r.parseable);
    
    // Rank by parseability score
    const ranked = parseable.map(r => ({
      ...r,
      score: (r.analysis?.teamFound ? 10 : 0) + 
             (r.analysis?.hasPositions ? 10 : 0) + 
             (r.analysis?.hasTable ? 10 : 0) +
             (r.analysis?.playerNameCount || 0) / 10 +
             (r.analysis?.isJavaScriptRendered ? -5 : 5) // Prefer non-JS rendered
    })).sort((a, b) => (b.score || 0) - (a.score || 0));
    
    return NextResponse.json({
      team: teamAbbr,
      date: testDate,
      summary: {
        total: parsed.length,
        parseable: parseable.length,
        notParseable: notParseable.length
      },
      rankedSources: ranked,
      notParseableSources: notParseable,
      recommendation: ranked.length > 0
        ? `Best source: ${ranked[0].source} (score: ${ranked[0].score?.toFixed(1)})`
        : 'No easily parseable sources found. May need to use browser automation or API access.'
    });
    
  } catch (error: any) {
    console.error('[Test Parsing] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to test parsing' },
      { status: 500 }
    );
  }
}

