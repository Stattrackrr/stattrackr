#!/usr/bin/env node

const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

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

function getCurrentBranch() {
  try {
    const head = readFileSync(join(process.cwd(), '.git', 'HEAD'), 'utf8').trim();
    const prefix = 'ref: refs/heads/';
    return head.startsWith(prefix) ? head.slice(prefix.length) : '';
  } catch {
    return '';
  }
}

function getDirtyGeneratedFiles() {
  const candidates = [
    '.next',
    join('data', 'afl-model', 'local'),
    join('data', 'afl-model', 'latest-disposals-projections-localtest.json'),
  ];
  const found = candidates.filter((path) => existsSync(join(process.cwd(), path)));

  const projectionsDir = join(process.cwd(), 'data', 'afl-model', 'projections');
  if (existsSync(projectionsDir)) {
    for (const entry of readdirSync(projectionsDir)) {
      if (entry.startsWith('disposals-projections-')) {
        found.push(join('data', 'afl-model', 'projections', entry));
        break;
      }
    }
  }

  return found.slice(0, 8);
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
