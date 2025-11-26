
/**
 * Inspect Rotowire HTML structure to understand how lineups are formatted
 * This will help us build the proper parser
 * 
 * Usage: /api/dvp/inspect-rotowire-structure?team=MIL
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    console.log(`[Inspect] Fetching Rotowire structure...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.rotowire.com/',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return NextResponse.json({ error: `HTTP ${response.status}` }, { status: 500 });
    }
    
    const html = await response.text();
    
    // Find team section
    const teamUpper = teamAbbr.toUpperCase();
    const teamIndex = html.toUpperCase().indexOf(teamUpper);
    
    if (teamIndex === -1) {
      return NextResponse.json({
        team: teamAbbr,
        error: 'Team not found in HTML',
        htmlLength: html.length,
        sample: html.substring(0, 2000)
      });
    }
    
    // Extract larger section around team (10000 chars)
    const start = Math.max(0, teamIndex - 5000);
    const end = Math.min(html.length, teamIndex + 5000);
    const teamSection = html.substring(start, end);
    
    // Look for common patterns
    const hasTable = teamSection.includes('<table');
    const hasDiv = teamSection.includes('<div');
    const hasList = teamSection.includes('<ul') || teamSection.includes('<ol');
    const hasPositions = /PG|SG|SF|PF|C/.test(teamSection);
    const hasPlayerNames = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/.test(teamSection);
    
    // Try to find specific structures
    const structures = {
      tables: (teamSection.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || []).length,
      divsWithClass: (teamSection.match(/<div[^>]*class[^>]*>/gi) || []).length,
      spansWithClass: (teamSection.match(/<span[^>]*class[^>]*>/gi) || []).length,
      dataAttributes: (teamSection.match(/data-[^=]+=/gi) || []).length
    };
    
    // Look for JSON data embedded in page
    const jsonMatches = html.match(/<script[^>]*type[^>]*json[^>]*>([\s\S]*?)<\/script>/gi) || 
                        html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/i) ||
                        html.match(/window\.__DATA__\s*=\s*({[\s\S]*?});/i) ||
                        [];
    
    // Look for API endpoints in JavaScript
    const apiMatches = html.match(/["']https?:\/\/[^"']*api[^"']*["']/gi) || [];
    const lineupApiMatches = html.match(/["']https?:\/\/[^"']*lineup[^"']*["']/gi) || [];
    
    // Search for team name in different contexts
    const teamInScript = html.indexOf(`"${teamAbbr}"`) !== -1 || html.indexOf(`'${teamAbbr}'`) !== -1;
    const teamInDataAttr = html.indexOf(`data-team="${teamAbbr}"`) !== -1 || html.indexOf(`data-team='${teamAbbr}'`) !== -1;
    
    return NextResponse.json({
      team: teamAbbr,
      url,
      analysis: {
        teamFound: true,
        teamIndex,
        sectionLength: teamSection.length,
        hasTable,
        hasDiv,
        hasList,
        hasPositions,
        hasPlayerNames,
        structures,
        hasJSONData: jsonMatches.length > 0,
        jsonDataCount: jsonMatches.length,
        hasAPICalls: apiMatches.length > 0,
        apiCallCount: apiMatches.length,
        hasLineupAPI: lineupApiMatches.length > 0,
        teamInScript,
        teamInDataAttr
      },
      htmlSample: teamSection,
      jsonSamples: jsonMatches.slice(0, 3).map((m: string) => m.substring(0, 500)),
      apiSamples: [...apiMatches.slice(0, 5), ...lineupApiMatches.slice(0, 5)],
      // Also return full HTML for manual inspection (first 10000 chars)
      fullHtmlSample: html.substring(0, 10000)
    });
    
  } catch (error: any) {
    console.error('[Inspect] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to inspect Rotowire' },
      { status: 500 }
    );
  }
}

