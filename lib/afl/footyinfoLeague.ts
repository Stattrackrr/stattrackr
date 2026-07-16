/**
 * FootyInfo league-level helpers: ladder, injuries, season player averages for warm roster.
 */

import { fetchFootyinfoJson } from '@/lib/afl/footyinfoHttp';
import {
  footyinfoAbbrevToOfficial,
  footyinfoNameToOfficial,
} from '@/lib/afl/footyinfoTeamMapping';
import {
  fetchFootyinfoPlayerProfile,
  resolveFootyinfoSeasonId,
} from '@/lib/afl/footyinfoPlayer';

export type FootyinfoLadderTeam = {
  tid: number;
  ta: string;
  tm: string;
  p: string;
  w: string;
  l: string;
  d: string;
  f: string;
  a: string;
  pct: string;
  pts: string;
};

export async function fetchFootyinfoLadder(seasonYear?: number): Promise<{
  seasonYear: number;
  seasonId: number;
  teams: FootyinfoLadderTeam[];
} | null> {
  let path = '/ladder';
  if (seasonYear) {
    const sid = await resolveFootyinfoSeasonId(seasonYear);
    if (sid) path = `/ladder?season_id=${sid}`;
  }
  const res = await fetchFootyinfoJson<{
    season?: { id: number; name: string };
    teams?: FootyinfoLadderTeam[];
  }>(path);
  if (!res.ok || !res.data.teams) return null;
  const year = Number.parseInt(String(res.data.season?.name || seasonYear || ''), 10);
  return {
    seasonYear: Number.isFinite(year) ? year : seasonYear || new Date().getFullYear(),
    seasonId: res.data.season?.id || 0,
    teams: res.data.teams,
  };
}

export type FootyinfoInjury = {
  id: number;
  playerName: string;
  playerSlug: string | null;
  teamOfficial: string;
  status: string;
  detail: string;
  estimatedReturn: string | null;
  firstReportedAt: string | null;
};

export async function fetchFootyinfoInjuries(): Promise<FootyinfoInjury[]> {
  const res = await fetchFootyinfoJson<
    Array<{
      id: number;
      player?: { known_as?: string; knownAs?: string; slug?: string };
      team?: { name?: string; abbrev?: string };
      status?: string;
      injury?: string;
      detail?: string;
      injury_type_label?: string;
      description?: string;
      estimated_return?: string | null;
      estimatedReturn?: string | null;
      first_reported_at?: string | null;
    }>
  >('/injuries');
  if (!res.ok || !Array.isArray(res.data)) return [];
  const injuries = res.data.map((row) => {
    const teamOfficial =
      footyinfoNameToOfficial(row.team?.name) ||
      footyinfoAbbrevToOfficial(row.team?.abbrev) ||
      row.team?.name ||
      '';
    return {
      id: row.id,
      playerName: row.player?.known_as || row.player?.knownAs || '',
      playerSlug: row.player?.slug || null,
      teamOfficial,
      status: row.status || '',
      detail: row.injury || row.detail || row.injury_type_label || row.description || '',
      estimatedReturn: row.estimated_return ?? row.estimatedReturn ?? null,
      firstReportedAt: row.first_reported_at ?? null,
    };
  });
  // FootyInfo may retain multiple active reports for one player. Publish only
  // the newest report so consumers receive one current injury per player/team.
  return [...injuries.reduce((latest, injury) => {
    const key = `${injury.teamOfficial.toLowerCase()}|${injury.playerSlug || injury.playerName.toLowerCase()}`;
    const existing = latest.get(key);
    if (
      !existing ||
      Date.parse(injury.firstReportedAt || '') > Date.parse(existing.firstReportedAt || '') ||
      (!Number.isFinite(Date.parse(existing.firstReportedAt || '')) && injury.id > existing.id)
    ) {
      latest.set(key, injury);
    }
    return latest;
  }, new Map<string, FootyinfoInjury>()).values()];
}

export type LeaguePlayerStatsRow = {
  name: string;
  team: string;
  games: number;
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  goals: number;
  tackles: number;
  clearances: number;
  meters_gained: number;
  contested_possessions: number;
  uncontested_possessions: number;
  slug?: string;
};

/**
 * Build league player season averages from FootyInfo game_logs_summary for a list of player slugs.
 * For weekly refresh, prefer iterating known roster slugs / search seed.
 */
export async function fetchFootyinfoPlayerSeasonAverages(
  slug: string,
  seasonYear: number
): Promise<LeaguePlayerStatsRow | null> {
  const seasonId = await resolveFootyinfoSeasonId(seasonYear);
  if (!seasonId) return null;
  const profile = await fetchFootyinfoPlayerProfile(slug);
  const res = await fetchFootyinfoJson<{
    leagues?: Array<{
      competition_type_id?: number;
      game_logs_summary?: {
        rows?: Array<Record<string, { value?: unknown }>>;
      };
    }>;
  }>(`/player/${encodeURIComponent(slug)}/game_logs_summary?mode=averages&columns=all`);
  if (!res.ok) return null;
  const afl = (res.data.leagues || []).find((l) => l.competition_type_id === 1) || res.data.leagues?.[0];
  const rows = afl?.game_logs_summary?.rows || [];
  const yearRow = rows.find((r) => String(r.season?.value) === String(seasonYear));
  if (!yearRow) return null;
  const teamAbbrev = String(yearRow.team_abbrev?.value || '');
  const team =
    footyinfoAbbrevToOfficial(teamAbbrev) ||
    footyinfoNameToOfficial(teamAbbrev) ||
    teamAbbrev;
  const n = (k: string) => {
    const v = yearRow[k]?.value;
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    name: profile?.knownAs || slug,
    team: team.replace(/ Crows| Lions| Blues| Magpies| Bombers| Dockers| Cats| Suns| Giants| Hawks| Demons| Kangaroos| Power| Tigers| Saints| Swans| Eagles| Bulldogs/g, '').trim() || team,
    games: n('games'),
    disposals: n('disposals'),
    kicks: n('kicks'),
    handballs: n('handballs'),
    marks: n('marks'),
    goals: n('goals'),
    tackles: n('tackles'),
    clearances: n('clearances'),
    meters_gained: n('metres_gained'),
    contested_possessions: n('contested_poss'),
    uncontested_possessions: n('uncontested_poss'),
    slug,
  };
}

/** Seed player list from existing league JSON names, or trending search — for warm roster rebuild. */
export async function searchFootyinfoPlayers(
  query: string
): Promise<Array<{ name: string; slug: string }>> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const res = await fetchFootyinfoJson<{
    results?: Array<{ type?: string; title?: string; slug?: string }>;
  }>(`/search?q=${q}`);
  if (!res.ok) return [];
  return (res.data.results || [])
    .filter((r) => r.type === 'player' && r.slug && r.title)
    .map((r) => ({ name: String(r.title), slug: String(r.slug) }));
}

export type FootyinfoRoundMatch = {
  id: number;
  home_team: string;
  away_team: string;
  home_team_full?: string;
  away_team_full?: string;
  match_date?: string;
  match_time?: string;
  round_name?: string;
  round_name_abbrev?: string;
  slug?: string;
};

/** Current FootyInfo round, used for published lineups and match links. */
export async function fetchFootyinfoRoundSummary(
  seasonYear?: number,
  competitionId?: number
): Promise<FootyinfoRoundMatch[]> {
  // FootyInfo's current-premiership feed is keyed by competition ID. Supplying
  // season_id alone can select the current preseason competition instead.
  const seasonId = seasonYear ? await resolveFootyinfoSeasonId(seasonYear) : null;
  const params = new URLSearchParams();
  if (competitionId) params.set('competition_id', String(competitionId));
  else if (seasonId) params.set('season_id', String(seasonId));
  const path = `/round_summary${params.size ? `?${params}` : ''}`;
  const res = await fetchFootyinfoJson<{ matches?: FootyinfoRoundMatch[] }>(path);
  return res.ok && Array.isArray(res.data.matches) ? res.data.matches : [];
}
