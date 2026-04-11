#!/usr/bin/env node

const { execSync } = require('node:child_process');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function reply(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function run(command) {
  return execSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function getCurrentBranch() {
  try {
    return run('git branch --show-current');
  } catch {
    return '';
  }
}

function getDirtyGeneratedFiles() {
  try {
    const status = run('git status --short');
    return status
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) =>
        line.includes('.next/') ||
        line.includes('__pycache__/') ||
        line.includes('data/afl-model/local/') ||
        line.includes('latest-disposals-projections-localtest.json') ||
        line.includes('data/afl-model/projections/disposals-projections-')
      )
      .slice(0, 8);
  } catch {
    return [];
  }
}

function isMasterLike(branch) {
  return branch === 'master' || branch === 'main';
}

function isBlockedOnMaster(command) {
  return /^git\s+(commit|push|merge|cherry-pick)\b/i.test(command);
}

function isBroadStage(command) {
  return /^git\s+add(?:\s+(?:\.|-A|--all)\s*)?$/i.test(command);
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    reply({ permission: 'allow' });
    return;
  }

  const command = String(payload.command || '').trim();
  if (!command.toLowerCase().startsWith('git ')) {
    reply({ permission: 'allow' });
    return;
  }

  const branch = getCurrentBranch();

  if (isMasterLike(branch) && isBlockedOnMaster(command)) {
    reply({
      permission: 'deny',
      user_message: `Blocked: \`${command}\` on \`${branch}\`. Create or switch to a task branch before committing or pushing.`,
      agent_message: 'This repo should not commit or push directly from master/main except for deliberate sync workflows.',
    });
    return;
  }

  if (isBroadStage(command)) {
    const generatedFiles = getDirtyGeneratedFiles();
    if (generatedFiles.length > 0) {
      reply({
        permission: 'ask',
        user_message: `Broad staging command detected while generated files are dirty:\n${generatedFiles.join('\n')}\nReview files before using \`git add .\` or \`git add -A\`.`,
        agent_message: 'Generated artifacts are present in the worktree. Prefer staging only task-specific files.',
      });
      return;
    }
  }

  reply({ permission: 'allow' });
}

main().catch(() => {
  reply({ permission: 'allow' });
});
