#!/usr/bin/env npx tsx

import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { backfillSoccerPlayerPositionsInCache } = await import('../lib/soccerCache');
  const dryRun = String(process.env.SOCCER_POSITION_BACKFILL_DRY_RUN || '0') === '1';
  const limitRaw = String(process.env.SOCCER_POSITION_BACKFILL_LIMIT || '').trim();
  const limit = limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10) || 0) : undefined;

  console.log(`[soccer-positions] starting dryRun=${dryRun}${limit ? ` limit=${limit}` : ''}`);

  const result = await backfillSoccerPlayerPositionsInCache({ dryRun, limit, quiet: false });

  console.log('[soccer-positions] done', result);
  if (result.errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[soccer-positions] failed', err);
  process.exitCode = 1;
});
