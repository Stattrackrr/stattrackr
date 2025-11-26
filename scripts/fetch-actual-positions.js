#!/usr/bin/env node

/**
 * Fetch Actual Positions from NBA Stats API
 * 
 * Fetches real game positions from NBA Stats API boxscores (START_POSITION field)
 * This is more accurate than depth chart scraping because it shows actual positions played.
 * 
 * Usage:
 *   node scripts/fetch-actual-positions.js --team MIL --season 2025
 *   node scripts/fetch-actual-positions.js --all --season 2025
 *   node scripts/fetch-actual-positions.js --team MIL --min-games 5 --apply
 */

const fs = require('fs');
const path = require('path');

const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const ABBR_TO_TEAM_ID = {
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766, CHI: 1610612741,
  CLE: 1610612739, DAL: 1610612742, DEN: 1610612743, DET: 1610612765, GSW: 1610612744,
  HOU: 1610612745, IND: 1610612754, LAC: 1610612746, LAL: 1610612747, MEM: 1610612763,
  MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756, POR: 1610612757,
  SAC: 1610612758, SAS: 1610612759, TOR: 1610612761, UTA: 1610612762, WAS: 1610612764
};

const VALID_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/stats/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v=124, "Google Chrome";v=124, "Not=A?Brand";v=99',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

function normName(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function idx(headers, ...names) {
  for (const name of names) {
    const i = headers.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

async function nbaFetch(pathAndQuery) {
  // Try using our API endpoint first (server-side, works better)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  if (pathAndQuery.includes('teamgamelog')) {
    // Extract team and season from query
    const teamMatch = pathAndQuery.match(/TeamID=(\d+)/);
    const seasonMatch = pathAndQuery.match(/Season=([^&]+)/);
    if (teamMatch && seasonMatch) {
      const teamId = parseInt(teamMatch[1], 10);
      const seasonLabel = decodeURIComponent(seasonMatch[1]);
      // Find team abbreviation
      const teamAbbr = Object.entries(ABBR_TO_TEAM_ID).find(([_, id]) => id === teamId)?.[0];
      if (teamAbbr) {
        // Extract year from season label (e.g., "2024-25" -> 2024)
        const year = parseInt(seasonLabel.split('-')[0], 10);
        try {
          const apiRes = await fetch(`${baseUrl}/api/dvp/fetch-positions?team=${teamAbbr}&season=${year}`);
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            // Convert to expected format
            if (apiData.players && apiData.players.length > 0) {
              // Return mock resultSet format with game IDs
              // For now, return empty and let the script use direct API
              // This is a fallback - the API endpoint can be called directly
            }
          }
        } catch (e) {
          // Fall through to direct API call
        }
      }
    }
  }
  
  // Direct NBA API call (original method)
  const url = `https://stats.nba.com/stats/${pathAndQuery}`;
  const res = await fetch(url, { headers: NBA_HEADERS });
  if (!res.ok) {
    throw new Error(`NBA API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function formatSeason(season) {
  // Convert "2025" to "2025-26"
  const year = parseInt(season, 10);
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

async function fetchTeamGameLog(teamId, seasonLabel) {
  try {
    const data = await nbaFetch(`teamgamelog?TeamID=${teamId}&Season=${encodeURIComponent(seasonLabel)}&SeasonType=Regular+Season`);
    const rs = (data?.resultSets || []).find(r => (r?.name || '').toLowerCase().includes('teamgamelog')) || data?.resultSets?.[0];
    
    if (!rs) {
      console.error(`   No resultSet found in response for team ${teamId}`);
      return [];
    }
    
    const headers = rs?.headers || [];
    const rows = rs?.rowSet || [];
    const iGameId = idx(headers, 'GAME_ID', 'Game_ID');
    
    if (iGameId < 0) {
      console.error(`   GAME_ID column not found in headers:`, headers);
      return [];
    }
    
    if (rows.length === 0) {
      console.log(`   No games found in resultSet (this is normal if season hasn't started or team has no games)`);
    }
    
    return rows.map(r => String(r[iGameId])).filter(Boolean);
  } catch (e) {
    console.error(`   Error fetching game log for team ${teamId}:`, e.message);
    if (e.stack) console.error(`   Stack:`, e.stack.split('\n').slice(0, 3).join('\n'));
    return [];
  }
}

async function fetchBoxscorePositions(gameId, teamId) {
  try {
    const data = await nbaFetch(`boxscoretraditionalv2?GameID=${gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
    const pset = (data?.resultSets || []).find(r => (r?.name || '').toLowerCase().includes('playerstats')) || data?.resultSets?.[0];
    const headers = pset?.headers || [];
    const rows = pset?.rowSet || [];
    
    const iTeamId = idx(headers, 'TEAM_ID');
    const iPlayer = idx(headers, 'PLAYER_NAME');
    const iStartPos = idx(headers, 'START_POSITION');
    const iMin = idx(headers, 'MIN');
    const iAst = idx(headers, 'AST');
    const iReb = idx(headers, 'REB');
    const iBlk = idx(headers, 'BLK');
    
    if (iTeamId < 0 || iPlayer < 0 || iStartPos < 0) return [];
    
    // First pass: collect all team players and their starter positions
    const teamPlayers = [];
    const starterPositions = new Set(); // Track exact positions already filled by starters
    
    for (const row of rows) {
      const rowTeamId = Number(row[iTeamId]);
      if (rowTeamId !== teamId) continue; // Only players from target team
      
      const playerName = String(row[iPlayer] || '').trim();
      const startPos = String(row[iStartPos] || '').toUpperCase().trim();
      const minutes = String(row[iMin] || '').trim();
      
      // Only count players who actually played (have minutes)
      if (!playerName || !minutes || minutes === '') continue;
      
      const isStarter = startPos && startPos.length > 0;
      
      // Get stats for position inference
      const ast = Number(row[iAst] || 0);
      const reb = Number(row[iReb] || 0);
      const blk = Number(row[iBlk] || 0);
      const iPts = idx(headers, 'PTS');
      const pts = iPts >= 0 ? Number(row[iPts] || 0) : 0;
      
      // Track exact starter positions (for context-based G/F splitting)
      if (isStarter && VALID_POSITIONS.includes(startPos)) {
        starterPositions.add(startPos);
      }
      
      teamPlayers.push({
        name: playerName,
        normalized: normName(playerName),
        startPos: startPos,
        isStarter: isStarter,
        minutes: minutes,
        stats: { ast, reb, blk, pts },
        row: row // Keep row reference for later
      });
    }
    
    // Second pass: determine final positions using context
    const positions = [];
    const benchPlayers = [];
    
    // First, process all starters
    for (const player of teamPlayers) {
      if (!player.isStarter) {
        benchPlayers.push(player);
        continue;
      }
      
      const { name, normalized, startPos, minutes, stats } = player;
      const { ast, reb, blk } = stats;
      
      let finalPosition = null;
      let isExact = false;
      let inferenceMethod = '';
      
      // STARTER: Use START_POSITION
      if (VALID_POSITIONS.includes(startPos)) {
        // Perfect! We got the exact 5-position value ✅
        finalPosition = startPos;
        isExact = true;
        inferenceMethod = 'starter_exact';
      } else if (startPos === 'G') {
        // Generic guard - use context of other starters to fill missing position
        if (starterPositions.has('PG') && !starterPositions.has('SG')) {
          // PG already taken, fill SG
          finalPosition = 'SG';
          inferenceMethod = 'starter_context_fill';
        } else if (starterPositions.has('SG') && !starterPositions.has('PG')) {
          // SG already taken, fill PG
          finalPosition = 'PG';
          inferenceMethod = 'starter_context_fill';
        } else {
          // Both or neither taken - use assist heuristic
          finalPosition = ast >= 5 ? 'PG' : 'SG';
          inferenceMethod = 'starter_heuristic';
        }
        isExact = false;
      } else if (startPos === 'F') {
        // Generic forward - use context of other starters to fill missing position
        if (starterPositions.has('SF') && !starterPositions.has('PF')) {
          // SF already taken, fill PF
          finalPosition = 'PF';
          inferenceMethod = 'starter_context_fill';
        } else if (starterPositions.has('PF') && !starterPositions.has('SF')) {
          // PF already taken, fill SF
          finalPosition = 'SF';
          inferenceMethod = 'starter_context_fill';
        } else {
          // Both or neither taken - use rebound/block heuristic
          finalPosition = (reb >= 8 || blk >= 2) ? 'PF' : 'SF';
          inferenceMethod = 'starter_heuristic';
        }
        isExact = false;
      } else if (startPos === 'C') {
        // Center is always C, no ambiguity
        finalPosition = 'C';
        isExact = true;
        inferenceMethod = 'starter_exact';
      }
      
      if (finalPosition) {
        positions.push({
          name: name,
          normalized: normalized,
          position: finalPosition,
          isStarter: true,
          minutes: minutes,
          isExact: isExact,
          originalStartPos: startPos,
          inferenceMethod: inferenceMethod,
          stats: stats
        });
      }
    }
    
    // Now process bench players with better logic
    // Group bench players by position type
    const benchGuards = [];
    const benchForwards = [];
    const benchCenters = [];
    
    for (const player of benchPlayers) {
      const { stats } = player;
      const { ast, reb, blk } = stats;
      
      // Identify position type based on stats
      if (reb >= 10 || blk >= 2) {
        // High rebounds/blocks = center
        benchCenters.push(player);
      } else if (ast >= 3 || reb < 6) {
        // Higher assists or low rebounds = guard
        benchGuards.push(player);
      } else {
        // Moderate rebounds, lower assists = forward
        benchForwards.push(player);
      }
    }
    
    // Assign guard positions: most assists = PG, others = SG
    benchGuards.sort((a, b) => b.stats.ast - a.stats.ast);
    for (let i = 0; i < benchGuards.length; i++) {
      const player = benchGuards[i];
      const finalPosition = i === 0 ? 'PG' : 'SG'; // First (most assists) = PG, rest = SG
      
      positions.push({
        name: player.name,
        normalized: player.normalized,
        position: finalPosition,
        isStarter: false,
        minutes: player.minutes,
        isExact: false,
        originalStartPos: 'BENCH',
        inferenceMethod: i === 0 ? 'bench_guard_most_ast' : 'bench_guard_other',
        stats: player.stats
      });
    }
    
    // Assign forward positions: most rebounds = PF, others = SF
    benchForwards.sort((a, b) => b.stats.reb - a.stats.reb);
    for (let i = 0; i < benchForwards.length; i++) {
      const player = benchForwards[i];
      const finalPosition = i === 0 ? 'PF' : 'SF'; // First (most rebounds) = PF, rest = SF
      
      positions.push({
        name: player.name,
        normalized: player.normalized,
        position: finalPosition,
        isStarter: false,
        minutes: player.minutes,
        isExact: false,
        originalStartPos: 'BENCH',
        inferenceMethod: i === 0 ? 'bench_forward_most_reb' : 'bench_forward_other',
        stats: player.stats
      });
    }
    
    // Centers are already identified
    for (const player of benchCenters) {
      positions.push({
        name: player.name,
        normalized: player.normalized,
        position: 'C',
        isStarter: false,
        minutes: player.minutes,
        isExact: false,
        originalStartPos: 'BENCH',
        inferenceMethod: 'bench_center',
        stats: player.stats
      });
    }
    
    return positions;
  } catch (e) {
    console.error(`Error fetching boxscore for game ${gameId}:`, e.message);
    return [];
  }
}

async function analyzeTeam(teamAbbr, season = '2025', minGames = 1) {
  const teamId = ABBR_TO_TEAM_ID[teamAbbr];
  if (!teamId) {
    return { team: teamAbbr, error: 'Invalid team abbreviation', players: [] };
  }
  
  const seasonLabel = formatSeason(season);
  console.log(`📊 Fetching game log for ${teamAbbr} (${seasonLabel})...`);
  
  const gameIds = await fetchTeamGameLog(teamId, seasonLabel);
  if (gameIds.length === 0) {
    return { team: teamAbbr, error: 'No games found', players: [] };
  }
  
  console.log(`   Found ${gameIds.length} games, fetching boxscores...`);
  
  // Track position counts per player
  const playerPositions = new Map();
  let processedGames = 0;
  let errors = 0;
  
  // Process games with delay to avoid rate limiting
  for (let i = 0; i < gameIds.length; i++) {
    const gameId = gameIds[i];
    try {
      const positions = await fetchBoxscorePositions(gameId, teamId);
      
      for (const pos of positions) {
        if (!playerPositions.has(pos.normalized)) {
          playerPositions.set(pos.normalized, {
            name: pos.name,
            normalized: pos.normalized,
            positions: {},
            totalGames: 0,
            starterGames: 0,
            benchGames: 0
          });
        }
        
        const p = playerPositions.get(pos.normalized);
        p.totalGames++;
        if (pos.isStarter) {
          p.starterGames++;
        } else {
          p.benchGames++;
        }
        
        if (!p.positions[pos.position]) {
          p.positions[pos.position] = { 
            count: 0, 
            starterCount: 0, 
            benchCount: 0,
            exactCount: 0 
          };
        }
        p.positions[pos.position].count++;
        if (pos.isStarter) {
          p.positions[pos.position].starterCount++;
        } else {
          p.positions[pos.position].benchCount++;
        }
        if (pos.isExact) {
          p.positions[pos.position].exactCount++;
        }
      }
      
      processedGames++;
      
      // Small delay to avoid rate limiting
      if (i < gameIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (e) {
      errors++;
      console.error(`   Error processing game ${gameId}:`, e.message);
    }
  }
  
  console.log(`   Processed ${processedGames}/${gameIds.length} games (${errors} errors)`);
  
    // Calculate most common position for each player
    const results = [];
    for (const [normalized, data] of playerPositions.entries()) {
      if (data.totalGames < minGames) continue;
      
      // Find most common position (prioritize: exact > starter > bench > total)
      let mostCommonPos = null;
      let maxCount = 0;
      let maxStarterCount = 0;
      let maxBenchCount = 0;
      let maxExactCount = 0;
      
      for (const [pos, stats] of Object.entries(data.positions)) {
        // Prioritize: exact count > starter count > bench count > total count
        if (stats.exactCount > maxExactCount ||
            (stats.exactCount === maxExactCount && stats.starterCount > maxStarterCount) ||
            (stats.exactCount === maxExactCount && stats.starterCount === maxStarterCount && stats.benchCount > maxBenchCount) ||
            (stats.exactCount === maxExactCount && stats.starterCount === maxStarterCount && stats.benchCount === maxBenchCount && stats.count > maxCount)) {
          mostCommonPos = pos;
          maxCount = stats.count;
          maxStarterCount = stats.starterCount;
          maxBenchCount = stats.benchCount || 0;
          maxExactCount = stats.exactCount || 0;
        }
      }
      
      if (mostCommonPos) {
        const totalExact = Object.values(data.positions).reduce((sum, stats) => sum + (stats.exactCount || 0), 0);
        const totalStarter = Object.values(data.positions).reduce((sum, stats) => sum + (stats.starterCount || 0), 0);
        const hasExact = totalExact > 0;
        const exactPercentage = (totalExact / data.totalGames) * 100;
        const starterPercentage = (totalStarter / data.totalGames) * 100;
        
        let note = '';
        if (hasExact) {
          note = `✅ ${exactPercentage.toFixed(0)}% exact (100% accurate)`;
        } else if (totalStarter > 0) {
          const heuristicStarter = totalStarter - totalExact;
          if (heuristicStarter > 0) {
            note = `⚠️ ${exactPercentage.toFixed(0)}% exact, ${((heuristicStarter/data.totalGames)*100).toFixed(0)}% starter (heuristic), ${(100-starterPercentage).toFixed(0)}% bench (inferred)`;
          } else {
            note = `⚠️ ${starterPercentage.toFixed(0)}% starter (heuristic), ${(100-starterPercentage).toFixed(0)}% bench (inferred)`;
          }
        } else {
          note = `⚠️ 100% bench (inferred from stats - not 100% accurate)`;
        }
        
        results.push({
          name: data.name,
          normalized: normalized,
          recommendedPosition: mostCommonPos,
          totalGames: data.totalGames,
          starterGames: data.starterGames,
          benchGames: data.benchGames,
          positionBreakdown: data.positions,
          confidence: maxCount / data.totalGames,
          exactDataPercentage: exactPercentage,
          starterDataPercentage: starterPercentage,
          hasExactPositions: hasExact,
          note: note
        });
      }
    }
  
  // Sort by total games (most active first)
  results.sort((a, b) => b.totalGames - a.totalGames);
  
  return {
    team: teamAbbr,
    players: results,
    totalGames: gameIds.length,
    processedGames: processedGames
  };
}

function loadPositionsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { positions: {}, aliases: {} };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return { positions: {}, aliases: {} };
  }
}

function savePositionsFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  let team = null;
  let all = false;
  let minGames = 1;
  let apply = false;
  let season = '2025';
  
  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--team' && args[i + 1]) {
      team = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === '--all') {
      all = true;
    } else if (args[i] === '--min-games' && args[i + 1]) {
      minGames = parseInt(args[i + 1], 10) || 1;
      i++;
    } else if (args[i] === '--apply') {
      apply = true;
    } else if (args[i] === '--season' && args[i + 1]) {
      season = args[i + 1];
      i++;
    }
  }
  
  if (!team && !all) {
    console.error('Error: Must provide --team or --all');
    console.error('\nUsage:');
    console.error('  node scripts/fetch-actual-positions.js --team MIL --season 2025');
    console.error('  node scripts/fetch-actual-positions.js --all --season 2025');
    console.error('  node scripts/fetch-actual-positions.js --team MIL --min-games 5 --apply');
    process.exit(1);
  }
  
  const teamsToAnalyze = all ? TEAMS : [team];
  const allResults = [];
  
  console.log('🏀 Fetching Actual Positions from NBA Stats API\n');
  console.log(`Season: ${formatSeason(season)}`);
  console.log(`Minimum games required: ${minGames}\n`);
  console.log('='.repeat(100));
  
  for (const teamAbbr of teamsToAnalyze) {
    const result = await analyzeTeam(teamAbbr, season, minGames);
    allResults.push(result);
    
    if (result.error) {
      console.log(`\n❌ ${teamAbbr}: ${result.error}`);
      continue;
    }
    
    console.log(`\n🏀 ${teamAbbr} (${result.processedGames}/${result.totalGames} games processed, ${result.players.length} players)`);
    console.log('Legend: ✓=100% accurate (exact PG/SG/SF/PF/C) | ~=Heuristic (G/F split using context or stats) | *=Inferred (bench stats) | S=Starter | B=Bench | E=Exact count');
    console.log('-'.repeat(100));
    
    // Load current positions for comparison
    const teamFile = path.resolve(process.cwd(), 'data', 'player_positions', 'teams', `${teamAbbr}.json`);
    const masterFile = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
    const teamData = loadPositionsFile(teamFile);
    const masterData = loadPositionsFile(masterFile);
    const currentPositions = { ...masterData.positions, ...teamData.positions };
    
    for (const player of result.players) {
      const currentPos = currentPositions[player.normalized] || 'NOT SET';
      const needsUpdate = currentPos !== player.recommendedPosition;
      const status = needsUpdate ? '⚠️  UPDATE' : '✅ OK';
      
      // Build position breakdown string
      const breakdown = Object.entries(player.positionBreakdown)
        .map(([pos, stats]) => {
          const exact = stats.exactCount || 0;
          const starter = stats.starterCount || 0;
          const bench = stats.benchCount || 0;
          const total = stats.count;
          
          let marker = '';
          if (exact > 0) {
            // Has exact starter data
            marker = `✓${pos}:${total}(${starter}S/${bench}B,${exact}E)`;
          } else if (starter > 0) {
            // Has starter data (heuristic)
            marker = `~${pos}:${total}(${starter}S/${bench}B)`;
          } else {
            // Only bench data (inferred)
            marker = `*${pos}:${total}(${bench}B)`;
          }
          return marker;
        })
        .join(', ');
      
      const gamesInfo = `${player.totalGames}G (${player.starterGames}S/${player.benchGames}B)`;
      console.log(`${status} ${player.name.padEnd(30)} | Current: ${String(currentPos).padEnd(8)} | Recommended: ${player.recommendedPosition} | ${gamesInfo} | ${(player.confidence * 100).toFixed(0)}% | ${breakdown} | ${player.note}`);
    }
    
    // Small delay between teams
    if (teamAbbr !== teamsToAnalyze[teamsToAnalyze.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Generate updates if --apply
  if (apply) {
    console.log('\n' + '='.repeat(100));
    console.log('📝 APPLYING POSITION UPDATES\n');
    
    const updatesByTeam = {};
    
    for (const result of allResults) {
      if (result.error || result.players.length === 0) continue;
      
      const teamFile = path.resolve(process.cwd(), 'data', 'player_positions', 'teams', `${result.team}.json`);
      const existing = loadPositionsFile(teamFile);
      const positions = existing.positions || {};
      const aliases = existing.aliases || {};
      
      let updated = 0;
      for (const player of result.players) {
        const currentPos = positions[player.normalized];
        if (currentPos !== player.recommendedPosition) {
          positions[player.normalized] = player.recommendedPosition;
          updated++;
        }
      }
      
      if (updated > 0) {
        savePositionsFile(teamFile, { positions, aliases });
        console.log(`✅ ${result.team}: Updated ${updated} position(s)`);
        updatesByTeam[result.team] = updated;
      } else {
        console.log(`✓  ${result.team}: No updates needed`);
      }
    }
    
    const totalUpdated = Object.values(updatesByTeam).reduce((a, b) => a + b, 0);
    console.log(`\n✅ Total: ${totalUpdated} position(s) updated across ${Object.keys(updatesByTeam).length} team(s)`);
  } else {
    console.log('\n' + '='.repeat(100));
    console.log('💡 To apply these updates, run with --apply flag:');
    console.log(`   node scripts/fetch-actual-positions.js ${all ? '--all' : `--team ${team}`} --apply`);
  }
}

main().catch(console.error);

