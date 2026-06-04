#!/usr/bin/env npx tsx
/**
 * Build the World Cup master player index and store it permanently in Supabase
 * (`world_cup_cache`). Once run, the player search is served entirely from
 * cache and never needs the BalldontLie API.
 *
 * Pulls and name-matches every player across:
 *   - World Cup (BDL FIFA API, seasons 2018/2022/2026)
 *   - Euros (Supabase international_players, source = statsbomb)
 *   - Nations League (Supabase international_players, source = api-football)
 *
 * Usage:
 *   npx tsx scripts/build-world-cup-player-index.ts
 *   npm run build:world-cup:player-index
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) config({ path: fullPath, override: false });
}

async function main() {
  const { rebuildAndPersistWorldCupPlayerIndex, WORLD_CUP_PLAYER_INDEX_CACHE_KEY } = await import(
    '../lib/worldCupPlayerIndex'
  );

  console.log('[player-index] building World Cup / Euros / Nations League player index...');
  const started = Date.now();

  const result = await rebuildAndPersistWorldCupPlayerIndex({ log: (msg) => console.log(msg) });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!result.count) {
    console.error('[player-index] No players found. Check BALLDONTLIE_API_KEY and Supabase env vars.');
    process.exitCode = 1;
    return;
  }
  if (!result.persisted) {
    console.error(`[player-index] Built ${result.count} players but FAILED to persist to Supabase.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[player-index] done in ${seconds}s — cached ${result.count} unique players under "${WORLD_CUP_PLAYER_INDEX_CACHE_KEY}".`
  );
}

main().catch((err) => {
  console.error('[player-index] failed', err);
  process.exitCode = 1;
});
