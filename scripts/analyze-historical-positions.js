#!/usr/bin/env node

/**
 * Analyze Historical Positions Script
 * 
 * Analyzes stored game data to determine the actual positions players played
 * and generates position updates based on most common position.
 * 
 * Usage:
 *   node scripts/analyze-historical-positions.js --team MIL
 *   node scripts/analyze-historical-positions.js --all
 *   node scripts/analyze-historical-positions.js --team MIL --min-games 5 --apply
 */

const fs = require('fs');
const path = require('path');

const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const VALID_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

function normName(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
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

function analyzeTeam(teamAbbr, season = '2025', minGames = 1) {
  const storeDir = path.resolve(process.cwd(), 'data', 'dvp_store', season);
  const filePath = path.join(storeDir, `${teamAbbr}.json`);
  
  if (!fs.existsSync(filePath)) {
    return { team: teamAbbr, error: 'No game data found', players: [] };
  }
  
  try {
    const games = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(games)) {
      return { team: teamAbbr, error: 'Invalid data format', players: [] };
    }
    
    // Track position counts per player
    const playerPositions = new Map();
    
    for (const game of games) {
      if (!Array.isArray(game.players)) continue;
      
      for (const player of game.players) {
        const name = String(player.name || '').trim();
        if (!name) continue;
        
        const normalized = normName(name);
        const bucket = player.bucket;
        
        // Only count valid positions
        if (!bucket || !VALID_POSITIONS.includes(bucket)) continue;
        
        if (!playerPositions.has(normalized)) {
          playerPositions.set(normalized, {
            name: name,
            normalized: normalized,
            positions: {},
            totalGames: 0,
            starterGames: 0,
            totalPoints: 0
          });
        }
        
        const p = playerPositions.get(normalized);
        p.totalGames++;
        p.totalPoints += Number(player.pts || 0);
        if (player.isStarter) p.starterGames++;
        
        // Count occurrences of each position
        if (!p.positions[bucket]) {
          p.positions[bucket] = { count: 0, starterCount: 0 };
        }
        p.positions[bucket].count++;
        if (player.isStarter) {
          p.positions[bucket].starterCount++;
        }
      }
    }
    
    // Calculate most common position for each player
    const results = [];
    for (const [normalized, data] of playerPositions.entries()) {
      if (data.totalGames < minGames) continue;
      
      // Find most common position
      let mostCommonPos = null;
      let maxCount = 0;
      let maxStarterCount = 0;
      
      for (const [pos, stats] of Object.entries(data.positions)) {
        // Prioritize starter appearances, then total count
        if (stats.starterCount > maxStarterCount || 
            (stats.starterCount === maxStarterCount && stats.count > maxCount)) {
          mostCommonPos = pos;
          maxCount = stats.count;
          maxStarterCount = stats.starterCount;
        }
      }
      
      if (mostCommonPos) {
        results.push({
          name: data.name,
          normalized: normalized,
          recommendedPosition: mostCommonPos,
          totalGames: data.totalGames,
          starterGames: data.starterGames,
          totalPoints: data.totalPoints,
          positionBreakdown: data.positions,
          confidence: maxCount / data.totalGames // How often they played this position
        });
      }
    }
    
    // Sort by total games (most active first)
    results.sort((a, b) => b.totalGames - a.totalGames);
    
    return {
      team: teamAbbr,
      players: results,
      totalGames: games.length
    };
    
  } catch (e) {
    return { team: teamAbbr, error: e.message, players: [] };
  }
}

function main() {
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
    console.error('  node scripts/analyze-historical-positions.js --team MIL');
    console.error('  node scripts/analyze-historical-positions.js --all');
    console.error('  node scripts/analyze-historical-positions.js --team MIL --min-games 5 --apply');
    process.exit(1);
  }
  
  const teamsToAnalyze = all ? TEAMS : [team];
  const allResults = [];
  
  console.log('📊 Analyzing Historical Player Positions\n');
  console.log(`Minimum games required: ${minGames}`);
  console.log(`Season: ${season}\n`);
  console.log('='.repeat(100));
  
  for (const teamAbbr of teamsToAnalyze) {
    const result = analyzeTeam(teamAbbr, season, minGames);
    allResults.push(result);
    
    if (result.error) {
      console.log(`\n❌ ${teamAbbr}: ${result.error}`);
      continue;
    }
    
    console.log(`\n🏀 ${teamAbbr} (${result.totalGames} games, ${result.players.length} players)`);
    console.log('-'.repeat(100));
    
    // Load current positions for comparison
    const teamFile = path.resolve(process.cwd(), 'data', 'player_positions', 'teams', `${teamAbbr}.json`);
    const masterFile = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json`);
    const teamData = loadPositionsFile(teamFile);
    const masterData = loadPositionsFile(masterFile);
    const currentPositions = { ...masterData.positions, ...teamData.positions };
    
    for (const player of result.players) {
      const currentPos = currentPositions[player.normalized] || 'NOT SET';
      const needsUpdate = currentPos !== player.recommendedPosition;
      const status = needsUpdate ? '⚠️  UPDATE' : '✅ OK';
      
      // Build position breakdown string
      const breakdown = Object.entries(player.positionBreakdown)
        .map(([pos, stats]) => `${pos}:${stats.count}${stats.starterCount > 0 ? `(${stats.starterCount}S)` : ''}`)
        .join(', ');
      
      console.log(`${status} ${player.name.padEnd(30)} | Current: ${String(currentPos).padEnd(8)} | Recommended: ${player.recommendedPosition} | ${player.totalGames}G | ${(player.confidence * 100).toFixed(0)}% | ${breakdown}`);
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
    console.log(`   node scripts/analyze-historical-positions.js ${all ? '--all' : `--team ${team}`} --apply`);
  }
  
  // Generate JSON output for programmatic use
  if (all && !apply) {
    const outputFile = path.resolve(process.cwd(), 'data', 'player_positions', 'historical-analysis.json');
    const summary = {
      generated: new Date().toISOString(),
      season: season,
      minGames: minGames,
      teams: allResults.map(r => ({
        team: r.team,
        totalGames: r.totalGames,
        players: r.players.map(p => ({
          name: p.name,
          normalized: p.normalized,
          recommendedPosition: p.recommendedPosition,
          totalGames: p.totalGames,
          confidence: p.confidence,
          positionBreakdown: p.positionBreakdown
        }))
      }))
    };
    
    savePositionsFile(outputFile, summary);
    console.log(`\n📄 Full analysis saved to: ${path.relative(process.cwd(), outputFile)}`);
  }
}

main();


