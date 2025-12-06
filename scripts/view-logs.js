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
    // Vercel CLI v48 doesn't support -n flag, so we get all and take first
    const deploymentsOutput = execSync('vercel ls --json', { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const deployments = JSON.parse(deploymentsOutput.trim());
    if (!deployments || deployments.length === 0) {
      console.error('❌ No deployments found');
      process.exit(1);
    }
    
    // Filter for production deployments and get the latest one
    const prodDeployments = deployments.filter((d: any) => 
      d.target === 'production' || d.url?.includes('vercel.app')
    );
    
    const latestDeployment = prodDeployments.length > 0 ? prodDeployments[0] : deployments[0];
    const deploymentUrl = latestDeployment.url || latestDeployment.id;
    
    if (!deploymentUrl) {
      console.error('❌ Could not determine deployment URL');
      console.log('Available deployment data:', JSON.stringify(latestDeployment, null, 2));
      process.exit(1);
    }
    
    console.log(`✅ Found deployment: ${deploymentUrl}`);
    console.log(`📊 Fetching logs...\n`);
    
    command = `vercel logs ${deploymentUrl}`;
    if (json) {
      command += ' --json';
    }
  } catch (error: any) {
    console.error('❌ Error fetching deployments:', error.message);
    console.log('\n💡 Tip: You can also provide a deployment URL directly:');
    console.log('   node scripts/view-logs.js <deployment-url>');
    console.log('\nOr list deployments manually:');
    console.log('   vercel ls');
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
