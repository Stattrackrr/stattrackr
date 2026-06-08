#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { supabaseAdmin } from '../lib/supabaseAdmin';

async function main() {
  const eventIds = ['11797997', '11797980', '11797936'];
  for (const id of eventIds) {
    const { data } = await supabaseAdmin
      .from('international_matches')
      .select('home_team_name, away_team_name, match_date, stage')
      .eq('source', 'sofascore')
      .eq('source_match_id', id)
      .maybeSingle();
    console.log(`[${id}]`, data ?? 'not in db');
  }

  const { data: rows } = await supabaseAdmin
    .from('international_matches')
    .select('source_match_id, home_team_name, away_team_name, match_date, kickoff_unix')
    .eq('source', 'sofascore')
    .eq('tournament_slug', 'wcq-africa')
    .eq('season_year', 2025)
    .order('kickoff_unix', { ascending: true });

  const all = rows ?? [];
  console.log(`\nTotal 2025 matches in db: ${all.length}`);

  const { data: withStats } = await supabaseAdmin
    .from('international_team_match_stats')
    .select('source_match_id')
    .eq('source', 'sofascore')
    .eq('tournament_slug', 'wcq-africa')
    .eq('season_year', 2025);

  const statIds = new Set((withStats ?? []).map((r) => r.source_match_id));
  const missing = all.filter((r) => !statIds.has(r.source_match_id));
  console.log(`Missing team stats: ${missing.length}\n`);
  for (const r of missing) {
    console.log(`  [${r.source_match_id}] ${r.home_team_name} vs ${r.away_team_name} (${r.match_date})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
