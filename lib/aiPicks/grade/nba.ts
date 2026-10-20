import { isNbaAchievementMarket, isNblGameMarket, isNblPropMarket, type NbaAchievementMarket } from '@/lib/aiPicks/markets';
import { gradeNblGame, gradeNblProp, type LegGrade, type NblBoxValues } from '@/lib/aiPicks/grade/rules';
import type { AiPickLeg } from '@/lib/aiPicks/types';

/** Past this, a game that never went final (or never got box scores) is void. */
const GIVE_UP_MS = 3 * 24 * 60 * 60 * 1000;

export type NbaGameRow = { id: number; status_state: string | null; postponed: boolean | null; home_score: number | null; visitor_score: number | null };
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
export type NbaResults = { game(gameId: string): Promise<NbaGameRow | null>; box(gameId: string): Promise<NbaBoxRow[]> };

const db = async () => (await import('@/lib/supabaseAdmin')).supabaseAdmin;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};

/** Per-run cache: one game read and one box-score read per game (the leg's event key is the game id). */
export class NbaResultsSource implements NbaResults {
  private games = new Map<string, Promise<NbaGameRow | null>>();
  private boxes = new Map<string, Promise<NbaBoxRow[]>>();

  game(gameId: string): Promise<NbaGameRow | null> {
    let hit = this.games.get(gameId);
    if (!hit) {
      hit = (async () => {
        const id = Number(gameId);
        if (!Number.isFinite(id)) return null;
        const { data, error } = await (await db())
          .from('nba_games')
          .select('id, status_state, postponed, home_score, visitor_score')
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(`nba_games ${gameId}: ${error.message}`);
        return (data as NbaGameRow | null) ?? null;
      })();
      this.games.set(gameId, hit);
    }
    return hit;
  }

  box(gameId: string): Promise<NbaBoxRow[]> {
    let hit = this.boxes.get(gameId);
    if (!hit) {
      hit = (async () => {
        const { data, error } = await (await db())
          .from('nba_player_game_stats')
          .select('player_id, minutes, pts, reb, ast, fg3m, stl, blk')
          .eq('game_id', Number(gameId))
          .eq('period', 0);
        if (error) throw new Error(`nba box ${gameId}: ${error.message}`);
        return (data ?? []) as NbaBoxRow[];
      })();
      this.boxes.set(gameId, hit);
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
 * null = not gradeable yet. Box scores land with the 3-hourly NBA sync, so a final game with no box
 * rows waits; once the game has rows, a player missing from them did not play (void).
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
    if (isNbaAchievementMarket(leg.market)) return gradeNbaAchievement(leg.market, row);
    return gradeNblProp(leg, leg.market, row ? boxValues(row) : null);
  }
  return { status: 'void', value: null, note: `Unknown NBA market ${leg.market}` };
}
