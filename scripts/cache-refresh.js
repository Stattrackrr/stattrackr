#!/usr/bin/env node

/**
 * Cache Refresh Utility Script
 * 
 * This script can be used to trigger scheduled cache refreshes.
 * It's designed to be run from cron jobs or other scheduling systems.
 * 
 * Usage:
 *   node scripts/cache-refresh.js [options]
 * 
 * Options:
 *   --job <name>         Run a specific refresh job
 *   --jobs <name1,name2> Run multiple specific refresh jobs
 *   --dry-run           Show what would be done without making changes
 *   --url <url>         Custom API endpoint URL (default: http://localhost:3000)
 *   --token <token>     Authorization token (or set CACHE_REFRESH_TOKEN env var)
 *   --help              Show this help message
 * 
 * Examples:
 *   node scripts/cache-refresh.js
 *   node scripts/cache-refresh.js --job player_stats
 *   node scripts/cache-refresh.js --jobs player_stats,player_search
 *   node scripts/cache-refresh.js --dry-run
 */

const https = require('https');
const http = require('http');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    job: null,
    jobs: null,
    dryRun: false,
    url: process.env.CACHE_REFRESH_URL || 'http://localhost:3000',
    token: process.env.CACHE_REFRESH_TOKEN || null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--job':
        options.job = args[++i];
        break;
      case '--jobs':
        options.jobs = args[++i]?.split(',').map(j => j.trim());
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--url':
        options.url = args[++i];
        break;
      case '--token':
        options.token = args[++i];
        break;
      case '--help':
        options.help = true;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
Cache Refresh Utility Script

This script triggers scheduled cache refreshes for your Next.js application.

Usage:
  node scripts/cache-refresh.js [options]

Options:
  --job <name>         Run a specific refresh job (player_stats, player_search, espn_player)
  --jobs <name1,name2> Run multiple specific refresh jobs (comma-separated)
  --dry-run           Show what would be done without making changes
  --url <url>         Custom API endpoint URL (default: http://localhost:3000)
  --token <token>     Authorization token (or set CACHE_REFRESH_TOKEN env var)
  --help              Show this help message

Environment Variables:
  CACHE_REFRESH_TOKEN  Authorization token for the refresh API
  CACHE_REFRESH_URL    Base URL for your application

Examples:
  # Refresh all caches
  node scripts/cache-refresh.js

  # Refresh only player stats
  node scripts/cache-refresh.js --job player_stats

  # Refresh multiple specific caches
  node scripts/cache-refresh.js --jobs player_stats,player_search

  # Dry run to see what would be refreshed
  node scripts/cache-refresh.js --dry-run

  # Use with production URL
  CACHE_REFRESH_URL=https://your-app.vercel.app node scripts/cache-refresh.js

Cron Examples:
  # Refresh player stats at 3:30 AM ET (8:30 AM UTC) daily
  30 8 * * * /usr/bin/node /path/to/scripts/cache-refresh.js --job player_stats

  # Refresh all caches at 5:30 AM ET (10:30 AM UTC) daily  
  30 10 * * * /usr/bin/node /path/to/scripts/cache-refresh.js
`);
}

// Make HTTP request
function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    
    const req = client.request(url, options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonBody = JSON.parse(body);
          resolve({ statusCode: res.statusCode, body: jsonBody });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: body });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(data);
    }
    
    req.end();
  });
}

// Main function
async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    return;
  }
  
  if (!options.token) {
    console.error('Error: No authorization token provided.');
    console.error('Set the CACHE_REFRESH_TOKEN environment variable or use --token option.');
    process.exit(1);
  }
  
  const apiUrl = `${options.url.replace(/\/$/, '')}/api/cache/scheduled-refresh`;
  
  const requestBody = {
    token: options.token,
    dryRun: options.dryRun
  };
  
  if (options.job) {
    requestBody.job = options.job;
  } else if (options.jobs) {
    requestBody.jobs = options.jobs;
  }
  
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.token}`
    }
  };
  
  console.log(`${options.dryRun ? '[DRY RUN] ' : ''}Triggering cache refresh...`);
  console.log(`API URL: ${apiUrl}`);
  
  if (options.job) {
    console.log(`Job: ${options.job}`);
  } else if (options.jobs) {
    console.log(`Jobs: ${options.jobs.join(', ')}`);
  } else {
    console.log('Jobs: All enabled jobs');
  }
  
  try {
    const response = await makeRequest(apiUrl, requestOptions, JSON.stringify(requestBody));
    
    if (response.statusCode === 200) {
      console.log('✅ Cache refresh completed successfully');
      console.log('\nResults:');
      
      if (typeof response.body === 'object' && response.body.results) {
        for (const [jobName, result] of Object.entries(response.body.results)) {
          if (result.success) {
            console.log(`  ${jobName}: ✅ ${result.dryRun ? '(dry run) ' : ''}${result.duration || 'completed'}`);
            if (result.matchingCacheKeys !== undefined) {
              console.log(`    Found ${result.matchingCacheKeys} cache entries`);
            }
          } else if (result.skipped) {
            console.log(`  ${jobName}: ⏭️  ${result.reason}`);
          } else {
            console.log(`  ${jobName}: ❌ ${result.error}`);
          }
        }
        
        if (response.body.cacheStats) {
          console.log(`\nCache Stats: ${response.body.cacheStats.totalKeys} keys, size: ${response.body.cacheStats.size}`);
        }
      } else {
        console.log(JSON.stringify(response.body, null, 2));
      }
      
    } else {
      console.error('❌ Cache refresh failed');
      console.error(`Status: ${response.statusCode}`);
      console.error('Response:', JSON.stringify(response.body, null, 2));
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error triggering cache refresh:', error.message);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { parseArgs, makeRequest, main };