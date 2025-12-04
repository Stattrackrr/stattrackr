/**
 * Test script to scrape BettingPros DVP data
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://www.bettingpros.com/nba/defense-vs-position/';

console.log('🔍 Testing BettingPros DVP scraper...\n');

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  }
}, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`✅ Fetched ${data.length} bytes\n`);
    
    // Look for the bpDefenseVsPositionStats JavaScript variable
    // The data might be on a single line, so we need a more flexible regex
    const statsMatch = data.match(/const bpDefenseVsPositionStats = ({[\s\S]*?});/);
    if (!statsMatch) {
      // Try without the semicolon at the end (might be followed by other code)
      const statsMatch2 = data.match(/const bpDefenseVsPositionStats = ({[^}]+"teamStats":{[^}]+}[^}]+})/);
      if (statsMatch2) {
        // Try to find the closing brace more carefully
        let braceCount = 0;
        let startIdx = data.indexOf('const bpDefenseVsPositionStats = {');
        if (startIdx >= 0) {
          startIdx += 'const bpDefenseVsPositionStats = '.length;
          let endIdx = startIdx;
          for (let i = startIdx; i < data.length; i++) {
            if (data[i] === '{') braceCount++;
            if (data[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                endIdx = i + 1;
                break;
              }
            }
          }
          const jsonStr = data.substring(startIdx, endIdx);
          try {
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
                console.log(`   ALL position stats:`, JSON.stringify(sampleData.ALL, null, 2));
              }
              
              // Show data for a specific position if available
              const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
              for (const pos of positions) {
                if (sampleData[pos]) {
                  console.log(`   ${pos} position stats:`, JSON.stringify(sampleData[pos], null, 2));
                  break;
                }
              }
            }
            
            // Save the full data to a file for inspection
            const outputPath = path.join(__dirname, '..', 'data', 'bettingpros-dvp-data.json');
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, JSON.stringify(statsData, null, 2));
            console.log(`\n💾 Saved full data to: ${outputPath}`);
            return;
          } catch (e) {
            console.error('❌ Error parsing JSON:', e.message);
          }
        }
      }
    }
    if (statsMatch) {
      console.log('✅ Found bpDefenseVsPositionStats variable');
      console.log(`   Length: ${statsMatch[1].length} characters\n`);
      
      // Try to parse it
      try {
        // Use eval to parse the JavaScript object (safe in this context)
        const statsData = eval('(' + statsMatch[1] + ')');
        
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
            console.log(`   ALL position stats:`, JSON.stringify(sampleData.ALL, null, 2));
          }
          
          // Show data for a specific position if available
          const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
          for (const pos of positions) {
            if (sampleData[pos]) {
              console.log(`   ${pos} position stats:`, JSON.stringify(sampleData[pos], null, 2));
              break;
            }
          }
        }
        
        // Save the full data to a file for inspection
        const outputPath = path.join(__dirname, '..', 'data', 'bettingpros-dvp-data.json');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(statsData, null, 2));
        console.log(`\n💾 Saved full data to: ${outputPath}`);
        
      } catch (e) {
        console.error('❌ Error parsing JSON:', e.message);
        console.log('\n📝 First 1000 chars of data:');
        console.log(statsMatch[1].substring(0, 1000));
      }
    } else {
      console.log('❌ Could not find bpDefenseVsPositionStats variable');
      console.log('\n🔍 Looking for alternative data structures...');
      
      // Look for table data
      const tableMatches = data.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
      console.log(`   Found ${tableMatches?.length || 0} table(s)`);
      
      // Save HTML for manual inspection
      const htmlPath = path.join(__dirname, '..', 'data', 'bettingpros-sample.html');
      fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
      fs.writeFileSync(htmlPath, data);
      console.log(`\n💾 Saved HTML to: ${htmlPath}`);
    }
  });
}).on('error', (err) => {
  console.error('❌ Error fetching page:', err.message);
});
