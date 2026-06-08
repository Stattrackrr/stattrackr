/**
 * Diagnostic: figure out whether we can determine the actual winner of a
 * knockout match that finished level (i.e. went to a penalty shootout).
 *
 * 1) Finds "draw" knockout matches in `international_matches` (level score in a
 *    non-group stage) and re-fetches those fixtures from API-Football to see if
 *    `score.penalty` and `teams.{home,away}.winner` are populated.
 * 2) Pulls BDL World Cup matches and dumps the raw keys / a knockout sample so
 *    we can see whether BDL exposes any shootout / winner field at all.
 *
 * Run: npx tsx scripts/probe-knockout-winners.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';

function isKnockoutStage(stage: string | null): boolean {
  if (!stage) return false;
  const s = stage.toLowerCase();
  return (
    s.includes('final') ||
    s.includes('semi') ||
    s.includes('quarter') ||
    s.includes('round of 16') ||
    s.includes('3rd') ||
    s.includes('third')
  );
}

async function probeApiFootball() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.log('\n[API-Football] API_FOOTBALL_KEY missing — skipping.');
    return;
  }
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');

  const { data, error } = await supabaseAdmin
    .from('international_matches')
    .select('source, source_match_id, tournament_slug, stage, home_team_name, away_team_name, home_score, away_score')
    .eq('source', 'api-football');
  if (error) throw error;

  const draws = (data ?? []).filter(
    (m: any) =>
      isKnockoutStage(m.stage) &&
      m.home_score != null &&
      m.away_score != null &&
      m.home_score === m.away_score
  );

  console.log(`\n=== API-Football: ${draws.length} level knockout matches in DB ===`);
  for (const m of draws.slice(0, 8)) {
    try {
      const res = await fetch(`${API_FOOTBALL_BASE}/fixtures?id=${m.source_match_id}`, {
        headers: { 'x-apisports-key': key, Accept: 'application/json' },
      });
      const json: any = await res.json();
      const fx = json?.response?.[0];
      const pen = fx?.score?.penalty;
      const et = fx?.score?.extratime;
      const winner =
        fx?.teams?.home?.winner === true
          ? fx?.teams?.home?.name
          : fx?.teams?.away?.winner === true
            ? fx?.teams?.away?.name
            : '(none/null)';
      console.log(
        `  [${m.tournament_slug}] ${m.home_team_name} ${m.home_score}-${m.away_score} ${m.away_team_name} (${m.stage})`
      );
      console.log(
        `     -> ET=${JSON.stringify(et)} PEN=${JSON.stringify(pen)} winner=${winner}`
      );
    } catch (err) {
      console.log(`  fixture ${m.source_match_id} fetch failed:`, err);
    }
  }
}

async function probeBdl() {
  const key = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!key) {
    console.log('\n[BDL] API key missing — skipping.');
    return;
  }
  const auth = key.startsWith('Bearer ') ? key : `Bearer ${key}`;
  const params = new URLSearchParams();
  [2018, 2022].forEach((y) => params.append('seasons[]', String(y)));
  params.set('per_page', '100');

  try {
    const res = await fetch(`${BDL_FIFA_BASE}/matches?${params.toString()}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    const json: any = await res.json();
    const matches: any[] = json?.data ?? [];
    console.log(`\n=== BDL World Cup: fetched ${matches.length} matches (2018/2022) ===`);
    if (matches.length) {
      console.log('  Top-level keys on a match object:');
      console.log('   ', Object.keys(matches[0]).join(', '));
    }
    const knockoutDraws = matches.filter(
      (m) =>
        isKnockoutStage(m?.stage?.name ?? null) &&
        m?.home_score != null &&
        m?.away_score != null &&
        m.home_score === m.away_score
    );
    console.log(`  level knockout matches: ${knockoutDraws.length}`);
    for (const m of knockoutDraws.slice(0, 6)) {
      console.log(
        `   ${m?.home_team?.name} ${m.home_score}-${m.away_score} ${m?.away_team?.name} (${m?.stage?.name})`
      );
      console.log('     full row:', JSON.stringify(m));
    }
  } catch (err) {
    console.log('  BDL fetch failed:', err);
  }
}

async function main() {
  await probeApiFootball();
  await probeBdl();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
