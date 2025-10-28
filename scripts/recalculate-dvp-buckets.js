/**
 * Recalculate bucket totals in DVP store files
 * 
 * Usage:
 *   node scripts/recalculate-dvp-buckets.js [team] [season]
 * 
 * Examples:
 *   node scripts/recalculate-dvp-buckets.js LAL 2025
 *   node scripts/recalculate-dvp-buckets.js all 2025
 */

const fs = require('fs');
const path = require('path');

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const ALL_TEAMS = [
  'ATL', 'BKN', 'BOS', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

function recalculateTeamFile(teamAbbr, seasonYear) {
  const filePath = path.resolve(process.cwd(), 'data', 'dvp_store', String(seasonYear), `${teamAbbr}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return false;
  }

  console.log(`📊 Processing ${teamAbbr} (${seasonYear})...`);

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let gamesUpdated = 0;

    for (const game of data) {
      // Recalculate buckets from player data
      const newBuckets = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
      
      if (Array.isArray(game.players)) {
        for (const player of game.players) {
          const bucket = player.bucket;
          const pts = player.pts || 0;
          
          if (POSITIONS.includes(bucket)) {
            newBuckets[bucket] += pts;
          } else {
            console.warn(`  ⚠️  Invalid bucket "${bucket}" for player ${player.name} in game ${game.gameId}`);
          }
        }
      }

      // Check if buckets changed
      const oldBuckets = game.buckets || {};
      let changed = false;
      for (const pos of POSITIONS) {
        if (oldBuckets[pos] !== newBuckets[pos]) {
          changed = true;
          break;
        }
      }

      if (changed) {
        console.log(`  ✏️  Game ${game.gameId} (${game.date}): ${JSON.stringify(oldBuckets)} → ${JSON.stringify(newBuckets)}`);
        game.buckets = newBuckets;
        gamesUpdated++;
      }
    }

    if (gamesUpdated > 0) {
      // Write back to file with pretty formatting
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`✅ ${teamAbbr}: Updated ${gamesUpdated} game(s)\n`);
      return true;
    } else {
      console.log(`✓ ${teamAbbr}: All buckets already correct\n`);
      return true;
    }

  } catch (error) {
    console.error(`❌ Error processing ${teamAbbr}:`, error.message);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const teamArg = args[0] || 'all';
  const seasonYear = parseInt(args[1]) || 2025;

  console.log('🔧 DVP Bucket Recalculation Script\n');

  if (teamArg.toLowerCase() === 'all') {
    console.log(`Processing all teams for season ${seasonYear}...\n`);
    let successCount = 0;
    for (const team of ALL_TEAMS) {
      if (recalculateTeamFile(team, seasonYear)) {
        successCount++;
      }
    }
    console.log(`\n✨ Done! Successfully processed ${successCount}/${ALL_TEAMS.length} teams`);
  } else {
    const team = teamArg.toUpperCase();
    if (recalculateTeamFile(team, seasonYear)) {
      console.log('✨ Done!');
    } else {
      process.exit(1);
    }
  }
}

main();
