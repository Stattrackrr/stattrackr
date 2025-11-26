/**
 * Test Rotowire parsing with detailed output
 * Shows exactly what HTML structure we're working with
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Referer': 'https://www.rotowire.com/',
      },
      cache: 'no-store'
    });
    
    if (!response.ok) {
      return NextResponse.json({ error: `HTTP ${response.status}` }, { status: 500 });
    }
    
    const html = await response.text();
    const teamUpper = teamAbbr.toUpperCase();
    const teamIndex = html.toUpperCase().indexOf(teamUpper);
    
    if (teamIndex === -1) {
      return NextResponse.json({
        team: teamAbbr,
        error: 'Team not found',
        htmlLength: html.length
      });
    }
    
    // Get larger section
    const start = Math.max(0, teamIndex - 3000);
    const end = Math.min(html.length, teamIndex + 15000);
    const teamSection = html.substring(start, end);
    
    // Try different patterns
    const patterns = {
      pattern1: /\b(PG|SG|SF|PF|C)\s+([A-Z][a-z]*(?:\.[A-Z])?\s+[A-Z][a-z]+)/g,
      pattern2: /(PG|SG|SF|PF|C)[\s>]+([A-Z][^<\s]{2,30})/g,
      pattern3: /(?:>|"|')(PG|SG|SF|PF|C)[\s:]+([A-Z][^<>\n]{3,30})/g,
    };
    
    const results: any = {
      team: teamAbbr,
      teamIndex,
      sectionLength: teamSection.length,
      patterns: {}
    };
    
    for (const [name, pattern] of Object.entries(patterns)) {
      const matches: any[] = [];
      let match;
      while ((match = pattern.exec(teamSection)) !== null) {
        matches.push({
          position: match[1],
          player: match[2],
          fullMatch: match[0],
          index: match.index
        });
      }
      results.patterns[name] = {
        count: matches.length,
        matches: matches.slice(0, 10) // First 10 matches
      };
    }
    
    // Look for API endpoints or JSON data in JavaScript
    const apiPatterns = [
      /fetch\(["']([^"']*lineup[^"']*)["']/gi,
      /fetch\(["']([^"']*api[^"']*)["']/gi,
      /axios\.(get|post)\(["']([^"']*)["']/gi,
      /\.ajax\(["']([^"']*)["']/gi,
      /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/i,
      /window\.__DATA__\s*=\s*({[\s\S]*?});/i,
    ];
    
    const foundAPIs: string[] = [];
    for (const pattern of apiPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1] || match[2];
        if (url && !foundAPIs.includes(url)) {
          foundAPIs.push(url);
        }
      }
    }
    
    results.foundAPIs = foundAPIs;
    results.rawSection = teamSection.substring(0, 5000); // First 5000 chars
    
    return NextResponse.json(results);
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

