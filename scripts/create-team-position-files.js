const fs = require('fs');
const path = require('path');

// All 30 NBA teams
const TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const teamsDir = path.join(__dirname, '..', 'data', 'player_positions', 'teams');

// Template for team position file
const template = {
  positions: {},
  aliases: {}
};

// Create directory if it doesn't exist
if (!fs.existsSync(teamsDir)) {
  fs.mkdirSync(teamsDir, { recursive: true });
}

let created = 0;
let skipped = 0;

for (const team of TEAMS) {
  const filePath = path.join(teamsDir, `${team}.json`);
  
  if (fs.existsSync(filePath)) {
    console.log(`[SKIP] ${team}.json already exists`);
    skipped++;
  } else {
    fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf8');
    console.log(`[CREATED] ${team}.json`);
    created++;
  }
}

console.log(`\nDone! Created ${created} files, skipped ${skipped} existing files.`);

