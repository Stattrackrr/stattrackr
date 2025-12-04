/**
 * Test script to scrape Hashtag Basketball DVP data
 */

const https = require('https');
const http = require('http');

const url = 'https://hashtagbasketball.com/nba-defense-vs-position';

console.log('🔍 Testing Hashtag Basketball DVP scraper...\n');

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
    
    // Look for table structures
    const tableMatches = data.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
    console.log(`Found ${tableMatches?.length || 0} table(s)`);
    
    // Look for script tags with data
    const scriptMatches = data.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    console.log(`Found ${scriptMatches?.length || 0} script tag(s)`);
    
    // Look for team names
    const teams = ['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets'];
    for (const team of teams) {
      if (data.includes(team)) {
        console.log(`✅ Found team: ${team}`);
      }
    }
    
    // Look for position abbreviations
    const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
    for (const pos of positions) {
      const count = (data.match(new RegExp(`\\b${pos}\\b`, 'gi')) || []).length;
      if (count > 0) {
        console.log(`Found "${pos}" ${count} time(s)`);
      }
    }
    
    // Try to find a data structure
    console.log('\n📊 Looking for data patterns...');
    
    // Check if there's JSON data
    const jsonMatches = data.match(/\{[^{}]{100,5000}\}/g);
    if (jsonMatches) {
      console.log(`Found ${jsonMatches.length} potential JSON objects`);
      for (let i = 0; i < Math.min(3, jsonMatches.length); i++) {
        try {
          const parsed = JSON.parse(jsonMatches[i]);
          console.log(`  JSON ${i + 1}: Valid JSON with ${Object.keys(parsed).length} keys`);
        } catch (e) {
          console.log(`  JSON ${i + 1}: Invalid JSON`);
        }
      }
    }
    
    // Save a sample to file for inspection
    const fs = require('fs');
    const path = require('path');
    const samplePath = path.join(__dirname, '..', 'data', 'hashtag-sample.html');
    fs.writeFileSync(samplePath, data.substring(0, 50000), 'utf8');
    console.log(`\n💾 Saved first 50KB to: ${samplePath}`);
    console.log('\n💡 Inspect the file to see the HTML structure');
  });
}).on('error', (err) => {
  console.error('❌ Error:', err.message);
});

