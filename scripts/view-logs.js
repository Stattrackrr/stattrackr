#!/usr/bin/env node

/**
 * View Vercel production logs
 * 
 * Usage:
 *   node scripts/view-logs.js                    # View recent logs from latest production deployment
 *   node scripts/view-logs.js --json              # View logs as JSON
 *   node scripts/view-logs.js <deployment-url>    # View logs for specific deployment
 */

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const json = args.includes('--json') || args.includes('-j');
const deploymentUrl = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));

let command;

if (deploymentUrl) {
  // Use provided deployment URL
  command = `vercel logs ${deploymentUrl}`;
  if (json) {
    command += ' --json';
  }
} else {
  // Get latest production deployment
  console.log('📊 Fetching latest production deployment...');
  try {
    const deploymentsOutput = execSync('vercel ls --prod -n 1 -j', { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const deployments = JSON.parse(deploymentsOutput.trim());
    if (!deployments || deployments.length === 0) {
      console.error('❌ No production deployments found');
      process.exit(1);
    }
    
    const latestDeployment = deployments[0];
    const deploymentUrl = latestDeployment.url || latestDeployment.id;
    
    console.log(`✅ Found deployment: ${deploymentUrl}`);
    console.log(`📊 Fetching logs...\n`);
    
    command = `vercel logs ${deploymentUrl}`;
    if (json) {
      command += ' --json';
    }
  } catch (error) {
    console.error('❌ Error fetching deployments:', error.message);
    console.log('\n💡 Tip: You can also provide a deployment URL directly:');
    console.log('   node scripts/view-logs.js <deployment-url>');
    process.exit(1);
  }
}

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
