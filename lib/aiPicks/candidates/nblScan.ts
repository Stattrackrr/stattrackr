import fs from 'fs';
import path from 'path';
import { rosettaUtcMs } from '@/lib/aiPicks/grade/nbl';
import type { NblFinal, NblGameContext } from '@/lib/aiPicks/model/nblGames';
import { nblPropContext } from '@/lib/aiPicks/model/nblContext';
import { DEFAULT_AI_PICKS_PARAMS, type AiSportParams } from '@/lib/aiPicks/params';
import {
  buildNblGameCandidates,
  buildNblPropCandidates,
  type NblPropGameContext,
  type NblResolvedPlayer,
} from '@/lib/aiPicks/candidates/nbl';
import {
  injuriesFor,
  loadNblContextData,
  matchupFor,
  playedSinceReport,
  restDays,
  teamContext,
  teamInjuryImpact,
} from '@/lib/aiPicks/candidates/nblContextData';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import { flattenPulseNblGame, playerKeyOf } from '@/lib/nbl/playerPropSnapshots';
import { loadNblPlayerGameLogs } from '@/lib/nbl/playerGameLogsServer';
import { namesMatch, readNblPulseScoreBoardCache, type PulseNblGame } from '@/lib/nbl/pulseScore';
import { NBL_ODDS_CACHE_KEY, type NblOddsCache } from '@/lib/nbl/refreshNblOdds';
import { fetchNblSchedule } from '@/lib/nbl/rosettaLeague';
import { fetchNormalizedPlayerGameLogs } from '@/lib/nbl/rosettaPlayer';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';
import { nblTeamKey } from '@/lib/aiPicks/model/nblGames';
import sharedCache from '@/lib/sharedCache';

type RosterPlayer = { playerId: string; name: string; team: string };

export type NblScanResult = {
  candidates: AiCandidate[];
  games: Array<{ eventLabel: string; startsAt: string; propLines: number; players: number; gameBooks: number }>;
  unresolvedPlayers: string[];
  boardUpdatedAt: string | null;
  /** Context sources that could not be used this scan (stale injury report, ...). */
  contextIssues?: string[];
};

function readRoster(year: number): RosterPlayer[] {
  const file = path.join(process.cwd(), 'data', `nbl-roster-${year}.json`);
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { players?: RosterPlayer[] };
    return Array.isArray(json.players) ? json.players : [];
  } catch {
    return [];
  }
}

const dayOf = (iso: string | null | undefined) => String(iso || '').slice(0, 10);

/** Committed logs for past seasons; this season straight from the NBL feed (disk if the feed fails). */
async function loadPlayerGames(playerId: string, season: number): Promise<NblGameLogRow[]> {
  const disk = loadNblPlayerGameLogs({ playerId, years: [season, season - 1, season - 2] })?.games ?? [];
  let live: NblGameLogRow[] = [];
  try {
    live = await fetchNormalizedPlayerGameLogs(playerId, season, 'regular');
  } catch {
    live = [];
  }
  const liveDays = new Set(live.map((g) => dayOf(g.date)));
  const merged = [...disk.filter((g) => Number(g.season) !== season || !liveDays.has(dayOf(g.date))), ...live];
  return merged.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

async function loadFinals(season: number): Promise<NblFinal[]> {
  const out: NblFinal[] = [];
  for (const year of [season, season - 1]) {
    const matches = (await fetchNblSchedule(year, 'regular')) ?? [];
    for (const m of matches) {
      const hs = Number(m.home_score);
      const as = Number(m.away_score);
      const status = String(m.match_status || m.status || '').toLowerCase();
      if (!Number.isFinite(hs) || !Number.isFinite(as) || m.home_score == null || (status && !/complete|final|closed/.test(status))) continue;
      const t = rosettaUtcMs(m.start_time_datetime || m.start_time);
      if (!Number.isFinite(t)) continue;
      out.push({ date: new Date(t).toISOString(), season: year, home: m.home_team?.name ?? '', away: m.away_team?.name ?? '', homeScore: hs, awayScore: as });
    }
  }
  return out;
}

function resolvePlayer(name: string, roster: RosterPlayer[], teams: string[]): RosterPlayer | null {
  const teamKeys = new Set(teams.map(nblTeamKey));
  const onTeams = roster.filter((p) => teamKeys.has(nblTeamKey(p.team)));
  return onTeams.find((p) => playerKeyOf(p.name) === playerKeyOf(name)) ?? onTeams.find((p) => namesMatch(p.name, name)) ?? null;
}

function inWindow(commenceTime: string, nowMs: number, horizonMs: number): boolean {
  const t = Date.parse(commenceTime);
  return Number.isFinite(t) && t > nowMs + 5 * 60_000 && t <= nowMs + horizonMs;
}

export async function scanNblCandidates(opts: {
  nowMs?: number;
  horizonMs?: number;
  params?: AiSportParams;
  season?: number;
}): Promise<NblScanResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const horizonMs = opts.horizonMs ?? 24 * 60 * 60 * 1000;
  const params = opts.params ?? DEFAULT_AI_PICKS_PARAMS.nbl;
  const season = opts.season ?? NBL_CURRENT_SEASON_YEAR;

  const board = await readNblPulseScoreBoardCache();
  const propGames = board.games.filter((g) => inWindow(g.commenceTime, nowMs, horizonMs));
  const oddsCache = await sharedCache.getJSON<NblOddsCache>(NBL_ODDS_CACHE_KEY);
  const oddsGames = (oddsCache?.games ?? []).filter((g) => inWindow(g.commenceTime, nowMs, horizonMs));

  const result: NblScanResult = { candidates: [], games: [], unresolvedPlayers: [], boardUpdatedAt: board.lastUpdated };
  if (!propGames.length && !oddsGames.length) return result;

  const roster = readRoster(season);
  const finals = await loadFinals(season);
  const ctx = loadNblContextData({ season, finals, nowMs });
  result.contextIssues = ctx.errors;
  const logCache = new Map<string, Promise<NblGameLogRow[]>>();
  const gamesFor = (id: string) => {
    let hit = logCache.get(id);
    if (!hit) logCache.set(id, (hit = loadPlayerGames(id, season)));
    return hit;
  };
  /** Players on a team's injury list who have not played since it was written, with their logs. */
  const outFor = async (team: string) => {
    const rows = await Promise.all(
      injuriesFor(ctx, team).map(async (entry) => {
        const hit = resolvePlayer(entry.player, roster, [team]);
        return { entry, playerId: hit?.playerId ?? null, games: hit ? await gamesFor(hit.playerId) : null };
      })
    );
    return rows.filter((r) => !playedSinceReport(r.games, r.entry.reportedAt));
  };
  const gameContext = async (homeTeam: string, awayTeam: string, commenceTime: string): Promise<NblGameContext> => {
    const [homeOut, awayOut] = await Promise.all([outFor(homeTeam), outFor(awayTeam)]);
    const h = teamInjuryImpact(ctx, homeTeam, homeOut, season);
    const a = teamInjuryImpact(ctx, awayTeam, awayOut, season);
    return {
      home: teamContext(ctx, homeTeam),
      away: teamContext(ctx, awayTeam),
      leaguePace: ctx.league?.pace || null,
      homeOutPoints: h.points,
      awayOutPoints: a.points,
      homeOut: h.names,
      awayOut: a.names,
      homeRestDays: restDays(ctx, homeTeam, commenceTime),
      awayRestDays: restDays(ctx, awayTeam, commenceTime),
      strength: params.contextStrength,
    };
  };

  for (const game of propGames) {
    const lines = flattenPulseNblGame(game);
    const byPlayer = new Map<string, typeof lines>();
    for (const l of lines) byPlayer.set(l.playerKey, [...(byPlayer.get(l.playerKey) ?? []), l]);
    const outByTeam = new Map<string, Awaited<ReturnType<typeof outFor>>>([
      [nblTeamKey(game.homeTeam), await outFor(game.homeTeam)],
      [nblTeamKey(game.awayTeam), await outFor(game.awayTeam)],
    ]);
    let players = 0;
    for (const playerLines of byPlayer.values()) {
      const name = playerLines[0]!.player;
      const hit = resolvePlayer(name, roster, [game.homeTeam, game.awayTeam]);
      if (!hit) {
        result.unresolvedPlayers.push(`${name} (${game.awayTeam} @ ${game.homeTeam})`);
        continue;
      }
      const resolved: NblResolvedPlayer = { playerId: hit.playerId, name: hit.name, team: hit.team, games: await gamesFor(hit.playerId) };
      const isHome = nblTeamKey(hit.team) === nblTeamKey(game.homeTeam);
      const opponent = isHome ? game.awayTeam : game.homeTeam;
      const mates = outByTeam.get(nblTeamKey(hit.team)) ?? [];
      const self = mates.find((m) => m.playerId === hit.playerId || namesMatch(m.entry.player, hit.name));
      const teammatesOut = mates.filter((m) => m !== self).map((m) => ({ ...m.entry, games: m.games }));
      const teamCtx = teamContext(ctx, hit.team);
      const oppCtx = teamContext(ctx, opponent);
      const rest = restDays(ctx, hit.team, game.commenceTime);
      const context: NblPropGameContext = {
        listed: self ? self.entry : null,
        forStat: (stat) =>
          nblPropContext({
            stat,
            games: resolved.games,
            currentSeason: season,
            isHome,
            dvp: matchupFor(ctx, hit.playerId, hit.name, opponent, stat),
            team: teamCtx,
            opponent: oppCtx,
            league: ctx.league,
            teammatesOut,
            restDays: rest,
            strength: params.contextStrength,
          }),
        facts: {
          team: teamCtx,
          opponent: oppCtx,
          leagueDefRtg: ctx.league ? Math.round(ctx.league.defRtg * 10) / 10 : null,
          teammatesOut: teammatesOut.map((m) => `${m.player} (${m.status})`),
          opponentOut: (outByTeam.get(nblTeamKey(opponent)) ?? []).map((m) => `${m.entry.player} (${m.entry.status})`),
          restDays: rest,
          opponentRestDays: restDays(ctx, opponent, game.commenceTime),
          home: isHome,
        },
      };
      result.candidates.push(
        ...buildNblPropCandidates({ game, lines: playerLines, player: resolved, opponent, params, currentSeason: season, nowMs, context })
      );
      players += 1;
    }
    const odds = matchOdds(game, oddsGames);
    result.games.push({
      eventLabel: `${game.awayTeam} @ ${game.homeTeam}`,
      startsAt: game.commenceTime,
      propLines: lines.length,
      players,
      gameBooks: odds?.bookmakers.length ?? 0,
    });
  }

  for (const odds of oddsGames) {
    const context = await gameContext(odds.homeTeam, odds.awayTeam, odds.commenceTime);
    result.candidates.push(...buildNblGameCandidates({ odds, finals, params, currentSeason: season, context }));
    if (!propGames.some((g) => sameGame(g, odds))) {
      result.games.push({ eventLabel: `${odds.awayTeam} @ ${odds.homeTeam}`, startsAt: odds.commenceTime, propLines: 0, players: 0, gameBooks: odds.bookmakers.length });
    }
  }
  return result;
}

function sameGame(a: { homeTeam: string; awayTeam: string; commenceTime: string }, b: { homeTeam: string; awayTeam: string; commenceTime: string }): boolean {
  return (
    nblTeamKey(a.homeTeam) === nblTeamKey(b.homeTeam) &&
    nblTeamKey(a.awayTeam) === nblTeamKey(b.awayTeam) &&
    Math.abs(Date.parse(a.commenceTime) - Date.parse(b.commenceTime)) < 6 * 60 * 60 * 1000
  );
}

function matchOdds<T extends { homeTeam: string; awayTeam: string; commenceTime: string }>(game: PulseNblGame, list: T[]): T | null {
  return list.find((o) => sameGame(game, o)) ?? null;
}
