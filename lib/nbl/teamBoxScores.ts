/**
 * Per-game team boxes summed from cached player logs, then SpatialJam rates.
 */

import fs from 'fs';
import path from 'path';
import { nblRosettaYearStamp } from '@/lib/nbl/ladderSeason';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import {
  nblGamePace,
  nblPossessions,
  nblReboundPct,
  nblRegulationTeamMinutes,
  nblTrueShootingPct,
  nblUsagePct,
  round1,
} from '@/lib/nbl/advancedRates';

export type NblTeamBox = {
  matchId: string;
  teamCode: string;
  opponentCode: string | null;
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tov: number;
  orb: number;
  drb: number;
  trb: number;
  stl: number;
  blk: number;
  pf: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function nblTeamBoxKey(matchId: string, teamCode: string | null | undefined): string | null {
  const id = String(matchId || '').trim();
  const code = resolveNblSteTeamCode(teamCode);
  if (!id || !code) return null;
  return `${id}::${code}`;
}

const boxesByYear = new Map<string, Map<string, NblTeamBox>>();

function playerLogsDir(): string {
  return path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs');
}

function emptyBox(matchId: string, teamCode: string, opponentCode: string | null): NblTeamBox {
  return {
    matchId,
    teamCode,
    opponentCode,
    minutes: 0,
    pts: 0,
    fgm: 0,
    fga: 0,
    ftm: 0,
    fta: 0,
    tov: 0,
    orb: 0,
    drb: 0,
    trb: 0,
    stl: 0,
    blk: 0,
    pf: 0,
  };
}

export function loadNblTeamBoxes(year: number): Map<string, NblTeamBox> {
  const cacheKey = `${year}:${nblRosettaYearStamp(year)}:box3`;
  const cached = boxesByYear.get(cacheKey);
  if (cached) return cached;

  const boxes = new Map<string, NblTeamBox>();
  const dir = playerLogsDir();
  if (!fs.existsSync(dir)) {
    boxesByYear.set(cacheKey, boxes);
    return boxes;
  }

  const suffix = `-${year}.json`;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(suffix)) continue;
    let games: NblGameLogRow[] = [];
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as {
        games?: NblGameLogRow[];
      };
      games = Array.isArray(data.games) ? data.games : [];
    } catch {
      continue;
    }
    for (const g of games) {
      if ((num(g.minutes) || 0) <= 0) continue;
      const teamCode = resolveNblSteTeamCode(g.teamCode || g.team);
      const key = nblTeamBoxKey(g.matchId, teamCode);
      if (!key || !teamCode) continue;
      const opp = resolveNblSteTeamCode(g.opponentCode || g.opponent);
      const prev = boxes.get(key) ?? emptyBox(String(g.matchId), teamCode, opp);
      if (!prev.opponentCode && opp) prev.opponentCode = opp;
      prev.minutes += num(g.minutes);
      prev.pts += num(g.points);
      prev.fgm += num(g.fgMade);
      prev.fga += num(g.fgAttempted);
      prev.ftm += num(g.ftMade);
      prev.fta += num(g.ftAttempted);
      prev.tov += num(g.turnovers);
      prev.orb += num(g.offensiveRebounds);
      prev.drb += num(g.defensiveRebounds);
      prev.trb += num(g.rebounds) || num(g.offensiveRebounds) + num(g.defensiveRebounds);
      prev.stl += num(g.steals);
      prev.blk += num(g.blocks);
      prev.pf += num(g.fouls);
      boxes.set(key, prev);
    }
  }

  boxesByYear.set(cacheKey, boxes);
  return boxes;
}

export function findNblOpponentBox(
  boxes: Map<string, NblTeamBox>,
  matchId: string,
  teamCode: string,
  opponentCode: string | null
): NblTeamBox | null {
  const byOpp = nblTeamBoxKey(matchId, opponentCode);
  if (byOpp && boxes.has(byOpp)) return boxes.get(byOpp) ?? null;
  const prefix = `${matchId}::`;
  for (const [key, box] of boxes) {
    if (key.startsWith(prefix) && box.teamCode !== teamCode) return box;
  }
  return null;
}

function attachRates(
  game: NblGameLogRow,
  boxes: Map<string, NblTeamBox>,
  year: number
): NblGameLogRow {
  const mp = num(game.minutes);
  const tsPct = nblTrueShootingPct(num(game.points), num(game.fgAttempted), num(game.ftAttempted));
  const teamCode = resolveNblSteTeamCode(game.teamCode || game.team);
  const key = nblTeamBoxKey(game.matchId, teamCode);
  const team = key ? boxes.get(key) : undefined;
  const opp =
    team && teamCode
      ? findNblOpponentBox(boxes, String(game.matchId), teamCode, team.opponentCode)
      : null;

  const usgPct =
    team && mp > 0
      ? nblUsagePct({
          mp,
          fga: num(game.fgAttempted),
          fta: num(game.ftAttempted),
          tov: num(game.turnovers),
          teamMp: team.minutes,
          teamFga: team.fga,
          teamFta: team.fta,
          teamTov: team.tov,
        })
      : null;

  const trebPct =
    team && opp && mp > 0
      ? nblReboundPct({
          mp,
          playerReb: num(game.rebounds),
          teamMp: team.minutes,
          teamReb: team.trb,
          oppReb: opp.trb,
        })
      : null;
  const orebPct =
    team && opp && mp > 0
      ? nblReboundPct({
          mp,
          playerReb: num(game.offensiveRebounds),
          teamMp: team.minutes,
          teamReb: team.orb,
          oppReb: opp.drb,
        })
      : null;
  const drebPct =
    team && opp && mp > 0
      ? nblReboundPct({
          mp,
          playerReb: num(game.defensiveRebounds),
          teamMp: team.minutes,
          teamReb: team.drb,
          oppReb: opp.orb,
        })
      : null;

  const teamPoss = team ? nblPossessions(team.fga, team.fta, team.tov, team.orb) : null;
  const oppPoss = opp ? nblPossessions(opp.fga, opp.fta, opp.tov, opp.orb) : null;
  const pace =
    team && teamPoss != null && oppPoss != null
      ? nblGamePace({
          teamMp: team.minutes,
          teamPoss,
          oppPoss,
          regulationTeamMinutes: nblRegulationTeamMinutes(year),
        })
      : null;

  return {
    ...game,
    usgPct: usgPct != null ? round1(usgPct) : null,
    tsPct: tsPct != null ? round1(tsPct) : null,
    trebPct: trebPct != null ? round1(trebPct) : null,
    orebPct: orebPct != null ? round1(orebPct) : null,
    drebPct: drebPct != null ? round1(drebPct) : null,
    pace: pace != null ? round1(pace) : null,
  };
}

export function enrichNblGamesAdvancedRates(
  games: NblGameLogRow[],
  year: number
): NblGameLogRow[] {
  if (!games.length) return games;
  const boxes = loadNblTeamBoxes(year);
  return games.map((game) => attachRates(game, boxes, year));
}
