#!/usr/bin/env node
/**
 * Test corrected URLs for projection sources
 */

const https = require('https');
const http = require('http');

const sources = [
  {
    name: 'Rotowire Daily Projections',
    url: 'https://www.rotowire.com/basketball/daily-projections.php',
    description: 'Daily fantasy projections'
  },
  {
    name: 'NumberFire Daily',
    url: 'https://www.numberfire.com/nba/daily-fantasy/daily-projections/all',
    description: 'Daily fantasy projections'
  },
  {
    name: 'Hashtag Basketball Daily',
    url: 'https://www.hashtagbasketball.com/nba-daily-projections',
    description: 'Daily NBA projections'
  },
  {
    name: 'FantasyPros Daily',
    url: 'https://www.fantasypros.com/nba/daily-projections.php',
    description: 'Daily fantasy projections'
  },
  {
    name: 'RotoGrinders',
    url: 'https://www.rotogrinders.com/projected-stats/nba',
    description: 'Projected stats'
  }
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000,
      maxRedirects: 5
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') 
          ? res.headers.location 
          : new URL(res.headers.location, url).toString();
        console.log(`   ↪️  Redirecting to: ${redirectUrl}`);
        return fetchUrl(redirectUrl).then(resolve).catch(reject);
      }
      
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers, finalUrl: url });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function testSource(source) {
  console.log(`\n🔍 Testing ${source.name}...`);
  console.log(`   URL: ${source.url}`);
  
  try {
    const result = await fetchUrl(source.url);
    
    if (result.status !== 200) {
      console.log(`   ❌ Status: ${result.status}`);
      return { source: source.name, success: false, error: `HTTP ${result.status}` };
    }
    
    const html = result.data;
    const text = html.toLowerCase();
    
    const hasMinutes = text.includes('min') || text.includes('minutes') || text.includes('mp');
    const hasUsage = text.includes('usage') || text.includes('usg');
    const hasPace = text.includes('pace') || text.includes('possessions');
    const hasProjections = text.includes('projection') || text.includes('proj') || text.includes('forecast');
    
    console.log(`   ✅ Status: ${result.status}`);
    console.log(`   📊 Keywords: Minutes=${hasMinutes ? '✅' : '❌'}, Usage=${hasUsage ? '✅' : '❌'}, Pace=${hasPace ? '✅' : '❌'}, Projections=${hasProjections ? '✅' : '❌'}`);
    
    return {
      source: source.name,
      success: true,
      hasMinutes,
      hasUsage,
      hasPace,
      hasProjections,
      url: result.finalUrl
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { source: source.name, success: false, error: error.message };
  }
}

async function main() {
  console.log('🧪 Testing Corrected URLs for Projection Sources\n');
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const source of sources) {
    const result = await testSource(source);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:\n');
  
  const successful = results.filter(r => r.success);
  successful.forEach(r => {
    console.log(`✅ ${r.source}:`);
    console.log(`   Minutes: ${r.hasMinutes ? '✅' : '❌'}`);
    console.log(`   Usage: ${r.hasUsage ? '✅' : '❌'}`);
    console.log(`   Pace: ${r.hasPace ? '✅' : '❌'}`);
    console.log(`   URL: ${r.url}`);
  });
}

main().catch(console.error);















