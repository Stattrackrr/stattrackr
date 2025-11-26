/**
 * Test scraping today's BasketballMonster page without Puppeteer
 * This helps us verify the parsing logic works before adding Puppeteer complexity
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase() || 'MIL';
    
    const url = `https://basketballmonster.com/nbalineups.aspx`;
    console.log(`[Test] Fetching ${url}...`);
    
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
    console.log(`[Test] Got HTML: ${html.length} chars`);
    
    const teamUpper = teamAbbr.toUpperCase();
    
    // Find game matchup
    const gameMatchPattern = new RegExp(`(${teamUpper})\\s*@\\s*([A-Z]{3})|([A-Z]{3})\\s*@\\s*(${teamUpper})`, 'i');
    const gameMatch = html.match(gameMatchPattern);
    
    if (!gameMatch) {
      return NextResponse.json({
        success: false,
        error: `No game found with team ${teamAbbr}`,
        htmlLength: html.length,
        teamFound: html.toUpperCase().includes(teamUpper)
      });
    }
    
    const matchupIndex = html.indexOf(gameMatch[0]);
    const isFirstTeam = gameMatch[1]?.toUpperCase() === teamUpper;
    
    // Extract game box
    const boxStart = Math.max(0, matchupIndex - 2000);
    const boxEnd = Math.min(html.length, matchupIndex + 20000);
    const teamSection = html.substring(boxStart, boxEnd);
    
    // Find table
    const tableStart = teamSection.indexOf('<table');
    if (tableStart === -1) {
      return NextResponse.json({
        success: false,
        error: 'No table found',
        gameMatch: gameMatch[0],
        matchupIndex
      });
    }
    
    const tableEnd = teamSection.indexOf('</table>', tableStart) + '</table>'.length;
    const gameTableHtml = teamSection.substring(tableStart, tableEnd);
    
    // Find rows with positions
    const tableRows = gameTableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const starters: Array<{ position: string; player1: string; player2: string; selected: string }> = [];
    
    for (const row of tableRows) {
      const positionMatch = row.match(/<span[^>]*>(PG|SG|SF|PF|C)<\/span>/i);
      if (!positionMatch) continue;
      
      const position = positionMatch[1].toUpperCase();
      const playerLinks = row.match(/<a[^>]*href=['"]playerinfo\.aspx\?i=\d+['"][^>]*>([^<]+)<\/a>/gi) || [];
      
      if (playerLinks.length >= 2) {
        const player1 = playerLinks[0].match(/>([^<]+)</)?.[1]?.trim() || '';
        const player2 = playerLinks[1].match(/>([^<]+)</)?.[1]?.trim() || '';
        const selected = isFirstTeam ? player1 : player2;
        
        starters.push({ position, player1, player2, selected });
      }
    }
    
    return NextResponse.json({
      success: true,
      team: teamAbbr,
      gameMatch: gameMatch[0],
      isFirstTeam,
      tableFound: tableStart !== -1,
      tableLength: gameTableHtml.length,
      rowsFound: tableRows.length,
      starters,
      htmlSample: teamSection.substring(0, 2000)
    });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

