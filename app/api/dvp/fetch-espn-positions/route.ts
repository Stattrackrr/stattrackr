/**
 * Fetch actual positions from ESPN per-game starting lineups
 * ESPN has accurate per-game starting lineups with positions (PG/SG/SF/PF/C)
 * This is more accurate than depth charts which don't update per game
 * 
 * Usage: /api/dvp/fetch-espn-positions?team=MIL&season=2024
 */

import { NextRequest, NextResponse } from 'next/server';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'StatTrackr/1.0',
  Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY || '9823adcf-57dc-4036-906d-aeb9f0003cfd'}`,
};

const ABBR_TO_TEAM_ID_BDL: Record<string, number> = {
  ATL:1,BOS:2,BKN:3,CHA:4,CHI:5,CLE:6,DAL:7,DEN:8,DET:9,GSW:10,
  HOU:11,IND:12,LAC:13,LAL:14,MEM:15,MIA:16,MIL:17,MIN:18,NOP:19,NYK:20,
  OKC:21,ORL:22,PHI:23,PHX:24,POR:25,SAC:26,SAS:27,TOR:28,UTA:29,WAS:30,
};

function normName(name: string): string {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function formatYMD(d: string | Date): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d2 = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${d2}`;
}

async function espnFetch(url: string) {
  const res = await fetch(url, { 
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 
    cache: 'no-store' 
  });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

type EspnRosterInfo = { 
  pos: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'|'G'|'F'|string>, 
  starters: string[],
  starterPositions: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'>
};

async function fetchEspnRosterMapByDate(dateStr: string, homeAbbr: string, awayAbbr: string, targetTeam?: string): Promise<EspnRosterInfo> {
  try {
    const ymd = /\d{8}/.test(dateStr) ? dateStr : formatYMD(dateStr);
    const sb = await espnFetch(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=${ymd}`);
    const events = sb?.events || [];
    let evt: any = null;
    
    for (const e of events) {
      const comps = e?.competitions?.[0]?.competitors || [];
      const abbrs = comps.map((c: any) => String(c?.team?.abbreviation || '').toUpperCase());
      if (abbrs.includes(String(homeAbbr).toUpperCase()) && abbrs.includes(String(awayAbbr).toUpperCase())) {
        evt = e;
        break;
      }
    }
    
    if (!evt) return { pos: {}, starters: [], starterPositions: {} };
    
    const eventId = String(evt?.id || evt?.uid?.split(':').pop() || '');
    if (!eventId) return { pos: {}, starters: [], starterPositions: {} };
    
    const sum = await espnFetch(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/summary?event=${eventId}`);
    const map: any = {};
    const starters: string[] = [];
    const starterPositions: Record<string, 'PG'|'SG'|'SF'|'PF'|'C'> = {};
    
    // Get team IDs from competitors to match players to teams
    const comps = evt?.competitions?.[0]?.competitors || [];
    const homeTeamId = comps.find((c: any) => String(c?.team?.abbreviation || '').toUpperCase() === homeAbbr)?.team?.id;
    const awayTeamId = comps.find((c: any) => String(c?.team?.abbreviation || '').toUpperCase() === awayAbbr)?.team?.id;
    const targetTeamId = targetTeam === homeAbbr ? homeTeamId : (targetTeam === awayAbbr ? awayTeamId : null);
    
    const addAth = (a: any, teamId?: string, teamAbbr?: string) => {
      const nm = normName(a?.athlete?.displayName || a?.athlete?.fullName || a?.athlete?.name || a?.displayName || a?.name || '');
      const pos = String(a?.position?.abbreviation || a?.position || '').toUpperCase();
      const isStarter = Boolean(a?.starter || a?.isStarter || a?.starting || a?.starterStatus === 'STARTER' || a?.lineupSlot === 'starter');
      const playerTeamId = String(a?.team?.id || a?.teamId || teamId || '');
      const playerTeamAbbr = String(a?.team?.abbreviation || teamAbbr || '').toUpperCase();
      
      // Only include players from target team if specified
      // Try team ID first, then fallback to team abbreviation
      if (targetTeam) {
        const matchesById = targetTeamId && playerTeamId && playerTeamId === String(targetTeamId);
        const matchesByAbbr = playerTeamAbbr && playerTeamAbbr === targetTeam;
        if (!matchesById && !matchesByAbbr) {
          return; // Player is not from target team
        }
      }
      
      if (nm) {
        map[nm] = pos as any;
        if (isStarter) {
          starters.push(nm);
          // Map generic positions to specific ones
          let specificPos: 'PG'|'SG'|'SF'|'PF'|'C' | undefined;
          if (['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) {
            specificPos = pos as 'PG'|'SG'|'SF'|'PF'|'C';
          } else if (pos === 'G') {
            // Generic guard - will need to infer from context
            specificPos = 'SG'; // Default, but we'll try to get better data
          } else if (pos === 'F') {
            // Generic forward
            specificPos = 'SF'; // Default
          }
          if (specificPos) {
            starterPositions[nm] = specificPos;
          }
        }
      }
    };
    
    const box = sum?.boxscore;
    console.log(`[ESPN Positions] Boxscore structure:`, {
      hasBoxscore: !!box,
      hasPlayers: !!box?.players,
      hasTeams: !!box?.teams,
      playersLength: box?.players?.length,
      teamsLength: box?.teams?.length
    });
    
    // Try boxscore.players[...].athletes
    const teams = box?.players || box?.teams || [];
    for (const t of teams) {
      const teamAbbr = String(t?.team?.abbreviation || '').toUpperCase();
      const teamId = String(t?.team?.id || '');
      const aths = t?.athletes || t?.statistics?.[0]?.athletes || t?.players || [];
      console.log(`[ESPN Positions] Team ${teamAbbr} (ID: ${teamId}): ${aths.length} athletes`);
      if (Array.isArray(aths)) {
        aths.forEach((a: any) => {
          const playerTeamId = String(a?.team?.id || a?.teamId || t?.team?.id || '');
          addAth(a, playerTeamId, teamAbbr);
        });
      }
    }
    
    // Also try boxscore.teams[*].players
    for (const t of (box?.teams || [])) {
      const teamAbbr = String(t?.team?.abbreviation || '').toUpperCase();
      const teamId = String(t?.team?.id || '');
      const aths = t?.players || [];
      console.log(`[ESPN Positions] Team ${teamAbbr} (ID: ${teamId}) from teams array: ${aths.length} players`);
      if (Array.isArray(aths)) {
        aths.forEach((a: any) => {
          const playerTeamId = String(a?.team?.id || a?.teamId || t?.team?.id || '');
          addAth(a, playerTeamId, teamAbbr);
        });
      }
    }
    
    console.log(`[ESPN Positions] Total starters found: ${starters.length}, positions:`, Object.keys(starterPositions));
    
    // If we have 5 starters but some have generic positions, try to infer
    if (starters.length === 5) {
      const starterPosArray = starters.map(s => starterPositions[s] || map[s]).filter(Boolean);
      const hasPG = starterPosArray.includes('PG');
      const hasSG = starterPosArray.includes('SG');
      const hasSF = starterPosArray.includes('SF');
      const hasPF = starterPosArray.includes('PF');
      const hasC = starterPosArray.includes('C');
      
      // Fill in missing positions for generic G/F
      for (const starter of starters) {
        if (!starterPositions[starter]) {
          const genericPos = map[starter];
          if (genericPos === 'G') {
            starterPositions[starter] = hasPG ? 'SG' : 'PG';
          } else if (genericPos === 'F') {
            starterPositions[starter] = hasPF ? 'SF' : (hasC ? 'SF' : 'PF');
          }
        }
      }
    }
    
    return { pos: map as any, starters, starterPositions };
  } catch (e: any) {
    console.error(`[ESPN Positions] Error fetching for ${dateStr}:`, e.message);
    return { pos: {}, starters: [], starterPositions: {} };
  }
}

async function bdlFetch(url: string) {
  const res = await fetch(url, { headers: BDL_HEADERS, cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`BDL ${res.status}: ${t || url}`);
  }
  return res.json();
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
    
    console.log(`[ESPN Positions] Fetching positions for ${teamAbbr} (season ${season})...`);
    
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
        error: `No games found for ${teamAbbr} in season ${season}. Season may not have started yet or BDL doesn't have data.`,
        players: []
      });
    }
    
    console.log(`[ESPN Positions] Found ${games.length} games for ${teamAbbr}, fetching ESPN starting lineups...`);
    
    // Track positions per player
    const playerPositions = new Map<string, {
      name: string;
      positions: Record<string, { count: number; starterCount: number }>;
      totalGames: number;
      starterGames: number;
    }>();
    
    // Process first 20 games (to avoid timeout)
    const gamesToProcess = games.slice(0, 20);
    let processed = 0;
    
    for (const game of gamesToProcess) {
      const gameDate = game.date;
      const homeTeam = String(game.home_team?.abbreviation || '').toUpperCase();
      const awayTeam = String(game.visitor_team?.abbreviation || '').toUpperCase();
      
      try {
        // Determine which team we're tracking
        const targetTeam = homeTeam === teamAbbr ? homeTeam : (awayTeam === teamAbbr ? awayTeam : null);
        if (!targetTeam) {
          console.log(`[ESPN Positions] Skipping game ${gameDate}: ${teamAbbr} not in game (${homeTeam} vs ${awayTeam})`);
          continue;
        }
        
        console.log(`[ESPN Positions] Processing game ${gameDate}: ${homeTeam} vs ${awayTeam}, tracking ${targetTeam}`);
        
        // Get ESPN starting lineup for this game (filtered to target team)
        const espnInfo = await fetchEspnRosterMapByDate(gameDate, homeTeam, awayTeam, targetTeam);
        
        // Process starters with their positions
        console.log(`[ESPN Positions] Game ${gameDate}: Found ${espnInfo.starters.length} starters, positions:`, Object.keys(espnInfo.starterPositions));
        
        for (const starterName of espnInfo.starters) {
          const normalized = normName(starterName);
          const position = espnInfo.starterPositions[starterName] || espnInfo.pos[starterName];
          
          if (!position || !['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) {
            console.log(`[ESPN Positions] Skipping ${starterName}: position=${position} (not valid)`);
            continue;
          }
          
          if (!playerPositions.has(normalized)) {
            playerPositions.set(normalized, {
              name: starterName,
              positions: {},
              totalGames: 0,
              starterGames: 0
            });
          }
          
          const p = playerPositions.get(normalized)!;
          p.totalGames++;
          p.starterGames++;
          
          if (!p.positions[position]) {
            p.positions[position] = { count: 0, starterCount: 0 };
          }
          p.positions[position].count++;
          p.positions[position].starterCount++;
        }
        
        processed++;
        
        // Small delay to avoid rate limiting
        if (processed < gamesToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (e: any) {
        console.error(`[ESPN Positions] Error processing game ${gameDate}:`, e.message);
      }
    }
    
    // Calculate most common position for each player
    const results = Array.from(playerPositions.entries()).map(([key, data]) => {
      let mostCommonPos = '';
      let maxStarterCount = 0;
      let maxCount = 0;
      
      // Prioritize starter positions
      for (const [pos, stats] of Object.entries(data.positions)) {
        if (stats.starterCount > maxStarterCount ||
            (stats.starterCount === maxStarterCount && stats.count > maxCount)) {
          mostCommonPos = pos;
          maxStarterCount = stats.starterCount;
          maxCount = stats.count;
        }
      }
      
      return {
        name: data.name,
        recommendedPosition: mostCommonPos,
        totalGames: data.totalGames,
        starterGames: data.starterGames,
        benchGames: 0, // ESPN only gives us starters
        positionBreakdown: data.positions,
        confidence: maxCount / data.totalGames
      };
    });
    
    if (results.length === 0) {
      return NextResponse.json({
        team: teamAbbr,
        season,
        gamesProcessed: processed,
        totalGames: games.length,
        error: `No players found. Processed ${processed} games but no starters matched ${teamAbbr}. ESPN may not have starting lineup data yet for this season.`,
        players: []
      });
    }
    
    return NextResponse.json({
      team: teamAbbr,
      season,
      gamesProcessed: processed,
      totalGames: games.length,
      players: results.sort((a, b) => b.totalGames - a.totalGames)
    });
    
  } catch (error: any) {
    console.error('[ESPN Positions] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch ESPN positions' },
      { status: 500 }
    );
  }
}

