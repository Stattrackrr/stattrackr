#!/usr/bin/env node

/**
 * Print every player in the cached AFL roster.
 *   node scripts/list-afl-roster.js
 *   node scripts/list-afl-roster.js --season=2025
 */

const fs = require('fs');
const path = require('path');

function getArg(name, fallback) {
  const pref = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(pref));
  if (!raw) return fallback;
  return raw.slice(pref.length);
}

const dataDir = path.join(process.cwd(), 'data');
const season = getArg('season', String(new Date().getFullYear()));
const filePath = path.join(dataDir, `afl-roster-${season}.json`);

if (!fs.existsSync(filePath)) {
  const prev = String(parseInt(season, 10) - 1);
  const prevPath = path.join(dataDir, `afl-roster-${prev}.json`);
  if (fs.existsSync(prevPath)) {
    const data = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
    console.log(`Roster file for ${season} not found. Using ${prev} (${data.players.length} players):\n`);
    data.players.forEach((p) => console.log(p.name));
    process.exit(0);
  }
  console.error(`No roster found for ${season} or ${prev}. Run: npm run fetch:afl-roster`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
console.log(`Season ${data.season} – ${data.players.length} players:\n`);
data.players.forEach((p) => console.log(p.name));
