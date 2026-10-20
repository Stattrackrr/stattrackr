/**
 * NBA scan: the odds board (BallDontLie US books + odds-api.net AU books), this season's and last
 * season's box scores from the Redis season snapshots, and the injury report. No per-player queries.
 */

import { NBA_ACHIEVEMENT_MARKETS, NBL_PROP_MARKETS, type NblPropMarket } from '@/lib/aiPicks/markets';
import type { NblInjuryContext } from '@/lib/aiPicks/model/nblContext';
import { playedGames } from '@/lib/aiPicks/model/nblProps';
import {
  NBA_GAME_MODEL,
  nbaFinalsFromDataset,
  nbaGameScore,
  type NbaMissing,
  nbaTeamRatings,
  projectNbaGame,
  type NbaFinal,
  type NbaGameContext,
} from '@/lib/aiPicks/model/nbaGames';
import {
  addNbaDvpGame,
  emptyNbaDvp,
  nbaPositionGroup,
  nbaPropContext,
  type NbaDvpTable,
} from '@/lib/aiPicks/model/nbaProps';
import { DEFAULT_AI_PICKS_PARAMS, type AiSportParams } from '@/lib/aiPicks/params';
import { isNbaGameTimeCall } from '@/lib/aiPicks/decide/select';
import {
  buildNbaAchievementCandidates,
  buildNbaGameCandidates,
  buildNbaPropCandidates,
  nbaAchievementQuotes,
  nbaPlayerLines,
  nbaRosterEntry,
  resolveNbaBoardName,
  saneSpreads,
  type NbaPropGameContext,
  type NbaResolvedPlayer,
  type NbaRosterEntry,
} from '@/lib/aiPicks/candidates/nba';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import { getNbaOddsCache, normalizeNbaPropPlayerName } from '@/lib/nba/dash/odds';
import type { NbaGameOdds, NbaOddsCache } from '@/lib/nba/dash/oddsTypes';
import { getNbaSeasonDataset, type NbaSeasonDataset } from '@/lib/nba/dash/season';
import { getNbaClubById, NBA_CURRENT_SEASON_YEAR, resolveNbaClub } from '@/lib/nba/dash/teams';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { BdlClient } from '@/lib/nba/bdl/client';
import { mapInjury } from '@/lib/nba/sync/mappers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type NbaScanResult = {
  candidates: AiCandidate[];
  games: Array<{ eventLabel: string; startsAt: string; propLines: number; players: number; gameBooks: number }>;
  unresolvedPlayers: string[];
  /** Board spellings matched to a player other than by exact name. */
  renamed?: string[];
  boardUpdatedAt: string | null;
  /** Last odds-api.net pull: the AU prices (every price we post) are only as fresh as this. */
  auPricesAt: string | null;
  /** When the injury report used was pulled (live near tip, else the last stored sync). */
  injuriesAt?: string | null;
  contextIssues?: string[];
};

type Injury = { playerId: string; teamCode: string; status: string; returning: string | null; description: string | null };

/** Prior-season box scores count this much in the matchup table (rosters and schemes change). */
const PRIOR_DVP_WEIGHT = 0.3;
const REGULAR_MINUTES = 20;
const MISSED_GAMES_BLOCK = 3;
const MIN_HISTORY_GAMES = 10;
const EARLY_SEASON_GAMES = 5;
/** A game this close gets the live injury report. */
export const NBA_LIVE_INJURY_LEAD_MS = 3 * 60 * 60 * 1000;
const LIVE_INJURY_TIMEOUT_MS = 20_000;

function inWindow(commenceTime: string, nowMs: number, horizonMs: number): boolean {
  const t = Date.parse(commenceTime);
  return Number.isFinite(t) && t > nowMs + 5 * 60_000 && t <= nowMs + horizonMs;
}

function toInjury(r: { player_id: unknown; team_id: unknown; status: unknown; return_date: unknown; description: unknown }): Injury {
  return {
    playerId: String(r.player_id),
    teamCode: getNbaClubById(r.team_id as number)?.code ?? '',
    status: String(r.status || ''),
    returning: r.return_date ? String(r.return_date) : null,
    description: r.description ? String(r.description) : null,
  };
}

/** The stored report: as fresh as the 3-hourly sync. */
async function storedInjuries(): Promise<{ rows: Injury[]; at: string | null }> {
  const { data, error } = await supabaseAdmin.from('nba_injuries').select('player_id, team_id, status, return_date, description, updated_at');
  if (error) throw new Error(`nba_injuries: ${error.message}`);
  const at = (data ?? []).reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null);
  return { rows: (data ?? []).map(toInjury).filter((r) => r.teamCode && r.status), at };
}

/** BallDontLie's report right now (a few requests, nothing stored); teams post late scratches close to tip. */
async function liveInjuries(): Promise<{ rows: Injury[]; at: string }> {
  const bdl = new BdlClient({ apiKey: process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '', perMinute: 120, maxRetries: 1 });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('live injury report timed out')), LIVE_INJURY_TIMEOUT_MS));
  const raw = await Promise.race([bdl.all<Parameters<typeof mapInjury>[0]>('/v1/player_injuries'), timeout]);
  const rows = raw.filter((r) => r.player?.id).map((r) => toInjury(mapInjury(r)));
  if (!rows.length) throw new Error('live injury report came back empty');
  return { rows: rows.filter((r) => r.teamCode && r.status), at: new Date().toISOString() };
}

/** Live when a game is close (late news decides props), the stored report otherwise or if the live pull fails. */
async function loadInjuries(live: boolean, issues: string[]): Promise<{ rows: Injury[]; at: string | null }> {
  if (live) {
    try {
      return await liveInjuries();
    } catch (e) {
      issues.push(`Live injury report failed, using the stored one: ${e instanceof Error ? e.message : e}`);
    }
  }
  return storedInjuries();
}

const isOut = (status: string) => /out|doubtful/i.test(status);
/** A questionable player this involved moves his teammates' numbers and the game lines. */
const HOLD_REGULAR_MINUTES = 25;

type TeamLogs = { code: string; games: Array<{ matchId: string; date: string; season: number; players: Map<string, number> }> };

export async function scanNbaCandidates(opts: {
  nowMs?: number;
  horizonMs?: number;
  params?: AiSportParams;
  season?: number;
  /** A board built in memory (dry runs) instead of the stored one. */
  board?: NbaOddsCache | null;
}): Promise<NbaScanResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const horizonMs = opts.horizonMs ?? 24 * 60 * 60 * 1000;
  const params = opts.params ?? DEFAULT_AI_PICKS_PARAMS.nba;
  const season = opts.season ?? NBA_CURRENT_SEASON_YEAR;

  const board = opts.board ?? (await getNbaOddsCache());
  const games = (board?.games ?? []).filter((g) => inWindow(g.commenceTime, nowMs, horizonMs));
  const result: NbaScanResult = {
    candidates: [],
    games: [],
    unresolvedPlayers: [],
    renamed: [],
    boardUpdatedAt: board?.lastUpdated ?? null,
    auPricesAt: board?.oddsNetFetchedAt ?? null,
    contextIssues: [],
  };
  if (!games.length) return result;

  const live = games.some((g) => Date.parse(g.commenceTime) - nowMs <= NBA_LIVE_INJURY_LEAD_MS);
  const [cur, prev, report] = await Promise.all([
    getNbaSeasonDataset(season),
    getNbaSeasonDataset(season - 1),
    loadInjuries(live, result.contextIssues!).catch((e: Error) => {
      result.contextIssues!.push(e.message);
      return { rows: [] as Injury[], at: null };
    }),
  ]);
  const injuries = report.rows;
  result.injuriesAt = report.at;
  const datasets: NbaSeasonDataset[] = [prev, cur];
  const finals: NbaFinal[] = [...nbaFinalsFromDataset(prev), ...nbaFinalsFromDataset(cur)];
  const rated = nbaTeamRatings(finals, season);
  const gamePace = new Map(finals.map((f) => [f.matchId, ((f.homePoss + f.awayPoss) / 2) * (48 / f.minutes)]));

  const logsOf = (id: string): NbaGameLogRow[] => [...(prev.logsByPlayer.get(id) ?? []), ...(cur.logsByPlayer.get(id) ?? [])];
  const positionOf = (id: string) => nbaPositionGroup(cur.players.get(id)?.position ?? prev.players.get(id)?.position);

  const dvp: NbaDvpTable = emptyNbaDvp();
  for (const ds of datasets) {
    const w = ds.season === season ? 1 : PRIOR_DVP_WEIGHT;
    for (const [id, logs] of ds.logsByPlayer) {
      const pos = positionOf(id);
      if (pos) for (const row of logs) if (!row.postseason) addNbaDvpGame(dvp, row, pos, NBL_PROP_MARKETS, w);
    }
  }

  const teams = new Map<string, TeamLogs>();
  const teamGame = new Map<string, TeamLogs['games'][number]>();
  for (const ds of datasets) {
    for (const [id, logs] of ds.logsByPlayer) {
      for (const g of logs) {
        if (!g.teamCode) continue;
        const key = `${g.matchId}|${g.teamCode}`;
        let game = teamGame.get(key);
        if (!game) {
          game = { matchId: g.matchId, date: String(g.date), season: g.season, players: new Map() };
          teamGame.set(key, game);
          const t = teams.get(g.teamCode) ?? { code: g.teamCode, games: [] };
          t.games.push(game);
          teams.set(g.teamCode, t);
        }
        game.players.set(id, g.minutes ?? 0);
      }
    }
  }
  for (const t of teams.values()) t.games.sort((a, b) => a.date.localeCompare(b.date));

  const nameOf = (id: string) => cur.players.get(id)?.name ?? prev.players.get(id)?.name ?? id;
  const injuriesBy = new Map<string, Injury[]>();
  for (const inj of injuries) injuriesBy.set(inj.teamCode, [...(injuriesBy.get(inj.teamCode) ?? []), inj]);

  const restDays = (code: string, commenceTime: string): number | null => {
    const last = (teams.get(code)?.games ?? []).filter((g) => g.season === season && Date.parse(g.date) < Date.parse(commenceTime)).at(-1);
    if (!last) return null;
    const day = (iso: string) => Math.floor((Date.parse(iso) - 5 * 3_600_000) / 86_400_000);
    return day(commenceTime) - day(last.date);
  };

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  /**
   * Listed players who are regulars: played 3 of the team's last 5 at this many minutes. Players new to
   * the team (traded, signed) or before its third game go on their own minutes wherever they played:
   * their last 5 this season, else last season as a whole (its final weeks miss injured and rested regulars).
   */
  const regularsListed = (code: string, listed: (status: string) => boolean, minMinutes: number) => {
    const thisSeason = (teams.get(code)?.games ?? []).filter((g) => g.season === season);
    const teamRecent = thisSeason.slice(-5);
    const isRegular = (id: string) => {
      if (thisSeason.length >= 3 && thisSeason.some((g) => g.players.has(id))) {
        const mins = teamRecent.flatMap((g) => (g.players.has(id) ? [g.players.get(id)!] : []));
        return mins.length >= 3 && avg(mins) >= minMinutes;
      }
      const own = (playedGames(logsOf(id)) as NbaGameLogRow[]).filter((g) => !g.postseason);
      const mine = own.filter((g) => g.season === season);
      if (mine.length >= 3) return avg(mine.slice(-5).map((g) => g.minutes ?? 0)) >= minMinutes;
      // The team is under way without him: the market and its ratings already reflect that.
      if (thisSeason.length >= 3) return false;
      const last = own.filter((g) => g.season === season - 1);
      return last.length >= 10 && avg(last.map((g) => g.minutes ?? 0)) >= minMinutes;
    };
    return (injuriesBy.get(code) ?? []).filter((inj) => listed(inj.status) && isRegular(inj.playerId));
  };
  const regularsOut = (code: string) => regularsListed(code, isOut, REGULAR_MINUTES);
  /** Big-minutes regulars who may or may not play: everything around them waits for the call. */
  const regularsQuestionable = (code: string) =>
    regularsListed(code, (s) => isNbaGameTimeCall(s) && !isOut(s), HOLD_REGULAR_MINUTES).map((inj) => `${nameOf(inj.playerId)} (${inj.status})`);
  /** Missing regulars' points, game score and minutes a game over their last 40 regular-season games. */
  const missing = (out: Injury[]): NbaMissing => {
    const m: NbaMissing = { players: [], points: 0, gameScore: 0, minutes: 0 };
    for (const inj of out) {
      const rows = (playedGames(logsOf(inj.playerId)) as NbaGameLogRow[]).filter((g) => !g.postseason).slice(-40);
      m.players.push(nameOf(inj.playerId));
      if (!rows.length) continue;
      m.points += rows.reduce((a, g) => a + (g.points ?? 0), 0) / rows.length;
      m.gameScore += rows.reduce((a, g) => a + nbaGameScore(g), 0) / rows.length;
      m.minutes += rows.reduce((a, g) => a + (g.minutes ?? 0), 0) / rows.length;
    }
    return m;
  };

  for (const odds of games) {
    const homeClub = resolveNbaClub(odds.homeTeam);
    const awayClub = resolveNbaClub(odds.awayTeam);
    if (!homeClub || !awayClub) {
      result.contextIssues!.push(`Unknown teams ${odds.awayTeam} @ ${odds.homeTeam}`);
      continue;
    }
    const cleaned: NbaGameOdds = { ...odds, bookmakers: odds.bookmakers.map(saneSpreads) };
    const base = projectNbaGame(homeClub.code, awayClub.code, rated, NBA_GAME_MODEL);
    const gameCtx: NbaGameContext = {
      homeMissing: missing(regularsOut(homeClub.code)),
      awayMissing: missing(regularsOut(awayClub.code)),
      homeRestDays: restDays(homeClub.code, odds.commenceTime),
      awayRestDays: restDays(awayClub.code, odds.commenceTime),
      strength: params.contextStrength,
    };
    const seasonGames = (code: string) => (teams.get(code)?.games ?? []).filter((g) => g.season === season).length;
    const priorGames = (code: string) => (teams.get(code)?.games ?? []).filter((g) => g.season === season - 1).length;
    const sample = Math.min(
      ...[homeClub.code, awayClub.code].map((c) => seasonGames(c) + NBA_GAME_MODEL.priorSeasonWeight * priorGames(c))
    );
    const gameFlags = Math.min(seasonGames(homeClub.code), seasonGames(awayClub.code)) < EARLY_SEASON_GAMES ? ['Early season: team ratings lean on last season'] : [];
    const questionable = new Map([homeClub.code, awayClub.code].map((c) => [c, regularsQuestionable(c)]));
    result.candidates.push(
      ...buildNbaGameCandidates({
        odds: cleaned,
        base,
        params,
        context: gameCtx,
        sample: round1(sample),
        flags: gameFlags,
        waitingOn: { home: questionable.get(homeClub.code) ?? [], away: questionable.get(awayClub.code) ?? [] },
      })
    );

    // Player props
    const sideCodes = new Set([homeClub.code, awayClub.code]);
    const rosterById = new Map<string, NbaRosterEntry>();
    for (const ds of [prev, cur]) {
      for (const [id, info] of ds.players) {
        const club = getNbaClubById(info.currentTeamId);
        if (info.active && club && sideCodes.has(club.code)) rosterById.set(id, nbaRosterEntry(id, info.name));
      }
    }
    const roster = [...rosterById.values()];
    const boardPlayers = new Set<string>();
    for (const players of Object.values(odds.playerProps ?? {})) for (const name of Object.keys(players ?? {})) boardPlayers.add(name);
    const namesById = new Map<string, string[]>();
    for (const name of boardPlayers) {
      const id = resolveNbaBoardName(name, roster);
      if (!id) {
        result.unresolvedPlayers.push(`${name} (${odds.awayTeam} @ ${odds.homeTeam})`);
        continue;
      }
      const names = namesById.get(id) ?? [];
      // The exact spelling leads so the candidate keeps the cleanest name.
      if (rosterById.get(id)?.norm === normalizeNbaPropPlayerName(name)) names.unshift(name);
      else {
        names.push(name);
        result.renamed!.push(`${name} -> ${nameOf(id)}`);
      }
      namesById.set(id, names);
    }
    let resolvedCount = 0;
    let propLines = 0;
    for (const [id, names] of namesById) {
      const club = getNbaClubById(cur.players.get(id)?.currentTeamId ?? prev.players.get(id)?.currentTeamId)!;
      const isHome = club.code === homeClub.code;
      const oppClub = isHome ? awayClub : homeClub;
      const games = logsOf(id);
      const lines = nbaPlayerLines(cleaned, names);
      propLines += lines.length;
      if (!lines.length && !NBA_ACHIEVEMENT_MARKETS.some((m) => nbaAchievementQuotes(cleaned, names, m).length)) continue;
      const player: NbaResolvedPlayer = { playerId: id, name: nameOf(id), team: club.name, teamCode: club.code, games };

      const flags: string[] = [];
      const played = playedGames(games) as NbaGameLogRow[];
      const thisSeason = played.filter((g) => g.season === season);
      const lastTeam = played.at(-1)?.teamCode ?? null;
      if (played.length < MIN_HISTORY_GAMES) flags.push(`Not enough games behind the projection (${played.length})`);
      if (lastTeam && lastTeam !== club.code && thisSeason.filter((g) => g.teamCode === club.code).length < 3) {
        flags.push(`Fewer than 3 games with ${club.name}`);
      }
      const lastMs = Date.parse(String(played.at(-1)?.date ?? ''));
      const missed = (teams.get(club.code)?.games ?? []).filter((g) => g.season === season && Date.parse(g.date) > lastMs).length;
      if (missed >= MISSED_GAMES_BLOCK) flags.push(`Has not played in his team's last ${missed} games`);
      if (thisSeason.length < EARLY_SEASON_GAMES) flags.push('Early season: projection leans on last season');

      const mates = injuriesBy.get(club.code) ?? [];
      const self = mates.find((m) => m.playerId === id) ?? null;
      const teammatesOut: Array<NblInjuryContext & { games: NbaGameLogRow[] | null }> = mates
        .filter((m) => m !== self && isOut(m.status))
        .map((m) => ({ player: nameOf(m.playerId), status: m.status, injury: m.description ?? undefined, returning: m.returning ?? undefined, games: logsOf(m.playerId) }));
      const rest = restDays(club.code, odds.commenceTime);
      const pos = positionOf(id);
      const context: NbaPropGameContext = {
        listed: self ? { player: nameOf(id), status: self.status, injury: self.description ?? undefined, returning: self.returning ?? undefined } : null,
        waitingOn: (questionable.get(club.code) ?? []).filter((n) => !n.startsWith(`${nameOf(id)} (`)),
        flags,
        forStat: (stat: NblPropMarket, proj) =>
          nbaPropContext({
            stat,
            games,
            currentSeason: season,
            isHome,
            position: pos,
            opponent: oppClub.code,
            dvp,
            expectedPace: base.pace,
            gamePace,
            teammatesOut,
            restDays: rest,
            absMargin: Math.abs(base.homeMargin),
            expectedMinutes: proj.expectedMinutes,
            strength: params.contextStrength,
          }),
        facts: {
          position: pos,
          team: rated.ratings.get(club.code) ?? null,
          opponent: rated.ratings.get(oppClub.code) ?? null,
          league: rated.league,
          expectedPace: base.pace,
          teammatesOut: teammatesOut.map((m) => `${m.player} (${m.status})`),
          opponentOut: (injuriesBy.get(oppClub.code) ?? []).filter((m) => isOut(m.status)).map((m) => `${nameOf(m.playerId)} (${m.status})`),
          restDays: rest,
          opponentRestDays: restDays(oppClub.code, odds.commenceTime),
          home: isHome,
        },
      };
      const built = [
        ...buildNbaPropCandidates({
          game: { gameId: odds.gameId, homeTeam: odds.homeTeam, awayTeam: odds.awayTeam, commenceTime: odds.commenceTime },
          lines,
          player,
          opponent: { name: oppClub.name, code: oppClub.code },
          params,
          currentSeason: season,
          context,
        }),
        ...buildNbaAchievementCandidates({
          game: { gameId: odds.gameId, homeTeam: odds.homeTeam, awayTeam: odds.awayTeam, commenceTime: odds.commenceTime },
          odds: cleaned,
          names,
          player,
          opponent: { name: oppClub.name, code: oppClub.code },
          params,
          currentSeason: season,
          context,
        }),
      ];
      // The board spellings, so the pre-post price check finds the same player in a fresh pull.
      for (const c of built) c.context.boardNames = names;
      result.candidates.push(...built);
      resolvedCount += 1;
    }
    result.games.push({
      eventLabel: `${odds.awayTeam} @ ${odds.homeTeam}`,
      startsAt: odds.commenceTime,
      propLines,
      players: resolvedCount,
      gameBooks: odds.bookmakers.length,
    });
  }
  return result;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
