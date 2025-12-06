import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const BDL_BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY;

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (API_KEY) h["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  return h;
}

// Convert height string to inches (handles "6'10", "6-10", or total inches)
function heightToInches(height: string | null | undefined): number | null {
  if (!height) return null;
  
  const heightStr = String(height).trim();
  
  // If it's just a number (total inches)
  if (/^\d+$/.test(heightStr)) {
    return parseInt(heightStr, 10);
  }
  
  // Parse "6'10" or "6-10" format
  const match = heightStr.match(/(\d+)['-](\d+)/);
  if (match) {
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    return feet * 12 + inches;
  }
  
  return null;
}

// Map BDL team abbreviations to ESPN team abbreviations
// ESPN sometimes uses different abbreviations than BDL
const ESPN_TEAM_ABBR_MAP: Record<string, string> = {
  'UTA': 'UTAH',  // ESPN uses UTAH, BDL uses UTA
  'NYK': 'NY',    // ESPN uses NY, BDL uses NYK
  'WAS': 'WSH',   // ESPN uses WSH, BDL uses WAS
  'SAS': 'SA',    // ESPN uses SA, BDL uses SAS
  'GSW': 'GS',    // ESPN uses GS, BDL uses GSW
  'NOP': 'NO',    // ESPN uses NO, BDL uses NOP
  // Add more mappings as needed
};

// Normalize name for matching (improved to handle more edge cases)
function normalizeName(s: string): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD') // Decompose characters (é -> e + ´)
    .replace(/\p{Diacritic}/gu, '') // Remove diacritics
    .replace(/[''""`]/g, '') // Remove quotes/apostrophes (De'Aaron -> DeAaron)
    .replace(/[^a-z0-9\s]/g, '') // Remove all non-alphanumeric except spaces
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '') // Remove suffixes
    .replace(/\./g, '') // Remove periods (O.G. -> OG)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Calculate string similarity (simple Levenshtein-like)
function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1;
  
  // Check if shorter is contained in longer
  if (longer.includes(shorter)) return shorter.length / longer.length;
  
  // Simple character overlap
  const set1 = new Set(str1.split(''));
  const set2 = new Set(str2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

// Fetch ESPN roster and get headshot URL for a player by name
async function getEspnHeadshot(playerName: string, teamAbbr: string, debug = false): Promise<{ headshot: string | null; matchedName?: string; similarity?: number; debug?: any }> {
  try {
    // Special case: if playerName is "DEBUG_UTA_ROSTER", just return roster info
    if (playerName === 'DEBUG_UTA_ROSTER') {
      const teamsResp = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams', { cache: 'no-store' });
      if (!teamsResp.ok) return { headshot: null };
      
      const teamsJson = await teamsResp.json();
      const allTeams: any[] = teamsJson?.sports?.[0]?.leagues?.[0]?.teams?.map((t: any) => t.team) || [];
      
      const team = allTeams.find((t: any) => {
        const abbr = String(t?.abbreviation || '').toUpperCase();
        return abbr === teamAbbr.toUpperCase();
      });
      
      if (!team?.id) return { headshot: null };
      
      const rosterResp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}?enable=roster`, { cache: 'no-store' });
      if (!rosterResp.ok) return { headshot: null };
      
      const rosterJson = await rosterResp.json();
      const athletes: any[] = rosterJson?.team?.athletes || [];
      
      return {
        headshot: null,
        matchedName: undefined,
        similarity: undefined,
        debug: {
          searched: 'DEBUG_UTA_ROSTER',
          normalizedSearch: '',
          teamAbbr,
          rosterSize: athletes.length,
          allNormalized: athletes.map(a => normalizeName(a?.displayName || '')),
          allOriginal: athletes.map(a => a?.displayName || '')
        }
      };
    }
    
    // First, get ESPN team ID
    const teamsResp = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams', { cache: 'no-store' });
    if (!teamsResp.ok) return { headshot: null };
    
    const teamsJson = await teamsResp.json();
    const allTeams: any[] = teamsJson?.sports?.[0]?.leagues?.[0]?.teams?.map((t: any) => t.team) || [];
    
    // Find team by abbreviation (try both BDL and ESPN abbreviations)
    const espnAbbr = ESPN_TEAM_ABBR_MAP[teamAbbr.toUpperCase()] || teamAbbr.toUpperCase();
    const team = allTeams.find((t: any) => {
      const abbr = String(t?.abbreviation || '').toUpperCase();
      return abbr === teamAbbr.toUpperCase() || abbr === espnAbbr;
    });
    
    if (!team?.id) {
      if (debug) {
        console.warn(`[Player Sync] Team not found: ${teamAbbr} (tried ${teamAbbr} and ${espnAbbr}). Available ESPN teams: ${allTeams.map(t => t.abbreviation).join(', ')}`);
      }
      return { headshot: null };
    }
    
    // Fetch roster
    const rosterResp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}?enable=roster`, { cache: 'no-store' });
    if (!rosterResp.ok) return { headshot: null };
    
    const rosterJson = await rosterResp.json();
    const athletes: any[] = rosterJson?.team?.athletes || [];
    
    // Match player by name
    const normalizedSearch = normalizeName(playerName);
    let matchedAthlete = athletes.find((a: any) => {
      const displayName = a?.displayName || '';
      return normalizeName(displayName) === normalizedSearch;
    });
    
    // If exact match fails, try fuzzy matching (first name + last name separately)
    if (!matchedAthlete) {
      const [firstName, ...lastNameParts] = playerName.split(' ');
      const lastName = lastNameParts.join(' ');
      const normalizedFirst = normalizeName(firstName);
      const normalizedLast = normalizeName(lastName);
      
      matchedAthlete = athletes.find((a: any) => {
        const displayName = a?.displayName || '';
        const normalized = normalizeName(displayName);
        const [espnFirst, ...espnLastParts] = displayName.split(' ');
        const espnLast = espnLastParts.join(' ');
        const normalizedEspnFirst = normalizeName(espnFirst);
        const normalizedEspnLast = normalizeName(espnLast);
        
        // Match if first and last names match (allowing for middle names/initials)
        // Also handle shortened names (Nicolas -> Nic, Nah'Shon -> Bones)
        const firstMatches = normalizedFirst === normalizedEspnFirst || 
                            normalizedFirst.includes(normalizedEspnFirst) || 
                            normalizedEspnFirst.includes(normalizedFirst);
        const lastMatches = normalizedLast === normalizedEspnLast || 
                           normalized.includes(normalizedLast);
        
        return firstMatches && lastMatches;
      });
    }
    
    // If still no match, try high similarity threshold (for nicknames like "Bones" vs "Nah'Shon")
    if (!matchedAthlete) {
      const normalizedSearch = normalizeName(playerName);
      let bestMatch: any = null;
      let bestSimilarity = 0.75; // Higher threshold for nickname matching
      
      for (const athlete of athletes) {
        const displayName = athlete?.displayName || '';
        const normalized = normalizeName(displayName);
        const similarity = calculateSimilarity(normalizedSearch, normalized);
        
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = athlete;
        }
      }
      
      if (bestMatch) {
        matchedAthlete = bestMatch;
      }
    }
    
    if (matchedAthlete) {
      // ESPN headshot is usually in headshot.href or headshot
      const headshot = matchedAthlete?.headshot?.href || matchedAthlete?.headshot || null;
      const matchedName = matchedAthlete?.displayName || '';
      const similarity = matchedName ? calculateSimilarity(normalizeName(playerName), normalizeName(matchedName)) : 1;
      return { headshot, matchedName, similarity };
    }
    
    // Debug: show what we searched for vs what's available
    if (debug) {
      const allNames = athletes.map(a => ({
        original: a?.displayName || '',
        normalized: normalizeName(a?.displayName || '')
      }));
      const sampleNames = allNames.slice(0, 10);
      
      // Find closest matches (for debugging)
      const closestMatches = allNames
        .map(n => ({
          ...n,
          similarity: calculateSimilarity(normalizedSearch, n.normalized)
        }))
        .filter(m => m.similarity > 0.5)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3);
      
      return {
        headshot: null,
        debug: {
          searched: playerName,
          normalizedSearch,
          teamAbbr,
          rosterSize: athletes.length,
          sampleNames,
          allNormalized: allNames.map(n => n.normalized),
          closestMatches
        }
      };
    }
    
    return { headshot: null };
  } catch (error) {
    console.warn(`[Player Sync] Error fetching ESPN headshot for ${playerName} (${teamAbbr}):`, error);
    return { headshot: null };
  }
}

/**
 * Fetch ALL active players from BDL API using cursor-based pagination
 */
async function fetchAllActivePlayers() {
  const allPlayers: any[] = [];
  let cursor: string | null = null;
  let hops = 0;
  const maxHops = 100; // Safety limit (should be enough for all NBA players)

  while (hops < maxHops) {
    const url = new URL(`${BDL_BASE}/players/active`);
    url.searchParams.set('per_page', '100');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString(), {
      headers: authHeaders(),
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error(`Failed to fetch players hop ${hops + 1}: ${response.status}`);
      break;
    }

    const data = await response.json();
    const players = data.data || [];
    allPlayers.push(...players);

    console.log(`Fetched hop ${hops + 1}: ${players.length} players (total: ${allPlayers.length})`);

    const nextCursor = data.meta?.next_cursor ?? null;
    if (!nextCursor) break;

    cursor = String(nextCursor);
    hops++;
  }

  return allPlayers;
}

/**
 * Sync all active players from BDL to Supabase
 * This should be run periodically (e.g., daily) to keep player data fresh
 */
export async function GET(req: NextRequest) {
  try {
    console.log('🔄 Starting player sync from BDL to Supabase...');

    // Fetch all active players from BDL
    const players = await fetchAllActivePlayers();
    console.log(`📥 Fetched ${players.length} players from BDL`);

    if (players.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No players fetched from BDL' },
        { status: 500 }
      );
    }

    // Transform players for Supabase
    const playersToUpsert = players.map((p: any) => ({
      id: p.id,
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      position: p.position || null,
      height: p.height || null,
      height_inches: heightToInches(p.height), // Calculate and store height in inches for fast filtering
      weight: p.weight || null,
      team_id: p.team?.id || null,
      team_abbreviation: p.team?.abbreviation || null,
      updated_at: new Date().toISOString()
    }));

    // Upsert all players (insert or update if exists)
    const { error } = await supabaseAdmin
      .from('players')
      .upsert(playersToUpsert, {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error syncing players to Supabase:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(`✅ Successfully synced ${playersToUpsert.length} players to Supabase`);

    // Now fetch headshots from ESPN for players with teams
    console.log('🖼️ Fetching ESPN headshots for players...');
    const playersWithTeams = players.filter((p: any) => p.team?.abbreviation);
    const playersWithoutTeams = players.length - playersWithTeams.length;
    if (playersWithoutTeams > 0) {
      console.log(`⚠️ ${playersWithoutTeams} players without teams (free agents) - skipping headshot fetch`);
    }
    
    const headshotUpdates: Array<{ id: number; headshot_url: string | null }> = [];
    const missingHeadshots: Array<{ id: number; name: string; normalizedName: string; team: string }> = [];
    const matchedPlayers: Array<{ bdlName: string; espnName: string; team: string; similarity?: number }> = [];
    let headshotsFetched = 0;

    // Group players by team to batch ESPN API calls
    const playersByTeam = new Map<string, any[]>();
    for (const player of playersWithTeams) {
      const team = player.team?.abbreviation || '';
      if (!team) continue;
      if (!playersByTeam.has(team)) {
        playersByTeam.set(team, []);
      }
      playersByTeam.get(team)!.push(player);
    }

    // Fetch headshots for each team's players
    const debugSamples: Array<{ name: string; team: string; debug: any }> = [];
    let debugCount = 0;
    
    // Special debug for UTA to see what ESPN actually has
    const utaPlayers = playersByTeam.get('UTA') || [];
    if (utaPlayers.length > 0) {
      console.log(`\n🔍 Debugging UTA roster (${utaPlayers.length} BDL players)...`);
      const utaDebug = await getEspnHeadshot('DEBUG_UTA_ROSTER', 'UTA', true);
      if (utaDebug.debug) {
        console.log(`   ESPN UTA roster size: ${utaDebug.debug.rosterSize}`);
        console.log(`   All ESPN UTA player names: ${utaDebug.debug.allNormalized.join(', ')}`);
      }
    }
    
    for (const [teamAbbr, teamPlayers] of playersByTeam.entries()) {
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
      
      for (const player of teamPlayers) {
        const playerName = `${player.first_name} ${player.last_name}`;
        const normalizedName = normalizeName(playerName);
        
        // Debug first 10 missing players to see name matching issues
        const shouldDebug = debugCount < 10;
        const result = await getEspnHeadshot(playerName, teamAbbr, shouldDebug);
        
        if (result.headshot) {
          headshotUpdates.push({ id: player.id, headshot_url: result.headshot });
          headshotsFetched++;
          
          // Store match info for verification (sample of first 50)
          if (matchedPlayers.length < 50 && result.matchedName) {
            matchedPlayers.push({
              bdlName: playerName,
              espnName: result.matchedName,
              team: teamAbbr,
              similarity: result.similarity
            });
          }
        } else {
          missingHeadshots.push({ 
            id: player.id, 
            name: playerName, 
            normalizedName,
            team: teamAbbr 
          });
          
          // Store debug info for first few failures
          if (result.debug && debugSamples.length < 10) {
            debugSamples.push({
              name: playerName,
              team: teamAbbr,
              debug: result.debug
            });
            debugCount++;
          }
        }
      }
    }
    
    // Log summary of matched players for verification
    if (matchedPlayers.length > 0) {
      console.log(`\n✅ Sample matched players (verifying correctness):`);
      matchedPlayers.slice(0, 30).forEach(m => {
        const matchType = m.similarity && m.similarity < 1 
          ? ` (${(m.similarity * 100).toFixed(0)}% match - ${m.similarity < 0.9 ? 'FUZZY' : 'EXACT'})` 
          : ' (EXACT)';
        console.log(`   BDL: "${m.bdlName}" → ESPN: "${m.espnName}" (${m.team})${matchType}`);
      });
      if (matchedPlayers.length > 30) {
        console.log(`   ... and ${matchedPlayers.length - 30} more matches`);
      }
    }
    
    // Log summary of missing headshots
    const totalMissing = playersWithoutTeams + missingHeadshots.length;
    if (totalMissing > 0) {
      console.log(`\n⚠️ ${totalMissing} players didn't get headshots:`);
      console.log(`   - ${playersWithoutTeams} without teams (free agents)`);
      console.log(`   - ${missingHeadshots.length} with teams but not found in ESPN rosters`);
      
      if (missingHeadshots.length > 0) {
        console.log(`\n📋 Sample missing players (showing name normalization):`);
        missingHeadshots.slice(0, 15).forEach(p => {
          console.log(`   "${p.name}" (${p.team}) -> normalized: "${p.normalizedName}"`);
        });
        
        // Show debug samples with ESPN roster comparisons
        if (debugSamples.length > 0) {
          console.log(`\n🔍 Debug samples (comparing with ESPN roster):`);
          debugSamples.forEach(sample => {
            console.log(`\n   Player: "${sample.name}" (${sample.team})`);
            console.log(`   Normalized: "${sample.debug.normalizedSearch}"`);
            console.log(`   ESPN roster size: ${sample.debug.rosterSize}`);
            console.log(`   Sample ESPN names: ${sample.debug.sampleNames.map((n: any) => `"${n.original}" -> "${n.normalized}"`).join(', ')}`);
            if (sample.debug.closestMatches && sample.debug.closestMatches.length > 0) {
              console.log(`   Closest matches: ${sample.debug.closestMatches.map((m: any) => `"${m.original}" (${(m.similarity * 100).toFixed(0)}% similar)`).join(', ')}`);
            }
          });
        }
      }
    }

    // Update headshots in batches
    if (headshotUpdates.length > 0) {
      console.log(`📸 Updating ${headshotUpdates.length} headshots...`);
      
      // Update in batches of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < headshotUpdates.length; i += BATCH_SIZE) {
        const batch = headshotUpdates.slice(i, i + BATCH_SIZE);
        
        for (const update of batch) {
          await supabaseAdmin
            .from('players')
            .update({ headshot_url: update.headshot_url })
            .eq('id', update.id);
        }
      }
      
      console.log(`✅ Updated ${headshotsFetched} headshots`);
    }

    // Calculate match quality stats
    const exactMatches = matchedPlayers.filter(m => !m.similarity || m.similarity === 1).length;
    const fuzzyMatches = matchedPlayers.filter(m => m.similarity && m.similarity < 1 && m.similarity >= 0.9).length;
    const lowConfidenceMatches = matchedPlayers.filter(m => m.similarity && m.similarity < 0.9).length;
    
    return NextResponse.json({
      success: true,
      count: playersToUpsert.length,
      headshotsFetched,
      playersWithoutTeams: playersWithoutTeams,
      missingHeadshots: missingHeadshots.length,
      matchQuality: {
        exact: exactMatches,
        fuzzy: fuzzyMatches,
        lowConfidence: lowConfidenceMatches,
        sampleMatches: matchedPlayers.slice(0, 20) // Include sample for verification
      },
      message: `Synced ${playersToUpsert.length} players to Supabase (${headshotsFetched} headshots fetched, ${playersWithoutTeams} without teams, ${missingHeadshots.length} not found in ESPN)`
    });

  } catch (error: any) {
    console.error('❌ Error in player sync:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

