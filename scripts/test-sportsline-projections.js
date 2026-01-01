#!/usr/bin/env node
/**
 * Test scraping SportsLine NBA projections
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://www.sportsline.com/nba/expert-projections/simulation/';

console.log('🔍 Testing SportsLine NBA Projections Scraper\n');
console.log(`URL: ${url}\n`);

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  },
  timeout: 15000
}, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`✅ Fetched ${data.length} bytes\n`);
    
    const text = data.toLowerCase();
    
    // Check for key indicators
    console.log('📊 Content Analysis:');
    console.log(`   - Has "projections": ${text.includes('projection') ? '✅' : '❌'}`);
    console.log(`   - Has "minutes" or "min": ${text.includes('min') ? '✅' : '❌'}`);
    console.log(`   - Has "player": ${text.includes('player') ? '✅' : '❌'}`);
    console.log(`   - Has table structure: ${data.includes('<table') || data.includes('<tbody') ? '✅' : '❌'}`);
    console.log(`   - Has "nikola jokic" (test player): ${text.includes('nikola jokic') ? '✅' : '❌'}`);
    console.log(`   - Has "paywall" or "subscribe": ${text.includes('paywall') || text.includes('subscribe') ? '⚠️' : '✅'}`);
    
    // Look for JSON data
    const jsonMatches = data.match(/<script[^>]*>[\s\S]*?({[\s\S]{100,}?})[\s\S]*?<\/script>/gi);
    if (jsonMatches) {
      console.log(`\n📦 Found ${jsonMatches.length} potential JSON blocks in scripts`);
      
      // Look for player data
      jsonMatches.forEach((match, idx) => {
        if (match.toLowerCase().includes('player') || match.toLowerCase().includes('projection')) {
          console.log(`   Script ${idx + 1}: Contains player/projection data`);
        }
      });
    }
    
    // Look for table with player data
    const tableMatches = data.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
    if (tableMatches) {
      console.log(`\n📋 Found ${tableMatches.length} table(s)`);
      
      // Check first table for player names
      const firstTable = tableMatches[0];
      const playerNameMatches = firstTable.match(/>([A-Z][a-z]+ [A-Z][a-z]+)</g);
      if (playerNameMatches) {
        console.log(`   Found ${playerNameMatches.length} potential player names`);
        console.log(`   Sample: ${playerNameMatches.slice(0, 5).map(m => m.replace(/[<>]/g, '')).join(', ')}`);
      }
    }
    
    // Look for data attributes
    const dataMatches = data.match(/data-[a-z-]+="[^"]{20,}"/gi);
    if (dataMatches) {
      console.log(`\n📊 Found ${dataMatches.length} data attributes`);
    }
    
    // Save HTML for inspection
    const htmlPath = path.join(__dirname, '..', 'data', 'sportsline-projections.html');
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, data);
    console.log(`\n💾 Saved HTML to: ${htmlPath}`);
    console.log(`   You can open this file to inspect the structure manually`);
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('💡 Assessment:');
    if (text.includes('nikola jokic') && (text.includes('min') || text.includes('minutes'))) {
      console.log('   ✅ Looks promising - player data and minutes found');
      console.log('   ✅ Data appears to be visible (not behind paywall)');
      console.log('   ⚠️  May need to parse table structure or find API endpoint');
    } else {
      console.log('   ⚠️  Could not find expected player data');
      console.log('   💡 Check the saved HTML file for structure');
    }
  });
}).on('error', (err) => {
  console.error('❌ Error:', err.message);
}).on('timeout', () => {
  console.error('❌ Request timeout');
});








