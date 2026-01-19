#!/usr/bin/env node
/**
 * Extract and analyze SportsLine __NEXT_DATA__
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'data', 'sportsline-projections.html');

if (!fs.existsSync(htmlPath)) {
  console.error('❌ HTML file not found:', htmlPath);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// Extract __NEXT_DATA__
const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (!nextDataMatch) {
  console.error('❌ Could not find __NEXT_DATA__');
  process.exit(1);
}

try {
  const nextData = JSON.parse(nextDataMatch[1]);
  
  console.log('✅ Successfully parsed __NEXT_DATA__\n');
  console.log('📊 Structure:');
  console.log(JSON.stringify(Object.keys(nextData), null, 2));
  
  // Look for player/projection data
  const dataStr = JSON.stringify(nextData);
  
  console.log('\n🔍 Searching for player data...');
  console.log(`   - Contains "player": ${dataStr.toLowerCase().includes('player') ? '✅' : '❌'}`);
  console.log(`   - Contains "projection": ${dataStr.toLowerCase().includes('projection') ? '✅' : '❌'}`);
  console.log(`   - Contains "minutes" or "min": ${dataStr.toLowerCase().includes('min') ? '✅' : '❌'}`);
  console.log(`   - Contains "nikola jokic": ${dataStr.toLowerCase().includes('nikola jokic') ? '✅' : '❌'}`);
  
  // Check initialState
  if (nextData.props?.pageProps) {
    console.log('\n📦 pageProps structure:');
    console.log(JSON.stringify(Object.keys(nextData.props.pageProps), null, 2));
  }
  
  if (nextData.props?.initialState) {
    try {
      const initialState = typeof nextData.props.initialState === 'string' 
        ? JSON.parse(nextData.props.initialState)
        : nextData.props.initialState;
      
      console.log('\n📦 initialState structure:');
      console.log(JSON.stringify(Object.keys(initialState), null, 2));
      
      // Look for projection/player data in initialState
      const initialStateStr = JSON.stringify(initialState);
      if (initialStateStr.toLowerCase().includes('player') || initialStateStr.toLowerCase().includes('projection')) {
        console.log('\n✅ Found player/projection data in initialState!');
        // Try to find the actual data structure
        const searchFor = (obj, path = '') => {
          if (typeof obj !== 'object' || obj === null) return;
          for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            if (typeof value === 'string' && (value.toLowerCase().includes('nikola jokic') || value.toLowerCase().includes('minutes'))) {
              console.log(`   Found at: ${currentPath}`);
            }
            if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
              if (value[0].hasOwnProperty('player') || value[0].hasOwnProperty('name') || value[0].hasOwnProperty('minutes')) {
                console.log(`\n✅ Found array at: ${currentPath}`);
                console.log(`   Sample item:`, JSON.stringify(value[0], null, 2).substring(0, 500));
              }
            }
            searchFor(value, currentPath);
          }
        };
        searchFor(initialState);
      }
    } catch (e) {
      console.log('\n⚠️  Could not parse initialState:', e.message);
    }
  }
  
  // Save full JSON for inspection
  const jsonPath = path.join(__dirname, '..', 'data', 'sportsline-next-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(nextData, null, 2));
  console.log(`\n💾 Saved full JSON to: ${jsonPath}`);
  
} catch (e) {
  console.error('❌ Error parsing JSON:', e.message);
  process.exit(1);
}

















