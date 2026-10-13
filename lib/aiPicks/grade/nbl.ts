import { isNblGameMarket, isNblPropMarket, parseNblEventKey } from '@/lib/aiPicks/markets';
import { gradeNblGame, gradeNblProp, type LegGrade, type NblBoxValues } from '@/lib/aiPicks/grade/rules';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import { fetchNblSchedule } from '@/lib/nbl/rosettaLeague';
import { fetchNblPlayerBoxscores } from '@/lib/nbl/rosettaPlayer';
import type { RosettaMatch, RosettaPlayerBoxScore } from '@/lib/nbl/rosettaTypes';
import { NBL_CURRENT_SEASON_YEAR, normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

const SEASON_TYPES = ['regular', 'finals'] as const;
/** Rosetta can lag a final whistle; a player missing from the box score this long after the match is a DNP. */
const DNP_AFTER_MS = 4 * 60 * 60 * 1000;
const MATCH_WINDOW_MS = 18 * 60 * 60 * 1000;
const BOX_MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};

/** Rosetta datetimes are UTC without a zone suffix. */
export function rosettaUtcMs(value: string | null | undefined): number {
  const s = String(value || '').trim();
  if (!s) return Number.NaN;
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`);
}

function clubKey(name: string | null | undefined): string {
  return normalizeTeamKey(resolveNblClubName(name) ?? String(name || ''));
}

function matchIsFinal(m: RosettaMatch): boolean {
  const status = String(m.match_status || m.status || '').toLowerCase();
  if (status && !/(complete|final|closed)/.test(status)) return false;
  return num(m.home_score) != null && num(m.away_score) != null;
}

/** Per-run cache so a slate of legs costs one schedule call and one box-score call per player. */
export class NblResultsSource {
  private schedule: Promise<RosettaMatch[]> | null = null;
  private boxes = new Map<string, Promise<RosettaPlayerBoxScore[]>>();

  constructor(private readonly year = NBL_CURRENT_SEASON_YEAR) {}

  private loadSchedule(): Promise<RosettaMatch[]> {
    this.schedule ??= Promise.all(SEASON_TYPES.map((t) => fetchNblSchedule(this.year, t))).then((lists) => {
      if (lists.every((l) => l == null)) throw new Error('NBL schedule unavailable');
      return lists.flatMap((l) => l ?? []);
    });
    return this.schedule;
  }

  private loadBoxes(playerId: string): Promise<RosettaPlayerBoxScore[]> {
    let hit = this.boxes.get(playerId);
    if (!hit) {
      hit = Promise.all(SEASON_TYPES.map((t) => fetchNblPlayerBoxscores(playerId, this.year, t))).then((lists) => {
        if (lists.every((l) => l == null)) throw new Error(`NBL box scores unavailable for ${playerId}`);
        return lists.flatMap((l) => l ?? []);
      });
      this.boxes.set(playerId, hit);
    }
    return hit;
  }

  async findMatch(eventKey: string, startsAt: string): Promise<RosettaMatch | null> {
    const ev = parseNblEventKey(eventKey);
    if (!ev) return null;
    const home = clubKey(ev.home.replace(/-/g, ' '));
    const away = clubKey(ev.away.replace(/-/g, ' '));
    const start = Date.parse(startsAt);
    const matches = await this.loadSchedule();
    return (
      matches.find((m) => {
        if (clubKey(m.home_team?.name) !== home || clubKey(m.away_team?.name) !== away) return false;
        const t = rosettaUtcMs(m.start_time_datetime || m.start_time);
        return Number.isFinite(t) && Math.abs(t - start) <= MATCH_WINDOW_MS;
      }) ?? null
    );
  }

  /** The schedule and box-score feeds use different match ids, so match on tip-off time. */
  async playerBox(playerId: string, match: RosettaMatch): Promise<RosettaPlayerBoxScore | null> {
    const tip = rosettaUtcMs(match.start_time_datetime || match.start_time);
    if (!Number.isFinite(tip)) return null;
    const rows = await this.loadBoxes(playerId);
    return (
      rows.find((r) => {
        const t = rosettaUtcMs(r.match?.start_time_datetime);
        return Number.isFinite(t) && Math.abs(t - tip) <= BOX_MATCH_WINDOW_MS;
      }) ?? null
    );
  }
}

function boxValues(row: RosettaPlayerBoxScore): NblBoxValues {
  return {
    minutes: row.participated === false ? 0 : num(row.minutes),
    points: num(row.points),
    rebounds: num(row.rebounds),
    assists: num(row.assists),
    threeMade: num(row.three_points_made),
  };
}

/** null = not gradeable yet (match not final, or the box score may still be landing). */
export async function gradeNblLeg(leg: AiPickLeg, source: NblResultsSource, nowMs: number): Promise<LegGrade | null> {
  const match = await source.findMatch(leg.eventKey, leg.startsAt);
  if (!match) {
    const ageMs = nowMs - Date.parse(leg.startsAt);
    return ageMs > 3 * 24 * 60 * 60 * 1000 ? { status: 'void', value: null, note: 'Game not found or not played' } : null;
  }
  if (!matchIsFinal(match)) return null;
  const homeScore = num(match.home_score)!;
  const awayScore = num(match.away_score)!;

  if (isNblGameMarket(leg.market)) return gradeNblGame(leg, homeScore, awayScore);

  if (isNblPropMarket(leg.market)) {
    if (!leg.playerId) return { status: 'void', value: null, note: 'No player id on the leg' };
    const row = await source.playerBox(leg.playerId, match);
    if (!row && nowMs - Date.parse(leg.startsAt) < DNP_AFTER_MS) return null;
    return gradeNblProp(leg, leg.market, row ? boxValues(row) : null);
  }

  return { status: 'void', value: null, note: `Unknown NBL market ${leg.market}` };
}
