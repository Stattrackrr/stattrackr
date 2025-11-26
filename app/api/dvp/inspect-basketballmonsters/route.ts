/**
 * Inspect BasketballMonster HTML structure to understand lineup format
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    
    const url = `https://basketballmonster.com/nbalineups.aspx`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Referer': 'https://basketballmonster.com/',
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
        error: 'Team not found in HTML',
        htmlLength: html.length
      });
    }
    
    // Extract larger section around team
    const start = Math.max(0, teamIndex - 5000);
    const end = Math.min(html.length, teamIndex + 15000);
    const teamSection = html.substring(start, end);
    
    // Look for position patterns
    const pgMatches = teamSection.match(/PG[^<]{0,100}/gi) || [];
    const sgMatches = teamSection.match(/SG[^<]{0,100}/gi) || [];
    
    // Look for player name patterns
    const playerNamePattern = /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    const playerNames = teamSection.match(playerNamePattern) || [];
    
    return NextResponse.json({
      team: teamAbbr,
      url,
      teamIndex,
      sectionLength: teamSection.length,
      pgSamples: pgMatches.slice(0, 5),
      sgSamples: sgMatches.slice(0, 5),
      playerNameSamples: [...new Set(playerNames)].slice(0, 20),
      htmlSample: teamSection.substring(0, 5000),
      // Look for specific structures
      hasDivStructure: teamSection.includes('<div') && teamSection.includes('class'),
      hasTableStructure: teamSection.includes('<table'),
      hasPositionLabels: /PG|SG|SF|PF|C/.test(teamSection)
    });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

