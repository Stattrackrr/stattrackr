/**
 * Snapshot NBL injuries from basketball.com.au into data/nbl-injuries.json
 * Usage: npx tsx scripts/fetch-nbl-injuries.ts
 */

import fs from 'fs';
import path from 'path';
import { fetchNblInjuriesFromBasketballComAu } from '../lib/nbl/basketballComAuInjuries';

async function main() {
  const { injuries, sourceUrl } = await fetchNblInjuriesFromBasketballComAu();
  if (!injuries.length) throw new Error('No NBL injuries parsed from basketball.com.au');
  const file = path.join(process.cwd(), 'data', 'nbl-injuries.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'basketball.com.au',
    sourceUrl,
    sourcePage: '/news/2025-26-nbl-team-lists-and-roster-tracker',
    injuryCount: injuries.length,
    injuries,
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${file} (${injuries.length} injuries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
