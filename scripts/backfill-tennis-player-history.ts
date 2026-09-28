/**
 * Fill every tennis Redis player log from the compiled 2024–2026 disk history.
 * Usage: npx tsx scripts/backfill-tennis-player-history.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { backfillAllTennisPlayerLogs } = await import('../lib/tennis/loadCached');
  const result = await backfillAllTennisPlayerLogs();
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
