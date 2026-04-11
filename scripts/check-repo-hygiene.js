#!/usr/bin/env node

const { execSync } = require('node:child_process');

const FORBIDDEN_TRACKED_PREFIXES = [
  '.next/',
  'scripts/afl_model/__pycache__/',
  'data/afl-model/local/',
];

const FORBIDDEN_CHANGED_PATTERNS = [
  /^\.next\//,
  /^scripts\/afl_model\/__pycache__\//,
  /^data\/afl-model\/local\//,
  /^data\/afl-model\/latest-disposals-projections-localtest\.json$/,
];

function run(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getTrackedFiles() {
  const output = run('git ls-files');
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function getChangedFiles() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args.filter(Boolean);
  }

  const output = run('git diff --name-only --cached HEAD');
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function main() {
  const trackedFiles = getTrackedFiles();
  const changedFiles = getChangedFiles();

  const trackedViolations = trackedFiles.filter((file) =>
    FORBIDDEN_TRACKED_PREFIXES.some((prefix) => file.startsWith(prefix))
  );

  const changedViolations = changedFiles.filter((file) =>
    FORBIDDEN_CHANGED_PATTERNS.some((pattern) => pattern.test(file))
  );

  if (trackedViolations.length === 0 && changedViolations.length === 0) {
    console.log('Repo hygiene check passed.');
    return;
  }

  if (trackedViolations.length > 0) {
    console.error('Forbidden generated files are tracked in git:');
    trackedViolations.forEach((file) => console.error(`- ${file}`));
  }

  if (changedViolations.length > 0) {
    console.error('Forbidden generated files appear in the current change set:');
    changedViolations.forEach((file) => console.error(`- ${file}`));
  }

  process.exit(1);
}

main();
