/**
 * Survey API-Football coverage across EVERY edition of the international
 * competitions that feed the World Cup dashboard. For each league it lists all
 * seasons and flags which ones expose per-player AND team fixture statistics
 * (the two things the dashboard merges). Use this to find additional historical
 * seasons worth ingesting to raise thin countries' game counts.
 *
 *   npx tsx scripts/probe-competition-coverage.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE = 'https://v3.football.api-sports.io';

type ApiResponse<T> = { response: T };

async function af<T>(path: string, params: Record<string, string | number>): Promise<ApiResponse<T>> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY missing from .env.local');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { 'x-apisports-key': key, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}`);
  return (await res.json()) as ApiResponse<T>;
}

// Leagues that could add games for thin confederations. Each maps to a
// build-script slug (or notes the source) so it's clear how to ingest it.
const LEAGUES: Array<{ id: number; label: string; ingestSlug?: string }> = [
  { id: 6, label: 'AFCON (CAF)', ingestSlug: 'afcon' },
  { id: 9, label: 'Copa América (CONMEBOL)', ingestSlug: 'copa-america' },
  { id: 7, label: 'Asian Cup (AFC)', ingestSlug: 'asian-cup' },
  { id: 5, label: 'Nations League (UEFA)', ingestSlug: 'nations-league' },
  { id: 4, label: 'Euros (UEFA) — currently StatsBomb' },
  { id: 32, label: 'WCQ Europe', ingestSlug: 'wcq-uefa' },
  { id: 31, label: 'WCQ CONCACAF', ingestSlug: 'wcq-concacaf' },
  { id: 34, label: 'WCQ South America', ingestSlug: 'wcq-conmebol' },
  { id: 15, label: 'FIFA Confederations Cup' },
  { id: 19, label: 'CONCACAF Gold Cup' },
  { id: 21, label: 'CONCACAF Nations League' },
];

type LeagueEntry = {
  league: { id: number; name: string };
  seasons: Array<{ year: number; coverage?: { fixtures?: { statistics_fixtures?: boolean }; players?: boolean } }>;
};

async function probeSeasonStats(leagueId: number, season: number) {
  const fx = await af<any[]>('/fixtures', { league: leagueId, season });
  const fixtures = fx.response ?? [];
  const finished = fixtures.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short));
  if (!finished.length) return { fixtures: fixtures.length, finished: 0, players: 0, teamStats: 0 };
  const pid = finished[0].fixture.id;
  const pl = await af<any[]>('/fixtures/players', { fixture: pid });
  const players = (pl.response ?? []).reduce((s: number, t: any) => s + (t.players?.length ?? 0), 0);
  const st = await af<any[]>('/fixtures/statistics', { fixture: pid });
  const teamStats = (st.response ?? []).reduce((s: number, t: any) => s + (t.statistics?.length ?? 0), 0);
  return { fixtures: fixtures.length, finished: finished.length, players, teamStats };
}

async function main() {
  for (const lg of LEAGUES) {
    console.log(`\n================ [${lg.id}] ${lg.label} ================`);
    if (lg.ingestSlug) console.log(`  ingest via: --competition=${lg.ingestSlug}`);
    let entry: LeagueEntry | undefined;
    try {
      const data = await af<LeagueEntry[]>('/leagues', { id: lg.id });
      entry = data.response?.[0];
    } catch (err) {
      console.log(`  league lookup failed — ${(err as Error).message}`);
      continue;
    }
    if (!entry) {
      console.log('  league not found.');
      continue;
    }
    const seasons = [...entry.seasons].sort((a, b) => b.year - a.year).slice(0, 8);
    const good: number[] = [];
    for (const s of seasons) {
      try {
        const r = await probeSeasonStats(lg.id, s.year);
        const ok = r.players > 0 && r.teamStats > 0;
        if (ok) good.push(s.year);
        const flag = r.finished === 0 ? '· not played' : ok ? '✅ player+team stats' : '❌ no usable stats';
        console.log(
          `   season ${s.year}: finished=${String(r.finished).padStart(3)} | ${flag} (p:${r.players} t:${r.teamStats})`
        );
      } catch (err) {
        console.log(`   season ${s.year}: probe failed — ${(err as Error).message}`);
      }
    }
    if (good.length) console.log(`  → ingestable seasons: ${good.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
