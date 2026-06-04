#!/usr/bin/env npx tsx
/**
 * Backfill international_players.normalized_name using the canonical
 * `normalizeWorldCupPlayerName` so the stored values stay in lock-step with the
 * normalization used by the World Cup dashboard merge and player index.
 *
 * This is required after improving the normalizer (folding ø/å/æ/ß/ı/etc.):
 * the dashboard merges by `normalized_name = <selected player normalized>`, so
 * both sides MUST normalize identically or matches silently drift.
 *
 * Usage:
 *   npx tsx scripts/backfill-international-normalized-names.ts          # apply
 *   npx tsx scripts/backfill-international-normalized-names.ts --dry    # preview
 *   npm run backfill:international:normalized-names
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

const ENV_FILES = ['.env.local', '.env.development.local', '.env'];
for (const file of ENV_FILES) {
  const fullPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(fullPath)) config({ path: fullPath, override: false });
}

const DRY_RUN = process.argv.includes('--dry') || process.argv.includes('--dry-run');

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');
  const { normalizeWorldCupPlayerName } = await import('../lib/worldCupPlayerIndex');

  console.log(`[backfill] reading international_players...${DRY_RUN ? ' (dry run)' : ''}`);

  const rows: Array<{ id: number; full_name: string; normalized_name: string | null }> = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('international_players')
      .select('id, full_name, normalized_name')
      .in('source', ['statsbomb', 'api-football'])
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`read failed: ${error.message}`);
    const page = (data ?? []) as typeof rows;
    if (!page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  console.log(`[backfill] loaded ${rows.length} rows`);

  const changes = rows
    .map((r) => ({ id: r.id, full_name: r.full_name, from: r.normalized_name ?? '', to: normalizeWorldCupPlayerName(r.full_name || '') }))
    .filter((c) => c.to && c.to !== c.from);

  console.log(`[backfill] ${changes.length} rows need updating`);
  for (const c of changes.slice(0, 30)) {
    console.log(`  "${c.full_name}": "${c.from}" -> "${c.to}"`);
  }
  if (changes.length > 30) console.log(`  ...and ${changes.length - 30} more`);

  if (DRY_RUN) {
    console.log('[backfill] dry run — no changes written.');
    return;
  }

  let done = 0;
  await mapWithConcurrency(changes, 20, async (c) => {
    const { error } = await supabaseAdmin
      .from('international_players')
      .update({ normalized_name: c.to })
      .eq('id', c.id);
    if (error) console.error(`  update failed id=${c.id}: ${error.message}`);
    done += 1;
    if (done % 200 === 0) console.log(`[backfill] updated ${done}/${changes.length}`);
  });

  console.log(`[backfill] done — updated ${done} rows.`);
}

main().catch((err) => {
  console.error('[backfill] failed', err);
  process.exitCode = 1;
});
