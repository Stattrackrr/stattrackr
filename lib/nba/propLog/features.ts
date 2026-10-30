/**
 * The new model's inputs, computed for each logged line from what was known at capture time
 * (agreed build spec, Part D): the projection's per-minute rate and spread, expected minutes with and
 * without tonight's information, the pooled usage shift from listed teammates, and the implied-minutes
 * gap (tested as a separate model). Everything is stored on the snapshot; nothing bets on it yet.
 */

import { NBL_PROP_MARKETS, type NblPropMarket } from '@/lib/aiPicks/markets';
import { projectNbaProp } from '@/lib/aiPicks/model/nbaProps';
import { nblStatValue } from '@/lib/aiPicks/model/nblProps';
import { getNbaSeasonDataset } from '@/lib/nba/dash/season';
import { NBA_CURRENT_SEASON_YEAR, resolveNbaClub } from '@/lib/nba/dash/teams';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { BASE_STATS, type BaseStat } from '@/lib/nba/model/design';
import { FITTED_MINUTES_COEFS, minutesNewInfoZ, tonightMinutes, type MinutesGame } from '@/lib/nba/model/minutes';
import { pOut } from '@/lib/nba/model/pOut';
import { absentShare, usageDelta, type Absentee } from '@/lib/nba/model/usage';
import { designationOf } from './contextRules';

/** Combo stats as their parts, for the usage shift. */
const PARTS: Record<NblPropMarket, BaseStat[]> = {
  points: ['points'],
  rebounds: ['rebounds'],
  assists: ['assists'],
  threeMade: ['threeMade'],
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

const ROTATION_MINUTES = 20;
const etDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayOf = (g: NbaGameLogRow) => String(g.date || '').slice(0, 10);

export type FeatureRow = {
  game_id: string;
  tip_at: string;
  player_id: string | null;
  team: string | null;
  stat: string;
  main_line: number;
  market_spread: number | null;
  injury_report: Array<{ player_id: number; team_id: number | null; status: string }>;
  starter_basis: string | null;
  role_changed_recently?: boolean | null;
  features: Record<string, unknown>;
};

type TeamGame = { matchId: string; date: string; players: Map<string, number>; totals: Record<BaseStat, number> };

function startsTonight(basis: string | null): boolean | null {
  if (!basis || basis === 'fallback') return null;
  if (basis.endsWith(':starter')) return true;
  return false;
}

/** Adds the model inputs to each row's features (rows for unknown players are left alone). */
export async function addModelFeatures(rows: FeatureRow[]): Promise<{ computed: number; skipped: number }> {
  const withPlayer = rows.filter((r) => r.player_id && r.team);
  if (!withPlayer.length) return { computed: 0, skipped: rows.length };
  const [cur, prev] = await Promise.all([getNbaSeasonDataset(NBA_CURRENT_SEASON_YEAR), getNbaSeasonDataset(NBA_CURRENT_SEASON_YEAR - 1)]);

  // Team schedules this season, with who played and team totals.
  const teamGames = new Map<string, Map<string, TeamGame>>();
  for (const [id, logs] of cur.logsByPlayer) {
    for (const g of logs) {
      if (g.postseason || !g.teamCode || !g.date) continue;
      const games = teamGames.get(g.teamCode) ?? new Map<string, TeamGame>();
      const tg = games.get(g.matchId) ?? { matchId: g.matchId, date: dayOf(g), players: new Map(), totals: { points: 0, rebounds: 0, assists: 0, threeMade: 0 } };
      if ((g.minutes ?? 0) > 0) tg.players.set(id, g.minutes ?? 0);
      for (const s of BASE_STATS) tg.totals[s] += nblStatValue(g, s) ?? 0;
      games.set(g.matchId, tg);
      teamGames.set(g.teamCode, games);
    }
  }
  const schedule = (team: string, beforeDay: string) =>
    [...(teamGames.get(team)?.values() ?? [])].filter((g) => g.date < beforeDay).sort((a, b) => a.date.localeCompare(b.date));

  // Starters in this season's games.
  const matchIds = [...new Set([...teamGames.values()].flatMap((m) => [...m.keys()]))].map(Number).filter(Number.isFinite);
  const started = new Map<string, boolean>();
  for (let i = 0; i < matchIds.length; i += 200) {
    const { data } = await supabaseAdmin.from('nba_lineups').select('game_id, player_id, starter').in('game_id', matchIds.slice(i, i + 200));
    for (const r of data ?? []) started.set(`${r.game_id}|${r.player_id}`, Boolean(r.starter));
  }

  const logsOf = (id: string, beforeDay: string) =>
    [...(prev.logsByPlayer.get(id) ?? []), ...(cur.logsByPlayer.get(id) ?? [])].filter((g) => !g.noSecondHalf && dayOf(g) < beforeDay);
  const recentAvg = (id: string, team: string, beforeDay: string, read: (g: NbaGameLogRow) => number | null) => {
    const played = (cur.logsByPlayer.get(id) ?? []).filter((g) => g.teamCode === team && dayOf(g) < beforeDay && (g.minutes ?? 0) > 0).slice(-10);
    return played.length ? played.reduce((a, g) => a + (read(g) ?? 0), 0) / played.length : null;
  };

  let computed = 0;
  type Listed = Absentee & { minutes: number };
  const absenteeCache = new Map<string, Listed[]>();
  for (const row of withPlayer) {
    const day = etDay(row.tip_at);
    const team = row.team!;
    const pid = row.player_id!;
    const sched = schedule(team, day);
    const history = logsOf(pid, day);
    const stat = row.stat as NblPropMarket;
    if (!NBL_PROP_MARKETS.includes(stat)) continue;
    const proj = projectNbaProp(history, stat, NBA_CURRENT_SEASON_YEAR);
    if (!proj) continue;
    const sd = Math.sqrt(proj.variance);

    // Listed rotation teammates who played in one of the last 3 team games: fresh absences only.
    const key = `${row.game_id}|${team}`;
    let absentees = absenteeCache.get(key);
    if (!absentees) {
      const teamId = Number(resolveNbaClub(team)?.id);
      const recent = new Set(sched.slice(-3).flatMap((g) => [...g.players.keys()]));
      absentees = [];
      for (const inj of row.injury_report) {
        const id = String(inj.player_id);
        if (inj.team_id !== teamId || !recent.has(id)) continue;
        const minutes = recentAvg(id, team, day, (g) => g.minutes);
        if (minutes == null || minutes < ROTATION_MINUTES) continue;
        let missedInRow = 0;
        for (let i = sched.length - 1; i >= 0 && !sched[i]!.players.has(id); i -= 1) missedInRow += 1;
        const p = pOut({ missedInRow, designation: designationOf(inj.status) });
        absentees.push({
          id,
          pOut: p.p,
          minutes,
          statPerGame: Object.fromEntries(BASE_STATS.map((s) => [s, recentAvg(id, team, day, (g) => nblStatValue(g, s)) ?? 0])),
        });
      }
      absenteeCache.set(key, absentees);
    }
    const others = absentees.filter((a) => a.id !== pid);

    // Minutes: this season's games (last season if fewer than 2), with starter flags.
    const curGames = (cur.logsByPlayer.get(pid) ?? []).filter((g) => dayOf(g) < day && (g.minutes ?? 0) > 0);
    const source = curGames.length >= 2 ? curGames : history.filter((g) => (g.minutes ?? 0) > 0);
    const minutesGames: MinutesGame[] = source.map((g) => ({ date: dayOf(g), minutes: g.minutes ?? 0, started: started.get(`${g.matchId}|${pid}`) ?? null }));
    let run = 0;
    for (let i = sched.length - 1; i >= 0 && sched[i]!.players.has(pid); i -= 1) run += 1;
    let missed = 0;
    for (let i = sched.length - 1 - run; i >= 0 && !sched[i]!.players.has(pid); i -= 1) missed += 1;
    const lastTeamDay = sched.at(-1)?.date;
    const est = tonightMinutes(
      minutesGames,
      {
        startsTonight: startsTonight(row.starter_basis),
        gamesSinceReturn: missed >= 3 && run <= 2 && sched.length - 1 - run >= 0 ? run : null,
        backToBack: lastTeamDay ? (Date.parse(day) - Date.parse(lastTeamDay)) / 86_400_000 <= 1 : false,
        absSpread: row.market_spread == null ? null : Math.abs(row.market_spread),
        teammateMinutesOut: others.reduce((a, o) => a + o.pOut * o.minutes, 0),
      },
      FITTED_MINUTES_COEFS
    );
    if (!est) continue;

    // Usage: pooled shift per part, at tonight's minutes.
    const recentTeam = sched.slice(-10);
    let usage = 0;
    const shares: Record<string, number> = {};
    for (const part of PARTS[stat]) {
      const partProj = part === stat ? proj : projectNbaProp(history, part, NBA_CURRENT_SEASON_YEAR);
      if (!partProj) continue;
      const teamPerGame = recentTeam.reduce((a, g) => a + g.totals[part], 0) / Math.max(1, recentTeam.length);
      const share = absentShare(others, teamPerGame, part);
      shares[part] = Math.round(share * 1000) / 1000;
      usage += usageDelta(partProj.ratePerMinute, est.tonight, share, part);
    }

    const lastTeam = history.at(-1)?.teamCode ?? null;
    const recentStarts = minutesGames.slice(-3).map((g) => g.started).filter((v): v is boolean => v != null);
    row.role_changed_recently =
      (lastTeam != null && lastTeam !== team) || new Set(recentStarts).size > 1 || (missed >= 3 && run <= 2);
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    row.features = {
      ...row.features,
      projection: { mean: proj.mean, rate: proj.ratePerMinute, sd: r4(sd), sample: proj.sample },
      minutes: { base: r4(est.base), tonight: r4(est.tonight), parts: est.parts },
      minutes_new_info_z: r4(minutesNewInfoZ(est, proj.ratePerMinute, sd)),
      usage: { delta: r4(usage), shares },
      usage_shift_z: r4(sd > 0 ? usage / sd : 0),
      implied_minutes_gap_z: r4(sd > 0 ? (row.main_line - est.tonight * proj.ratePerMinute) / sd : 0),
      absentees: others.map((o) => ({ id: o.id, pOut: r4(o.pOut) })),
    };
    computed += 1;
  }
  return { computed, skipped: rows.length - computed };
}
