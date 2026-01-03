#!/usr/bin/env node
/**
 * Inspect UsageBoost to see what data structure they have
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://usageboost.com';

console.log('🔍 Inspecting UsageBoost data structure...\n');

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
    
    // Look for JSON data in script tags
    const scriptMatches = data.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    if (scriptMatches) {
      console.log(`📦 Found ${scriptMatches.length} script tags\n`);
      
      // Look for JSON data
      for (let i = 0; i < scriptMatches.length; i++) {
        const scriptContent = scriptMatches[i];
        
        // Look for JSON objects
        const jsonMatches = scriptContent.match(/(\{[\s\S]{50,}?\})/g);
        if (jsonMatches) {
          console.log(`   Script ${i + 1}: Found ${jsonMatches.length} potential JSON objects`);
          
          jsonMatches.forEach((jsonStr, idx) => {
            try {
              const parsed = JSON.parse(jsonStr);
              console.log(`      JSON ${idx + 1}:`, Object.keys(parsed).slice(0, 10).join(', '));
            } catch (e) {
              // Not valid JSON, might be a variable assignment
              if (jsonStr.includes('player') || jsonStr.includes('projection') || jsonStr.includes('usage') || jsonStr.includes('minutes')) {
                console.log(`      Found relevant data structure (not valid JSON): ${jsonStr.substring(0, 200)}...`);
              }
            }
          });
        }
        
        // Look for variable assignments with data
        if (scriptContent.includes('const ') || scriptContent.includes('var ') || scriptContent.includes('let ')) {
          const varMatches = scriptContent.match(/(const|var|let)\s+(\w+)\s*=\s*(\{[\s\S]{100,}?\});/g);
          if (varMatches) {
            console.log(`   Script ${i + 1}: Found ${varMatches.length} variable assignments with data`);
            varMatches.forEach((match, idx) => {
              console.log(`      Var ${idx + 1}: ${match.substring(0, 150)}...`);
            });
          }
        }
      }
    }
    
    // Look for API endpoints
    const apiMatches = data.match(/https?:\/\/[^"'\s]+(api|data|projection|usage|minutes)[^"'\s]*/gi);
    if (apiMatches) {
      console.log(`\n🔗 Found ${apiMatches.length} potential API endpoints:`);
      [...new Set(apiMatches)].slice(0, 10).forEach(url => {
        console.log(`   ${url}`);
      });
    }
    
    // Look for table structures
    const tableMatches = data.match(/<table[^>]*>[\s\S]{200,}?<\/table>/gi);
    if (tableMatches) {
      console.log(`\n📋 Found ${tableMatches.length} table(s)`);
      
      // Check first table for structure
      if (tableMatches[0]) {
        const firstTable = tableMatches[0];
        const headerMatches = firstTable.match(/<th[^>]*>([^<]+)<\/th>/gi);
        if (headerMatches) {
          console.log(`   Table headers: ${headerMatches.map(h => h.replace(/<[^>]+>/g, '')).slice(0, 10).join(', ')}`);
        }
      }
    }
    
    // Save HTML for manual inspection
    const htmlPath = path.join(__dirname, '..', 'data', 'usageboost-sample.html');
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, data);
    console.log(`\n💾 Saved HTML to: ${htmlPath}`);
    console.log(`   You can open this file to inspect the structure manually`);
    
  });
}).on('error', (err) => {
  console.error('❌ Error:', err.message);
}).on('timeout', () => {
  console.error('❌ Request timeout');
});









