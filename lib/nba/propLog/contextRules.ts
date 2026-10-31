import { nbaRosterEntry, resolveNbaBoardName } from '@/lib/aiPicks/candidates/nba';
import type { PropLogPlayer } from './lines';

export type ReportRow = { player_id: number; team_id: number | null; status: string; return_date: string | null; description: string | null };

export type StatusChange = {
  player_id: string;
  team_id: number | null;
  from_status: string | null;
  to_status: string;
  designation: string;
  injury_type: string | null;
  return_date: string | null;
};

/** The report's designation, normalised; "cleared" when a player drops off the report. */
export function designationOf(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase();
  if (!s) return 'cleared';
  if (/out/.test(s)) return 'out';
  if (/doubt/.test(s)) return 'doubtful';
  if (/question|game.?time|gtd/.test(s)) return 'questionable';
  if (/probable/.test(s)) return 'probable';
  if (/day.to.day/.test(s)) return 'day-to-day';
  return 'other';
}

const SEVERITY: Record<string, number> = { cleared: 0, other: 0, probable: 1, 'day-to-day': 2, questionable: 3, doubtful: 4, out: 5 };

/**
 * Whether a change is news worth a snapshot: the designation actually moves, and the move involves
 * questionable, doubtful or out. Same-designation edits (return date, wording), "available" players
 * dropping off the report and probable/available swaps are logged but are not news.
 */
export function isNewsChange(c: Pick<StatusChange, 'from_status' | 'designation'>): boolean {
  const from = SEVERITY[c.from_status == null ? 'cleared' : designationOf(c.from_status)] ?? 0;
  const to = SEVERITY[c.designation] ?? 0;
  return from !== to && Math.max(from, to) >= SEVERITY.questionable!;
}

/** Changes between two pulls of the report: new listings, status changes, and players who dropped off it. */
export function diffReports(prev: Record<string, ReportRow>, next: ReportRow[]): StatusChange[] {
  const out: StatusChange[] = [];
  const seen = new Set<string>();
  for (const r of next) {
    const id = String(r.player_id);
    seen.add(id);
    const before = prev[id];
    if (before && before.status === r.status && before.return_date === r.return_date) continue;
    out.push({
      player_id: id,
      team_id: r.team_id,
      from_status: before?.status ?? null,
      to_status: r.status,
      designation: designationOf(r.status),
      injury_type: r.description,
      return_date: r.return_date,
    });
  }
  for (const [id, before] of Object.entries(prev)) {
    if (seen.has(id)) continue;
    out.push({ player_id: id, team_id: before.team_id, from_status: before.status, to_status: 'cleared', designation: 'cleared', injury_type: before.description, return_date: null });
  }
  return out;
}

/** RotoWire's game key: the slate's ET date and away@home, so a back-to-back never borrows the other night's lineup. */
export function lineupGameKey(tipIso: string, awayCode: string, homeCode: string): string {
  const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(tipIso));
  return `${etDate}|${awayCode}@${homeCode}`;
}

export type LineupVersion = { id: string; gameKey: string; team: string; confirmed: boolean; starters: Array<{ name: string }>; mayNotPlay: Array<{ name: string }> };

/**
 * The player's place in his team's lineup version: "<confirmed|predicted>:<starter|may_not_play|bench>",
 * or "fallback" with no version (starter status then comes from his previous game, computed later).
 */
export function starterBasis(player: PropLogPlayer | null, lineup: LineupVersion | undefined, teamRoster: PropLogPlayer[]): string {
  if (!player || !lineup) return 'fallback';
  const entries = teamRoster.map((p) => nbaRosterEntry(p.id, p.name));
  const ids = (list: Array<{ name: string }>) => new Set(list.map((p) => resolveNbaBoardName(p.name, entries)).filter(Boolean));
  const kind = lineup.confirmed ? 'confirmed' : 'predicted';
  if (ids(lineup.starters).has(player.id)) return `${kind}:starter`;
  if (ids(lineup.mayNotPlay).has(player.id)) return `${kind}:may_not_play`;
  return `${kind}:bench`;
}
