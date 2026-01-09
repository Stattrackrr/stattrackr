const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Find all TypeScript/TSX files
const files = execSync('git ls-files "**/*.{ts,tsx}"', { encoding: 'utf-8' })
  .split('\n')
  .filter(f => f && !f.includes('node_modules') && !f.includes('.next'));

let totalRemoved = 0;

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  
  let content = fs.readFileSync(file, 'utf-8');
  const originalContent = content;
  
  // Remove console.log, console.warn, console.debug, console.info statements
  // Match patterns like:
  // console.log(...);
  // console.log(...); // comment
  // console.warn(...);
  // etc.
  const patterns = [
    // Single line console statements
    /^\s*console\.(log|warn|debug|info|error|trace|table|group|groupEnd|groupCollapsed)\([^)]*\);?\s*$/gm,
    // Multi-line console statements (simple cases)
    /^\s*console\.(log|warn|debug|info|error|trace|table|group|groupEnd|groupCollapsed)\([^)]*\);?\s*\/\/.*$/gm,
  ];
  
  patterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, '');
      totalRemoved += matches.length;
    }
  });
  
  // Also remove console statements that span multiple lines (more complex)
  // This handles cases like:
  // console.log(
  //   'message',
  //   data
  // );
  const multilinePattern = /console\.(log|warn|debug|info|error|trace|table|group|groupEnd|groupCollapsed)\([^;]*?\);?/gs;
  const multilineMatches = content.match(multilinePattern);
  if (multilineMatches) {
    content = content.replace(multilinePattern, '');
    totalRemoved += multilineMatches.length;
  }
  
  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`Removed console statements from: ${file}`);
  }
});

console.log(`\nTotal console statements removed: ${totalRemoved}`);


