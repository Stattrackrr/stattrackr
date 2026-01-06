#!/usr/bin/env node
/**
 * Inspect SportsLine projections data structure
 */

const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '..', 'data', 'sportsline-next-data.json');

if (!fs.existsSync(jsonPath)) {
  console.error('❌ JSON file not found. Run extract-sportsline-data.js first.');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// Navigate to projections
const initialState = typeof data.props.initialState === 'string'
  ? JSON.parse(data.props.initialState)
  : data.props.initialState;

const projections = initialState?.fantasyState?.projectionsPageState?.data?.projections;

if (!projections || !Array.isArray(projections)) {
  console.log('❌ Could not find projections array');
  console.log('Available paths:', Object.keys(initialState?.fantasyState || {}));
  process.exit(1);
}

console.log(`✅ Found ${projections.length} projections\n`);

// Show first projection structure
if (projections.length > 0) {
  const first = projections[0];
  console.log('📊 First projection structure:');
  console.log(JSON.stringify(first, null, 2).substring(0, 3000));
  
  // Look for minutes
  console.log('\n🔍 Looking for minutes data...');
  const firstStr = JSON.stringify(first);
  if (firstStr.includes('min') || firstStr.includes('MIN')) {
    console.log('   ✅ Contains "min"');
    
    // Try to find the minutes value
    const findMinutes = (obj, path = '') => {
      if (typeof obj === 'object' && obj !== null) {
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = path ? `${path}.${key}` : key;
          if (key.toLowerCase().includes('min') && typeof value === 'number') {
            console.log(`   Found minutes at: ${currentPath} = ${value}`);
          }
          if (typeof value === 'object') {
            findMinutes(value, currentPath);
          }
        }
      }
    };
    findMinutes(first);
  }
  
  // Show sample of players
  console.log('\n📋 Sample players (first 5):');
  projections.slice(0, 5).forEach((p, i) => {
    const name = p.playerName || p.name || p.player || 'Unknown';
    const team = p.team || p.teamAbbr || 'Unknown';
    const minutes = p.minutes || p.min || p.projectedMinutes || 'N/A';
    console.log(`   ${i + 1}. ${name} (${team}) - ${minutes} min`);
  });
}












