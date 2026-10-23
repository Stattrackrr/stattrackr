import { isNbaAchievementMarket, isNblGameMarket, isNblPropMarket, type NbaAchievementMarket } from '@/lib/aiPicks/markets';
import { gradeNblGame, gradeNblProp, type LegGrade, type NblBoxValues } from '@/lib/aiPicks/grade/rules';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import { BdlClient } from '@/lib/nba/bdl/client';
import { parseBdlMinutes } from '@/lib/nba/sync/mappers';

/** Past this, a game that never went final (or never got box scores) is void. */
const GIVE_UP_MS = 3 * 24 * 60 * 60 * 1000;
/** Tip-off this long ago and still not final in the database: ask BallDontLie directly instead of waiting on the sync. */
const LIVE_AFTER_MS = 2 * 60 * 60 * 1000;

export type NbaGameRow = {
  id: number;
  status_state: string | null;
  postponed: boolean | null;
  home_score: number | null;
  visitor_score: number | null;
  tipoff_at?: string | null;
};
export type NbaBoxRow = {
  player_id: number;
  minutes: number | string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  stl?: number | null;
  blk?: number | null;
};
export type NbaResults = {
  game(gameId: string): Promise<NbaGameRow | null>;
  box(gameId: string): Promise<NbaBoxRow[]>;
  /** Player ids with minutes in the 3rd or 4th quarter; null while the quarter box scores aren't in. */
  secondHalf?(gameId: string): Promise<Set<string> | null>;
  /** Player ids ejected from the game; null while the play-by-play isn't in. */
  ejected?(gameId: string): Promise<Set<string> | null>;
};

/** Nobody plays more than this in a first half, so anyone over it played after half-time. */
const FIRST_HALF_MINUTES = 24;

const db = async () => (await import('@/lib/supabaseAdmin')).supabaseAdmin;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};

/** The synced nba_games / nba_player_game_stats rows (GitHub Actions, every 3 hours when the schedule runs on time). */
export class StoredNbaResults implements NbaResults {
  async game(gameId: string): Promise<NbaGameRow | null> {
    const id = Number(gameId);
    if (!Number.isFinite(id)) return null;
    const { data, error } = await (await db())
      .from('nba_games')
      .select('id, status_state, postponed, home_score, visitor_score, tipoff_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`nba_games ${gameId}: ${error.message}`);
    return (data as NbaGameRow | null) ?? null;
  }

  async box(gameId: string): Promise<NbaBoxRow[]> {
    const { data, error } = await (await db())
      .from('nba_player_game_stats')
      .select('player_id, minutes, pts, reb, ast, fg3m, stl, blk')
      .eq('game_id', Number(gameId))
      .eq('period', 0);
    if (error) throw new Error(`nba box ${gameId}: ${error.message}`);
    return (data ?? []) as NbaBoxRow[];
  }

  async secondHalf(gameId: string): Promise<Set<string> | null> {
    const { data, error } = await (await db())
      .from('nba_player_game_stats')
      .select('player_id')
      .eq('game_id', Number(gameId))
      .in('period', [3, 4])
      .gt('minutes', 0);
    if (error) throw new Error(`nba second half ${gameId}: ${error.message}`);
    return data?.length ? new Set(data.map((r) => String(r.player_id))) : null;
  }

  async ejected(gameId: string): Promise<Set<string> | null> {
    const id = Number(gameId);
    const { data, error } = await (await db()).from('nba_plays').select('participants').eq('game_id', id).eq('type', 'Ejection');
    if (error) throw new Error(`nba ejections ${gameId}: ${error.message}`);
    if (data?.length) return ejectedIds(data);
    const { data: game, error: gameError } = await (await db()).from('nba_games').select('plays_synced_at').eq('id', id).maybeSingle();
    if (gameError) throw new Error(`nba plays synced ${gameId}: ${gameError.message}`);
    return game?.plays_synced_at ? new Set() : null;
  }
}

function ejectedIds(plays: Array<{ type?: unknown; participants?: unknown }>): Set<string> {
  const ids = new Set<string>();
  for (const p of plays) {
    if (p.type != null && p.type !== 'Ejection') continue;
    if (Array.isArray(p.participants)) for (const id of p.participants) ids.add(String(id));
  }
  return ids;
}

type Obj = Record<string, any>;
export type BdlReader = { get<T>(path: string): Promise<T>; all<T>(path: string): Promise<T[]> };
type LiveResult = { game: NbaGameRow; box: NbaBoxRow[] };

/**
 * BallDontLie's game and full-game box score. The box only counts once each team's player points add up to
 * its final score, so a box score still catching up to the final whistle can't grade anything.
 */
export function nbaLiveResult(g: Obj, stats: Obj[]): LiveResult {
  const game: NbaGameRow = {
    id: Number(g.id),
    status_state: g.status_state ?? null,
    postponed: g.postponed ?? null,
    home_score: num(g.home_team_score),
    visitor_score: num(g.visitor_team_score),
    tipoff_at: g.datetime ?? null,
  };
  if (game.status_state !== 'final') return { game, box: [] };
  const teamPoints = (teamId: unknown) =>
    stats.filter((s) => s.team?.id === teamId).reduce((sum, s) => sum + (num(s.pts) ?? 0), 0);
  const homeId = g.home_team?.id ?? g.home_team_id;
  const visitorId = g.visitor_team?.id ?? g.visitor_team_id;
  if (teamPoints(homeId) !== game.home_score || teamPoints(visitorId) !== game.visitor_score) return { game, box: [] };
  const box = stats
    .filter((s) => s.player?.id != null)
    .map((s) => ({
      player_id: Number(s.player.id),
      minutes: parseBdlMinutes(s.min),
      pts: num(s.pts),
      reb: num(s.reb),
      ast: num(s.ast),
      fg3m: num(s.fg3m),
      stl: num(s.stl),
      blk: num(s.blk),
    }));
  return { game, box };
}

function defaultBdl(): BdlReader | null {
  const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
  return apiKey ? new BdlClient({ apiKey, perMinute: 60, maxRetries: 1 }) : null;
}

/** Box rows whose points add up to the final score: anything less was saved mid-game. */
function completeBox(game: NbaGameRow, rows: NbaBoxRow[]): boolean {
  if (!rows.length || game.home_score == null || game.visitor_score == null) return false;
  return rows.reduce((sum, r) => sum + (num(r.pts) ?? 0), 0) === game.home_score + game.visitor_score;
}

/**
 * Per-run cache over the synced tables (the leg's event key is the game id). A game the database still
 * shows unfinished 2h after tip-off is read straight from BallDontLie, and so is a box score that does
 * not add up to the final score (the sync can save one mid-game).
 */
export class NbaResultsSource implements NbaResults {
  private games = new Map<string, Promise<NbaGameRow | null>>();
  private boxes = new Map<string, Promise<NbaBoxRow[]>>();
  private live = new Map<string, Promise<LiveResult | null>>();
  private halves = new Map<string, Promise<Set<string> | null>>();
  private ejections = new Map<string, Promise<Set<string> | null>>();
  private readonly stored: NbaResults;
  private readonly bdl: BdlReader | null;
  private readonly nowMs: number;

  constructor(opts: { stored?: NbaResults; bdl?: BdlReader | null; nowMs?: number } = {}) {
    this.stored = opts.stored ?? new StoredNbaResults();
    this.bdl = opts.bdl === undefined ? defaultBdl() : opts.bdl;
    this.nowMs = opts.nowMs ?? Date.now();
  }

  private liveResult(gameId: string): Promise<LiveResult | null> {
    let hit = this.live.get(gameId);
    if (!hit) {
      const bdl = this.bdl;
      hit = bdl
        ? (async () => {
            try {
              const { data } = await bdl.get<{ data: Obj }>(`/v1/games/${encodeURIComponent(gameId)}`);
              if (!data) return null;
              const stats = data.status_state === 'final' ? await bdl.all<Obj>(`/v1/stats?game_ids[]=${encodeURIComponent(gameId)}`) : [];
              return nbaLiveResult(data, stats);
            } catch (err) {
              console.warn(`[ai-grade] BallDontLie game ${gameId}:`, err instanceof Error ? err.message : err);
              return null;
            }
          })()
        : Promise.resolve(null);
      this.live.set(gameId, hit);
    }
    return hit;
  }

  private due(game: NbaGameRow | null): boolean {
    const tip = Date.parse(String(game?.tipoff_at ?? ''));
    return Number.isFinite(tip) && this.nowMs - tip >= LIVE_AFTER_MS;
  }

  game(gameId: string): Promise<NbaGameRow | null> {
    let hit = this.games.get(gameId);
    if (!hit) {
      hit = (async () => {
        const stored = await this.stored.game(gameId);
        if (stored?.status_state === 'final' || !this.due(stored)) return stored;
        return (await this.liveResult(gameId))?.game ?? stored;
      })();
      this.games.set(gameId, hit);
    }
    return hit;
  }

  box(gameId: string): Promise<NbaBoxRow[]> {
    let hit = this.boxes.get(gameId);
    if (!hit) {
      hit = (async () => {
        const game = await this.game(gameId);
        if (game?.status_state !== 'final') return [];
        const rows = await this.stored.box(gameId);
        if (completeBox(game, rows)) return rows;
        const live = (await this.liveResult(gameId))?.box ?? [];
        return completeBox(game, live) ? live : [];
      })();
      this.boxes.set(gameId, hit);
    }
    return hit;
  }

  secondHalf(gameId: string): Promise<Set<string> | null> {
    let hit = this.halves.get(gameId);
    if (!hit) {
      hit = (async () => {
        const stored = (await this.stored.secondHalf?.(gameId)) ?? null;
        if (stored || !this.bdl) return stored;
        try {
          const rows = (
            await Promise.all(
              [3, 4].map((p) => this.bdl!.all<Obj>(`/v1/stats?game_ids[]=${encodeURIComponent(gameId)}&period=${p}`))
            )
          ).flat();
          const ids = rows.filter((s) => s.player?.id != null && (parseBdlMinutes(s.min) ?? 0) > 0).map((s) => String(s.player.id));
          return ids.length ? new Set(ids) : null;
        } catch (err) {
          console.warn(`[ai-grade] BallDontLie quarters ${gameId}:`, err instanceof Error ? err.message : err);
          return null;
        }
      })();
      this.halves.set(gameId, hit);
    }
    return hit;
  }

  ejected(gameId: string): Promise<Set<string> | null> {
    let hit = this.ejections.get(gameId);
    if (!hit) {
      hit = (async () => {
        const stored = (await this.stored.ejected?.(gameId)) ?? null;
        if (stored || !this.bdl) return stored;
        try {
          const { data } = await this.bdl.get<{ data: Obj[] }>(`/v1/plays?game_id=${encodeURIComponent(gameId)}`);
          return data?.length ? ejectedIds(data) : null;
        } catch (err) {
          console.warn(`[ai-grade] BallDontLie plays ${gameId}:`, err instanceof Error ? err.message : err);
          return null;
        }
      })();
      this.ejections.set(gameId, hit);
    }
    return hit;
  }
}

function boxValues(row: NbaBoxRow): NblBoxValues {
  return { minutes: num(row.minutes), points: num(row.pts), rebounds: num(row.reb), assists: num(row.ast), threeMade: num(row.fg3m) };
}

/** Double-double / triple-double yes bets: 10+ in two / three of points, rebounds, assists, steals, blocks. */
export function gradeNbaAchievement(market: NbaAchievementMarket, row: NbaBoxRow | null): LegGrade {
  if (!row || !num(row.minutes)) return { status: 'void', value: null, note: 'Did not play' };
  const stats: Array<[string, number | null]> = [
    ['pts', num(row.pts)],
    ['reb', num(row.reb)],
    ['ast', num(row.ast)],
    ['stl', num(row.stl)],
    ['blk', num(row.blk)],
  ];
  if (stats.slice(0, 3).some(([, v]) => v == null)) return { status: 'void', value: null, note: 'Stat missing from the box score' };
  const count = stats.filter(([, v]) => v != null && v >= 10).length;
  const need = market === 'doubleDouble' ? 2 : 3;
  const note = stats
    .filter(([k, v]) => v != null && (k === 'pts' || k === 'reb' || k === 'ast' || v >= 10))
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  return { status: count >= need ? 'win' : 'loss', value: count, note };
}

/**
 * null = not gradeable yet: a final game with no box rows (synced or from BallDontLie) waits; once the
 * game has rows, a player missing from them did not play (void).
 */
export async function gradeNbaLeg(leg: AiPickLeg, source: NbaResults, nowMs: number): Promise<LegGrade | null> {
  const age = nowMs - Date.parse(leg.startsAt);
  const game = await source.game(leg.eventKey);
  if (!game || game.status_state !== 'final' || game.home_score == null || game.visitor_score == null) {
    if (game?.postponed && age > 24 * 60 * 60 * 1000) return { status: 'void', value: null, note: 'Game postponed' };
    return age > GIVE_UP_MS ? { status: 'void', value: null, note: 'Game not found or not played' } : null;
  }
  if (isNblGameMarket(leg.market)) return gradeNblGame(leg, game.home_score, game.visitor_score);
  if (isNblPropMarket(leg.market) || isNbaAchievementMarket(leg.market)) {
    if (!leg.playerId) return { status: 'void', value: null, note: 'No player id on the leg' };
    const rows = await source.box(leg.eventKey);
    if (!rows.length) return age > GIVE_UP_MS ? { status: 'void', value: null, note: 'Box score never arrived' } : null;
    const row = rows.find((r) => String(r.player_id) === leg.playerId) ?? null;
    const grade = isNbaAchievementMarket(leg.market)
      ? gradeNbaAchievement(leg.market, row)
      : gradeNblProp(leg, leg.market, row ? boxValues(row) : null);
    const minutes = row ? num(row.minutes) : null;
    if (!minutes || minutes > FIRST_HALF_MINUTES || decidedEarly(leg, grade)) return grade;
    return leftEarly(leg, grade, minutes, source, age);
  }
  return { status: 'void', value: null, note: `Unknown NBA market ${leg.market}` };
}

/** Settled by what he did before leaving: an over or yes already hit, an under already gone past. */
function decidedEarly(leg: AiPickLeg, grade: LegGrade): boolean {
  return leg.side === 'under' ? grade.status === 'loss' : grade.status === 'win';
}

/**
 * A player who played the first half only: books void a bet his injury left undecided, but an ejection
 * is on him and the bet stands. null = quarter box scores or play-by-play not in yet.
 */
async function leftEarly(leg: AiPickLeg, grade: LegGrade, minutes: number, source: NbaResults, age: number): Promise<LegGrade | null> {
  if (!source.secondHalf) return grade;
  const played = await source.secondHalf(leg.eventKey);
  if (!played) return age > GIVE_UP_MS ? grade : null;
  if (played.has(leg.playerId!)) return grade;
  const ejected = source.ejected ? await source.ejected(leg.eventKey) : new Set<string>();
  if (!ejected && age <= GIVE_UP_MS) return null;
  if (ejected?.has(leg.playerId!)) return { ...grade, note: `${grade.note} (ejected)` };
  return { status: 'void', value: null, note: `Did not return for the second half (${Math.round(minutes)} min)` };
}
