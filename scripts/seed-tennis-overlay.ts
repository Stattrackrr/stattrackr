/**
 * Upload a 90-day tennis overlay from local cache.json into Supabase + Redis.
 *
 *   npx tsx scripts/seed-tennis-overlay.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { seedTennisOverlayFromDisk } = await import('../lib/tennis/ingest');
  const result = await seedTennisOverlayFromDisk();
  console.log(
    `Seeded tennis overlay: matches=${result.overlayRows} players=${result.players} fetchedAt=${result.fetchedAt}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
