/**
 * Test script for auto-ingest functionality
 * Run: node test-auto-ingest.js
 */

const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ENDPOINT = '/api/cron/auto-ingest';

console.log('🧪 Testing Auto-Ingest Endpoint');
console.log('================================');
console.log(`URL: ${BASE_URL}${ENDPOINT}\n`);

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'StatTrackr-Test/1.0',
        'Accept': 'application/json',
      },
    };

    const protocol = urlObj.protocol === 'https:' ? require('https') : http;
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function test() {
  try {
    console.log('📡 Making request...\n');
    const result = await makeRequest(`${BASE_URL}${ENDPOINT}`);
    
    console.log(`Status: ${result.status}`);
    console.log('\nResponse:');
    console.log(JSON.stringify(result.data, null, 2));
    
    if (result.status === 200) {
      if (result.data.success) {
        if (result.data.ingested) {
          console.log('\n✅ SUCCESS: Auto-ingest completed!');
          console.log(`   - Completed games: ${result.data.completedGames}`);
          console.log(`   - Total games: ${result.data.totalGames}`);
          console.log(`   - New games ingested: ${result.data.newGamesCount || 'N/A'}`);
        } else {
          console.log('\n⚠️  No games to ingest (no completed games found)');
          console.log(`   - Completed games: ${result.data.completedGames || 0}`);
          console.log(`   - Total games: ${result.data.totalGames || 0}`);
        }
      } else {
        console.log('\n❌ FAILED: Auto-ingest returned an error');
        console.log(`   Error: ${result.data.error || 'Unknown error'}`);
      }
    } else {
      console.log(`\n❌ FAILED: HTTP ${result.status}`);
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.log('\n💡 Make sure your dev server is running:');
    console.log('   npm run dev');
    console.log('\n💡 Or test against production:');
    console.log('   TEST_URL=https://your-domain.vercel.app node test-auto-ingest.js');
  }
}

test();

