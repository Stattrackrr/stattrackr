#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { fetchFootyinfoInjuries } from '../lib/afl/footyinfoLeague';

async function main() {
  const rows = await fetchFootyinfoInjuries();
  if (!rows.length) throw new Error('FootyInfo returned no injuries');
  const file = path.join(process.cwd(), 'data', 'afl-injuries.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'footyinfo.com',
    sourcePage: '/injuries',
    injuryCount: rows.length,
    injuries: rows.map((row) => ({
      team: row.teamOfficial,
      player: row.playerName,
      injury: row.detail || row.status,
      returning: row.estimatedReturn || row.status,
    })),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${file} (${rows.length} FootyInfo injuries)`);
}
main().catch((error) => { console.error(error); process.exit(1); });
