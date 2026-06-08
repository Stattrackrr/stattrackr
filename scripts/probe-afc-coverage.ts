#!/usr/bin/env npx tsx
/**
 * Probe API-Football coverage for the Asian zone:
 *   - AFC Asian Cup (most recent: 2023, played Jan 2024)
 *   - AFC World Cup Qualifiers (Asian zone)
 *
 * For each candidate league it prints recent seasons and, for the latest few,
 * whether fixtures expose per-player stats AND team fixture statistics (the two
 * things the World Cup dashboard merges).
 *
 *   npx tsx scripts/probe-afc-coverage.ts
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
  seasons: Array<{ year: number }>;
};

async function probeSeason(leagueId: number, season: number) {
  const fixturesRes = await af<any[]>('/fixtures', { league: leagueId, season });
  const fixtures = fixturesRes.response ?? [];
  const finished = fixtures.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short));
  if (!finished.length) return { fixtures: fixtures.length, finished: 0, players: 0, teamStats: 0 };
  const probeId = finished[0].fixture.id;
  const playersRes = await af<any[]>('/fixtures/players', { fixture: probeId });
  const players = (playersRes.response ?? []).reduce((s: number, t: any) => s + (t.players?.length ?? 0), 0);
  const statsRes = await af<any[]>('/fixtures/statistics', { fixture: probeId });
  const teamStats = (statsRes.response ?? []).reduce((s: number, t: any) => s + (t.statistics?.length ?? 0), 0);
  return { fixtures: fixtures.length, finished: finished.length, players, teamStats, probeId };
}

async function report(searchTerm: string, prefer: (e: LeagueEntry) => boolean) {
  console.log(`\n================ Search: "${searchTerm}" ================`);
  const data = await af<LeagueEntry[]>('/leagues', { search: searchTerm });
  const leagues = data.response ?? [];
  if (!leagues.length) {
    console.log('  No leagues found.');
    return;
  }
  for (const l of leagues) {
    const recent = [...l.seasons].sort((a, b) => b.year - a.year).slice(0, 5).map((s) => s.year);
    console.log(`  • [${l.league.id}] ${l.league.name} (${l.country.name}, ${l.league.type}) — seasons: ${recent.join(', ')}`);
  }
  const target = leagues.find(prefer) ?? leagues[0];
  const seasons = [...target.seasons].sort((a, b) => b.year - a.year);
  console.log(`\n  → Probing "${target.league.name}" [${target.league.id}]:`);
  for (const s of seasons.slice(0, 4)) {
    try {
      const r = await probeSeason(target.league.id, s.year);
      const playerFlag = r.players > 0 ? '✅ player stats' : '❌ no player stats';
      const teamFlag = r.teamStats > 0 ? '✅ team stats' : '❌ no team stats';
      console.log(
        `     season ${s.year}: fixtures=${r.fixtures} finished=${r.finished} | ${playerFlag} (${r.players}) | ${teamFlag} (${r.teamStats})`
      );
    } catch (err) {
      console.log(`     season ${s.year}: probe failed — ${(err as Error).message}`);
    }
  }
}

async function probeLeagueId(leagueId: number, label: string) {
  console.log(`\n================ Direct probe: ${label} [${leagueId}] ================`);
  const data = await af<LeagueEntry[]>('/leagues', { id: leagueId });
  const entry = data.response?.[0];
  if (!entry) {
    console.log('  League not found.');
    return;
  }
  const seasons = [...entry.seasons].sort((a, b) => b.year - a.year);
  console.log(`  ${entry.league.name} (${entry.country.name}) — seasons: ${seasons.slice(0, 6).map((s) => s.year).join(', ')}`);
  for (const s of seasons.slice(0, 4)) {
    try {
      const r = await probeSeason(leagueId, s.year);
      const playerFlag = r.players > 0 ? '✅ player stats' : '❌ no player stats';
      const teamFlag = r.teamStats > 0 ? '✅ team stats' : '❌ no team stats';
      console.log(
        `     season ${s.year}: fixtures=${r.fixtures} finished=${r.finished} | ${playerFlag} (${r.players}) | ${teamFlag} (${r.teamStats})`
      );
    } catch (err) {
      console.log(`     season ${s.year}: probe failed — ${(err as Error).message}`);
    }
  }
}

async function probeAustraliaWcqLeagues() {
  // Australia national team id on API-Football.
  const AUSTRALIA_TEAM_ID = 20;
  console.log(`\n================ Australia team leagues (team=${AUSTRALIA_TEAM_ID}) ================`);
  for (const season of [2026, 2024, 2022]) {
    const data = await af<LeagueEntry[]>('/leagues', { team: AUSTRALIA_TEAM_ID, season });
    const wcq = (data.response ?? []).filter((e) => /world cup.*qualif|qualif.*world cup/i.test(e.league.name));
    if (!wcq.length) {
      console.log(`  season ${season}: no WCQ leagues on file for Australia`);
      continue;
    }
    for (const e of wcq) {
      console.log(`  season ${season}: [${e.league.id}] ${e.league.name}`);
    }
  }
}

async function main() {
  await report('Asian Cup', (e) => /asian cup/i.test(e.league.name) && e.league.type === 'Cup');
  await report('World Cup Qualification Asia', (e) => /asia/i.test(e.league.name));
  await report('World Cup Qualification', (e) => /qualification/i.test(e.league.name) && /asia/i.test(e.league.name));

  // Text search often misses WCQ leagues; probe known api-sports ids directly.
  // 29=Africa, 30=Asia, 31=CONCACAF, 32=UEFA, 33=OFC, 34=CONMEBOL (verify names via API).
  for (const id of [29, 30, 31, 32, 33, 34]) {
    await probeLeagueId(id, `league id ${id}`);
  }

  await probeAustraliaWcqLeagues();
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exitCode = 1;
});
