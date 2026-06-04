#!/usr/bin/env npx tsx
/**
 * One-off probe: does API-Football cover Copa América and AFCON, and do those
 * editions expose per-player match stats (the thing the World Cup dashboard
 * needs to merge)? Prints league IDs, recent seasons, fixture counts, and a
 * player-stat coverage sample.
 *
 *   npx tsx scripts/probe-api-football-competitions.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE = 'https://v3.football.api-sports.io';

type ApiResponse<T> = {
  errors: unknown;
  results: number;
  paging: { current: number; total: number };
  response: T;
};

async function af<T>(path: string, params: Record<string, string | number>): Promise<ApiResponse<T>> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY missing from .env.local');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { 'x-apisports-key': key, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}`);
  return (await res.json()) as ApiResponse<T>;
}

type LeagueEntry = {
  league: { id: number; name: string; type: string };
  country: { name: string };
  seasons: Array<{ year: number; start: string; end: string; coverage?: { fixtures?: Record<string, boolean> } }>;
};

async function findLeague(searchTerm: string) {
  const data = await af<LeagueEntry[]>('/leagues', { search: searchTerm });
  return data.response;
}

async function probeSeasonStats(leagueId: number, season: number) {
  const fixturesRes = await af<any[]>('/fixtures', { league: leagueId, season });
  const fixtures = fixturesRes.response ?? [];
  const finished = fixtures.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short));
  if (!finished.length) return { fixtures: fixtures.length, finished: 0, samplePlayers: 0 };
  const probeId = finished[0].fixture.id;
  const playersRes = await af<any[]>('/fixtures/players', { fixture: probeId });
  const teams = playersRes.response ?? [];
  const samplePlayers = teams.reduce((sum: number, t: any) => sum + (t.players?.length ?? 0), 0);
  return { fixtures: fixtures.length, finished: finished.length, samplePlayers, probeFixtureId: probeId };
}

async function report(searchTerm: string, prefer: (e: LeagueEntry) => boolean) {
  console.log(`\n================ Search: "${searchTerm}" ================`);
  const leagues = await findLeague(searchTerm);
  if (!leagues.length) {
    console.log('  No leagues found.');
    return;
  }
  for (const l of leagues) {
    const recent = [...l.seasons].sort((a, b) => b.year - a.year).slice(0, 4).map((s) => s.year);
    console.log(`  • [${l.league.id}] ${l.league.name} (${l.country.name}, ${l.league.type}) — seasons: ${recent.join(', ')}`);
  }
  const target = leagues.find(prefer) ?? leagues[0];
  const seasons = [...target.seasons].sort((a, b) => b.year - a.year);
  console.log(`\n  → Probing "${target.league.name}" [${target.league.id}] most recent seasons for player stats:`);
  for (const s of seasons.slice(0, 3)) {
    try {
      const r = await probeSeasonStats(target.league.id, s.year);
      console.log(
        `     season ${s.year}: fixtures=${r.fixtures} finished=${r.finished} samplePlayersInOneFixture=${r.samplePlayers}` +
          (r.samplePlayers > 0 ? '  ✅ has per-player stats' : '  ⚠️ no per-player stats')
      );
    } catch (err) {
      console.log(`     season ${s.year}: probe failed — ${(err as Error).message}`);
    }
  }
}

async function main() {
  await report('Copa America', (e) => /copa\s*am[eé]rica/i.test(e.league.name) && e.league.type === 'Cup');
  await report('Africa Cup of Nations', (e) => /africa/i.test(e.league.name) && e.league.type === 'Cup');
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exitCode = 1;
});
