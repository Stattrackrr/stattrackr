/**
 * Predicted starters and "may not play" lists for a team's next game, read from the lineup log the
 * log-nba-lineups cron keeps in Redis. User reads never fetch the source page.
 */
import sharedCache from '@/lib/sharedCache';
import { nbaRosterEntry, resolveNbaBoardName, type NbaRosterEntry } from '@/lib/aiPicks/candidates/nba';
import { rotowireDayKey, type RwDayLog, type RwPlayer, type RwTeamSnapshot } from '@/lib/nba/rotowireLineups';
import { getNbaPlayersInfo, type NbaPlayerInfo } from './season';
import { getNbaClubByCode, resolveNbaClub } from './teams';
import type { NbaPredictedLineupsPayload, NbaPredictedPlayer, NbaPredictedTeam } from './predictedLineupsShared';

const DAY_MS = 86_400_000;
/** Keep showing a game's lineup this long after tip, then move on to the next game. */
const AFTER_TIP_MS = 3 * 60 * 60 * 1000;

const STATUS_LABELS: Record<string, string> = {
  out: 'Out',
  ofs: 'Out for season',
  doubt: 'Doubtful',
  ques: 'Questionable',
  gtd: 'Game-time decision',
  prob: 'Probable',
  susp: 'Suspended',
};

function statusLabel(tag: string | null): string | null {
  if (!tag) return null;
  return STATUS_LABELS[tag.trim().toLowerCase().replace(/\.$/, '')] ?? tag.trim();
}

function etDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms)
  );
}

function teamOut(
  code: string,
  snaps: RwTeamSnapshot[],
  roster: NbaRosterEntry[],
  players: Map<string, NbaPlayerInfo>
): NbaPredictedTeam {
  const last = snaps[snaps.length - 1]!;
  const player = (p: RwPlayer): NbaPredictedPlayer => {
    const id = resolveNbaBoardName(p.name, roster);
    return {
      name: (id && players.get(id)?.name) || p.name,
      position: p.pos,
      playerId: id,
      imageUrl: (id && players.get(id)?.imageUrl) || null,
      status: statusLabel(p.tag),
      playPct: p.playPct,
    };
  };
  return {
    code,
    name: getNbaClubByCode(code)?.name ?? code,
    confirmed: last.confirmed,
    starters: last.starters.map(player),
    mayNotPlay: last.mayNotPlay.map(player),
  };
}

export async function loadNbaPredictedLineups(team: string, nowMs = Date.now()): Promise<NbaPredictedLineupsPayload | null> {
  const club = resolveNbaClub(team);
  if (!club) return null;
  const dates = [...new Set([-1, 0, 1].map((d) => etDate(nowMs + d * DAY_MS)))];
  const logs = (await sharedCache.getJSONMany<RwDayLog>(dates.map(rotowireDayKey))).filter((l): l is RwDayLog => !!l);

  const games = logs
    .flatMap((log) => Object.values(log.games).map((g) => ({ g, checkedAt: log.checkedAt })))
    .filter(({ g }) => (g.away === club.code || g.home === club.code) && g.teams[g.away]?.length && g.teams[g.home]?.length)
    .filter(({ g }) => !g.tipAt || Date.parse(g.tipAt) > nowMs - AFTER_TIP_MS)
    .sort((a, b) => Date.parse(a.g.tipAt ?? '') - Date.parse(b.g.tipAt ?? ''));
  const hit = games[0];
  if (!hit) return null;
  const { g } = hit;

  const players = await getNbaPlayersInfo();
  const rosterFor = (code: string): NbaRosterEntry[] => {
    const id = getNbaClubByCode(code)?.id;
    const own = [...players.values()].filter((p) => String(p.currentTeamId) === id).map((p) => nbaRosterEntry(p.playerId, p.name));
    return own.length ? own : [...players.values()].map((p) => nbaRosterEntry(p.playerId, p.name));
  };
  const away = g.teams[g.away]!;
  const home = g.teams[g.home]!;
  const updatedAt = [away.at(-1)!.at, home.at(-1)!.at].sort().at(-1) ?? null;
  const checkedAt = [away.at(-1)!.seenAt, home.at(-1)!.seenAt].sort().at(-1) ?? hit.checkedAt;
  return {
    tipAt: g.tipAt,
    updatedAt,
    checkedAt,
    away: teamOut(g.away, away, rosterFor(g.away), players),
    home: teamOut(g.home, home, rosterFor(g.home), players),
  };
}
