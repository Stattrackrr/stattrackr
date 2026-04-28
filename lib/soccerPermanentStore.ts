import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  normalizeSoccerTeamHref,
  type SoccerNextFixtureCachePayload,
  type SoccerPredictedLineupCachePayload,
  type SoccerTeamResultsCachePayload,
} from '@/lib/soccerCache';
import type { SoccerwayMatchStats, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

type TeamResultsMetaRow = {
  team_href: string;
  results_url: string;
  show_more_pages_fetched: number | null;
  match_count: number | null;
  history_probe_complete: boolean | null;
  competition_metadata_version: number | null;
  source: string | null;
  generated_at: string | null;
};

type TeamMatchIndexRow = {
  match_id: string;
  kickoff_unix: number | null;
};

type MatchRow = {
  match_id: string;
  summary_path: string;
  home_team: string;
  away_team: string;
  home_logo_url: string | null;
  away_logo_url: string | null;
  competition_name: string | null;
  competition_country: string | null;
  home_score: number;
  away_score: number;
  kickoff_unix: number | null;
};

type MatchStatsRow = {
  match_id: string;
  stats: SoccerwayMatchStats | null;
};

type NextFixtureRow = {
  team_href: string;
  fixtures_url: string;
  match_id: string | null;
  home_team: string | null;
  away_team: string | null;
  opponent_name: string | null;
  is_home: boolean | null;
  team_logo_url: string | null;
  opponent_logo_url: string | null;
  kickoff_unix: number | null;
  summary_path: string | null;
  competition_name: string | null;
  competition_country: string | null;
  competition_stage: string | null;
  match_count: number | null;
  source: string | null;
  generated_at: string | null;
};

type PredictedLineupRow = {
  team_href: string;
  summary_path: string | null;
  lineups_path: string | null;
  event_id: string | null;
  lineup: SoccerPredictedLineupCachePayload['lineup'];
  source: string | null;
  generated_at: string | null;
};

const PERMANENT_SOCCER_WARNINGS = new Set<string>();

function warnPermanentSoccerStore(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${context}:${message}`;
  if (PERMANENT_SOCCER_WARNINGS.has(key)) return;
  PERMANENT_SOCCER_WARNINGS.add(key);
  console.warn(`[Soccer Permanent Store] ${context}:`, error);
}

function parseIsoStringOrNow(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  if (parsed && Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return new Date().toISOString();
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sortRecentMatches(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

function toRecentMatch(row: MatchRow, stats: SoccerwayMatchStats | null): SoccerwayRecentMatch {
  return {
    matchId: row.match_id,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeLogoUrl: row.home_logo_url,
    awayLogoUrl: row.away_logo_url,
    competitionName: row.competition_name,
    competitionCountry: row.competition_country,
    homeScore: row.home_score,
    awayScore: row.away_score,
    kickoffUnix: row.kickoff_unix,
    summaryPath: row.summary_path,
    stats,
  };
}

function pruneStoredMatchStats(stats: SoccerwayMatchStats | null | undefined): SoccerwayMatchStats | null {
  if (!stats) return null;
  const matchPeriod =
    stats.periods.find((period) => String(period.name || '').trim().toLowerCase() === 'match') ?? stats.periods[0] ?? null;
  if (!matchPeriod) return null;
  return {
    feedUrl: stats.feedUrl,
    raw: '',
    periods: [
      {
        name: matchPeriod.name,
        categories: matchPeriod.categories.map((category) => ({
          name: category.name,
          stats: category.stats.map((stat) => ({
            id: stat.id,
            name: stat.name,
            homeValue: stat.homeValue,
            awayValue: stat.awayValue,
            fields: {},
          })),
        })),
      },
    ],
  };
}

async function readMatchesByIds(matchIds: string[]): Promise<Map<string, MatchRow>> {
  const out = new Map<string, MatchRow>();
  for (const ids of chunkArray(matchIds, 500)) {
    const { data, error } = await supabaseAdmin
      .from('soccer_matches')
      .select(
        'match_id, summary_path, home_team, away_team, home_logo_url, away_logo_url, competition_name, competition_country, home_score, away_score, kickoff_unix'
      )
      .in('match_id', ids);

    if (error) throw error;
    for (const row of (data ?? []) as MatchRow[]) out.set(row.match_id, row);
  }
  return out;
}

async function readMatchStatsByIds(matchIds: string[]): Promise<Map<string, SoccerwayMatchStats | null>> {
  const out = new Map<string, SoccerwayMatchStats | null>();
  for (const ids of chunkArray(matchIds, 500)) {
    const { data, error } = await supabaseAdmin
      .from('soccer_match_stats')
      .select('match_id, stats')
      .in('match_id', ids);

    if (error) throw error;
    for (const row of (data ?? []) as MatchStatsRow[]) out.set(row.match_id, row.stats ?? null);
  }
  return out;
}

async function readTeamMatchIndex(teamHref: string, limitMatches?: number): Promise<TeamMatchIndexRow[]> {
  const rows: TeamMatchIndexRow[] = [];
  const pageSize = 1000;
  let offset = 0;
  const targetLimit = Number.isFinite(limitMatches as number) && (limitMatches as number) > 0 ? Math.floor(limitMatches as number) : null;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('soccer_team_matches')
      .select('match_id, kickoff_unix')
      .eq('team_href', teamHref)
      .order('kickoff_unix', { ascending: false, nullsFirst: false })
      .order('match_id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as TeamMatchIndexRow[];
    if (page.length === 0) break;
    rows.push(...page);
    if (targetLimit && rows.length >= targetLimit) break;
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return targetLimit ? rows.slice(0, targetLimit) : rows;
}

export async function getPermanentSoccerTeamResults(
  teamHref: string,
  options: { limitMatches?: number } = {}
): Promise<SoccerTeamResultsCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;

  try {
    const { data: meta, error: metaError } = await supabaseAdmin
      .from('soccer_team_results_meta')
      .select(
        'team_href, results_url, show_more_pages_fetched, match_count, history_probe_complete, competition_metadata_version, source, generated_at'
      )
      .eq('team_href', normalized)
      .maybeSingle();

    if (metaError || !meta) {
      if (metaError) warnPermanentSoccerStore(`Failed to read team results meta for ${normalized}`, metaError);
      return null;
    }

    const orderedIndexRows = (await readTeamMatchIndex(normalized, options.limitMatches))
      .filter((row) => typeof row.match_id === 'string' && row.match_id.trim() !== '')
      .sort((a, b) => {
        const aKickoff = a.kickoff_unix ?? Number.MIN_SAFE_INTEGER;
        const bKickoff = b.kickoff_unix ?? Number.MIN_SAFE_INTEGER;
        if (aKickoff !== bKickoff) return bKickoff - aKickoff;
        return String(b.match_id || '').localeCompare(String(a.match_id || ''));
      });

    if (orderedIndexRows.length === 0) return null;

    const matchIds = orderedIndexRows.map((row) => row.match_id);
    const [matchesById, statsById] = await Promise.all([readMatchesByIds(matchIds), readMatchStatsByIds(matchIds)]);

    const matches = sortRecentMatches(
      orderedIndexRows
        .map((row) => {
          const match = matchesById.get(row.match_id);
          if (!match) return null;
          return toRecentMatch(match, statsById.get(row.match_id) ?? null);
        })
        .filter((match): match is SoccerwayRecentMatch => match != null)
    );

    if (matches.length === 0) return null;

    return {
      teamHref: normalized,
      resultsUrl: meta.results_url,
      matches,
      count: meta.match_count ?? matches.length,
      showMorePagesFetched: meta.show_more_pages_fetched ?? 0,
      historyProbeComplete: meta.history_probe_complete ?? true,
      competitionMetadataVersion: meta.competition_metadata_version ?? 2,
      source: (meta.source as 'soccerway' | null) ?? 'soccerway',
      generatedAt: parseIsoStringOrNow(meta.generated_at),
    };
  } catch (error) {
    warnPermanentSoccerStore(`Failed to read permanent team results for ${normalized}`, error);
    return null;
  }
}

export async function persistPermanentSoccerTeamResults(
  teamHref: string,
  payload: SoccerTeamResultsCachePayload
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized || !Array.isArray(payload?.matches) || payload.matches.length === 0) return false;

  try {
    const generatedAt = parseIsoStringOrNow(payload.generatedAt);
    const matchRows = payload.matches.map((match) => ({
      match_id: match.matchId,
      summary_path: match.summaryPath,
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      home_logo_url: match.homeLogoUrl ?? null,
      away_logo_url: match.awayLogoUrl ?? null,
      competition_name: match.competitionName ?? null,
      competition_country: match.competitionCountry ?? null,
      home_score: match.homeScore,
      away_score: match.awayScore,
      kickoff_unix: match.kickoffUnix ?? null,
      source: payload.source,
      fetched_at: generatedAt,
    }));

    const { error: matchesError } = await supabaseAdmin
      .from('soccer_matches')
      .upsert(matchRows, { onConflict: 'match_id' });

    if (matchesError) throw matchesError;

    const statsRows = payload.matches
      .filter((match) => Object.prototype.hasOwnProperty.call(match, 'stats'))
      .map((match) => ({
        match_id: match.matchId,
        stats: pruneStoredMatchStats(match.stats),
        source: payload.source,
        generated_at: generatedAt,
      }));

    if (statsRows.length > 0) {
      const { error: statsError } = await supabaseAdmin
        .from('soccer_match_stats')
        .upsert(statsRows, { onConflict: 'match_id' });

      if (statsError) throw statsError;
    }

    const nextMatchIds = new Set(payload.matches.map((match) => match.matchId));
    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('soccer_team_matches')
      .select('match_id')
      .eq('team_href', normalized);

    if (existingError) throw existingError;

    const staleIds = ((existingRows ?? []) as Array<{ match_id: string }>)
      .map((row) => row.match_id)
      .filter((matchId) => !nextMatchIds.has(matchId));

    if (staleIds.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('soccer_team_matches')
        .delete()
        .eq('team_href', normalized)
        .in('match_id', staleIds);

      if (deleteError) throw deleteError;
    }

    const teamMatchRows = payload.matches.map((match) => ({
      team_href: normalized,
      match_id: match.matchId,
      kickoff_unix: match.kickoffUnix ?? null,
      summary_path: match.summaryPath,
      source: payload.source,
      generated_at: generatedAt,
    }));

    const { error: teamMatchesError } = await supabaseAdmin
      .from('soccer_team_matches')
      .upsert(teamMatchRows, { onConflict: 'team_href,match_id' });

    if (teamMatchesError) throw teamMatchesError;

    const { error: metaError } = await supabaseAdmin
      .from('soccer_team_results_meta')
      .upsert(
        {
          team_href: normalized,
          results_url: payload.resultsUrl,
          show_more_pages_fetched: payload.showMorePagesFetched,
          match_count: payload.count,
          history_probe_complete: payload.historyProbeComplete ?? true,
          competition_metadata_version: payload.competitionMetadataVersion ?? null,
          source: payload.source,
          generated_at: generatedAt,
        },
        { onConflict: 'team_href' }
      );

    if (metaError) throw metaError;

    return true;
  } catch (error) {
    warnPermanentSoccerStore(`Failed to persist permanent team results for ${normalized}`, error);
    return false;
  }
}

export async function getPermanentSoccerNextFixture(teamHref: string): Promise<SoccerNextFixtureCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from('soccer_team_next_fixtures')
      .select(
        'team_href, fixtures_url, match_id, home_team, away_team, opponent_name, is_home, team_logo_url, opponent_logo_url, kickoff_unix, summary_path, competition_name, competition_country, competition_stage, match_count, source, generated_at'
      )
      .eq('team_href', normalized)
      .maybeSingle();

    if (error || !data) {
      if (error) warnPermanentSoccerStore(`Failed to read permanent next fixture for ${normalized}`, error);
      return null;
    }

    const row = data as NextFixtureRow;
    return {
      teamHref: normalized,
      fixturesUrl: row.fixtures_url,
      fixture: row.match_id
        ? {
            matchId: row.match_id,
            homeTeam: row.home_team ?? '',
            awayTeam: row.away_team ?? '',
            opponentName: row.opponent_name ?? '',
            isHome: row.is_home,
            teamLogoUrl: row.team_logo_url,
            opponentLogoUrl: row.opponent_logo_url,
            kickoffUnix: row.kickoff_unix,
            summaryPath: row.summary_path ?? '',
            competitionName: row.competition_name,
            competitionCountry: row.competition_country,
            competitionStage: row.competition_stage,
          }
        : null,
      count: row.match_count ?? 0,
      source: (row.source as 'soccerway' | null) ?? 'soccerway',
      generatedAt: parseIsoStringOrNow(row.generated_at),
    };
  } catch (error) {
    warnPermanentSoccerStore(`Failed to read permanent next fixture for ${normalized}`, error);
    return null;
  }
}

export async function persistPermanentSoccerNextFixture(
  teamHref: string,
  payload: SoccerNextFixtureCachePayload
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return false;

  try {
    const generatedAt = parseIsoStringOrNow(payload.generatedAt);
    const fixture = payload.fixture;
    const { error } = await supabaseAdmin.from('soccer_team_next_fixtures').upsert(
      {
        team_href: normalized,
        fixtures_url: payload.fixturesUrl,
        match_id: fixture?.matchId ?? null,
        home_team: fixture?.homeTeam ?? null,
        away_team: fixture?.awayTeam ?? null,
        opponent_name: fixture?.opponentName ?? null,
        is_home: fixture?.isHome ?? null,
        team_logo_url: fixture?.teamLogoUrl ?? null,
        opponent_logo_url: fixture?.opponentLogoUrl ?? null,
        kickoff_unix: fixture?.kickoffUnix ?? null,
        summary_path: fixture?.summaryPath ?? null,
        competition_name: fixture?.competitionName ?? null,
        competition_country: fixture?.competitionCountry ?? null,
        competition_stage: fixture?.competitionStage ?? null,
        match_count: payload.count,
        source: payload.source,
        generated_at: generatedAt,
      },
      { onConflict: 'team_href' }
    );

    if (error) throw error;
    return true;
  } catch (error) {
    warnPermanentSoccerStore(`Failed to persist permanent next fixture for ${normalized}`, error);
    return false;
  }
}

export async function getPermanentSoccerPredictedLineup(
  teamHref: string
): Promise<SoccerPredictedLineupCachePayload | null> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from('soccer_team_predicted_lineups')
      .select('team_href, summary_path, lineups_path, event_id, lineup, source, generated_at')
      .eq('team_href', normalized)
      .maybeSingle();

    if (error || !data) {
      if (error) warnPermanentSoccerStore(`Failed to read permanent lineup for ${normalized}`, error);
      return null;
    }

    const row = data as PredictedLineupRow;
    return {
      teamHref: normalized,
      summaryPath: row.summary_path,
      lineupsPath: row.lineups_path,
      eventId: row.event_id,
      lineup: row.lineup ?? null,
      source: (row.source as 'soccerway' | null) ?? 'soccerway',
      generatedAt: parseIsoStringOrNow(row.generated_at),
    };
  } catch (error) {
    warnPermanentSoccerStore(`Failed to read permanent lineup for ${normalized}`, error);
    return null;
  }
}

export async function persistPermanentSoccerPredictedLineup(
  teamHref: string,
  payload: SoccerPredictedLineupCachePayload
): Promise<boolean> {
  const normalized = normalizeSoccerTeamHref(teamHref);
  if (!normalized) return false;

  try {
    const generatedAt = parseIsoStringOrNow(payload.generatedAt);
    const { error } = await supabaseAdmin.from('soccer_team_predicted_lineups').upsert(
      {
        team_href: normalized,
        summary_path: payload.summaryPath,
        lineups_path: payload.lineupsPath,
        event_id: payload.eventId,
        lineup: payload.lineup,
        source: payload.source,
        generated_at: generatedAt,
      },
      { onConflict: 'team_href' }
    );

    if (error) throw error;
    return true;
  } catch (error) {
    warnPermanentSoccerStore(`Failed to persist permanent lineup for ${normalized}`, error);
    return false;
  }
}
