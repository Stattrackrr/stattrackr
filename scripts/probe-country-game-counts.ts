/**
 * Count chartable games per country for the World Cup dashboard Game Props
 * (team mode). A game counts when the team has either:
 *   - BDL World Cup completed match, or
 *   - international_team_match_stats row (API-Football / SofaScore team stats), or
 *   - international_player_match_stats rows summed for that team (StatsBomb Euros, etc.)
 *
 *   npx tsx scripts/probe-country-game-counts.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { resolveWorldCupFlagCode } from '../lib/worldCupFlags';

const BDL_FIFA_BASE = 'https://api.balldontlie.io/fifa/worldcup/v1';
const INTL_SOURCES = ['statsbomb', 'api-football', 'sofascore'];

type CountryAgg = {
  slug: string;
  label: string;
  bySource: Map<string, number>;
  matchKeys: Set<string>;
};

function keyFor(name: string | null, code: string | null): { slug: string; label: string } | null {
  const slug = resolveWorldCupFlagCode(code) || resolveWorldCupFlagCode(name);
  if (!slug) return null;
  return { slug, label: name?.trim() || slug.toUpperCase() };
}

function tagForSlug(slug: string): string {
  const s = (slug || '').toLowerCase();
  if (s.startsWith('club')) return 'Club';
  if (s.startsWith('wcq') || s.includes('world-cup-qualification')) return 'WCQ';
  if (s === 'copa-america') return 'Copa';
  if (s === 'afcon') return 'AFCON';
  if (s === 'asian-cup') return 'Asian Cup';
  if (s === 'euros') return 'Euros';
  if (s === 'nations-league') return 'NL';
  return slug || 'intl';
}

function bump(
  agg: Map<string, CountryAgg>,
  slug: string,
  label: string,
  matchKey: string,
  sourceTag: string
) {
  let entry = agg.get(slug);
  if (!entry) {
    entry = { slug, label, bySource: new Map(), matchKeys: new Set() };
    agg.set(slug, entry);
  }
  if (entry.matchKeys.has(matchKey)) return;
  entry.matchKeys.add(matchKey);
  entry.bySource.set(sourceTag, (entry.bySource.get(sourceTag) ?? 0) + 1);
}

function bdlAuth(): string | null {
  const key = (process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '').trim();
  if (!key) return null;
  return key.startsWith('Bearer ') ? key : `Bearer ${key}`;
}

/** The 48 teams qualified for the 2026 World Cup (BDL season 2026 team list). */
async function loadWorldCup2026Slugs(): Promise<Map<string, string> | null> {
  const auth = bdlAuth();
  if (!auth) return null;
  const params = new URLSearchParams();
  params.append('seasons[]', '2026');
  params.set('per_page', '100');
  const res = await fetch(`${BDL_FIFA_BASE}/teams?${params.toString()}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  const json: any = await res.json();
  const teams: any[] = json?.data ?? [];
  const slugs = new Map<string, string>();
  for (const t of teams) {
    const k = keyFor(t?.name ?? null, t?.country_code ?? null);
    if (k) slugs.set(k.slug, k.label);
  }
  return slugs.size ? slugs : null;
}

async function collectBdl(agg: Map<string, CountryAgg>) {
  const auth = bdlAuth();
  if (!auth) {
    console.log('[BDL] key missing — skipping World Cup source');
    return;
  }
  const params = new URLSearchParams();
  [2018, 2022, 2026].forEach((y) => params.append('seasons[]', String(y)));
  params.set('per_page', '100');
  const res = await fetch(`${BDL_FIFA_BASE}/matches?${params.toString()}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  const json: any = await res.json();
  const matches: any[] = json?.data ?? [];
  for (const m of matches) {
    if (m?.status !== 'completed') continue;
    const mid = String(m?.id ?? '');
    for (const side of [m?.home_team, m?.away_team]) {
      const k = keyFor(side?.name ?? null, side?.country_code ?? null);
      if (!k || !mid) continue;
      bump(agg, k.slug, k.label, `bdl:${mid}`, 'WC (BDL)');
    }
  }
}

async function collectInternational(agg: Map<string, CountryAgg>) {
  const { supabaseAdmin } = await import('../lib/supabaseAdmin');
  const sb = supabaseAdmin;

  const { data: teamRows } = await sb
    .from('international_teams')
    .select('source, source_team_id, team_name, country_code')
    .in('source', INTL_SOURCES);

  const slugByTeam = new Map<string, { slug: string; label: string }>();
  for (const t of (teamRows ?? []) as Array<{
    source: string;
    source_team_id: string;
    team_name: string;
    country_code: string | null;
  }>) {
    const k = keyFor(t.team_name, t.country_code);
    if (!k) continue;
    slugByTeam.set(`${t.source}:${t.source_team_id}`, k);
  }

  const matchMeta = new Map<string, string>();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('international_matches')
      .select('source, source_match_id, tournament_slug')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const m of rows as Array<{ source: string; source_match_id: string; tournament_slug: string }>) {
      matchMeta.set(`${m.source}:${m.source_match_id}`, tagForSlug(m.tournament_slug));
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('international_team_match_stats')
      .select('source, source_match_id, source_team_id')
      .in('source', INTL_SOURCES)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows as Array<{ source: string; source_match_id: string; source_team_id: string }>) {
      const team = slugByTeam.get(`${r.source}:${r.source_team_id}`);
      if (!team) continue;
      const tag = matchMeta.get(`${r.source}:${r.source_match_id}`) ?? 'intl';
      bump(agg, team.slug, team.label, `${r.source}:${r.source_match_id}`, tag);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('international_player_match_stats')
      .select('source, source_match_id, source_team_id')
      .in('source', INTL_SOURCES)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows as Array<{ source: string; source_match_id: string; source_team_id: string }>) {
      const team = slugByTeam.get(`${r.source}:${r.source_team_id}`);
      if (!team) continue;
      const tag = matchMeta.get(`${r.source}:${r.source_match_id}`) ?? 'intl';
      bump(agg, team.slug, team.label, `${r.source}:${r.source_match_id}`, tag);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
}

async function main() {
  // Restrict to the 48 teams actually in the 2026 World Cup unless --all is passed.
  const includeAll = process.argv.includes('--all');
  const wc2026 = includeAll ? null : await loadWorldCup2026Slugs();
  if (!includeAll && !wc2026) {
    console.log('[warn] could not load 2026 World Cup team list — falling back to ALL countries.');
  }

  const agg = new Map<string, CountryAgg>();
  await collectBdl(agg);
  await collectInternational(agg);

  let entries = [...agg.values()].map((c) => ({ ...c, total: c.matchKeys.size }));

  if (wc2026) {
    // Ensure every qualified team appears even with 0 chartable games.
    for (const [slug, label] of wc2026) {
      if (!agg.has(slug)) entries.push({ slug, label, bySource: new Map(), matchKeys: new Set(), total: 0 });
    }
    entries = entries.filter((c) => wc2026.has(c.slug));
  }

  const sorted = entries.sort((a, b) => a.total - b.total || a.label.localeCompare(b.label));

  const scope = wc2026 ? '2026 World Cup teams' : 'all countries';
  console.log(`\n================ Game counts (${scope}): ${sorted.length} teams ================\n`);
  for (const c of sorted) {
    const breakdown = [...c.bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([src, n]) => `${src}:${n}`)
      .join(', ') || 'none';
    const flag = c.total < 5 ? ' ⚠️' : '';
    console.log(`  ${c.label.padEnd(24)} ${String(c.total).padStart(3)} games  (${breakdown})${flag}`);
  }

  const under5 = sorted.filter((c) => c.total < 5);
  console.log(`\n⚠️  ${scope} under 5 games: ${under5.length}`);
  console.log(`   ${under5.map((c) => `${c.label} (${c.total})`).join(', ') || 'none'}`);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
