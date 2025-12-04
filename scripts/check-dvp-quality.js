#!/usr/bin/env node

/**
 * Check all DvP store files for data quality issues:
 * - Duplicate players in same game
 * - Generic "G" or "F" buckets (should be PG/SG/SF/PF/C)
 * - Missing required fields
 */

const fs = require('fs');
const path = require('path');

const TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
];

const SEASON = 2025;
const dvpDir = path.resolve(process.cwd(), 'data', 'dvp_store', String(SEASON));

const issues = {
  duplicates: [],
  genericBuckets: [],
  missingFields: [],
  invalidBuckets: []
};

function checkGame(team, game) {
  const gameId = game.gameId;
  const date = game.date;
  const players = game.players || [];
  
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
        playerName,
        field: 'bucket',
        index: idx
      });
    } else if (bucket === 'G' || bucket === 'F') {
      issues.genericBuckets.push({
        team,
        gameId,
        date,
        playerId: p.playerId,
        playerName,
        bucket,
        isStarter: p.isStarter || false,
        index: idx
      });
    } else if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(bucket)) {
      issues.invalidBuckets.push({
        team,
        gameId,
        date,
        playerId: p.playerId,
        playerName,
        bucket,
        index: idx
      });
    }
    
    // Check for missing required fields
    if (!p.playerId || p.playerId === 0) {
      issues.missingFields.push({
        team,
        gameId,
        date,
        playerName,
        field: 'playerId',
        index: idx
      });
    }
    if (!p.name) {
      issues.missingFields.push({
        team,
        gameId,
        date,
        playerName: `Player at index ${idx}`,
        field: 'name',
        index: idx
      });
    }
  });
}

console.log('='.repeat(60));
console.log('DvP Store Quality Check');
console.log('='.repeat(60));
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
console.log('='.repeat(60));
console.log('Summary');
console.log('='.repeat(60));
console.log(`Total Games: ${totalGames}`);
console.log(`Total Players: ${totalPlayers}`);
console.log('');

// Report issues
if (issues.duplicates.length > 0) {
  console.log(`❌ DUPLICATE PLAYERS: ${issues.duplicates.length} found`);
  issues.duplicates.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) | ${issue.playerName} (ID: ${issue.playerId}) at indices ${issue.indices.join(', ')}`);
  });
  if (issues.duplicates.length > 10) {
    console.log(`   ... and ${issues.duplicates.length - 10} more`);
  }
  console.log('');
}

if (issues.genericBuckets.length > 0) {
  console.log(`⚠️  GENERIC BUCKETS (G/F): ${issues.genericBuckets.length} found`);
  const starterCount = issues.genericBuckets.filter(i => i.isStarter).length;
  const benchCount = issues.genericBuckets.length - starterCount;
  console.log(`   Starters: ${starterCount}, Bench: ${benchCount}`);
  issues.genericBuckets.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) | ${issue.playerName} (${issue.isStarter ? 'Starter' : 'Bench'}) = ${issue.bucket}`);
  });
  if (issues.genericBuckets.length > 10) {
    console.log(`   ... and ${issues.genericBuckets.length - 10} more`);
  }
  console.log('');
}

if (issues.invalidBuckets.length > 0) {
  console.log(`❌ INVALID BUCKETS: ${issues.invalidBuckets.length} found`);
  issues.invalidBuckets.slice(0, 10).forEach(issue => {
    console.log(`   ${issue.team} | Game ${issue.gameId} (${issue.date}) | ${issue.playerName} = "${issue.bucket}"`);
  });
  if (issues.invalidBuckets.length > 10) {
    console.log(`   ... and ${issues.invalidBuckets.length - 10} more`);
  }
  console.log('');
}

if (issues.missingFields.length > 0) {
  console.log(`❌ MISSING FIELDS: ${issues.missingFields.length} found`);
  const byField = {};
  issues.missingFields.forEach(issue => {
    if (!byField[issue.field]) byField[issue.field] = [];
    byField[issue.field].push(issue);
  });
  Object.entries(byField).forEach(([field, items]) => {
    console.log(`   ${field}: ${items.length} occurrences`);
    items.slice(0, 5).forEach(issue => {
      console.log(`     ${issue.team} | Game ${issue.gameId} (${issue.date}) | ${issue.playerName}`);
    });
    if (items.length > 5) {
      console.log(`     ... and ${items.length - 5} more`);
    }
  });
  console.log('');
}

// Final status
const totalIssues = issues.duplicates.length + issues.genericBuckets.length + issues.invalidBuckets.length + issues.missingFields.length;

if (totalIssues === 0) {
  console.log('✅ All games passed quality checks!');
  process.exit(0);
} else {
  console.log(`⚠️  Found ${totalIssues} total issues across ${totalGames} games`);
  process.exit(1);
}


