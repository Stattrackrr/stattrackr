#!/usr/bin/env node
/**
 * Test script to check which sources have predicted minutes, usage rate, and pace
 */

const https = require('https');
const http = require('http');

const sources = [
  {
    name: 'Rotowire',
    url: 'https://www.rotowire.com/basketball/nba-projections.php',
    description: 'Fantasy projections - might have minutes/usage'
  },
  {
    name: 'NumberFire',
    url: 'https://www.numberfire.com/nba/daily-fantasy/daily-projections',
    description: 'Daily fantasy projections - likely has minutes/usage'
  },
  {
    name: 'Hashtag Basketball',
    url: 'https://www.hashtagbasketball.com/nba-projections',
    description: 'NBA projections - might have minutes/usage'
  },
  {
    name: 'UsageBoost',
    url: 'https://usageboost.com',
    description: 'Usage rate analysis - specifically tracks usage/minutes'
  },
  {
    name: 'FantasyPros',
    url: 'https://www.fantasypros.com/nba/projections/',
    description: 'Fantasy projections - might have minutes/usage'
  }
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    }).on('error', reject).on('timeout', () => {
      reject(new Error('Request timeout'));
    });
  });
}

async function testSource(source) {
  console.log(`\n🔍 Testing ${source.name}...`);
  console.log(`   URL: ${source.url}`);
  console.log(`   Description: ${source.description}`);
  
  try {
    const result = await fetchUrl(source.url);
    
    if (result.status !== 200) {
      console.log(`   ❌ Status: ${result.status}`);
      return { source: source.name, success: false, error: `HTTP ${result.status}` };
    }
    
    const html = result.data;
    const text = html.toLowerCase();
    
    // Check for keywords
    const hasMinutes = text.includes('min') || text.includes('minutes') || text.includes('mp');
    const hasUsage = text.includes('usage') || text.includes('usg');
    const hasPace = text.includes('pace') || text.includes('possessions');
    const hasProjections = text.includes('projection') || text.includes('proj') || text.includes('forecast');
    
    console.log(`   ✅ Status: ${result.status}`);
    console.log(`   📊 Found keywords:`);
    console.log(`      - Minutes: ${hasMinutes ? '✅' : '❌'}`);
    console.log(`      - Usage: ${hasUsage ? '✅' : '❌'}`);
    console.log(`      - Pace: ${hasPace ? '✅' : '❌'}`);
    console.log(`      - Projections: ${hasProjections ? '✅' : '❌'}`);
    
    // Look for JSON data in script tags
    const jsonMatches = html.match(/<script[^>]*>[\s\S]*?({[\s\S]{100,}?})[\s\S]*?<\/script>/gi);
    if (jsonMatches) {
      console.log(`   📦 Found ${jsonMatches.length} potential JSON data blocks`);
    }
    
    // Look for table structures
    const tableMatches = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
    if (tableMatches) {
      console.log(`   📋 Found ${tableMatches.length} table(s)`);
    }
    
    return {
      source: source.name,
      success: true,
      hasMinutes,
      hasUsage,
      hasPace,
      hasProjections,
      htmlLength: html.length
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { source: source.name, success: false, error: error.message };
  }
}

async function main() {
  console.log('🧪 Testing Projection Sources for Predicted Minutes, Usage, and Pace\n');
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const source of sources) {
    const result = await testSource(source);
    results.push(result);
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}\n`);
  
  if (successful.length > 0) {
    console.log('📋 Sources with data:');
    successful.forEach(r => {
      console.log(`\n   ${r.source}:`);
      console.log(`      Minutes: ${r.hasMinutes ? '✅' : '❌'}`);
      console.log(`      Usage: ${r.hasUsage ? '✅' : '❌'}`);
      console.log(`      Pace: ${r.hasPace ? '✅' : '❌'}`);
      console.log(`      Projections: ${r.hasProjections ? '✅' : '❌'}`);
    });
  }
  
  if (failed.length > 0) {
    console.log('\n❌ Failed sources:');
    failed.forEach(r => {
      console.log(`   ${r.source}: ${r.error}`);
    });
  }
  
  // Recommend best source
  const bestSource = successful.find(r => r.hasMinutes && r.hasUsage && r.hasProjections);
  if (bestSource) {
    console.log(`\n⭐ Best source: ${bestSource.source} (has all data)`);
  } else {
    const partialSource = successful.find(r => (r.hasMinutes || r.hasUsage) && r.hasProjections);
    if (partialSource) {
      console.log(`\n⭐ Best partial source: ${partialSource.source}`);
    }
  }
}

main().catch(console.error);



