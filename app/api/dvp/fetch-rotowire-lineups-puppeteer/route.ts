/**
 * Fetch starting lineups from Rotowire using Puppeteer
 * Caches results in Supabase for instant subsequent requests
 * 
 * Usage: /api/dvp/fetch-rotowire-lineups-puppeteer?team=MIL&season=2025
 */

import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

// Puppeteer requires Node.js runtime (not edge)
export const runtime = "nodejs";
export const maxDuration = 60; // 60 seconds max (Puppeteer can be slow)

const BDL_BASE = 'https://api.balldontlie.io/v1';

function getBdlHeaders(): Record<string, string> {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY environment variable is required');
  }
  return {
    Accept: 'application/json',
    'User-Agent': 'StatTrackr/1.0',
    Authorization: `Bearer ${apiKey}`,
  };
}

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

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

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: getBdlHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${t || url}`);
  }
  return res.json();
}

async function scrapeRotowireLineupForDate(date: string, teamAbbr: string): Promise<Array<{ name: string; position: string }>> {
  // Check cache first
  const cacheKey = `rotowire:lineup:${teamAbbr}:${date}`;
  const cached = await getNBACache<Array<{ name: string; position: string }>>(cacheKey);
  if (cached) {
    console.log(`[Rotowire Puppeteer] Cache hit for ${teamAbbr} on ${date}`);
    return cached;
  }
  
  console.log(`[Rotowire Puppeteer] Scraping lineups for ${teamAbbr} on ${date}...`);
  
  let browser;
  try {
    // Launch browser with Vercel-compatible settings
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process' // Required for Vercel/serverless
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Navigate to Rotowire
    const url = `https://www.rotowire.com/basketball/nba-lineups.php`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for lineup data to load (look for position indicators)
    const teamUpper = teamAbbr.toUpperCase();
    await page.waitForFunction(
      (team) => {
        const text = document.body.innerText || '';
        return text.includes('PG') && text.includes('SG') && text.toUpperCase().includes(team);
      },
      { timeout: 10000 },
      teamUpper
    ).catch(() => {
      console.log(`[Rotowire Puppeteer] Timeout waiting for lineup data, proceeding anyway...`);
    });
    
    // Get page content
    const html = await page.content();
    const text = await page.evaluate(() => document.body.innerText || '');
    
    // Close browser
    await browser.close();
    
    // Parse lineups from HTML/text
    const starters: Array<{ name: string; position: string }> = [];
    
    // Find team section
    const teamIndex = text.toUpperCase().indexOf(teamUpper);
    if (teamIndex === -1) {
      console.log(`[Rotowire Puppeteer] Team ${teamAbbr} not found on page`);
      return [];
    }
    
    // Extract section around team
    const start = Math.max(0, teamIndex - 2000);
    const end = Math.min(text.length, teamIndex + 5000);
    const teamSection = text.substring(start, end);
    
    // Rotowire format: "PG Player Name", "SG Player Name", etc.
    const lineupPattern = /\b(PG|SG|SF|PF|C)\s+([A-Z][a-z]*(?:\.[A-Z])?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[A-Z][a-z]+,\s+[A-Z][a-z]+)/g;
    
    const foundPositions = new Set<string>();
    let match;
    
    while ((match = lineupPattern.exec(teamSection)) !== null) {
      const position = match[1].toUpperCase();
      let playerName = match[2].trim();
      
      if (foundPositions.has(position)) continue;
      
      // Handle "Last, First" format
      if (playerName.includes(',')) {
        const parts = playerName.split(',').map(p => p.trim());
        if (parts.length === 2) {
          playerName = `${parts[1]} ${parts[0]}`;
        }
      }
      
      playerName = playerName.replace(/\s+/g, ' ').trim();
      
      starters.push({
        name: playerName,
        position: position
      });
      
      foundPositions.add(position);
      
      if (starters.length === 5) break;
    }
    
    // Cache the result (24 hour TTL)
    if (starters.length > 0) {
      await setNBACache(cacheKey, 'rotowire_lineup', starters, 24 * 60); // 24 hours
      console.log(`[Rotowire Puppeteer] Cached ${starters.length} starters for ${teamAbbr} on ${date}`);
    }
    
    return starters;
    
  } catch (e: any) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    console.error(`[Rotowire Puppeteer] Error scraping ${date}:`, e.message);
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const teamAbbr = searchParams.get('team')?.toUpperCase();
    const seasonParam = searchParams.get('season');
    const season = seasonParam ? parseInt(seasonParam, 10) : 2025;
    
    if (!teamAbbr) {
      return NextResponse.json({ error: 'Team abbreviation required' }, { status: 400 });
    }
    
    const bdlTeamId = ABBR_TO_TEAM_ID_BDL[teamAbbr];
    if (!bdlTeamId) {
      return NextResponse.json({ error: `Invalid team: ${teamAbbr}` }, { status: 400 });
    }
    
    console.log(`[Rotowire Puppeteer] Fetching lineups for ${teamAbbr} (season ${season})...`);
    
    // Get games from BDL
    const gamesUrl = new URL(`${BDL_BASE}/games`);
    gamesUrl.searchParams.set('per_page', '100');
    gamesUrl.searchParams.append('seasons[]', String(season));
    gamesUrl.searchParams.append('team_ids[]', String(bdlTeamId));
    
    const gamesData = await bdlFetch(gamesUrl.toString());
    const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
    
    if (games.length === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        error: 'No games found for this team/season',
        players: []
      });
    }
    
    console.log(`[Rotowire Puppeteer] Found ${games.length} games, scraping Rotowire...`);
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number }>;
      totalGames: number;
    }>();
    
    // Process first 10 games (Puppeteer is slower, so fewer games)
    const gamesToProcess = games.slice(0, 10);
    let processed = 0;
    
    for (const game of gamesToProcess) {
      const gameDate = game.date;
      
      try {
        const lineup = await scrapeRotowireLineupForDate(gameDate, teamAbbr);
        
        if (lineup.length === 5) {
          for (const starter of lineup) {
            const normalized = normName(starter.name);
            
            if (!playerPositions.has(normalized)) {
              playerPositions.set(normalized, {
                name: starter.name,
                positions: {},
                totalGames: 0
              });
            }
            
            const p = playerPositions.get(normalized)!;
            p.totalGames++;
            
            if (!p.positions[starter.position]) {
              p.positions[starter.position] = { count: 0 };
            }
            p.positions[starter.position].count++;
          }
          
          processed++;
        } else {
          console.log(`[Rotowire Puppeteer] Game ${gameDate}: Only found ${lineup.length} starters (expected 5)`);
        }
        
        // Small delay between games
        if (processed < gamesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (e: any) {
        console.error(`[Rotowire Puppeteer] Error processing game ${gameDate}:`, e.message);
      }
    }
    
    if (playerPositions.size === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        gamesProcessed: processed,
        totalGames: games.length,
        error: `No starting lineups found. Processed ${processed} games but couldn't extract lineups.`,
        players: []
      });
    }
    
    // Calculate most common position
    const results = Array.from(playerPositions.entries()).map(([key, data]) => {
      let mostCommonPos = '';
      let maxCount = 0;
      
      for (const [pos, stats] of Object.entries(data.positions)) {
        if (stats.count > maxCount) {
          mostCommonPos = pos;
          maxCount = stats.count;
        }
      }
      
      return {
        name: data.name,
        recommendedPosition: mostCommonPos,
        totalGames: data.totalGames,
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    return NextResponse.json({
      team: teamAbbr,
      season,
      source: 'Rotowire (Puppeteer)',
      gamesProcessed: processed,
      totalGames: games.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[Rotowire Puppeteer] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch Rotowire lineups' },
      { status: 500 }
    );
  }
}

