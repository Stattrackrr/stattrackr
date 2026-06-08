/**
 * Backfill penalty-shootout scores on `international_matches` from API-Football.
 * Run after applying migrations/add_international_match_penalty_scores.sql.
 *
 *   npx tsx scripts/backfill-match-penalties.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

async function main() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY missing from .env.local');

  const { supabaseAdmin } = await import('../lib/supabaseAdmin');

  const { data, error } = await supabaseAdmin
    .from('international_matches')
    .select('source, source_match_id, home_score, away_score, home_score_penalty')
    .eq('source', 'api-football');
  if (error) throw error;

  const candidates = (data ?? []).filter(
    (m: any) =>
      m.home_score != null &&
      m.away_score != null &&
      m.home_score === m.away_score &&
      (m.home_score_penalty == null || m.away_score_penalty == null)
  );

  console.log(`[backfill] ${candidates.length} level api-football matches to refresh`);

  let updated = 0;
  for (const m of candidates) {
    const res = await fetch(`${API_FOOTBALL_BASE}/fixtures?id=${m.source_match_id}`, {
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
    });
    const json: any = await res.json();
    const fx = json?.response?.[0];
    const homePen = fx?.score?.penalty?.home ?? null;
    const awayPen = fx?.score?.penalty?.away ?? null;
    if (homePen == null || awayPen == null || homePen === awayPen) continue;

    const { error: upErr } = await supabaseAdmin
      .from('international_matches')
      .update({
        home_score_penalty: homePen,
        away_score_penalty: awayPen,
        has_penalty_shootout: true,
      })
      .eq('source', 'api-football')
      .eq('source_match_id', m.source_match_id);
    if (upErr) {
      console.warn(`[backfill] failed ${m.source_match_id}:`, upErr.message);
      continue;
    }
    updated += 1;
    if (updated % 10 === 0) console.log(`[backfill] updated ${updated}...`);
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`[backfill] done — updated ${updated} matches`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
