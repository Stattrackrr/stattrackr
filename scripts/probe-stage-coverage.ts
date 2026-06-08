/**
 * Diagnostic: for each international competition, list the distinct `stage`
 * strings stored in `international_matches`, how our normalizer buckets them,
 * and how many of those matches actually have a team-stats row.
 *
 * Run: npx tsx scripts/probe-stage-coverage.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

type StageBucket = 'group' | 'r16' | 'qf' | 'sf' | 'third' | 'final' | null;

function deriveStageBucket(stageRaw: string | null): StageBucket {
  if (!stageRaw) return null;
  const s = stageRaw.toLowerCase();
  if (s.includes('semi')) return 'sf';
  if (s.includes('quarter') || /\bqf\b/.test(s)) return 'qf';
  if (s.includes('round of 16') || s.includes('last 16') || s.includes('1/8') || s.includes('eighth')) return 'r16';
  if ((s.includes('third') || s.includes('3rd')) && s.includes('place')) return 'third';
  if (s.includes('final')) return 'final';
  if (s.includes('group') || s.includes('league')) return 'group';
  return null;
}

async function main() {
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');

  // Pull all matches (paginate to be safe).
  const matches: Array<{ source_match_id: string; tournament_slug: string | null; stage: string | null; season_year: number | null }> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('international_matches')
      .select('source_match_id, tournament_slug, stage, season_year')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    matches.push(...(data as any));
    if (data.length < pageSize) break;
  }

  // Team-stats coverage: which match ids have a team-stats row.
  const statMatchIds = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('international_team_match_stats')
      .select('source_match_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as any[]) statMatchIds.add(String(r.source_match_id));
    if (data.length < pageSize) break;
  }

  const bySlug = new Map<string, typeof matches>();
  for (const m of matches) {
    const slug = m.tournament_slug ?? '(null)';
    const list = bySlug.get(slug) ?? [];
    list.push(m);
    bySlug.set(slug, list);
  }

  console.log(`Total international matches: ${matches.length}; with team stats: ${statMatchIds.size}\n`);

  for (const [slug, list] of [...bySlug.entries()].sort()) {
    console.log(`\n=== ${slug} (${list.length} matches) ===`);
    const byStage = new Map<string, { count: number; withStats: number; bucket: StageBucket }>();
    for (const m of list) {
      const key = m.stage ?? '(null)';
      const entry = byStage.get(key) ?? { count: 0, withStats: 0, bucket: deriveStageBucket(m.stage) };
      entry.count += 1;
      if (statMatchIds.has(String(m.source_match_id))) entry.withStats += 1;
      byStage.set(key, entry);
    }
    for (const [stage, entry] of [...byStage.entries()].sort()) {
      console.log(
        `  stage="${stage}" -> bucket=${entry.bucket ?? 'NONE'} | matches=${entry.count} | withTeamStats=${entry.withStats}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
