#!/usr/bin/env node

/**
 * Export player ID mappings to JSON for use in standalone scripts
 */

const fs = require('fs');
const path = require('path');

// Read the TypeScript mapping file
const mappingFile = path.join(__dirname, '..', 'lib', 'playerIdMapping.ts');
const content = fs.readFileSync(mappingFile, 'utf8');

// Extract mappings using regex
const regex = /\{\s*bdlId:\s*['"](\d+)['"],\s*nbaId:\s*['"](\d+)['"],\s*name:\s*['"]([^'"]+)['"]\s*\}/g;
const mappings = [];
let match;

while ((match = regex.exec(content)) !== null) {
  mappings.push({
    bdlId: match[1],
    nbaId: match[2],
    name: match[3]
  });
}

// Write to JSON file
const outputFile = path.join(__dirname, 'player-id-mappings.json');
fs.writeFileSync(outputFile, JSON.stringify(mappings, null, 2));

console.log(`✅ Exported ${mappings.length} player ID mappings to ${outputFile}`);

