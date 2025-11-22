#!/usr/bin/env node

/**
 * Bulk Position Update Script
 * 
 * Usage:
 *   node scripts/bulk-update-positions.js --team MIL --file positions.json
 *   node scripts/bulk-update-positions.js --master --updates '{"giannis antetokounmpo":"PF","khris middleton":"SF"}'
 * 
 * File format (positions.json):
 *   {
 *     "giannis antetokounmpo": "PF",
 *     "khris middleton": "SF",
 *     "brook lopez": "C"
 *   }
 */

const fs = require('fs');
const path = require('path');

function normName(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function isValidPosition(pos) {
  return ['PG', 'SG', 'SF', 'PF', 'C'].includes(pos);
}

function loadPositionsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { positions: {}, aliases: {} };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
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

function main() {
  const args = process.argv.slice(2);
  let team = null;
  let filePath = null;
  let updatesJson = null;
  let master = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--team' && args[i + 1]) {
      team = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      filePath = args[i + 1];
      i++;
    } else if (args[i] === '--updates' && args[i + 1]) {
      updatesJson = args[i + 1];
      i++;
    } else if (args[i] === '--master') {
      master = true;
    }
  }

  // Determine target file
  let targetPath;
  if (master || !team) {
    targetPath = path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
  } else {
    targetPath = path.resolve(process.cwd(), 'data', 'player_positions', 'teams', `${team}.json`);
  }

  // Load updates
  let updates = {};
  if (filePath) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`);
      process.exit(1);
    }
    const fileContent = fs.readFileSync(fullPath, 'utf8');
    updates = JSON.parse(fileContent);
  } else if (updatesJson) {
    updates = JSON.parse(updatesJson);
  } else {
    console.error('Error: Must provide either --file or --updates');
    console.error('\nUsage:');
    console.error('  node scripts/bulk-update-positions.js --team MIL --file positions.json');
    console.error('  node scripts/bulk-update-positions.js --master --updates \'{"player":"PG"}\'');
    process.exit(1);
  }

  // Load existing positions
  const existing = loadPositionsFile(targetPath);
  const positions = existing.positions || {};
  const aliases = existing.aliases || {};

  // Apply updates
  const updated = [];
  const errors = [];

  for (const [playerName, position] of Object.entries(updates)) {
    if (!isValidPosition(position)) {
      errors.push(`Invalid position for ${playerName}: ${position}. Must be PG, SG, SF, PF, or C.`);
      continue;
    }

    const normalizedName = normName(playerName);
    const oldPosition = positions[normalizedName];
    positions[normalizedName] = position;
    
    if (oldPosition) {
      updated.push(`${playerName}: ${oldPosition} → ${position}`);
    } else {
      updated.push(`${playerName}: (new) → ${position}`);
    }
  }

  // Save updated file
  const updatedData = {
    positions,
    aliases
  };

  savePositionsFile(targetPath, updatedData);

  // Print results
  console.log(`\n✅ Updated ${updated.length} position(s) in ${master || !team ? 'master' : `team ${team}`} file`);
  console.log(`📁 File: ${path.relative(process.cwd(), targetPath)}\n`);
  
  if (updated.length > 0) {
    console.log('Updated positions:');
    updated.forEach(u => console.log(`  - ${u}`));
  }

  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  console.log(`\n💡 Tip: Custom positions now override stored game data automatically.`);
}

main();


