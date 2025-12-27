#!/usr/bin/env node
/**
 * Inspect SportsLine to see if we can access NBA projections
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const urls = [
  'https://www.sportsline.com',
  'https://www.sportsline.com/nba',
  'https://www.cbssports.com/fantasy/basketball',
];

async function fetchUrl(url, followRedirects = true, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const makeRequest = (currentUrl, redirectCount = 0) => {
      https.get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 15000
      }, (res) => {
        // Handle redirects
        if (followRedirects && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && redirectCount < maxRedirects) {
          const redirectUrl = res.headers.location.startsWith('http') 
            ? res.headers.location 
            : new URL(res.headers.location, currentUrl).toString();
          console.log(`   ↪️  Redirecting to: ${redirectUrl}`);
          return makeRequest(redirectUrl, redirectCount + 1);
        }
        
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, data, headers: res.headers, finalUrl: currentUrl });
        });
      }).on('error', reject);
    };
    
    makeRequest(url);
  });
}

async function inspectUrl(url) {
  console.log(`\n🔍 Inspecting: ${url}`);
  
  try {
    const result = await fetchUrl(url);
    console.log(`   Status: ${result.status}`);
    
    if (result.status === 200) {
      const html = result.data;
      const text = html.toLowerCase();
      
      console.log(`   📄 HTML (${html.length} bytes)`);
      console.log(`   Keywords:`);
      console.log(`      - Minutes: ${text.includes('min') || text.includes('minutes') || text.includes('mp') ? '✅' : '❌'}`);
      console.log(`      - Pace: ${text.includes('pace') || text.includes('possessions') ? '✅' : '❌'}`);
      console.log(`      - Projections: ${text.includes('projection') || text.includes('proj') ? '✅' : '❌'}`);
      console.log(`      - Premium/Subscribe: ${text.includes('premium') || text.includes('subscribe') || text.includes('paywall') ? '✅' : '❌'}`);
      console.log(`      - Free: ${text.includes('free') && !text.includes('premium') ? '✅' : '❌'}`);
      
      // Look for JSON data in script tags
      const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      if (scriptMatches) {
        console.log(`   📦 Found ${scriptMatches.length} script tags`);
        
        // Look for API endpoints
        const apiMatches = html.match(/["']([^"']*\/api\/[^"']*)["']/gi);
        if (apiMatches) {
          console.log(`   🔗 Found API endpoints:`);
          [...new Set(apiMatches)].slice(0, 5).forEach(match => {
            console.log(`      ${match.replace(/["']/g, '')}`);
          });
        }
        
        // Look for data attributes
        const dataMatches = html.match(/data-[a-z-]+="[^"]{20,}"/gi);
        if (dataMatches) {
          console.log(`   📊 Found ${dataMatches.length} data attributes`);
        }
      }
      
      // Look for table structures
      const tableMatches = html.match(/<table[^>]*>[\s\S]{200,}?<\/table>/gi);
      if (tableMatches) {
        console.log(`   📋 Found ${tableMatches.length} table(s)`);
      }
      
      // Save HTML for manual inspection
      const filename = url.split('/').pop() || 'index';
      const htmlPath = path.join(__dirname, '..', 'data', `sportsline-${filename}.html`);
      fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
      fs.writeFileSync(htmlPath, html);
      console.log(`   💾 Saved HTML to: ${htmlPath}`);
      
    } else {
      console.log(`   ❌ Status ${result.status}`);
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Inspecting SportsLine.com\n');
  console.log('='.repeat(60));
  
  for (const url of urls) {
    await inspectUrl(url);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 Summary:');
  console.log('   - Check the saved HTML files in data/ folder');
  console.log('   - Look for API endpoints or data structures');
  console.log('   - Check if projections require subscription');
}

main().catch(console.error);

