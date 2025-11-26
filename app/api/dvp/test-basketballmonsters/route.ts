/**
 * Test BasketballMonsters NBA Lineups
 * Check if they have historical games and predicted vs confirmed lineups
 * 
 * Usage: /api/dvp/test-basketballmonsters?team=MIL
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    
    const url = `https://basketballmonsters.com/nbalineups`;
    console.log(`[Test BasketballMonsters] Testing ${url}...`);
    
    let html: string | undefined = undefined;
    let fetchError: any = null;
    
    // Try multiple URL variations (the actual URL is .aspx)
    const urlsToTry = [
      'https://basketballmonster.com/nbalineups.aspx',
      'https://www.basketballmonster.com/nbalineups.aspx',
      'https://basketballmonsters.com/nbalineups.aspx',
      'https://www.basketballmonsters.com/nbalineups.aspx',
    ];
    
    for (const testUrl of urlsToTry) {
      try {
        console.log(`[Test BasketballMonsters] Trying ${testUrl}...`);
        const response = await fetch(testUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://basketballmonsters.com/',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (response.ok) {
          html = await response.text();
          console.log(`[Test BasketballMonsters] Successfully fetched ${testUrl}`);
          break;
        } else {
          fetchError = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (e: any) {
        fetchError = e.message || 'Failed to fetch';
        console.log(`[Test BasketballMonsters] Failed ${testUrl}: ${fetchError}`);
        continue;
      }
    }
    
    if (!html) {
      return NextResponse.json({
        source: 'BasketballMonsters',
        success: false,
        error: fetchError || 'Failed to fetch from any URL',
        urlsTried: urlsToTry
      });
    }
    
    // TypeScript: html is guaranteed to be defined here
    const htmlContent: string = html;
    
    // Check for key indicators
    const hasLineups = htmlContent.toLowerCase().includes('lineup') || htmlContent.toLowerCase().includes('starting');
    const hasPositions = htmlContent.includes('PG') || htmlContent.includes('SG') || htmlContent.includes('SF') || htmlContent.includes('PF') || htmlContent.includes('C');
    const hasTeam = htmlContent.toUpperCase().includes(teamAbbr);
    const hasPredicted = htmlContent.toLowerCase().includes('predicted') || htmlContent.toLowerCase().includes('projected');
    const hasConfirmed = htmlContent.toLowerCase().includes('confirmed') || htmlContent.toLowerCase().includes('official');
    const hasHistorical = htmlContent.toLowerCase().includes('previous') || htmlContent.toLowerCase().includes('past') || htmlContent.toLowerCase().includes('history') || htmlContent.match(/\d{4}-\d{2}-\d{2}/);
    const hasDatePicker = htmlContent.toLowerCase().includes('date') && (htmlContent.includes('input') || htmlContent.includes('select'));
    
    // Check if it's JavaScript rendered
    const isJS = htmlContent.includes('react') || htmlContent.includes('__NEXT_DATA__') || htmlContent.includes('window.__INITIAL_STATE__') || htmlContent.includes('vue') || htmlContent.includes('angular');
    
    // Look for API endpoints
    const apiMatches = htmlContent.match(/["']https?:\/\/[^"']*api[^"']*["']/gi) || [];
    const lineupApiMatches = htmlContent.match(/["']https?:\/\/[^"']*lineup[^"']*["']/gi) || [];
    
    // Check for table structure (easier to parse)
    const hasTable = htmlContent.includes('<table') || htmlContent.includes('table');
    const hasDivStructure = htmlContent.match(/<div[^>]*class[^>]*lineup/gi)?.length || 0;
    
    // Sample HTML around team name
    const teamIndex = htmlContent.toUpperCase().indexOf(teamAbbr);
    const sampleHtml = teamIndex > 0 
      ? htmlContent.substring(Math.max(0, teamIndex - 500), Math.min(htmlContent.length, teamIndex + 2000))
      : htmlContent.substring(0, 3000);
    
    return NextResponse.json({
      source: 'BasketballMonsters',
      url,
      success: true,
      analysis: {
        hasLineups,
        hasPositions,
        hasTeam,
        hasPredicted,
        hasConfirmed,
        hasHistorical,
        hasDatePicker,
        isJavaScriptRendered: isJS,
        hasTable,
        hasDivStructure,
        htmlLength: htmlContent.length
      },
      apiEndpoints: {
        total: apiMatches.length,
        lineupSpecific: lineupApiMatches.length,
        samples: [...apiMatches.slice(0, 5), ...lineupApiMatches.slice(0, 5)]
      },
      sampleHtml: sampleHtml.substring(0, 2000),
      recommendation: !isJS && hasLineups && hasPositions 
        ? 'Good candidate - has lineups, positions, and appears to be server-rendered (easier to scrape)'
        : isJS 
          ? 'JavaScript rendered - would need Puppeteer'
          : 'May need further investigation'
    });
    
  } catch (error: any) {
    console.error('[Test BasketballMonsters] Error:', error);
    return NextResponse.json(
      { source: 'BasketballMonsters', success: false, error: error.message },
      { status: 500 }
    );
  }
}

