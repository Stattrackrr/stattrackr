#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';

const season = Number(process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) || new Date().getFullYear());
const leagueFile = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
const outputFile = path.join(process.cwd(), 'data', `afl-roster-${season}.json`);
const league = JSON.parse(fs.readFileSync(leagueFile, 'utf8')) as { players?: Array<{ name?: string; team?: string }> };
const players = (league.players || [])
  .filter((player) => player.name && player.team)
  .map((player) => ({ name: player.name, team: player.team }))
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

fs.writeFileSync(outputFile, JSON.stringify({
  season,
  generatedAt: new Date().toISOString(),
  source: 'footyinfo.com',
  sourcePage: `afl-league-player-stats-${season}.json`,
  playerCount: players.length,
  players,
}, null, 2));
console.log(`Wrote ${outputFile} (${players.length} FootyInfo roster entries)`);
