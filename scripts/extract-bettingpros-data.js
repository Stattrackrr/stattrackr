/**
 * Extract DVP data from BettingPros HTML file
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'data', 'bettingpros-sample.html');

console.log('🔍 Extracting BettingPros DVP data from HTML...\n');

const html = fs.readFileSync(htmlPath, 'utf8');

// Find the script tag containing bpDefenseVsPositionStats
const startMarker = 'const bpDefenseVsPositionStats = {';
const startIdx = html.indexOf(startMarker);

if (startIdx < 0) {
  console.error('❌ Could not find bpDefenseVsPositionStats variable');
  process.exit(1);
}

console.log(`✅ Found variable at position ${startIdx}\n`);

// Find the matching closing brace
let braceCount = 0;
let jsonStart = startIdx + startMarker.length - 1; // Start at the opening brace
let jsonEnd = jsonStart;

for (let i = jsonStart; i < html.length; i++) {
  if (html[i] === '{') braceCount++;
  if (html[i] === '}') {
    braceCount--;
    if (braceCount === 0) {
      jsonEnd = i + 1;
      break;
    }
  }
}

const jsonStr = html.substring(jsonStart, jsonEnd);
console.log(`📏 Extracted JSON string: ${jsonStr.length} characters\n`);

try {
  // Parse the JSON
  const statsData = eval('(' + jsonStr + ')');
  
  console.log('✅ Successfully parsed JSON data\n');
  console.log('📊 Data structure:');
  console.log(`   - avgGamesPlayed: ${statsData.avgGamesPlayed}`);
  console.log(`   - seasonParam: ${statsData.seasonParam}`);
  console.log(`   - sportSeason: ${statsData.sportSeason}`);
  console.log(`   - Teams: ${Object.keys(statsData.teamStats || {}).length}`);
  
  // Show sample team data
  const teamKeys = Object.keys(statsData.teamStats || {});
  if (teamKeys.length > 0) {
    const sampleTeam = teamKeys[0];
    const sampleData = statsData.teamStats[sampleTeam];
    console.log(`\n📋 Sample team (${sampleTeam}):`);
    console.log(`   Positions: ${Object.keys(sampleData).join(', ')}`);
    
    // Show data for "ALL" position
    if (sampleData.ALL) {
      console.log(`\n   ALL position stats:`);
      console.log(`      Points: ${sampleData.ALL.points}`);
      console.log(`      Rebounds: ${sampleData.ALL.rebounds}`);
      console.log(`      Assists: ${sampleData.ALL.assists}`);
      console.log(`      3PM: ${sampleData.ALL.three_points_made}`);
    }
    
    // Show data for PG position
    if (sampleData.PG) {
      console.log(`\n   PG position stats:`);
      console.log(`      Points: ${sampleData.PG.points}`);
      console.log(`      Rebounds: ${sampleData.PG.rebounds}`);
      console.log(`      Assists: ${sampleData.PG.assists}`);
      console.log(`      3PM: ${sampleData.PG.three_points_made}`);
    }
  }
  
  // Save the full data to a file
  const outputPath = path.join(__dirname, '..', 'data', 'bettingpros-dvp-data.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(statsData, null, 2));
  console.log(`\n💾 Saved full data to: ${outputPath}`);
  
  console.log('\n✅ Extraction complete!');
  
} catch (e) {
  console.error('❌ Error parsing JSON:', e.message);
  console.log('\n📝 First 500 chars of extracted string:');
  console.log(jsonStr.substring(0, 500));
  process.exit(1);
}
