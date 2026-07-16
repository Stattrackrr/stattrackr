/**
 * FootyInfo player profile + season game logs → StatTrackr GameLogRow shape.
 */

import { fetchFootyinfoJson } from '@/lib/afl/footyinfoHttp';
import {
  footyinfoOpponentToNickname,
  footyinfoPlayerSlug,
} from '@/lib/afl/footyinfoTeamMapping';
import { getAflFootyinfoSlugOverridesForName } from '@/lib/aflFootyinfoSlugOverrides';
import { fetchFootyinfoMatchMeta, type FootyinfoMatchMeta } from '@/lib/afl/footyinfoMatch';

export type FootyinfoGameLogRow = {
  season: number;
  round: string;
  opponent: string;
  result: string;
  date: string;
  venue: string;
  kicks: number;
  marks: number;
  handballs: number;
  disposals: number;
  goals: number;
  behinds: number;
  hitouts: number;
  tackles: number;
  rebounds: number;
  inside_50s: number;
  clearances: number;
  intercepts: number;
  tackles_inside_50: number;
  score_involvements: number;
  meters_gained: number;
  clangers: number;
  free_kicks_for: number;
  free_kicks_against: number;
  brownlow_votes: number;
  contested_possessions: number;
  uncontested_possessions: number;
  contested_marks: number;
  marks_inside_50: number;
  one_percenters: number;
  bounces: number;
  goal_assists: number;
  fantasy_points?: number | null;
  percent_played: number | null;
  effective_disposals: number;
  disposal_efficiency: number;
  match_url: string | null;
};

type Cell = { value?: unknown; linkId?: number; linkSlug?: string } | null | undefined;

function cellValue(row: Record<string, Cell>, key: string): unknown {
  const c = row?.[key];
  if (c == null) return null;
  if (typeof c === 'object' && 'value' in c) return c.value;
  return c;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/%/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function percent(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v <= 1 ? Math.round(v * 100) : v;
  const s = String(v).replace(/%/g, '').trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function goalsFromCell(row: Record<string, Cell>): { goals: number; behinds: number } {
  const goalsNum = cellValue(row, 'goals_num');
  const behinds = cellValue(row, 'behinds');
  if (goalsNum != null || behinds != null) {
    return { goals: num(goalsNum), behinds: num(behinds) };
  }
  const g = String(cellValue(row, 'goals') ?? '');
  const m = g.match(/^(\d+)\.(\d+)$/);
  if (m) return { goals: Number(m[1]), behinds: Number(m[2]) };
  return { goals: num(g), behinds: 0 };
}

let seasonIdCache: Map<number, number> | null = null;

/** Resolve FootyInfo season_id for a calendar year (e.g. 2026 → 132). */
export async function resolveFootyinfoSeasonId(year: number): Promise<number | null> {
  if (seasonIdCache?.has(year)) return seasonIdCache.get(year) ?? null;
  const res = await fetchFootyinfoJson<{
    seasons?: Array<{ id: number; name: string }>;
    season?: { id: number; name: string };
  }>('/ladder');
  if (!res.ok) return null;
  const map = new Map<number, number>();
  for (const s of res.data.seasons ?? []) {
    const y = Number.parseInt(String(s.name), 10);
    if (Number.isFinite(y)) map.set(y, s.id);
  }
  if (res.data.season?.name) {
    const y = Number.parseInt(String(res.data.season.name), 10);
    if (Number.isFinite(y)) map.set(y, res.data.season.id);
  }
  seasonIdCache = map;
  return map.get(year) ?? null;
}

export type FootyinfoPlayerProfile = {
  id: number;
  slug: string;
  knownAs: string;
  fullName: string;
  height: number | null;
  guernsey?: number | null;
};

export async function fetchFootyinfoPlayerProfile(
  slugOrId: string
): Promise<FootyinfoPlayerProfile | null> {
  const res = await fetchFootyinfoJson<{
    player?: {
      id: number;
      slug: string;
      knownAs?: string;
      fullName?: string;
      height?: number | null;
    };
  }>(`/player/${encodeURIComponent(slugOrId)}/profile`);
  if (!res.ok || !res.data.player?.id) return null;
  const p = res.data.player;
  return {
    id: p.id,
    slug: p.slug,
    knownAs: p.knownAs || p.fullName || slugOrId,
    fullName: p.fullName || p.knownAs || slugOrId,
    height: typeof p.height === 'number' ? p.height : null,
  };
}

export async function resolveFootyinfoPlayerSlug(playerName: string): Promise<string | null> {
  const overrides = getAflFootyinfoSlugOverridesForName(playerName);
  const primary = footyinfoPlayerSlug(playerName);
  const candidates = [...overrides, primary].filter(Boolean);

  // Cheap existence check: game_logs_summary returns 200 for valid slugs.
  for (const slug of candidates) {
    const res = await fetchFootyinfoJson(`/player/${encodeURIComponent(slug)}/game_logs_summary?mode=averages&columns=all`, {
      attempts: 2,
    });
    if (res.ok) return slug;
  }

  const q = encodeURIComponent(playerName.trim());
  const search = await fetchFootyinfoJson<{
    results?: Array<{ type?: string; slug?: string; title?: string }>;
  }>(`/search?q=${q}`);
  if (search.ok) {
    const players = (search.data.results || []).filter((r) => r.type === 'player' && r.slug);
    if (players.length === 1) return players[0].slug!;
    const want = playerName.trim().toLowerCase();
    const exact = players.find((p) => String(p.title || '').toLowerCase() === want);
    if (exact?.slug) return exact.slug;
    if (players[0]?.slug) return players[0].slug;
  }
  return null;
}

type GameLogsPayload = {
  game_logs?: {
    columns?: Array<{ id: string }>;
    rows?: Array<Record<string, Cell>>;
  };
};

function mapRowToGameLog(
  row: Record<string, Cell>,
  season: number,
  matchMeta: FootyinfoMatchMeta | null
): FootyinfoGameLogRow {
  const { goals, behinds } = goalsFromCell(row);
  const oppAbbrev = String(cellValue(row, 'opp_abbrev') ?? '');
  const round = String(cellValue(row, 'round') ?? matchMeta?.rd ?? '');
  const venue = String(cellValue(row, 'ground_abbrev') ?? matchMeta?.venue ?? '');
  const matchId = Number(cellValue(row, 'match_id') ?? row.round?.linkId ?? 0);
  const linkSlug =
    (row.round && typeof row.round === 'object' && row.round.linkSlug) ||
    matchMeta?.slug ||
    null;
  const date =
    matchMeta?.match_date ||
    (matchMeta?.utc
      ? new Date(matchMeta.utc * 1000).toISOString().slice(0, 10)
      : '');

  const disposals = num(cellValue(row, 'disposals'));
  const effective = num(cellValue(row, 'effective_disposals'));
  const de = percent(cellValue(row, 'disposal_efficiency'));

  let result = '';
  if (matchMeta) {
    const hs = matchMeta.hsc ?? matchMeta.hs ?? null;
    const as = matchMeta.asc ?? matchMeta.as ?? null;
    if (typeof hs === 'number' && typeof as === 'number') {
      const playerIsHome =
        matchMeta.h_abbrev &&
        oppAbbrev &&
        matchMeta.a_abbrev?.toUpperCase() === oppAbbrev.toUpperCase();
      const playerScore = playerIsHome ? hs : as;
      const oppScore = playerIsHome ? as : hs;
      if (playerScore > oppScore) result = `Win ${playerScore}-${oppScore}`;
      else if (playerScore < oppScore) result = `Loss ${playerScore}-${oppScore}`;
      else result = `Draw ${playerScore}-${oppScore}`;
    } else if (matchMeta.sts) {
      result = String(matchMeta.sts);
    }
  }

  return {
    season,
    round,
    opponent: footyinfoOpponentToNickname(oppAbbrev),
    result,
    date,
    venue,
    kicks: num(cellValue(row, 'kicks')),
    marks: num(cellValue(row, 'marks')),
    handballs: num(cellValue(row, 'handballs')),
    disposals,
    goals,
    behinds,
    hitouts: num(cellValue(row, 'hitouts')),
    tackles: num(cellValue(row, 'tackles')),
    rebounds: num(cellValue(row, 'rebounds')),
    inside_50s: num(cellValue(row, 'inside_50s')),
    clearances: num(cellValue(row, 'clearances')),
    intercepts: num(cellValue(row, 'intercepts')),
    tackles_inside_50: num(cellValue(row, 'tackles_inside_50')),
    score_involvements: num(cellValue(row, 'score_involvements')),
    meters_gained: num(cellValue(row, 'metres_gained')),
    clangers: num(cellValue(row, 'turnovers') || cellValue(row, 'clangers')),
    free_kicks_for: num(cellValue(row, 'frees_for')),
    free_kicks_against: num(cellValue(row, 'frees_against')),
    brownlow_votes: num(cellValue(row, 'brownlow_votes')),
    contested_possessions: num(cellValue(row, 'contested_poss')),
    uncontested_possessions: num(cellValue(row, 'uncontested_poss')),
    contested_marks: num(cellValue(row, 'contested_marks')),
    marks_inside_50: num(cellValue(row, 'marks_inside_50')),
    one_percenters: num(cellValue(row, 'one_percenters')),
    bounces: num(cellValue(row, 'bounces')),
    goal_assists: num(cellValue(row, 'goal_assists')),
    fantasy_points: (() => {
      const v = cellValue(row, 'afl_fantasy');
      return v == null ? null : num(v);
    })(),
    percent_played: percent(cellValue(row, 'time_on_ground')),
    effective_disposals: effective,
    disposal_efficiency: de ?? (disposals > 0 && effective > 0 ? Math.round((effective / disposals) * 100) : 0),
    match_url: linkSlug
      ? `https://www.footyinfo.com/match/${linkSlug}`
      : matchId
        ? `https://www.footyinfo.com/match/${matchId}`
        : null,
  };
}

const matchMetaCache = new Map<number, FootyinfoMatchMeta | null>();

function isCompletedMatch(meta: FootyinfoMatchMeta | null): boolean {
  // FootyInfo includes a placeholder row for upcoming fixtures in some player
  // logs. It has no stats but otherwise looks like a normal game to the chart.
  if (!meta) return true;
  const status = String(meta.st || '').trim().toUpperCase();
  if (status && !['C', 'F', 'FINAL', 'COMPLETED'].includes(status)) return false;
  const date = String(meta.match_date || '').slice(0, 10);
  return !date || date <= new Date().toISOString().slice(0, 10);
}

async function getMatchMetaCached(matchId: number): Promise<FootyinfoMatchMeta | null> {
  if (!matchId) return null;
  if (matchMetaCache.has(matchId)) return matchMetaCache.get(matchId) ?? null;
  const meta = await fetchFootyinfoMatchMeta(matchId);
  matchMetaCache.set(matchId, meta);
  return meta;
}

/**
 * Fetch season game logs for a player from FootyInfo and map to GameLogRow-compatible objects.
 */
export async function fetchFootyInfoPlayerGameLogs(
  playerName: string,
  season: number,
  _teamName?: string | null,
  options: { skipMemoryCache?: boolean; skipMatchMetadata?: boolean } = {}
): Promise<{
  games: FootyinfoGameLogRow[];
  height: string | null;
  guernsey: number | null;
  player_name: string;
  slug: string | null;
} | null> {
  const candidates = [
    ...getAflFootyinfoSlugOverridesForName(playerName),
    footyinfoPlayerSlug(playerName),
  ].filter(Boolean);
  let slug = candidates[0] || await resolveFootyinfoPlayerSlug(playerName);
  if (!slug) return null;

  const [seasonId, initialProfile] = await Promise.all([
    resolveFootyinfoSeasonId(season),
    fetchFootyinfoPlayerProfile(slug),
  ]);
  if (!seasonId) return null;

  const fetchLogs = (playerSlug: string) =>
    fetchFootyinfoJson<GameLogsPayload>(
      `/player/${encodeURIComponent(playerSlug)}/game_logs?columns=all&season_id=${seasonId}&competition_type_id=1`
    );
  let profile = initialProfile;
  let res = await fetchLogs(slug);
  // Slugs are normally deterministic. Only perform the slower validation and
  // search fallback when FootyInfo rejects the direct player request.
  if (!res.ok) {
    const resolvedSlug = await resolveFootyinfoPlayerSlug(playerName);
    if (!resolvedSlug || resolvedSlug === slug) return null;
    slug = resolvedSlug;
    const [resolvedProfile, resolvedLogs] = await Promise.all([
      fetchFootyinfoPlayerProfile(slug),
      fetchLogs(slug),
    ]);
    profile = resolvedProfile;
    res = resolvedLogs;
  }
  if (!res.ok) return null;

  const rows = res.data.game_logs?.rows ?? [];
  if (!rows.length) {
    return {
      games: [],
      height: profile?.height != null ? String(profile.height) : null,
      guernsey: null,
      player_name: profile?.knownAs || playerName.trim(),
      slug,
    };
  }

  const playedRows = options.skipMatchMetadata
    ? rows.filter((row) =>
        ['kicks', 'handballs', 'disposals', 'marks', 'tackles', 'goals', 'hitouts']
          .some((key) => cellValue(row, key) != null)
      )
    : rows;
  const matchIds = [
    ...new Set(
      playedRows
        .map((row) => Number(cellValue(row, 'match_id') || (row.round as Cell)?.linkId || 0))
        .filter((id) => id > 0)
    ),
  ];

  if (!options.skipMatchMetadata) {
    // Parallel match meta for dates/results (shared process cache across warm).
    const concurrency = 20;
    for (let i = 0; i < matchIds.length; i += concurrency) {
      const chunk = matchIds.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (id) => {
          if (!options.skipMemoryCache && matchMetaCache.has(id)) return;
          const meta = await fetchFootyinfoMatchMeta(id);
          matchMetaCache.set(id, meta);
        })
      );
    }
  }

  const games: FootyinfoGameLogRow[] = [];
  for (const row of playedRows) {
    const matchId = Number(cellValue(row, 'match_id') || (row.round as Cell)?.linkId || 0);
    const meta = matchMetaCache.get(matchId) ?? null;
    if (!isCompletedMatch(meta)) continue;
    games.push(mapRowToGameLog(row, season, meta));
  }

  // Newest first to match FootyWire ordering expectations in some UI paths
  games.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return {
    games,
    height: profile?.height != null ? String(profile.height) : null,
    guernsey: null,
    player_name: profile?.knownAs || playerName.trim(),
    slug,
  };
}
