#!/usr/bin/env node

/**
 * Trigger the GitHub Actions workflow "Auto Ingest Games to Git"
 * Requires GITHUB_TOKEN environment variable with repo permissions
 */

require('dotenv').config({ path: '.env.local' });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'nduar/stattrackr'; // Update with your repo
const WORKFLOW_ID = 'auto-ingest-to-git.yml';

if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN not found in environment variables');
  console.error('   Add GITHUB_TOKEN to your .env.local file');
  console.error('   You can create a token at: https://github.com/settings/tokens');
  console.error('   Required scope: repo (for private repos) or public_repo (for public repos)');
  process.exit(1);
}

async function triggerWorkflow() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`;
  
  console.log('🚀 Triggering GitHub Actions workflow...');
  console.log(`   Repository: ${GITHUB_REPO}`);
  console.log(`   Workflow: ${WORKFLOW_ID}`);
  console.log('');
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'master' // or 'main' depending on your default branch
      })
    });
    
    if (response.status === 204) {
      console.log('✅ Workflow triggered successfully!');
      console.log('');
      console.log('📋 Next steps:');
      console.log('   1. Go to: https://github.com/' + GITHUB_REPO + '/actions');
      console.log('   2. Click on "Auto Ingest Games to Git" workflow');
      console.log('   3. Wait for it to complete (usually takes 2-5 minutes)');
      console.log('   4. Check the DvP store files for BasketballMonsters positions');
    } else {
      const errorText = await response.text();
      console.error(`❌ Failed to trigger workflow: ${response.status} ${response.statusText}`);
      console.error('   Response:', errorText);
      
      if (response.status === 404) {
        console.error('');
        console.error('💡 Make sure:');
        console.error('   - GITHUB_REPO is correct (format: owner/repo)');
        console.error('   - The workflow file exists at .github/workflows/auto-ingest-to-git.yml');
      } else if (response.status === 401 || response.status === 403) {
        console.error('');
        console.error('💡 Make sure:');
        console.error('   - GITHUB_TOKEN is valid and has repo permissions');
        console.error('   - Token has not expired');
      }
      
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error triggering workflow:', error.message);
    process.exit(1);
  }
}

triggerWorkflow();

