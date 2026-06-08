#!/usr/bin/env npx tsx
/**
 * Diagnose which team-stat columns are actually populated in
 * international_team_match_stats for a given country, so we can see why the
 * World Cup dashboard's team-mode chart only shows a subset of stats.
 *
 *   npx tsx scripts/diagnose-team-stats-coverage.ts Ghana
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const COLS = [
  'goals',
  'expected_goals',
  'big_chances',
  'big_chances_missed',
  'shots_total',
  'shots_on_target',
  'shots_off_target',
  'shots_blocked',
  'shots_inside_box',
  'shots_outside_box',
  'corners',
  'offsides',
  'fouls',
  'yellow_cards',
  'red_cards',
  'throw_ins',
  'goal_kicks',
  'free_kicks',
  'possession_pct',
  'passes_total',
  'passes_accurate',
  'crosses_total',
  'tackles',
  'interceptions',
  'saves',
];

async function main() {
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');
  const name = process.argv[2] || 'Ghana';
  console.log(`\n=== team-stat coverage for "${name}" ===\n`);

  const { data: teamRows } = await supabaseAdmin
    .from('international_teams')
    .select('source, source_team_id, team_name, country_code')
    .ilike('team_name', `%${name}%`);

  const teams = teamRows ?? [];
  if (!teams.length) {
    console.log('No matching team rows found.');
    return;
  }
  for (const t of teams) {
    console.log(`  team: ${t.team_name} (source=${t.source}, id=${t.source_team_id}, cc=${t.country_code})`);
  }
  console.log('');

  // Group by source so we can run a per-source query.
  const idsBySource = new Map<string, string[]>();
  for (const t of teams) {
    const list = idsBySource.get(t.source) ?? [];
    list.push(String(t.source_team_id));
    idsBySource.set(t.source, list);
  }

  for (const [source, ids] of idsBySource) {
    const { data: statRows } = await supabaseAdmin
      .from('international_team_match_stats')
      .select('*')
      .eq('source', source)
      .in('source_team_id', ids);

    const rows = statRows ?? [];
    console.log(`--- source=${source}: ${rows.length} team-stat rows ---`);
    if (!rows.length) continue;

    // Per-slug breakdown.
    const bySlug = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const slug = String((r as Record<string, unknown>).tournament_slug ?? '(none)');
      const list = bySlug.get(slug) ?? [];
      list.push(r as Record<string, unknown>);
      bySlug.set(slug, list);
    }

    for (const [slug, slugRows] of bySlug) {
      console.log(`\n  [${slug}] ${slugRows.length} rows — non-null counts:`);
      for (const col of COLS) {
        const n = slugRows.filter((r) => r[col] != null).length;
        const flag = n === 0 ? '  ZERO' : '';
        console.log(`    ${col.padEnd(20)} ${String(n).padStart(3)}/${slugRows.length}${flag}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
