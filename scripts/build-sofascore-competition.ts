#!/usr/bin/env npx tsx
/**
 * Ingest an international competition from SofaScore into Supabase, fetched
 * through a hosted scraper API (no browser). Stores match scorelines, per-player
 * match stats, and team-level match stats so the World Cup dashboard's Game/Team
 * Props chart populates for competitions API-Football can't provide stats for
 * (AFC / CAF / OFC World Cup qualifiers, etc.).
 *
 * Configure in .env.local:
 *   SCRAPER_API_KEY=...           (see lib/sofascoreScraper.ts)
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *
 * Run with a named preset (defaults to the 2022 cycle onward):
 *   npx tsx scripts/build-sofascore-competition.ts --competition=wcq-asia
 *   npx tsx scripts/build-sofascore-competition.ts --competition=wcq-asia --from=2026
 *   npx tsx scripts/build-sofascore-competition.ts --competition=wcq-asia --season=12345 --limit=5 --dry-run
 *
 * …or override everything from the CLI (e.g. straight from the probe output):
 *   npx tsx scripts/build-sofascore-competition.ts --tournament=999 --slug=wcq-asia --name="WCQ Asia" --from=2018
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import {
  SofascoreNotFoundError,
  getSofascoreRequestCount,
  resetSofascoreRequestCount,
  sofascoreFetch,
} from '../lib/sofascoreScraper';

const SOURCE = 'sofascore';
const REQUEST_DELAY_MS = 250;

type CompetitionPreset = {
  /** SofaScore unique-tournament id. Fill from probe-sofascore-tournaments.ts. */
  tournamentId: number;
  /** tournament_slug stored on rows. wcq-* slugs map to the "WCQ" dashboard tag. */
  slug: string;
  name: string;
  /** Optional: restrict to these SofaScore season ids (else all >= --from). */
  seasonIds?: number[];
};

// SofaScore unique-tournament ids (last segment of the tournament URL on sofascore.com).
// Search is unreliable for these — use direct ids. Verified Mar 2026:
//   AFC  …/world-championship-qual-afc/308
//   CAF  …/world-championship-qual-caf/13
//   OFC  …/world-championship-qual-ofc/309
const COMPETITIONS: Record<string, CompetitionPreset> = {
  'wcq-asia': { tournamentId: 308, slug: 'wcq-asia', name: 'World Cup Qualification AFC' },
  'wcq-africa': { tournamentId: 13, slug: 'wcq-africa', name: 'World Cup Qualification CAF' },
  'wcq-oceania': { tournamentId: 309, slug: 'wcq-oceania', name: 'World Cup Qualification OFC' },
};

type SofaEvent = {
  id: number;
  startTimestamp?: number;
  status?: { type?: string };
  homeTeam?: { id: number; name: string; country?: { alpha3?: string } };
  awayTeam?: { id: number; name: string; country?: { alpha3?: string } };
  homeScore?: { current?: number; penalties?: number };
  awayScore?: { current?: number; penalties?: number };
  roundInfo?: { round?: number; name?: string };
};

type SofaSeason = { id: number; year: string; name: string; seasonYear: number };

type SofaPlayerLineup = {
  player: { id: number; name: string; position?: string; country?: { alpha3?: string } };
  teamId?: number;
  position?: string;
  substitute?: boolean;
  statistics?: Record<string, number | string | undefined>;
};

type SofaStatItem = { name: string; home?: string | number; away?: string | number };
type SofaStatGroup = { groupName?: string; statisticsItems?: SofaStatItem[] };
type SofaStatPeriod = { period?: string; groups?: SofaStatGroup[] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function parseSeasonYear(yearStr: string): number {
  // Two-digit ranges: "24/25" (UEFA seasons) and "23-25" (multi-year WCQ cycles).
  // Use the END year so e.g. the 2023-2025 AFC qualifying cycle resolves to 2025
  // (otherwise "23-25" parsed to 23 and was wrongly excluded by --from filters).
  const range = yearStr.match(/(\d{2})\s*[\/-]\s*(\d{2})/);
  if (range) {
    const end = Number.parseInt(range[2], 10);
    return end >= 50 ? 1900 + end : 2000 + end;
  }
  const four = yearStr.match(/(19|20)\d{2}/);
  if (four) return Number.parseInt(four[0], 10);
  return Number.parseInt(yearStr, 10) || 0;
}
function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const cleaned = v.replace('%', '').trim();
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
/** Parse a SofaScore stat value that may be "55%", "12/20 (60%)", "12", or num. */
function parseTeamStatValue(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (!s) return null;
  // "12/20 (60%)" → take the first number (the count).
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*\d+/);
  if (frac) return Number.parseFloat(frac[1]);
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number.parseFloat(pct[1]);
  const plain = s.match(/-?\d+(?:\.\d+)?/);
  return plain ? Number.parseFloat(plain[0]) : null;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadSeasons(tournamentId: number): Promise<SofaSeason[]> {
  const data = await sofascoreFetch<{ seasons: Array<{ id: number; year: string; name: string }> }>(
    `/unique-tournament/${tournamentId}/seasons`
  );
  return (data.seasons ?? []).map((s) => ({ ...s, seasonYear: parseSeasonYear(s.year) }));
}

async function loadAllEvents(tournamentId: number, seasonId: number): Promise<SofaEvent[]> {
  const all: SofaEvent[] = [];
  let pageNum = 0;
  for (;;) {
    const data = await sofascoreFetch<{ events: SofaEvent[]; hasNextPage?: boolean }>(
      `/unique-tournament/${tournamentId}/season/${seasonId}/events/last/${pageNum}`
    ).catch(() => ({ events: [] as SofaEvent[], hasNextPage: false }));
    all.push(...(data.events ?? []));
    if (!data.hasNextPage) break;
    pageNum += 1;
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
}

/** Map SofaScore per-player statistics object to our player_match_stats columns. */
function mapPlayerStats(stats: Record<string, unknown> | undefined) {
  const s = stats ?? {};
  const raw: Record<string, number> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'statisticsType') continue;
    const n = num(v);
    if (n !== 0) raw[k] = n;
  }
  const passesTotal = num(s.totalPass);
  const passesAccurate = num(s.accuratePass);
  const xg = num(s.expectedGoals) || num(s.goalsExpected) || 0;
  return {
    minutes_played: num(s.minutesPlayed),
    goals: num(s.goals),
    assists: num(s.goalAssist),
    shots_total: num(s.totalShots) || num(s.shotsTotal),
    shots_on_target: num(s.onTargetScoringAttempt),
    passes_total: passesTotal,
    passes_accurate: passesAccurate,
    expected_goals: xg > 0 ? xg : null,
    yellow_cards: num(s.yellowCards) || (s.yellowCard ? 1 : 0),
    red_cards: num(s.redCards) || (s.redCard ? 1 : 0),
    tackles: num(s.totalTackle),
    interceptions: num(s.interceptionWon),
    fouls: num(s.fouls),
    was_fouled: num(s.wasFouled),
    saves: num(s.saves) || num(s.goalkeeperSaves),
    big_chances_created: num(s.bigChanceCreated),
    raw_aggregates: raw,
  };
}

/** Map SofaScore /event/{id}/statistics (ALL period) to team_match_stats columns. */
function mapTeamStats(periods: SofaStatPeriod[]): { home: Record<string, number | null>; away: Record<string, number | null> } | null {
  const all = periods.find((p) => p.period === 'ALL') ?? periods[0];
  if (!all?.groups?.length) return null;
  const byName = new Map<string, SofaStatItem>();
  for (const g of all.groups) {
    for (const item of g.statisticsItems ?? []) {
      byName.set(item.name.trim().toLowerCase(), item);
    }
  }
  const pick = (names: string[], side: 'home' | 'away'): number | null => {
    for (const n of names) {
      const item = byName.get(n.toLowerCase());
      if (item) {
        const v = parseTeamStatValue(item[side]);
        if (v != null) return v;
      }
    }
    return null;
  };
  const build = (side: 'home' | 'away'): Record<string, number | null> => ({
    expected_goals: pick(['Expected goals', 'expected_goals'], side),
    shots_total: pick(['Total shots', 'Shots total'], side),
    shots_on_target: pick(['Shots on target'], side),
    shots_off_target: pick(['Shots off target'], side),
    shots_blocked: pick(['Blocked shots'], side),
    shots_inside_box: pick(['Shots inside box'], side),
    shots_outside_box: pick(['Shots outside box'], side),
    hit_woodwork: pick(['Hit woodwork'], side),
    corners: pick(['Corner kicks', 'Corners'], side),
    offsides: pick(['Offsides'], side),
    fouls: pick(['Fouls'], side),
    yellow_cards: pick(['Yellow cards'], side),
    red_cards: pick(['Red cards'], side),
    possession_pct: pick(['Ball possession'], side),
    passes_total: pick(['Passes', 'Total passes'], side),
    passes_accurate: pick(['Accurate passes'], side),
    saves: pick(['Goalkeeper saves', 'Saves'], side),
    big_chances: pick(['Big chances'], side),
    big_chances_missed: pick(['Big chances missed'], side),
    tackles: pick(['Total tackles', 'Tackles'], side),
    interceptions: pick(['Interceptions'], side),
    crosses_total: pick(['Crosses', 'Total crosses'], side),
  });
  return { home: build('home'), away: build('away') };
}

async function ingestSeason(
  supabase: ReturnType<typeof getSupabase> | null,
  preset: CompetitionPreset,
  season: SofaSeason,
  options: { limit: number | null; dryRun: boolean; teamStatsOnly: boolean }
): Promise<{ matches: number; players: number; statRows: number; teamRows: number }> {
  console.log(`\n[sofascore] === ${preset.name} ${season.year} (season_id=${season.id}, year=${season.seasonYear}) ===`);

  if (!options.dryRun && supabase) {
    const { error } = await supabase.from('international_competitions').upsert(
      {
        source: SOURCE,
        competition_id: String(preset.tournamentId),
        competition_name: preset.name,
        season_id: String(season.id),
        season_year: season.seasonYear,
        tournament_slug: preset.slug,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'source,competition_id,season_id' }
    );
    if (error) throw new Error(`competition upsert: ${error.message}`);
  }

  const events = await loadAllEvents(preset.tournamentId, season.id);
  const finished = events.filter((e) => e.status?.type === 'finished');
  const toProcess = options.limit ? finished.slice(0, options.limit) : finished;
  console.log(`[sofascore]   ${finished.length} finished matches (${toProcess.length} to process)`);

  // Teams.
  const teamRows = new Map<string, { name: string; cc: string | null }>();
  for (const e of finished) {
    if (e.homeTeam) teamRows.set(String(e.homeTeam.id), { name: e.homeTeam.name, cc: e.homeTeam.country?.alpha3 ?? null });
    if (e.awayTeam) teamRows.set(String(e.awayTeam.id), { name: e.awayTeam.name, cc: e.awayTeam.country?.alpha3 ?? null });
  }
  if (!options.dryRun && supabase && teamRows.size) {
    const { error } = await supabase.from('international_teams').upsert(
      [...teamRows.entries()].map(([source_team_id, t]) => ({
        source: SOURCE,
        source_team_id,
        team_name: t.name,
        country_code: t.cc,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'source,source_team_id' }
    );
    if (error) throw new Error(`teams upsert: ${error.message}`);
  }

  // Matches (scoreline + penalty shootout).
  const matchUpserts = finished.map((e) => {
    const homePen = e.homeScore?.penalties ?? null;
    const awayPen = e.awayScore?.penalties ?? null;
    return {
      source: SOURCE,
      source_match_id: String(e.id),
      competition_id: String(preset.tournamentId),
      season_id: String(season.id),
      tournament_slug: preset.slug,
      season_year: season.seasonYear,
      match_date: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString().slice(0, 10) : null,
      kickoff_unix: e.startTimestamp ?? null,
      stage: e.roundInfo?.name ?? (e.roundInfo?.round != null ? `Round ${e.roundInfo.round}` : null),
      home_team_source_id: String(e.homeTeam?.id ?? ''),
      away_team_source_id: String(e.awayTeam?.id ?? ''),
      home_team_name: e.homeTeam?.name ?? '',
      away_team_name: e.awayTeam?.name ?? '',
      home_score: e.homeScore?.current ?? null,
      away_score: e.awayScore?.current ?? null,
      home_score_penalty: homePen,
      away_score_penalty: awayPen,
      has_penalty_shootout: homePen != null && awayPen != null && homePen !== awayPen,
      status: 'completed',
      fetched_at: new Date().toISOString(),
    };
  });
  if (!options.dryRun && supabase) {
    for (let i = 0; i < matchUpserts.length; i += 200) {
      const chunk = matchUpserts.slice(i, i + 200);
      const { error } = await supabase.from('international_matches').upsert(chunk, { onConflict: 'source,source_match_id' });
      if (error) throw new Error(`matches upsert: ${error.message}`);
    }
  }

  const playerProfiles = new Map<
    string,
    { source_player_id: string; full_name: string; normalized_name: string; position: string | null; country_code: string | null }
  >();
  let totalStatRows = 0;
  let totalTeamRows = 0;
  let idx = 0;

  for (const event of toProcess) {
    idx += 1;
    const label = `${event.homeTeam?.name ?? '?'} vs ${event.awayTeam?.name ?? '?'}`;
    if (idx % 10 === 0 || idx === toProcess.length) {
      console.log(`[sofascore]   match ${idx}/${toProcess.length}: ${label}`);
    }

    // --- Team-level stats ---
    if (!options.dryRun && supabase) {
      try {
        const statsRes = await sofascoreFetch<{ statistics?: SofaStatPeriod[] }>(`/event/${event.id}/statistics`);
        const mapped = statsRes.statistics?.length ? mapTeamStats(statsRes.statistics) : null;
        if (mapped) {
          const homeId = String(event.homeTeam?.id ?? '');
          const awayId = String(event.awayTeam?.id ?? '');
          const rows = [
            { teamId: homeId, isHome: true, goals: event.homeScore?.current ?? null, stats: mapped.home },
            { teamId: awayId, isHome: false, goals: event.awayScore?.current ?? null, stats: mapped.away },
          ]
            .filter((r) => r.teamId)
            .map((r) => ({
              source: SOURCE,
              source_match_id: String(event.id),
              source_team_id: r.teamId,
              tournament_slug: preset.slug,
              season_year: season.seasonYear,
              is_home: r.isHome,
              goals: r.goals,
              ...r.stats,
              fetched_at: new Date().toISOString(),
            }));
          if (rows.length) {
            const { error } = await supabase
              .from('international_team_match_stats')
              .upsert(rows, { onConflict: 'source,source_match_id,source_team_id' });
            if (error) throw new Error(`team_match_stats upsert: ${error.message}`);
            totalTeamRows += rows.length;
          }
        }
      } catch (err) {
        console.warn(`[sofascore]     team-stats skip ${event.id}: ${(err as Error).message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    // --- Per-player stats (skipped in team-stats-only mode) ---
    if (options.teamStatsOnly) {
      continue;
    }
    let lineups: { home?: { players?: SofaPlayerLineup[] }; away?: { players?: SofaPlayerLineup[] } };
    try {
      lineups = await sofascoreFetch<typeof lineups>(`/event/${event.id}/lineups`);
    } catch (err) {
      if (!(err instanceof SofascoreNotFoundError)) {
        console.warn(`[sofascore]     skip ${event.id} (no lineups): ${(err as Error).message}`);
      }
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const homeId = String(event.homeTeam?.id ?? '');
    const awayId = String(event.awayTeam?.id ?? '');
    const sides: Array<{ players: SofaPlayerLineup[]; isHome: boolean; teamId: string }> = [
      { players: lineups.home?.players ?? [], isHome: true, teamId: homeId },
      { players: lineups.away?.players ?? [], isHome: false, teamId: awayId },
    ];

    const statRows: Array<Record<string, unknown>> = [];
    for (const { players, isHome, teamId } of sides) {
      for (const entry of players) {
        const mapped = mapPlayerStats(entry.statistics as Record<string, unknown> | undefined);
        if (mapped.minutes_played < 1) continue;
        const player = entry.player;
        const pid = String(player.id);
        const position = entry.position ?? player.position ?? null;
        statRows.push({
          source: SOURCE,
          source_match_id: String(event.id),
          source_player_id: pid,
          source_team_id: String(entry.teamId || teamId),
          is_home: isHome,
          position,
          minutes_played: mapped.minutes_played,
          goals: mapped.goals,
          assists: mapped.assists,
          shots_total: mapped.shots_total,
          shots_on_target: mapped.shots_on_target,
          passes_total: mapped.passes_total,
          passes_accurate: mapped.passes_accurate,
          expected_goals: mapped.expected_goals,
          yellow_cards: mapped.yellow_cards,
          red_cards: mapped.red_cards,
          tackles: mapped.tackles,
          interceptions: mapped.interceptions,
          fouls: mapped.fouls,
          was_fouled: mapped.was_fouled,
          saves: mapped.saves,
          big_chances_created: mapped.big_chances_created,
          raw_aggregates: mapped.raw_aggregates,
          fetched_at: new Date().toISOString(),
        });
        if (!playerProfiles.has(pid)) {
          playerProfiles.set(pid, {
            source_player_id: pid,
            full_name: player.name,
            normalized_name: normalizeName(player.name),
            position,
            country_code: player.country?.alpha3 ?? null,
          });
        }
      }
    }

    if (options.dryRun) {
      totalStatRows += statRows.length;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    if (supabase && statRows.length) {
      for (let i = 0; i < statRows.length; i += 200) {
        const chunk = statRows.slice(i, i + 200);
        const { error } = await supabase
          .from('international_player_match_stats')
          .upsert(chunk, { onConflict: 'source,source_match_id,source_player_id' });
        if (error) throw new Error(`player_match_stats upsert: ${error.message}`);
      }
    }
    totalStatRows += statRows.length;
    await sleep(REQUEST_DELAY_MS);
  }

  if (!options.dryRun && supabase && playerProfiles.size) {
    const rows = [...playerProfiles.values()].map((p) => ({
      source: SOURCE,
      source_player_id: p.source_player_id,
      full_name: p.full_name,
      normalized_name: p.normalized_name,
      primary_position: p.position,
      country_code: p.country_code,
      fetched_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase.from('international_players').upsert(chunk, { onConflict: 'source,source_player_id' });
      if (error) throw new Error(`players upsert: ${error.message}`);
    }
  }

  console.log(
    `[sofascore]   ${preset.name} ${season.year}: ${matchUpserts.length} matches, ${playerProfiles.size} players, ${totalStatRows} player-stat rows, ${totalTeamRows} team-stat rows`
  );
  return { matches: matchUpserts.length, players: playerProfiles.size, statRows: totalStatRows, teamRows: totalTeamRows };
}

function resolvePreset(): CompetitionPreset {
  const tournamentArg = getArg('tournament');
  const slugArg = getArg('slug');
  const nameArg = getArg('name');
  const compArg = getArg('competition');

  if (tournamentArg) {
    const id = Number.parseInt(tournamentArg, 10);
    if (!Number.isFinite(id) || id <= 0) throw new Error(`invalid --tournament=${tournamentArg}`);
    const base = compArg && COMPETITIONS[compArg] ? COMPETITIONS[compArg] : null;
    return {
      tournamentId: id,
      slug: slugArg ?? base?.slug ?? `sofa-${id}`,
      name: nameArg ?? base?.name ?? `SofaScore tournament ${id}`,
    };
  }

  if (!compArg) {
    throw new Error(
      `--competition or --tournament is required. Presets: ${Object.keys(COMPETITIONS).join(', ')}`
    );
  }
  const preset = COMPETITIONS[compArg];
  if (!preset) throw new Error(`Unknown --competition "${compArg}". Presets: ${Object.keys(COMPETITIONS).join(', ')}`);
  if (!preset.tournamentId) {
    throw new Error(
      `Preset "${compArg}" has no tournamentId yet. Run scripts/probe-sofascore-tournaments.ts, then fill it in or pass --tournament=<id>.`
    );
  }
  return preset;
}

async function main() {
  if (!process.env.SCRAPER_API_KEY) {
    throw new Error('SCRAPER_API_KEY missing from .env.local — see lib/sofascoreScraper.ts');
  }
  const preset = resolvePreset();
  // Default to the 2022 cycle onward (2018 editions are not needed).
  const fromYear = Number.parseInt(getArg('from') ?? '2022', 10);
  const seasonIdArg = getArg('season');
  const limitRaw = getArg('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const dryRun = hasFlag('dry-run');
  const teamStatsOnly = hasFlag('team-stats-only');

  const supabase = dryRun ? null : getSupabase();
  resetSofascoreRequestCount();

  console.log(`[sofascore] ingest ${preset.name} (tournament=${preset.tournamentId}, slug=${preset.slug})`);
  if (dryRun) console.log('[sofascore] DRY RUN — no Supabase writes');
  if (teamStatsOnly) console.log('[sofascore] TEAM-STATS-ONLY — skipping per-player lineups');
  if (limit) console.log(`[sofascore] limit=${limit} matches per season`);

  let seasons = await loadSeasons(preset.tournamentId);
  if (seasonIdArg) {
    seasons = seasons.filter((s) => String(s.id) === seasonIdArg);
    if (!seasons.length) throw new Error(`No season with id ${seasonIdArg} for tournament ${preset.tournamentId}`);
  } else {
    seasons = seasons.filter((s) => s.seasonYear >= fromYear);
  }
  if (preset.seasonIds?.length) {
    seasons = seasons.filter((s) => preset.seasonIds!.includes(s.id));
  }
  console.log(`[sofascore] seasons: ${seasons.map((s) => `${s.year}(${s.id})`).join(', ') || 'none'}`);

  let totals = { matches: 0, players: 0, statRows: 0, teamRows: 0 };
  for (const season of seasons) {
    const r = await ingestSeason(supabase, preset, season, { limit, dryRun, teamStatsOnly });
    totals = {
      matches: totals.matches + r.matches,
      players: totals.players + r.players,
      statRows: totals.statRows + r.statRows,
      teamRows: totals.teamRows + r.teamRows,
    };
  }

  const requests = getSofascoreRequestCount();
  console.log(
    `\n[sofascore] DONE ${preset.name}. matches=${totals.matches} players=${totals.players} player_stats=${totals.statRows} team_stats=${totals.teamRows}${dryRun ? ' (dry run)' : ''}`
  );
  console.log(
    `[sofascore] scraper requests this run: ${requests} (≈ ${requests * 10} credits at 10/req premium proxy)`
  );
}

main().catch((err) => {
  console.error('[sofascore] failed:', err);
  process.exitCode = 1;
});
