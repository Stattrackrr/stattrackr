#!/usr/bin/env node
/**
 * Strip git stash-pop conflict markers from generated data JSON.
 * Keeps the "Updated upstream" side (CI/master output).
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/resolve-data-merge-conflicts.js <file> [...]');
  process.exit(1);
}

const pattern = /<<<<<<< Updated upstream\r?\n([\s\S]*?)\r?\n=======\r?\n[\s\S]*?\r?\n>>>>>>> Stashed changes\r?\n?/g;

for (const file of files) {
  const full = path.resolve(file);
  const before = fs.readFileSync(full, 'utf8');
  const count = (before.match(/<<<<<<< Updated upstream/g) || []).length;
  if (!count) {
    console.log(`ok ${file}`);
    continue;
  }
  const after = before.replace(pattern, '$1');
  fs.writeFileSync(full, after, 'utf8');
  try {
    JSON.parse(after);
    console.log(`fixed ${file} (${count} conflicts)`);
  } catch (err) {
    console.error(`STILL INVALID ${file}: ${err.message}`);
    process.exitCode = 1;
  }
}
