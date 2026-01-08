#!/usr/bin/env node
/**
 * Inspect UsageBoost's actual data page to see the structure
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const urls = [
  'https://usageboost.com/nba-injury-usage',
  'https://usageboost.com/api/projections', // Common API pattern
  'https://usageboost.com/api/data', // Common API pattern
];

async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    }).on('error', reject);
  });
}

async function inspectUrl(url) {
  console.log(`\n🔍 Inspecting: ${url}`);
  
  try {
    const result = await fetchUrl(url);
    console.log(`   Status: ${result.status}`);
    
    if (result.status === 200) {
      const contentType = result.headers['content-type'] || '';
      
      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(result.data);
          console.log(`   ✅ Valid JSON`);
          console.log(`   📊 Keys: ${Object.keys(json).slice(0, 10).join(', ')}`);
          
          // Check for player/projection data
          if (Array.isArray(json)) {
            console.log(`   📋 Array with ${json.length} items`);
            if (json.length > 0) {
              console.log(`   📋 Sample item keys: ${Object.keys(json[0]).slice(0, 10).join(', ')}`);
            }
          } else if (json.data && Array.isArray(json.data)) {
            console.log(`   📋 Data array with ${json.data.length} items`);
            if (json.data.length > 0) {
              console.log(`   📋 Sample item keys: ${Object.keys(json.data[0]).slice(0, 10).join(', ')}`);
            }
          }
          
          // Save JSON
          const jsonPath = path.join(__dirname, '..', 'data', `usageboost-${url.split('/').pop() || 'data'}.json`);
          fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
          fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
          console.log(`   💾 Saved JSON to: ${jsonPath}`);
          
        } catch (e) {
          console.log(`   ⚠️  Not valid JSON: ${e.message}`);
        }
      } else {
        // HTML response
        const html = result.data;
        const text = html.toLowerCase();
        
        console.log(`   📄 HTML (${html.length} bytes)`);
        console.log(`   Keywords: minutes=${text.includes('min') ? '✅' : '❌'}, usage=${text.includes('usage') ? '✅' : '❌'}, pace=${text.includes('pace') ? '✅' : '❌'}`);
        
        // Look for JSON in script tags
        const jsonMatches = html.match(/<script[^>]*>[\s\S]*?({[\s\S]{100,}?})[\s\S]*?<\/script>/gi);
        if (jsonMatches) {
          console.log(`   📦 Found ${jsonMatches.length} potential JSON blocks in scripts`);
        }
        
        // Look for API endpoints
        const apiMatches = html.match(/["']([^"']*\/api\/[^"']*)["']/gi);
        if (apiMatches) {
          console.log(`   🔗 Found API endpoints:`);
          [...new Set(apiMatches)].slice(0, 5).forEach(match => {
            console.log(`      ${match.replace(/["']/g, '')}`);
          });
        }
        
        // Save HTML
        const htmlPath = path.join(__dirname, '..', 'data', `usageboost-${url.split('/').pop() || 'page'}.html`);
        fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
        fs.writeFileSync(htmlPath, html);
        console.log(`   💾 Saved HTML to: ${htmlPath}`);
      }
    } else {
      console.log(`   ❌ Status ${result.status}`);
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Inspecting UsageBoost Data Pages\n');
  console.log('='.repeat(60));
  
  for (const url of urls) {
    await inspectUrl(url);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 Next steps:');
  console.log('   1. Check the saved HTML/JSON files in data/ folder');
  console.log('   2. Look for API endpoints in the HTML');
  console.log('   3. Check browser network tab when visiting usageboost.com/nba-injury-usage');
  console.log('   4. See if they have a public API or if we need to scrape the rendered page');
}

main().catch(console.error);















