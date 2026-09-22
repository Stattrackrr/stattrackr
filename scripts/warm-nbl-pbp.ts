/**
 * Warm NBL SportRadar play-by-play caches (quarter splits + court chemistry).
 *
 * Usage:
 *   npx tsx scripts/warm-nbl-pbp.ts
 *   npx tsx scripts/warm-nbl-pbp.ts --years=2026 --concurrency=2 --force
 */

import { NBL_CURRENT_SEASON_YEAR } from '../lib/nblTeamCanonical';
import { warmNblPbpPoints } from '../lib/nbl/nblPbpData';

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
  console.log(`[warm-nbl-pbp] years=${years.join(',')} concurrency=${concurrency} force=${force}`);
  const result = await warmNblPbpPoints({ years, concurrency, forceRefresh: force });
  console.log('[warm-nbl-pbp] done', result);
}

main().catch((err) => {
  console.error('[warm-nbl-pbp] failed', err);
  process.exit(1);
});
