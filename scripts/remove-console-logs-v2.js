const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Find all TypeScript/TSX files
const files = execSync('git ls-files "**/*.{ts,tsx}"', { encoding: 'utf-8' })
  .split('\n')
  .filter(f => f && !f.includes('node_modules') && !f.includes('.next') && !f.includes('scripts/'));

let totalRemoved = 0;
const modifiedFiles = [];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  
  let content = fs.readFileSync(file, 'utf-8');
  const originalContent = content;
  let removed = 0;
  
  // Remove console.log, console.warn, console.debug, console.info, console.error statements
  // Handle both single-line and multi-line cases
  
  // Pattern 1: Single line console statements (with or without semicolon)
  // Matches: console.log(...); or console.log(...)
  const singleLinePattern = /^\s*console\.(log|warn|debug|info|error|trace|table|group|groupEnd|groupCollapsed)\([^)]*\);?\s*$/gm;
  const singleMatches = content.match(singleLinePattern);
  if (singleMatches) {
    removed += singleMatches.length;
    content = content.replace(singleLinePattern, '');
  }
  
  // Pattern 2: Multi-line console statements
  // This is more complex - we need to match opening paren, then everything until closing paren + semicolon
  // We'll do this in a loop to handle nested parentheses
  let multilineContent = content;
  let multilineRemoved = 0;
  let changed = true;
  while (changed) {
    changed = false;
    // Match console.method( ... ); where ... can span multiple lines
    const multilinePattern = /console\.(log|warn|debug|info|error|trace|table|group|groupEnd|groupCollapsed)\([^;]*?\);?/gs;
    const multilineMatch = multilineContent.match(multilinePattern);
    if (multilineMatch) {
      multilineRemoved += multilineMatch.length;
      multilineContent = multilineContent.replace(multilinePattern, '');
      changed = true;
    }
  }
  content = multilineContent;
  removed += multilineRemoved;
  
  // Clean up empty lines (more than 2 consecutive empty lines -> 2 empty lines)
  content = content.replace(/\n{3,}/g, '\n\n');
  
  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf-8');
    modifiedFiles.push(file);
    totalRemoved += removed;
  }
});

console.log(`Modified ${modifiedFiles.length} files`);
console.log(`Total console statements removed: ${totalRemoved}`);
if (modifiedFiles.length > 0) {
  console.log('\nModified files:');
  modifiedFiles.slice(0, 20).forEach(f => console.log(`  - ${f}`));
  if (modifiedFiles.length > 20) {
    console.log(`  ... and ${modifiedFiles.length - 20} more`);
  }
}


