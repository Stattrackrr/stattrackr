#!/usr/bin/env node

/**
 * Comprehensive DvP store quality check:
 * - Duplicate players in same game
 * - Generic "G" or "F" buckets (should be PG/SG/SF/PF/C)
 * - Missing required fields
 * - Invalid buckets
 * - Games with SG=0 or SF=0 (potential issues)
 * - Games with very low SG/SF totals
 */

const fs = require('fs');
const path = require('path');

const TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

const SEASON = 2025;
const dvpDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(SEASON));

const issues = {
  duplicates: [],
  genericBuckets: [],
  missingFields: [],
  invalidBuckets: [],
  zeroSG: [],
  zeroSF: [],
  lowSG: [], // SG < 5 points
  lowSF: []  // SF < 5 points
};

function checkGame(team, game) {
  const gameId = game.gameId;
  const date = game.date;
  const opponent = game.opponent;
  const players = game.players || [];
  const buckets = game.buckets || {};
  
  // Check for duplicate players in same game
  const playerIds = new Map();
  players.forEach((p, idx) => {
    const pid = p.playerId;
    if (pid && pid > 0) {
      if (playerIds.has(pid)) {
        issues.duplicates.push({
          team,
          gameId,
          date,
          opponent,
          playerId: pid,
          playerName: p.name,
          indices: [playerIds.get(pid), idx]
        });
      } else {
        playerIds.set(pid, idx);
      }
    }
  });
  
  // Check for generic buckets or invalid buckets
  players.forEach((p, idx) => {
    const bucket = p.bucket;
    const playerName = p.name;
    
    if (!bucket) {
      issues.missingFields.push({
        team,
        gameId,
        date,
        opponent,
        playerName,
        field: 'bucket',
        index: idx
      });
    } else if (bucket === 'G' || bucket === 'F') {
      issues.genericBuckets.push({
        team,
        gameId,
        date,
        opponent,
        playerId: p.playerId,
        playerName,
        bucket,
        isStarter: p.isStarter || false,
        index: idx
      });
    } else if (!POSITIONS.includes(bucket)) {
      issues.invalidBuckets.push({
        team,
        gameId,
        date,
        opponent,
        playerId: p.playerId,
        playerName,
        bucket,
        index: idx
      });
    }
  });
  
  // Check for zero or very low SG/SF totals
  const sgTotal = buckets.SG || 0;
  const sfTotal = buckets.SF || 0;
  const totalPoints = (buckets.PG || 0) + sgTotal + (buckets.SF || 0) + (buckets.PF || 0) + (buckets.C || 0);
  
  if (sgTotal === 0 && totalPoints > 0) {
    issues.zeroSG.push({
      team,
      gameId,
      date,
      opponent,
      buckets,
      players: players.length
    });
  } else if (sgTotal > 0 && sgTotal < 5 && totalPoints > 20) {
    // Very low SG but game has significant scoring (might be an issue)
    issues.lowSG.push({
      team,
      gameId,
      date,
      opponent,
      sgTotal,
      buckets,
      players: players.length
    });
  }
  
  if (sfTotal === 0 && totalPoints > 0) {
    issues.zeroSF.push({
      team,
      gameId,
      date,
      opponent,
      buckets,
      players: players.length
    });
  } else if (sfTotal > 0 && sfTotal < 5 && totalPoints > 20) {
    // Very low SF but game has significant scoring (might be an issue)
    issues.lowSF.push({
      team,
      gameId,
      date,
      opponent,
      sfTotal,
      buckets,
      players: players.length
    });
  }
}

console.log('='.repeat(80));
console.log('Comprehensive DvP Store Quality Check');
console.log('='.repeat(80));
console.log(`Season: ${SEASON}`);
console.log(`Teams: ${TEAMS.length}`);
console.log('');

let totalGames = 0;
let totalPlayers = 0;

for (const team of TEAMS) {
  const filePath = path.join(dvpDir, `${team}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${team}: File not found`);
    continue;
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const games = Array.isArray(data) ? data : [];
    
    totalGames += games.length;
    
    games.forEach(game => {
      const players = game.players || [];
      totalPlayers += players.length;
      checkGame(team, game);
    });
    
    console.log(`✅ ${team}: ${games.length} games, ${games.reduce((sum, g) => sum + (g.players || []).length, 0)} players`);
  } catch (e) {
    console.error(`❌ ${team}: Error reading file - ${e.message}`);
  }
}

console.log('');
console.log('='.repeat(80));
console.log('Summary');
console.log('='.repeat(80));
console.log(`Total Games: ${totalGames}`);
console.log(`Total Players: ${totalPlayers}`);
console.log('');

// Report issues
let hasIssues = false;

if (issues.duplicates.length > 0) {
  hasIssues = true;
  console.log(`❌ DUPLICATE PLAYERS: ${issues.duplicates.length} found`);
  issues.duplicates.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | ${issue.playerName} (ID: ${issue.playerId}) at indices ${issue.indices.join(', ')}`);
  });
  if (issues.duplicates.length > 10) {
    console.log(`   ... and ${issues.duplicates.length - 10} more`);
  }
  console.log('');
}

if (issues.genericBuckets.length > 0) {
  hasIssues = true;
  console.log(`⚠️  GENERIC BUCKETS (G/F): ${issues.genericBuckets.length} found`);
  const starterCount = issues.genericBuckets.filter(i => i.isStarter).length;
  const benchCount = issues.genericBuckets.length - starterCount;
  console.log(`   Starters: ${starterCount}, Bench: ${benchCount}`);
  issues.genericBuckets.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | ${issue.playerName} (${issue.isStarter ? 'Starter' : 'Bench'}) = ${issue.bucket}`);
  });
  if (issues.genericBuckets.length > 10) {
    console.log(`   ... and ${issues.genericBuckets.length - 10} more`);
  }
  console.log('');
}

if (issues.invalidBuckets.length > 0) {
  hasIssues = true;
  console.log(`❌ INVALID BUCKETS: ${issues.invalidBuckets.length} found`);
  issues.invalidBuckets.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | ${issue.playerName} = "${issue.bucket}"`);
  });
  if (issues.invalidBuckets.length > 10) {
    console.log(`   ... and ${issues.invalidBuckets.length - 10} more`);
  }
  console.log('');
}

if (issues.missingFields.length > 0) {
  hasIssues = true;
  console.log(`❌ MISSING FIELDS: ${issues.missingFields.length} found`);
  const byField = {};
  issues.missingFields.forEach(issue => {
    if (!byField[issue.field]) byField[issue.field] = [];
    byField[issue.field].push(issue);
  });
  Object.entries(byField).forEach(([field, items]) => {
    console.log(`   ${field}: ${items.length} occurrences`);
    items.slice(0, 5).forEach(issue => {
      console.log(`     ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | ${issue.playerName}`);
    });
    if (items.length > 5) {
      console.log(`     ... and ${items.length - 5} more`);
    }
  });
  console.log('');
}

if (issues.zeroSG.length > 0) {
  hasIssues = true;
  console.log(`⚠️  GAMES WITH SG=0: ${issues.zeroSG.length} found`);
  issues.zeroSG.slice(0, 15).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | Buckets: PG=${issue.buckets.PG || 0}, SG=0, SF=${issue.buckets.SF || 0}, PF=${issue.buckets.PF || 0}, C=${issue.buckets.C || 0} (${issue.players} players)`);
  });
  if (issues.zeroSG.length > 15) {
    console.log(`   ... and ${issues.zeroSG.length - 15} more`);
  }
  console.log('');
}

if (issues.zeroSF.length > 0) {
  hasIssues = true;
  console.log(`⚠️  GAMES WITH SF=0: ${issues.zeroSF.length} found`);
  issues.zeroSF.slice(0, 15).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | Buckets: PG=${issue.buckets.PG || 0}, SG=${issue.buckets.SG || 0}, SF=0, PF=${issue.buckets.PF || 0}, C=${issue.buckets.C || 0} (${issue.players} players)`);
  });
  if (issues.zeroSF.length > 15) {
    console.log(`   ... and ${issues.zeroSF.length - 15} more`);
  }
  console.log('');
}

if (issues.lowSG.length > 0) {
  hasIssues = true;
  console.log(`⚠️  GAMES WITH VERY LOW SG (<5 pts): ${issues.lowSG.length} found`);
  issues.lowSG.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | SG=${issue.sgTotal} pts`);
  });
  if (issues.lowSG.length > 10) {
    console.log(`   ... and ${issues.lowSG.length - 10} more`);
  }
  console.log('');
}

if (issues.lowSF.length > 0) {
  hasIssues = true;
  console.log(`⚠️  GAMES WITH VERY LOW SF (<5 pts): ${issues.lowSF.length} found`);
  issues.lowSF.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) vs ${issue.opponent} | SF=${issue.sfTotal} pts`);
  });
  if (issues.lowSF.length > 10) {
    console.log(`   ... and ${issues.lowSF.length - 10} more`);
  }
  console.log('');
}

// Final status
const totalIssues = issues.duplicates.length + issues.genericBuckets.length + issues.invalidBuckets.length + issues.missingFields.length + issues.zeroSG.length + issues.zeroSF.length + issues.lowSG.length + issues.lowSF.length;

if (totalIssues === 0) {
  console.log('✅ All games passed quality checks!');
  process.exit(0);
} else {
  console.log(`⚠️  Found ${totalIssues} total issues across ${totalGames} games`);
  console.log(`   Breakdown:`);
  console.log(`   - Duplicates: ${issues.duplicates.length}`);
  console.log(`   - Generic buckets (G/F): ${issues.genericBuckets.length}`);
  console.log(`   - Invalid buckets: ${issues.invalidBuckets.length}`);
  console.log(`   - Missing fields: ${issues.missingFields.length}`);
  console.log(`   - Games with SG=0: ${issues.zeroSG.length}`);
  console.log(`   - Games with SF=0: ${issues.zeroSF.length}`);
  console.log(`   - Games with low SG (<5): ${issues.lowSG.length}`);
  console.log(`   - Games with low SF (<5): ${issues.lowSF.length}`);
  process.exit(1);
}


