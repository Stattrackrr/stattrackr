/**
 * Whole-season NBA dataset from Supabase, cached in memory: every player's game logs,
 * per-game team box totals, and league per-player averages. Feeds the league-wide
 * dashboard cards (opponent breakdown, play types, similar players, usage, ratings).
 */
import { createHash } from 'crypto';
import { sharedCache } from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getNbaClubByCode, getNbaClubById, NBA_CURRENT_SEASON_YEAR } from './teams';
import type { NbaGameLogRow, NbaLeaguePlayerStatRow } from './types';

type Row = Record<string, any>;

const PAGE = 1000;
const WAVE = 8;
const CURRENT_TTL_MS = 30 * 60 * 1000;
const PAST_TTL_MS = 12 * 60 * 60 * 1000;

/** Pages a query in parallel waves; `build` must apply a stable order. */
export async function selectAllParallel(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let wave = 0; ; wave += 1) {
    const pages = await Promise.all(
      Array.from({ length: WAVE }, async (_, i) => {
        const from = (wave * WAVE + i) * PAGE;
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        return (data ?? []) as Row[];
      })
    );
    for (const page of pages) out.push(...page);
    if (pages.some((p) => p.length < PAGE)) break;
  }
  return out;
}

export function nbaHeadshotUrl(personId: number | string | null | undefined): string | null {
  if (personId == null || personId === '') return null;
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;
}

const n = (v: unknown): number | null =>
  v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const pct = (made: number | null, att: number | null): number | null =>
  made != null && att != null && att > 0 ? Math.round((made / att) * 1000) / 10 : null;
const sum = (...vals: Array<number | null>): number | null =>
  vals.some((v) => v == null) ? null : vals.reduce<number>((a, b) => a + (b as number), 0);
const rate = (v: unknown): number | null => {
  const x = n(v);
  return x == null ? null : Math.round(x * 1000) / 10;
};

export function resultLabel(teamScore: number | null, oppScore: number | null): string | null {
  if (teamScore == null || oppScore == null) return null;
  const tag = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T';
  return `${tag} ${teamScore}-${oppScore}`;
}

export const BOX_COLUMNS =
  'game_id, player_id, period, season, game_date, postseason, team_id, opponent_team_id, is_home, minutes, pts, reb, oreb, dreb, ast, stl, blk, turnover, pf, fgm, fga, fg3m, fg3a, ftm, fta, plus_minus';
export const ADV_COLUMNS =
  'game_id, player_id, usage_pct, ts_pct, pace, possessions, offensive_rating, defensive_rating, touches, passes, secondary_assists, free_throw_assists, rebound_chances_total, rebound_chances_off, rebound_chances_def, contested_fga, uncontested_fga, deflections, points_paint, points_fast_break, points_second_chance, distance, ' +
  // Only these keys of the ~2.6 KB `raw` blob are used; selecting the whole blob is ~90 MB a season.
  'raw_reb_pct:raw->rebound_percentage, raw_oreb_pct:raw->offensive_rebound_percentage, raw_dreb_pct:raw->defensive_rebound_percentage';
export const GAME_COLUMNS =
  'id, season, game_date, tipoff_at, status_state, postseason, home_team_id, visitor_team_id, home_score, visitor_score, home_q1, home_q2, home_q3, home_q4, visitor_q1, visitor_q2, visitor_q3, visitor_q4';

/** One stored box row (+ advanced, + quarter rows when available) as a dashboard game log row. */
export function toNbaGameLogRow(
  r: Row,
  g: Row | undefined,
  a: Row | undefined,
  quarter?: (period: number, key: string) => number | null
): NbaGameLogRow {
  const team = getNbaClubById(r.team_id);
  const opp = getNbaClubById(r.opponent_team_id);
  const teamScore = g ? n(r.is_home ? g.home_score : g.visitor_score) : null;
  const oppScore = g ? n(r.is_home ? g.visitor_score : g.home_score) : null;
  const pts = n(r.pts);
  const reb = n(r.reb);
  const ast = n(r.ast);
  const stl = n(r.stl);
  const blk = n(r.blk);
  const fgm = n(r.fgm);
  const fga = n(r.fga);
  const fg3m = n(r.fg3m);
  const fg3a = n(r.fg3a);
  const ftm = n(r.ftm);
  const fta = n(r.fta);
  const tov = n(r.turnover);
  const twoMade = fgm != null && fg3m != null ? fgm - fg3m : null;
  const twoAtt = fga != null && fg3a != null ? fga - fg3a : null;
  const q = quarter ?? (() => null);
  const efficiency =
    pts != null && reb != null && ast != null && stl != null && blk != null && fga != null && fgm != null && fta != null && ftm != null && tov != null
      ? pts + reb + ast + stl + blk - (fga - fgm) - (fta - ftm) - tov
      : null;
  const raw: Row = {
    rebound_percentage: a?.raw_reb_pct,
    offensive_rebound_percentage: a?.raw_oreb_pct,
    defensive_rebound_percentage: a?.raw_dreb_pct,
  };
  return {
    matchId: String(r.game_id),
    date: g?.tipoff_at ?? r.game_date,
    season: r.season,
    round: null,
    postseason: !!r.postseason,
    opponent: opp?.name ?? String(r.opponent_team_id),
    opponentCode: opp?.code ?? null,
    isHome: !!r.is_home,
    team: team?.name ?? String(r.team_id),
    teamCode: team?.code ?? null,
    result: resultLabel(teamScore, oppScore),
    venue: null,
    minutes: n(r.minutes),
    points: pts,
    rebounds: reb,
    offensiveRebounds: n(r.oreb),
    defensiveRebounds: n(r.dreb),
    assists: ast,
    steals: stl,
    blocks: blk,
    turnovers: tov,
    fouls: n(r.pf),
    fgMade: fgm,
    fgAttempted: fga,
    fgPct: pct(fgm, fga),
    twoMade,
    twoAttempted: twoAtt,
    twoPct: pct(twoMade, twoAtt),
    threeMade: fg3m,
    threeAttempted: fg3a,
    threePct: pct(fg3m, fg3a),
    ftMade: ftm,
    ftAttempted: fta,
    ftPct: pct(ftm, fta),
    plusMinus: n(r.plus_minus),
    efficiency,
    pra: sum(pts, reb, ast),
    pr: sum(pts, reb),
    pa: sum(pts, ast),
    ra: sum(reb, ast),
    stocks: sum(stl, blk),
    q1_pts: q(1, 'pts'), q2_pts: q(2, 'pts'), q3_pts: q(3, 'pts'), q4_pts: q(4, 'pts'),
    q1_reb: q(1, 'reb'), q2_reb: q(2, 'reb'), q3_reb: q(3, 'reb'), q4_reb: q(4, 'reb'),
    q1_ast: q(1, 'ast'), q2_ast: q(2, 'ast'), q3_ast: q(3, 'ast'), q4_ast: q(4, 'ast'),
    usgPct: rate(a?.usage_pct),
    tsPct: rate(a?.ts_pct),
    trebPct: rate(raw.rebound_percentage),
    orebPct: rate(raw.offensive_rebound_percentage),
    drebPct: rate(raw.defensive_rebound_percentage),
    pace: n(a?.pace),
    offRtg: n(a?.offensive_rating),
    defRtg: n(a?.defensive_rating),
    potentialRebounds: n(a?.rebound_chances_total),
    potentialOffRebounds: n(a?.rebound_chances_off),
    potentialDefRebounds: n(a?.rebound_chances_def),
    touches: n(a?.touches),
    passes: n(a?.passes),
    secondaryAssists: n(a?.secondary_assists),
    ftAssists: n(a?.free_throw_assists),
    contestedFga: n(a?.contested_fga),
    uncontestedFga: n(a?.uncontested_fga),
    deflections: n(a?.deflections),
    possessions: n(a?.possessions),
    pointsPaint: n(a?.points_paint),
    pointsFastBreak: n(a?.points_fast_break),
    pointsSecondChance: n(a?.points_second_chance),
    distanceMiles: n(a?.distance),
  };
}

// ---------------------------------------------------------------------------
// Season dataset
// ---------------------------------------------------------------------------

export type NbaTeamGameTotals = {
  matchId: string;
  date: string;
  postseason: boolean;
  teamCode: string;
  opponentCode: string;
  minutes: number;
  pts: number;
  reb: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
};

export type NbaPlayerInfo = {
  playerId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
  currentTeamId: number | null;
  active: boolean;
};

export type NbaSeasonDataset = {
  season: number;
  loadedAt: number;
  /** Ascending by date, minutes > 0 only. */
  logsByPlayer: Map<string, NbaGameLogRow[]>;
  /** Key `${matchId}|${teamCode}`. */
  teamGames: Map<string, NbaTeamGameTotals>;
  league: NbaLeaguePlayerStatRow[];
  players: Map<string, NbaPlayerInfo>;
};

/** Process-wide so every route bundle shares one in-flight season load instead of each building its own. */
type SeasonGlobals = {
  datasetCache: Map<number, { at: number; promise: Promise<NbaSeasonDataset> }>;
  playersCache: { at: number; promise: Promise<Map<string, NbaPlayerInfo>> } | null;
};
const seasonGlobals: SeasonGlobals = ((globalThis as { __nbaSeasonGlobals?: SeasonGlobals }).__nbaSeasonGlobals ??= {
  datasetCache: new Map(),
  playersCache: null,
});
const datasetCache = seasonGlobals.datasetCache;

export function nbaTeamGameKey(matchId: string, teamCode: string | null | undefined): string | null {
  if (!matchId || !teamCode) return null;
  return `${matchId}|${teamCode}`;
}

async function loadPlayersInfo(): Promise<Map<string, NbaPlayerInfo>> {
  const rows = await selectAllParallel(() =>
    supabaseAdmin
      .from('nba_players')
      .select('id, first_name, last_name, full_name, position, jersey_number, nba_person_id, team_id, is_active')
      .order('id')
  );
  const out = new Map<string, NbaPlayerInfo>();
  for (const p of rows) {
    out.set(String(p.id), {
      playerId: String(p.id),
      name: String(p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()),
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      position: p.position || null,
      jersey: p.jersey_number || null,
      imageUrl: nbaHeadshotUrl(p.nba_person_id),
      currentTeamId: p.team_id ?? null,
      active: !!p.is_active,
    });
  }
  return out;
}

export function getNbaPlayersInfo(): Promise<Map<string, NbaPlayerInfo>> {
  const hit = seasonGlobals.playersCache;
  if (hit && Date.now() - hit.at <= CURRENT_TTL_MS) return hit.promise;
  const promise = loadPlayersInfo();
  seasonGlobals.playersCache = { at: Date.now(), promise };
  promise.catch(() => {
    if (seasonGlobals.playersCache?.promise === promise) seasonGlobals.playersCache = null;
  });
  return promise;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function buildLeague(
  logsByPlayer: Map<string, NbaGameLogRow[]>,
  players: Map<string, NbaPlayerInfo>
): NbaLeaguePlayerStatRow[] {
  const out: NbaLeaguePlayerStatRow[] = [];
  for (const [playerId, logs] of logsByPlayer) {
    const regular = logs.filter((g) => !g.postseason);
    const games = regular.length ? regular : logs;
    if (!games.length) continue;
    const info = players.get(playerId);
    const last = games[games.length - 1]!;
    const total = (k: keyof NbaGameLogRow) => games.reduce((s, g) => s + (Number(g[k]) || 0), 0);
    const avg = (k: keyof NbaGameLogRow) => round1(total(k) / games.length);
    /** Advanced stats are blank for some games; average only the games that have them. */
    const trackedAvg = (k: keyof NbaGameLogRow) => {
      const vals = games.map((g) => g[k]).filter((v) => v != null && Number.isFinite(Number(v)));
      return vals.length ? round1(vals.reduce<number>((s, v) => s + Number(v), 0) / vals.length) : null;
    };
    const fgm = total('fgMade');
    const fga = total('fgAttempted');
    const tpm = total('threeMade');
    const tpa = total('threeAttempted');
    const ftm = total('ftMade');
    const fta = total('ftAttempted');
    out.push({
      playerId,
      name: info?.name ?? playerId,
      firstName: info?.firstName ?? null,
      lastName: info?.lastName ?? null,
      team: last.team,
      teamCode: last.teamCode,
      teamId: last.teamCode ? getNbaClubByCode(last.teamCode)?.id ?? null : null,
      position: info?.position ?? null,
      jersey: info?.jersey ?? null,
      imageUrl: info?.imageUrl ?? null,
      games: games.length,
      gamesStarted: 0,
      minutes: avg('minutes'),
      points: avg('points'),
      rebounds: avg('rebounds'),
      assists: avg('assists'),
      steals: avg('steals'),
      blocks: avg('blocks'),
      turnovers: avg('turnovers'),
      fouls: avg('fouls'),
      fgPct: fga > 0 ? round1((fgm / fga) * 100) : null,
      threePct: tpa > 0 ? round1((tpm / tpa) * 100) : null,
      ftPct: fta > 0 ? round1((ftm / fta) * 100) : null,
      threeMade: avg('threeMade'),
      pra: avg('pra'),
      offensiveRebounds: avg('offensiveRebounds'),
      defensiveRebounds: avg('defensiveRebounds'),
      usgPct: trackedAvg('usgPct'),
      potentialRebounds: trackedAvg('potentialRebounds'),
      touches: trackedAvg('touches'),
    });
  }
  return out.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
}

/**
 * Rows for a set of games, looked up through the (game_id, ...) primary key. Filtering these
 * tables by season has no index and times out on deep pages.
 */
export async function selectByGameIds(
  build: (ids: number[]) => any,
  gameIds: number[],
  gamesPerChunk = 25
): Promise<Row[]> {
  const chunks: number[][] = [];
  for (let i = 0; i < gameIds.length; i += gamesPerChunk) chunks.push(gameIds.slice(i, i + gamesPerChunk));
  const out: Row[] = [];
  for (let i = 0; i < chunks.length; i += WAVE) {
    const pages = await Promise.all(
      chunks.slice(i, i + WAVE).map(async (ids) => {
        const rows: Row[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build(ids).range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          rows.push(...((data ?? []) as Row[]));
          if (!data || data.length < PAGE) break;
        }
        return rows;
      })
    );
    for (const page of pages) out.push(...page);
  }
  return out;
}

type SeasonRows = { gameRows: Row[]; boxRows: Row[]; advRows: Row[] };

async function fetchSeasonRowsFromDb(season: number): Promise<SeasonRows> {
  const gameRows = await selectAllParallel(() =>
    supabaseAdmin.from('nba_games').select(GAME_COLUMNS).eq('season', season).order('id')
  );
  const gameIds = gameRows.filter((g) => g.status_state === 'final').map((g) => Number(g.id));
  const [boxRows, advRows] = await Promise.all([
    selectByGameIds(
      (ids) =>
        supabaseAdmin
          .from('nba_player_game_stats')
          .select(BOX_COLUMNS)
          .in('game_id', ids)
          .eq('period', 0)
          .order('game_id')
          .order('player_id'),
      gameIds
    ),
    selectByGameIds(
      (ids) =>
        supabaseAdmin
          .from('nba_player_game_advanced')
          .select(ADV_COLUMNS)
          .in('game_id', ids)
          .order('game_id')
          .order('player_id'),
      gameIds
    ),
  ]);
  return { gameRows, boxRows, advRows };
}

// ---------------------------------------------------------------------------
// Redis season snapshot: cold instances read ~2 MB from Redis instead of paging
// ~80k rows out of Supabase (~10 s). The NBA odds cron keeps it fresh.
// ---------------------------------------------------------------------------

const SNAPSHOT_TABLES = ['gameRows', 'boxRows', 'advRows'] as const;
type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];
const SNAPSHOT_SCHEMA = createHash('sha1').update(`${GAME_COLUMNS}|${BOX_COLUMNS}|${ADV_COLUMNS}`).digest('hex').slice(0, 8);
const SNAPSHOT_PREFIX = `nba_season_rows_v1:${SNAPSHOT_SCHEMA}`;
/** Rows per Redis value; keeps each GET well under the shared cache's 2 s timeout. */
const SNAPSHOT_PART_ROWS = 12_000;
const SNAPSHOT_CURRENT_TTL_S = 6 * 60 * 60;
const SNAPSHOT_PAST_TTL_S = 7 * 24 * 60 * 60;
const SNAPSHOT_CURRENT_MAX_AGE_MS = 30 * 60 * 1000;
const SNAPSHOT_PAST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SnapshotMeta = { builtAt: number; parts: Record<SnapshotTable, number> };
type SnapshotPart = { builtAt: number; keys: string[]; rows: unknown[][] };

const snapshotMetaKey = (season: number) => `${SNAPSHOT_PREFIX}:${season}:meta`;
const snapshotPartKey = (season: number, table: SnapshotTable, idx: number) =>
  `${SNAPSHOT_PREFIX}:${season}:${table}:${idx}`;
const isCurrentSeason = (season: number) => season >= NBA_CURRENT_SEASON_YEAR;

/** Columnar parts (column names once, then value arrays) per table. */
export function packNbaSeasonRows(rows: SeasonRows, builtAt: number): Record<SnapshotTable, SnapshotPart[]> {
  const out = {} as Record<SnapshotTable, SnapshotPart[]>;
  for (const table of SNAPSHOT_TABLES) {
    const list = rows[table];
    const keys = [...new Set(list.flatMap((r, i) => (i < 50 ? Object.keys(r) : [])))];
    const parts: SnapshotPart[] = [];
    for (let i = 0; i < list.length || i === 0; i += SNAPSHOT_PART_ROWS) {
      parts.push({
        builtAt,
        keys,
        rows: list.slice(i, i + SNAPSHOT_PART_ROWS).map((r) => keys.map((k) => r[k] ?? null)),
      });
    }
    out[table] = parts;
  }
  return out;
}

export function unpackNbaSeasonRows(parts: Record<SnapshotTable, SnapshotPart[]>): SeasonRows {
  const out = {} as SeasonRows;
  for (const table of SNAPSHOT_TABLES) {
    const rows: Row[] = [];
    for (const part of parts[table]) {
      for (const values of part.rows) {
        const row: Row = {};
        part.keys.forEach((k, i) => {
          row[k] = values[i];
        });
        rows.push(row);
      }
    }
    out[table] = rows;
  }
  return out;
}

async function readSeasonSnapshot(season: number): Promise<SeasonRows | null> {
  const meta = await sharedCache.getJSON<SnapshotMeta>(snapshotMetaKey(season));
  if (!meta?.builtAt || !meta.parts) return null;
  if (SNAPSHOT_TABLES.some((t) => !(Number(meta.parts[t]) >= 1))) return null;
  const entries = SNAPSHOT_TABLES.flatMap((table) =>
    Array.from({ length: Number(meta.parts[table]) || 0 }, (_, idx) => ({ table, idx }))
  );
  const fetched = await Promise.all(
    entries.map((e) => sharedCache.getJSON<SnapshotPart>(snapshotPartKey(season, e.table, e.idx)))
  );
  const parts = Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, [] as SnapshotPart[]])) as Record<
    SnapshotTable,
    SnapshotPart[]
  >;
  for (let i = 0; i < entries.length; i += 1) {
    const part = fetched[i];
    if (!part || part.builtAt !== meta.builtAt || !Array.isArray(part.keys) || !Array.isArray(part.rows)) return null;
    parts[entries[i]!.table].push(part);
  }
  return unpackNbaSeasonRows(parts);
}

async function writeSeasonSnapshot(season: number, rows: SeasonRows, builtAt: number): Promise<void> {
  const ttl = isCurrentSeason(season) ? SNAPSHOT_CURRENT_TTL_S : SNAPSHOT_PAST_TTL_S;
  const packed = packNbaSeasonRows(rows, builtAt);
  const writes: Array<Promise<void>> = [];
  for (const table of SNAPSHOT_TABLES) {
    packed[table].forEach((part, idx) => writes.push(sharedCache.setJSON(snapshotPartKey(season, table, idx), part, ttl)));
  }
  await Promise.all(writes);
  const meta: SnapshotMeta = {
    builtAt,
    parts: Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, packed[t].length])) as Record<SnapshotTable, number>,
  };
  await sharedCache.setJSON(snapshotMetaKey(season), meta, ttl);
}

async function loadSeasonRows(season: number): Promise<SeasonRows> {
  const snap = await readSeasonSnapshot(season).catch(() => null);
  if (snap) return snap;
  const rows = await fetchSeasonRowsFromDb(season);
  await writeSeasonSnapshot(season, rows, Date.now()).catch((err) =>
    console.warn('[nba season] snapshot write failed', err instanceof Error ? err.message : err)
  );
  return rows;
}

/**
 * Rebuild season snapshots that are missing or older than their max age (30 min for the
 * current season, 24 h for past ones). Called from the NBA odds cron.
 */
export async function refreshNbaSeasonSnapshots(
  seasons: number[]
): Promise<Array<{ season: number; rebuilt: boolean; ageMin: number | null; error?: string }>> {
  const out: Array<{ season: number; rebuilt: boolean; ageMin: number | null; error?: string }> = [];
  for (const season of [...new Set(seasons)]) {
    const meta = await sharedCache.getJSON<SnapshotMeta>(snapshotMetaKey(season)).catch(() => null);
    const age = meta?.builtAt ? Date.now() - meta.builtAt : null;
    const maxAge = isCurrentSeason(season) ? SNAPSHOT_CURRENT_MAX_AGE_MS : SNAPSHOT_PAST_MAX_AGE_MS;
    const ageMin = age != null ? Math.round(age / 60000) : null;
    if (age != null && age < maxAge) {
      out.push({ season, rebuilt: false, ageMin });
      continue;
    }
    try {
      const rows = await fetchSeasonRowsFromDb(season);
      await writeSeasonSnapshot(season, rows, Date.now());
      out.push({ season, rebuilt: true, ageMin });
    } catch (err) {
      out.push({ season, rebuilt: false, ageMin, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

async function buildDataset(season: number): Promise<NbaSeasonDataset> {
  const [{ gameRows, boxRows, advRows }, players] = await Promise.all([loadSeasonRows(season), getNbaPlayersInfo()]);

  const games = new Map<number, Row>(gameRows.map((g) => [Number(g.id), g]));
  const adv = new Map<string, Row>(advRows.map((a) => [`${a.game_id}:${a.player_id}`, a]));
  const logsByPlayer = new Map<string, NbaGameLogRow[]>();
  const teamGames = new Map<string, NbaTeamGameTotals>();

  for (const r of boxRows) {
    const mins = Number(r.minutes) || 0;
    const team = getNbaClubById(r.team_id);
    const opp = getNbaClubById(r.opponent_team_id);
    const g = games.get(Number(r.game_id));
    if (team && opp) {
      const key = `${r.game_id}|${team.code}`;
      let t = teamGames.get(key);
      if (!t) {
        t = {
          matchId: String(r.game_id),
          date: String(g?.tipoff_at ?? r.game_date),
          postseason: !!r.postseason,
          teamCode: team.code,
          opponentCode: opp.code,
          minutes: 0, pts: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
          fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
        };
        teamGames.set(key, t);
      }
      t.minutes += mins;
      t.pts += Number(r.pts) || 0;
      t.reb += Number(r.reb) || 0;
      t.oreb += Number(r.oreb) || 0;
      t.dreb += Number(r.dreb) || 0;
      t.ast += Number(r.ast) || 0;
      t.stl += Number(r.stl) || 0;
      t.blk += Number(r.blk) || 0;
      t.tov += Number(r.turnover) || 0;
      t.pf += Number(r.pf) || 0;
      t.fgm += Number(r.fgm) || 0;
      t.fga += Number(r.fga) || 0;
      t.fg3m += Number(r.fg3m) || 0;
      t.fg3a += Number(r.fg3a) || 0;
      t.ftm += Number(r.ftm) || 0;
      t.fta += Number(r.fta) || 0;
    }
    if (mins <= 0) continue;
    const row = toNbaGameLogRow(r, g, adv.get(`${r.game_id}:${r.player_id}`));
    const id = String(r.player_id);
    const list = logsByPlayer.get(id);
    if (list) list.push(row);
    else logsByPlayer.set(id, [row]);
  }
  for (const list of logsByPlayer.values()) {
    list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }

  return {
    season,
    loadedAt: Date.now(),
    logsByPlayer,
    teamGames,
    league: buildLeague(logsByPlayer, players),
    players,
  };
}

export function getNbaSeasonDataset(season: number): Promise<NbaSeasonDataset> {
  const ttl = season >= NBA_CURRENT_SEASON_YEAR ? CURRENT_TTL_MS : PAST_TTL_MS;
  const hit = datasetCache.get(season);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = buildDataset(season);
  datasetCache.set(season, { at: Date.now(), promise });
  promise.catch(() => {
    if (datasetCache.get(season)?.promise === promise) datasetCache.delete(season);
  });
  return promise;
}

const seasonHasGamesCache = new Map<number, { at: number; value: boolean }>();

async function seasonHasGames(season: number): Promise<boolean> {
  const hit = seasonHasGamesCache.get(season);
  if (hit && Date.now() - hit.at < CURRENT_TTL_MS) return hit.value;
  const { data, error } = await supabaseAdmin
    .from('nba_games')
    .select('id')
    .eq('season', season)
    .eq('status_state', 'final')
    .limit(1);
  if (error) throw new Error(error.message);
  const value = (data?.length ?? 0) > 0;
  seasonHasGamesCache.set(season, { at: Date.now(), value });
  return value;
}

/**
 * Season the league-wide cards should read: the requested one when it has games,
 * else the last completed season (early October before tip-off).
 */
export async function resolveNbaDataSeason(requested?: number | null): Promise<number> {
  const want = requested && Number.isFinite(requested) ? requested : NBA_CURRENT_SEASON_YEAR;
  if (await seasonHasGames(want)) return want;
  return want - 1;
}
