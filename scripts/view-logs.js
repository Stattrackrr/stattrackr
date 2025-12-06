#!/usr/bin/env node

/**
 * View Vercel production logs
 * 
 * Usage:
 *   node scripts/view-logs.js                    # View recent logs
 *   node scripts/view-logs.js --follow           # Follow logs in real-time
 *   node scripts/view-logs.js --function similar-players  # Filter by function name
 */

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const follow = args.includes('--follow') || args.includes('-f');
const functionFilter = args.find(arg => arg.startsWith('--function='))?.split('=')[1] || 
                       args.find(arg => arg.startsWith('-f='))?.split('=')[1];

let command = 'vercel logs';

if (follow) {
  command += ' --follow';
}

if (functionFilter) {
  command += ` --function=${functionFilter}`;
}

// Add production environment
command += ' --prod';

console.log('📊 Fetching Vercel production logs...');
console.log(`Command: ${command}\n`);

try {
  execSync(command, { 
    stdio: 'inherit',
    cwd: process.cwd()
  });
} catch (error) {
  if (error.status === 1) {
    // Vercel CLI might exit with code 1 when no logs found, which is fine
    console.log('\n✅ Log viewing completed');
  } else {
    console.error('❌ Error viewing logs:', error.message);
    process.exit(1);
  }
}

