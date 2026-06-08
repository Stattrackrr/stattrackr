/**
 * Count the games we'd show for Australia in the World Cup team chart, broken
 * down by source/competition. Mirrors the dashboard's data sources:
 *   - BDL World Cup history (2018 / 2022 / 2026)
 *   - international_* tables (StatsBomb Euros + API-Football comps incl. WCQ)
 *
 * Run: npx tsx scripts/probe-australia-games.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

async function probeBdl() {
  const key = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!key) {
    console.log('[BDL] key missing — skipping');
    return;
  }
  const auth = key.startsWith('Bearer ') ? key : `Bearer ${key}`;
  const params = new URLSearchParams();
  [2018, 2022, 2026].forEach((y) => params.append('seasons[]', String(y)));
  params.set('per_page', '100');
  const res = await fetch(`${BDL_FIFA_BASE}/matches?${params.toString()}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  const json: any = await res.json();
  const matches: any[] = json?.data ?? [];
  const aus = matches.filter(
    (m) =>
      (m?.home_team?.name === 'Australia' || m?.away_team?.name === 'Australia') &&
      m?.status === 'completed'
  );
  console.log(`\n=== BDL World Cup (Australia) ===`);
  const bySeason = new Map<number, number>();
  for (const m of aus) {
    const y = m?.season?.year ?? 0;
    bySeason.set(y, (bySeason.get(y) ?? 0) + 1);
  }
  for (const [y, c] of [...bySeason.entries()].sort()) {
    console.log(`  ${y}: ${c} games`);
  }
  console.log(`  total completed BDL games: ${aus.length}`);
  for (const m of aus) {
    console.log(
      `   ${m?.season?.year} ${m?.stage?.name}: ${m?.home_team?.name} ${m.home_score}-${m.away_score} ${m?.away_team?.name}`
    );
  }
}

async function probeInternational() {
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');

  // Find Australia's source_team_id(s) across international sources.
  const { data: teams } = await supabaseAdmin
    .from('international_teams')
    .select('source, source_team_id, team_name, country_code')
    .or('team_name.ilike.%australia%,country_code.eq.AUS');

  console.log(`\n=== international_teams matching Australia ===`);
  for (const t of (teams ?? []) as any[]) {
    console.log(`  [${t.source}] id=${t.source_team_id} name="${t.team_name}" cc=${t.country_code}`);
  }

  const idsBySource = new Map<string, string[]>();
  for (const t of (teams ?? []) as any[]) {
    const list = idsBySource.get(t.source) ?? [];
    list.push(String(t.source_team_id));
    idsBySource.set(t.source, list);
  }

  for (const [source, ids] of idsBySource) {
    const { data: matches } = await supabaseAdmin
      .from('international_matches')
      .select('tournament_slug, stage, home_team_name, away_team_name, home_score, away_score')
      .eq('source', source)
      .or(`home_team_source_id.in.(${ids.join(',')}),away_team_source_id.in.(${ids.join(',')})`);
    const rows = (matches ?? []) as any[];
    console.log(`\n=== ${source}: ${rows.length} Australia matches ===`);
    const bySlug = new Map<string, number>();
    for (const m of rows) bySlug.set(m.tournament_slug, (bySlug.get(m.tournament_slug) ?? 0) + 1);
    for (const [slug, c] of bySlug) console.log(`  ${slug}: ${c}`);
  }
}

async function main() {
  await probeBdl();
  await probeInternational();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
