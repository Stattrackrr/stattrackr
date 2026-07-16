#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { fetchFootyinfoLadder } from '../lib/afl/footyinfoLeague';

const season = Number(process.argv.find((arg) => arg.startsWith('--season='))?.slice(9) || new Date().getFullYear());

async function main() {
  const ladder = await fetchFootyinfoLadder(season);
  if (!ladder) throw new Error(`FootyInfo ladder unavailable for ${season}`);
  const teams = ladder.teams.map((team, index) => ({
    pos: index + 1,
    team: team.tm,
    played: Number(team.p) || 0,
    win: Number(team.w) || 0,
    loss: Number(team.l) || 0,
    draw: Number(team.d) || 0,
    points_for: Number(team.f) || null,
    points_against: Number(team.a) || null,
    percentage: Number(team.pct) || null,
    premiership_points: Number(team.pts) || null,
  }));
  const file = path.join(process.cwd(), 'data', `afl-ladder-${season}.json`);
  fs.writeFileSync(file, JSON.stringify({ season, generatedAt: new Date().toISOString(), source: 'footyinfo.com', teams }, null, 2));
  console.log(`Wrote ${file} (${teams.length} FootyInfo teams)`);
}
main().catch((error) => { console.error(error); process.exit(1); });
