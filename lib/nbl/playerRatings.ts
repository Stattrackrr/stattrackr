/**
 * Player offensive / defensive rating.
 * ORtg = 100 × PTS / possessions used (FGA + 0.44×FTA + TO).
 * DRtg = Basketball-Reference individual defensive rating from box + team defense.
 */

import fs from 'fs';
import path from 'path';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import {
  nblPossessions,
  nblPossessionsUsed,
  nblRatingPer100,
  round1,
} from '@/lib/nbl/advancedRates';
import {
  findNblOpponentBox,
  loadNblTeamBoxes,
  nblTeamBoxKey,
  type NblTeamBox,
} from '@/lib/nbl/teamBoxScores';

export type NblPlayerRating = {
  playerId: string;
  name: string;
  team: string;
  games: number;
  minutes: number;
  offRtg: number | null;
  defRtg: number | null;
};

export type NblPlayerRatingsPayload = {
  year: number;
  generatedAt: string;
  players: NblPlayerRating[];
};

const MIN_GAME_MINUTES = 5;
/** Pull one-game ORtg toward a typical 110 so 4-possession 225s don't print. */
const ORTG_PRIOR_POSS = 20;
const ORTG_PRIOR_RATE = 110;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function playerLogsDir(): string {
  return path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs');
}

/** Basketball-Reference individual DRtg from box-score stops. */
export function nblPlayerDefensiveRating(input: {
  mp: number;
  stl: number;
  blk: number;
  drb: number;
  pf: number;
  team: NblTeamBox;
  opp: NblTeamBox;
  oppPoss: number;
  teamDRtg: number;
}): number | null {
  const { mp, stl, blk, drb, pf, team, opp, oppPoss, teamDRtg } = input;
  if (mp <= 0 || team.minutes <= 0 || oppPoss <= 0) return null;

  const oppFtPct = opp.fta > 0 ? opp.ftm / opp.fta : 0;
  const drebAvail = opp.orb + team.drb;
  const dorbPct = drebAvail > 0 ? opp.orb / drebAvail : 0.28;
  const dfgPct = opp.fga > 0 ? opp.fgm / opp.fga : 0.45;
  const fmwtDen = dfgPct * (1 - dorbPct) + (1 - dfgPct) * dorbPct;
  const fmwt = fmwtDen > 0 ? (dfgPct * (1 - dorbPct)) / fmwtDen : 0.5;

  const stops1 = stl + blk * fmwt * (1 - 1.07 * dorbPct) + drb * (1 - fmwt);
  const stops2 =
    (((opp.fga - opp.fgm - team.blk) / team.minutes) * fmwt * (1 - 1.07 * dorbPct) +
      (opp.tov - team.stl) / team.minutes) *
      mp +
    (team.pf > 0 ? pf / team.pf : 0) * 0.4 * opp.fta * (1 - oppFtPct) ** 2;
  const stops = Math.max(0, stops1 + stops2);
  const oppMp = opp.minutes > 0 ? opp.minutes : team.minutes;
  const stopPct = Math.min(1, Math.max(0, (stops * oppMp) / (oppPoss * mp)));

  const scPoss = opp.fgm + (1 - (1 - oppFtPct) ** 2) * opp.fta * 0.4;
  if (scPoss <= 0) return teamDRtg;
  const dPtsPerScPoss = opp.pts / scPoss;
  return teamDRtg + 0.2 * (100 * dPtsPerScPoss * (1 - stopPct) - teamDRtg);
}

type Agg = {
  playerId: string;
  name: string;
  team: string;
  games: number;
  minutes: number;
  pts: number;
  possUsed: number;
  defWeighted: number;
  defMinutes: number;
};

export function loadNblPlayerRatings(year: number): NblPlayerRatingsPayload {
  const boxes = loadNblTeamBoxes(year);
  const dir = playerLogsDir();
  const byId = new Map<string, Agg>();

  if (fs.existsSync(dir)) {
    const suffix = `-${year}.json`;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(suffix)) continue;
      let games: NblGameLogRow[] = [];
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as {
          playerId?: string;
          name?: string;
          games?: NblGameLogRow[];
        };
        games = Array.isArray(data.games) ? data.games : [];
        const fallbackId = String(data.playerId || file.replace(suffix, '')).trim();
        const fallbackName = String(data.name || '').trim();
        for (const g of games) {
          const mp = num(g.minutes);
          if (mp < MIN_GAME_MINUTES) continue;
          const playerId = String(fallbackId).trim();
          if (!playerId) continue;
          let agg = byId.get(playerId);
          if (!agg) {
            agg = {
              playerId,
              name: fallbackName || playerId,
              team: String(g.team || ''),
              games: 0,
              minutes: 0,
              pts: 0,
              possUsed: 0,
              defWeighted: 0,
              defMinutes: 0,
            };
            byId.set(playerId, agg);
          }
          if (!agg.name && fallbackName) agg.name = fallbackName;
          if (g.team) agg.team = String(g.team);

          const poss = nblPossessionsUsed(num(g.fgAttempted), num(g.ftAttempted), num(g.turnovers));
          agg.games += 1;
          agg.minutes += mp;
          agg.pts += num(g.points);
          if (poss != null) agg.possUsed += poss;

          const teamCode = g.teamCode || g.team;
          const key = nblTeamBoxKey(String(g.matchId || ''), teamCode);
          const team = key ? boxes.get(key) : undefined;
          if (!team) continue;
          const opp = findNblOpponentBox(boxes, String(g.matchId || ''), team.teamCode, team.opponentCode);
          if (!opp) continue;
          const oppPoss = nblPossessions(opp.fga, opp.fta, opp.tov, opp.orb);
          if (oppPoss == null || oppPoss <= 0) continue;
          const teamDRtg = nblRatingPer100(opp.pts, oppPoss);
          if (teamDRtg == null) continue;
          const drtg = nblPlayerDefensiveRating({
            mp,
            stl: num(g.steals),
            blk: num(g.blocks),
            drb: num(g.defensiveRebounds),
            pf: num(g.fouls),
            team,
            opp,
            oppPoss,
            teamDRtg,
          });
          if (drtg == null) continue;
          agg.defWeighted += drtg * mp;
          agg.defMinutes += mp;
        }
      } catch {
        continue;
      }
    }
  }

  const players: NblPlayerRating[] = [];
  for (const agg of byId.values()) {
    const offRtg =
      agg.possUsed > 0
        ? nblRatingPer100(
            agg.pts + (ORTG_PRIOR_RATE / 100) * ORTG_PRIOR_POSS,
            agg.possUsed + ORTG_PRIOR_POSS
          )
        : null;
    players.push({
      playerId: agg.playerId,
      name: agg.name,
      team: agg.team,
      games: agg.games,
      minutes: round1(agg.minutes / Math.max(1, agg.games)),
      offRtg: offRtg != null ? round1(offRtg) : null,
      defRtg: agg.defMinutes > 0 ? round1(agg.defWeighted / agg.defMinutes) : null,
    });
  }

  return {
    year,
    generatedAt: new Date().toISOString(),
    players,
  };
}
