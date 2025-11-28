/**
 * Test script for the player odds cron job
 * 
 * Usage:
 *   node scripts/test-player-odds-cron.js [full|update]
 * 
 * Defaults to 'update' scan if no argument provided
 */

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const scanType = process.argv[2] || 'update';
const isFullScan = scanType === 'full';

// Get the base URL - use localhost for local dev, or provide PROD_URL env var
const baseUrl = process.env.PROD_URL || 'http://localhost:3000';
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error('❌ CRON_SECRET environment variable is required');
  console.error('   Set it in .env.local or export it before running this script');
  process.exit(1);
}

const url = `${baseUrl}/api/cron/refresh-player-odds?type=${scanType}`;

console.log(`🧪 Testing player odds cron job...`);
console.log(`   URL: ${url}`);
console.log(`   Scan Type: ${isFullScan ? 'FULL' : 'UPDATE'}`);
console.log(`   Base URL: ${baseUrl}`);
console.log('');

async function testCron() {
  try {
    const startTime = Date.now();
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Error: ${response.status} ${response.statusText}`);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log(`✅ Success! (${elapsed}s)`);
    console.log('');
    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.playersProcessed) {
      console.log('');
      console.log(`📊 Summary:`);
      console.log(`   Players processed: ${data.playersProcessed}`);
      console.log(`   Updated: ${data.updated || 0}`);
      console.log(`   Unchanged: ${data.unchanged || 0}`);
      if (data.errors && data.errors.length > 0) {
        console.log(`   Errors: ${data.errors.length}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   Make sure your Next.js dev server is running (npm run dev)');
    }
    process.exit(1);
  }
}

testCron();

