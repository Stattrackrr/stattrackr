/**
 * Probe API-Football coverage for the major CLUB leagues we might ingest for
 * World Cup player/team club form. For each league it resolves the league id
 * (by name + country), reads API-Football's per-season `coverage` flags, and
 * verifies against a real recent fixture that per-player AND team fixture
 * statistics are actually returned (the two things the dashboard merges).
 *
 *   npx tsx scripts/probe-club-league-coverage.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const BASE = 'https://v3.football.api-sports.io';

type ApiResponse<T> = { response: T; errors?: unknown };

let _req = 0;
async function af<T>(path: string, params: Record<string, string | number>): Promise<ApiResponse<T>> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY missing from .env.local');
  // Gentle pacing to avoid 429s on the free/dev plan.
  if (_req > 0 && _req % 9 === 0) await new Promise((r) => setTimeout(r, 1100));
  _req += 1;
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { 'x-apisports-key': key, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}`);
  return (await res.json()) as ApiResponse<T>;
}

// The club leagues to check, by display name + country (country disambiguates
// same-named leagues). `hint` is the commonly-known API-Football league id used
// as a fallback / sanity check if the name search is ambiguous.
const LEAGUES: Array<{ label: string; name: string; country: string; hint?: number }> = [
  { label: 'English Premier League', name: 'Premier League', country: 'England', hint: 39 },
  { label: 'La Liga', name: 'La Liga', country: 'Spain', hint: 140 },
  { label: 'Serie A', name: 'Serie A', country: 'Italy', hint: 135 },
  { label: 'Bundesliga', name: 'Bundesliga', country: 'Germany', hint: 78 },
  { label: 'Brasileirão', name: 'Serie A', country: 'Brazil', hint: 71 },
  { label: 'Ligue 1', name: 'Ligue 1', country: 'France', hint: 61 },
  { label: 'Liga Portugal', name: 'Primeira Liga', country: 'Portugal', hint: 94 },
  { label: 'Eredivisie', name: 'Eredivisie', country: 'Netherlands', hint: 88 },
  { label: 'Major League Soccer', name: 'Major League Soccer', country: 'USA', hint: 253 },
  { label: 'Belgian Pro League', name: 'Jupiler Pro League', country: 'Belgium', hint: 144 },
  { label: 'Saudi Pro League', name: 'Pro League', country: 'Saudi-Arabia', hint: 307 },
  { label: 'Argentine Primera División', name: 'Liga Profesional Argentina', country: 'Argentina', hint: 128 },
  { label: 'Liga MX', name: 'Liga MX', country: 'Mexico', hint: 262 },
  { label: 'Turkish Süper Lig', name: 'Super Lig', country: 'Turkey', hint: 203 },
  { label: 'J1 League', name: 'J1 League', country: 'Japan', hint: 98 },
];

type SeasonCoverage = {
  year: number;
  current?: boolean;
  coverage?: {
    fixtures?: {
      statistics_fixtures?: boolean;
      statistics_players?: boolean;
      lineups?: boolean;
      events?: boolean;
    };
    players?: boolean;
  };
};

type LeagueEntry = {
  league: { id: number; name: string; type: string };
  country: { name: string };
  seasons: SeasonCoverage[];
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function resolveLeague(spec: (typeof LEAGUES)[number]): Promise<LeagueEntry | null> {
  // Prefer the known id (exact), fall back to name search filtered by country.
  if (spec.hint) {
    try {
      const byId = await af<LeagueEntry[]>('/leagues', { id: spec.hint });
      if (byId.response?.[0]) return byId.response[0];
    } catch {
      /* fall through to search */
    }
  }
  const data = await af<LeagueEntry[]>('/leagues', { search: spec.name });
  const entries = data.response ?? [];
  const wantCountry = norm(spec.country.replace(/-/g, ' '));
  const match =
    entries.find((e) => norm(e.country?.name ?? '') === wantCountry && e.league?.type === 'League') ??
    entries.find((e) => norm(e.country?.name ?? '') === wantCountry) ??
    entries[0];
  return match ?? null;
}

async function probeSeasonStats(leagueId: number, season: number) {
  const fx = await af<any[]>('/fixtures', { league: leagueId, season });
  const fixtures = fx.response ?? [];
  const finished = fixtures.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short));
  if (!finished.length) return { fixtures: fixtures.length, finished: 0, players: 0, teamStats: 0, teamXg: false };
  // Probe the most recent finished fixture.
  const pid = finished[finished.length - 1].fixture.id;
  const pl = await af<any[]>('/fixtures/players', { fixture: pid });
  const players = (pl.response ?? []).reduce((s: number, t: any) => s + (t.players?.length ?? 0), 0);
  const st = await af<any[]>('/fixtures/statistics', { fixture: pid });
  const teamBlocks = st.response ?? [];
  const teamStats = teamBlocks.reduce((s: number, t: any) => s + (t.statistics?.length ?? 0), 0);
  const teamXg = teamBlocks.some((t: any) =>
    (t.statistics ?? []).some(
      (x: any) => String(x.type).toLowerCase() === 'expected_goals' && x.value != null
    )
  );
  return { fixtures: fixtures.length, finished: finished.length, players, teamStats, teamXg };
}

async function main() {
  console.log('Probing API-Football club-league coverage (player + team fixture stats)\n');
  const summary: string[] = [];

  for (const spec of LEAGUES) {
    console.log(`\n================ ${spec.label} (${spec.country}) ================`);
    let entry: LeagueEntry | null = null;
    try {
      entry = await resolveLeague(spec);
    } catch (err) {
      console.log(`  league lookup failed — ${(err as Error).message}`);
      summary.push(`${spec.label.padEnd(28)} ❓ lookup failed`);
      continue;
    }
    if (!entry) {
      console.log('  league not found.');
      summary.push(`${spec.label.padEnd(28)} ❓ not found`);
      continue;
    }
    const leagueId = entry.league.id;
    console.log(`  resolved: id=${leagueId} "${entry.league.name}" (${entry.country?.name})`);

    // Pick the current season (or latest) plus the prior season.
    const seasons = [...(entry.seasons ?? [])].sort((a, b) => b.year - a.year);
    const current = seasons.find((s) => s.current) ?? seasons[0];
    const probeSeasons = [current, seasons.find((s) => s.year === (current?.year ?? 0) - 1)].filter(
      (s): s is SeasonCoverage => Boolean(s)
    );

    let bestFlag = '❌ no usable stats';
    for (const s of probeSeasons) {
      const cov = s.coverage?.fixtures;
      const covFlags = `cov[stats_fix=${cov?.statistics_fixtures ? 'Y' : 'n'} stats_players=${
        cov?.statistics_players ? 'Y' : 'n'
      } players=${s.coverage?.players ? 'Y' : 'n'}]`;
      try {
        const r = await probeSeasonStats(leagueId, s.year);
        const ok = r.players > 0 && r.teamStats > 0;
        const flag = r.finished === 0 ? '· not played yet' : ok ? '✅ player+team stats' : '❌ no usable stats';
        if (ok) bestFlag = `✅ player+team${r.teamXg ? ' +xG(team)' : ''}`;
        console.log(
          `   season ${s.year}${s.current ? ' (current)' : ''}: finished=${String(r.finished).padStart(
            3
          )} | ${flag} (players:${r.players} teamStatTypes:${r.teamStats}${r.teamXg ? ' xG:team' : ''}) ${covFlags}`
        );
      } catch (err) {
        console.log(`   season ${s.year}: probe failed — ${(err as Error).message} ${covFlags}`);
      }
    }
    summary.push(`${spec.label.padEnd(28)} id=${String(leagueId).padStart(4)}  ${bestFlag}`);
  }

  console.log('\n\n==================== SUMMARY ====================');
  for (const line of summary) console.log('  ' + line);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
