/**
 * Warm NBL SportRadar lineup caches (starters/bench).
 * Dashboard `/api/nbl/lineups` is cache-only.
 *
 * Usage:
 *   npx tsx scripts/warm-nbl-lineups.ts
 *   npx tsx scripts/warm-nbl-lineups.ts --years=2026 --concurrency=2 --force
 */

import { NBL_CURRENT_SEASON_YEAR } from '../lib/nblTeamCanonical';
import { warmNblLineups } from '../lib/nbl/realLineups';

function parseArgs(argv: string[]) {
  let years = [NBL_CURRENT_SEASON_YEAR];
  let concurrency = 2;
  let force = false;
  for (const arg of argv) {
    if (arg.startsWith('--years=')) {
      const parsed = arg
        .slice('--years='.length)
        .split(',')
        .map((p) => Number(p.trim()))
        .filter((y) => Number.isFinite(y) && y >= 2020 && y <= 2100);
      if (parsed.length) years = [...new Set(parsed)].sort((a, b) => b - a);
    } else if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.slice('--concurrency='.length));
      if (Number.isFinite(n) && n >= 1 && n <= 6) concurrency = Math.floor(n);
    } else if (arg === '--force') {
      force = true;
    }
  }
  return { years, concurrency, force };
}

async function main() {
  const { years, concurrency, force } = parseArgs(process.argv.slice(2));
  console.log(`[warm-nbl-lineups] years=${years.join(',')} concurrency=${concurrency} force=${force}`);
  const result = await warmNblLineups({ years, concurrency, forceRefresh: force });
  console.log('[warm-nbl-lineups] done', result);
}

main().catch((err) => {
  console.error('[warm-nbl-lineups] failed', err);
  process.exit(1);
});
