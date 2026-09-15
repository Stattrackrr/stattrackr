#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { fetchFootyinfoInjuries } from '../lib/afl/footyinfoLeague';

async function main() {
  const rows = await fetchFootyinfoInjuries();
  const file = path.join(process.cwd(), 'data', 'afl-injuries.json');
  if (!rows.length) {
    if (fs.existsSync(file)) {
      console.warn('FootyInfo returned no injuries; keeping existing snapshot');
      return;
    }
    throw new Error('FootyInfo returned no injuries');
  }
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
