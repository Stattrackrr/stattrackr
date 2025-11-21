// app/api/team-defense-rankings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache } from '@/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

const NBA_TEAM_MAP: { [key: string]: string } = {
  'ATL': '1610612737', 'BOS': '1610612738', 'BKN': '1610612751', 'CHA': '1610612766',
  'CHI': '1610612741', 'CLE': '1610612739', 'DAL': '1610612742', 'DEN': '1610612743',
  'DET': '1610612765', 'GSW': '1610612744', 'HOU': '1610612745', 'IND': '1610612754',
  'LAC': '1610612746', 'LAL': '1610612747', 'MEM': '1610612763', 'MIA': '1610612748',
  'MIL': '1610612749', 'MIN': '1610612750', 'NOP': '1610612740', 'NYK': '1610612752',
  'OKC': '1610612760', 'ORL': '1610612753', 'PHI': '1610612755', 'PHX': '1610612756',
  'POR': '1610612757', 'SAC': '1610612758', 'SAS': '1610612759', 'TOR': '1610612761',
  'UTA': '1610612762', 'WAS': '1610612764'
};

async function fetchNBAStats(url: string, timeout = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Team Defense Rankings] NBA API error ${response.status}:`, text.slice(0, 500));
      throw new Error(`NBA API ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

async function fetchTeamDefenseStats(teamAbbr: string, teamId: string, seasonStr: string) {
  try {
    const defenseParams = new URLSearchParams({
      LeagueID: '00',
      Season: seasonStr,
      SeasonType: 'Regular Season',
      TeamID: '0',
      PlayerID: '0',
      Outcome: '',
      Location: '',
      Month: '0',
      SeasonSegment: '',
      DateFrom: '',
      DateTo: '',
      OpponentTeamID: teamId,
      VsConference: '',
      VsDivision: '',
      GameSegment: '',
      Period: '0',
      LastNGames: '0',
      ContextMeasure: 'FGA',
      RookieYear: '',
      Position: '',
    });

    const defenseUrl = `${NBA_STATS_BASE}/shotchartdetail?${defenseParams.toString()}`;
    console.log(`[Team Defense Rankings] Fetching defense for ${teamAbbr}...`);
    // Use shorter timeout (5s) for individual teams to speed up overall fetch
    const defenseData = await fetchNBAStats(defenseUrl, 5000);

    if (defenseData?.resultSets?.[0]) {
      const resultSet = defenseData.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];

      const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
      const shotZoneBasicIdx = headers.indexOf('SHOT_ZONE_BASIC');

      const zoneStats: {
        [key: string]: { made: number; attempted: number };
      } = {
        restrictedArea: { made: 0, attempted: 0 },
        paint: { made: 0, attempted: 0 },
        midRange: { made: 0, attempted: 0 },
        leftCorner3: { made: 0, attempted: 0 },
        rightCorner3: { made: 0, attempted: 0 },
        aboveBreak3: { made: 0, attempted: 0 },
      };

      for (const row of rows) {
        const made = row[shotMadeIdx] === 1;
        const zone = row[shotZoneBasicIdx];

        if (zone === 'Restricted Area') {
          zoneStats.restrictedArea.attempted++;
          if (made) zoneStats.restrictedArea.made++;
        } else if (zone === 'In The Paint (Non-RA)') {
          zoneStats.paint.attempted++;
          if (made) zoneStats.paint.made++;
        } else if (zone === 'Mid-Range') {
          zoneStats.midRange.attempted++;
          if (made) zoneStats.midRange.made++;
        } else if (zone === 'Left Corner 3') {
          zoneStats.leftCorner3.attempted++;
          if (made) zoneStats.leftCorner3.made++;
        } else if (zone === 'Right Corner 3') {
          zoneStats.rightCorner3.attempted++;
          if (made) zoneStats.rightCorner3.made++;
        } else if (zone === 'Above the Break 3') {
          zoneStats.aboveBreak3.attempted++;
          if (made) zoneStats.aboveBreak3.made++;
        }
      }

      return {
        team: teamAbbr,
        restrictedArea: {
          fgPct: zoneStats.restrictedArea.attempted > 0 ? (zoneStats.restrictedArea.made / zoneStats.restrictedArea.attempted) * 100 : 0,
          fga: zoneStats.restrictedArea.attempted,
          fgm: zoneStats.restrictedArea.made
        },
        paint: {
          fgPct: zoneStats.paint.attempted > 0 ? (zoneStats.paint.made / zoneStats.paint.attempted) * 100 : 0,
          fga: zoneStats.paint.attempted,
          fgm: zoneStats.paint.made
        },
        midRange: {
          fgPct: zoneStats.midRange.attempted > 0 ? (zoneStats.midRange.made / zoneStats.midRange.attempted) * 100 : 0,
          fga: zoneStats.midRange.attempted,
          fgm: zoneStats.midRange.made
        },
        leftCorner3: {
          fgPct: zoneStats.leftCorner3.attempted > 0 ? (zoneStats.leftCorner3.made / zoneStats.leftCorner3.attempted) * 100 : 0,
          fga: zoneStats.leftCorner3.attempted,
          fgm: zoneStats.leftCorner3.made
        },
        rightCorner3: {
          fgPct: zoneStats.rightCorner3.attempted > 0 ? (zoneStats.rightCorner3.made / zoneStats.rightCorner3.attempted) * 100 : 0,
          fga: zoneStats.rightCorner3.attempted,
          fgm: zoneStats.rightCorner3.made
        },
        aboveBreak3: {
          fgPct: zoneStats.aboveBreak3.attempted > 0 ? (zoneStats.aboveBreak3.made / zoneStats.aboveBreak3.attempted) * 100 : 0,
          fga: zoneStats.aboveBreak3.attempted,
          fgm: zoneStats.aboveBreak3.made
        },
      };
    }

    return null;
  } catch (err) {
    console.error(`[Team Defense Rankings] Error fetching defense for ${teamAbbr}:`, err);
    return null;
  }
}

function calculateRankings(allTeamsData: any[]) {
  const zones = ['restrictedArea', 'paint', 'midRange', 'leftCorner3', 'rightCorner3', 'aboveBreak3'];
  const rankings: { [team: string]: any } = {};

  // For each zone, sort teams by FG% allowed (ascending = best defense first)
  zones.forEach(zone => {
    const teamsWithPct = allTeamsData
      .filter(t => t && t[zone] && t[zone].fga > 0) // Only teams with attempts in this zone
      .map(t => ({
        team: t.team,
        fgPct: t[zone].fgPct,
        fga: t[zone].fga,
        fgm: t[zone].fgm
      }))
      .sort((a, b) => a.fgPct - b.fgPct); // Sort ascending (lowest % = best defense)

    // Assign ranks (1-30)
    teamsWithPct.forEach((t, index) => {
      if (!rankings[t.team]) {
        rankings[t.team] = {};
      }
      rankings[t.team][zone] = {
        rank: index + 1,
        fgPct: t.fgPct,
        fga: t.fga,
        fgm: t.fgm,
        totalTeams: teamsWithPct.length
      };
    });
  });

  return rankings;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const season = parseInt(searchParams.get('season') || '2025');
    const bypassCache = searchParams.get('bypassCache') === 'true';

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const cacheKey = `team_defense_rankings_${season}`;

    // Check cache (unless bypassed)
    const cached = !bypassCache ? cache.get<any>(cacheKey) : null;
    if (cached) {
      console.log(`[Team Defense Rankings] ✅ Cache hit for season ${season}`);
      return NextResponse.json(cached, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }

    console.log(`[Team Defense Rankings] Fetching defense stats for all 30 teams (season ${seasonStr})...`);

    // Fetch defense stats for all 30 teams (use allSettled to handle failures gracefully)
    const allTeamsPromises = Object.entries(NBA_TEAM_MAP).map(([abbr, id]) =>
      fetchTeamDefenseStats(abbr, id, seasonStr)
    );

    const allTeamsResults = await Promise.allSettled(allTeamsPromises);
    const validTeams = allTeamsResults
      .filter(result => result.status === 'fulfilled' && result.value !== null)
      .map(result => (result as PromiseFulfilledResult<any>).value);

    const failedCount = allTeamsResults.length - validTeams.length;
    console.log(`[Team Defense Rankings] Successfully fetched ${validTeams.length}/30 teams${failedCount > 0 ? ` (${failedCount} failed/timed out)` : ''}`);

    // Require at least 20 teams for meaningful rankings
    if (validTeams.length < 20) {
      console.warn(`[Team Defense Rankings] ⚠️ Only ${validTeams.length} teams fetched, need at least 20 for rankings`);
      return NextResponse.json({
        error: 'Insufficient data',
        message: `Only ${validTeams.length}/30 teams available, need at least 20 for rankings`,
        teamsProcessed: validTeams.length
      }, { status: 503 });
    }

    // Calculate rankings
    const rankings = calculateRankings(validTeams);

    const response = {
      season: seasonStr,
      rankings,
      cachedAt: new Date().toISOString(),
      teamsProcessed: validTeams.length
    };

    // Cache for 24 hours (1440 minutes)
    cache.set(cacheKey, response, 1440);
    console.log(`[Team Defense Rankings] 💾 Cached rankings for season ${season}`);

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    console.error('[Team Defense Rankings] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch team defense rankings',
        details: error.message
      },
      { status: 500 }
    );
  }
}

