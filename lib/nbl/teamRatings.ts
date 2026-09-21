/**
 * Team offensive / defensive rating (points per 100 possessions).
 * ORtg = 100 × PTS / Poss. DRtg = 100 × Opp PTS / Opp Poss.
 */

import {
  NBL_CLUBS,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';
import {
  nblGamePace,
  nblPossessions,
  nblRatingPer100,
  nblRegulationTeamMinutes,
  round1,
} from '@/lib/nbl/advancedRates';
import {
  findNblOpponentBox,
  loadNblTeamBoxes,
  type NblTeamBox,
} from '@/lib/nbl/teamBoxScores';

export type NblTeamRating = {
  team: string;
  teamCode: string;
  shortName: string;
  games: number;
  offRtg: number;
  defRtg: number;
  netRtg: number;
  pace: number | null;
};

export type NblTeamRatingsPayload = {
  year: number;
  seasonLabel: string;
  generatedAt: string;
  teams: NblTeamRating[];
};

function boxesForTeam(boxes: Map<string, NblTeamBox>, teamCode: string): NblTeamBox[] {
  const out: NblTeamBox[] = [];
  for (const box of boxes.values()) {
    if (box.teamCode === teamCode) out.push(box);
  }
  return out;
}

export function loadNblTeamRatings(year: number): NblTeamRatingsPayload {
  const boxes = loadNblTeamBoxes(year);
  const regulation = nblRegulationTeamMinutes(year);
  const teams: NblTeamRating[] = [];

  for (const club of NBL_CLUBS) {
    const rows = boxesForTeam(boxes, club.code);
    let pts = 0;
    let poss = 0;
    let oppPts = 0;
    let oppPoss = 0;
    let games = 0;
    let paceSum = 0;
    let paceN = 0;

    for (const box of rows) {
      const teamPoss = nblPossessions(box.fga, box.fta, box.tov, box.orb);
      const opp = findNblOpponentBox(boxes, box.matchId, box.teamCode, box.opponentCode);
      if (teamPoss == null || teamPoss <= 0 || !opp) continue;
      const oppPossVal = nblPossessions(opp.fga, opp.fta, opp.tov, opp.orb);
      if (oppPossVal == null || oppPossVal <= 0) continue;
      pts += box.pts;
      poss += teamPoss;
      oppPts += opp.pts;
      oppPoss += oppPossVal;
      games += 1;
      const pace = nblGamePace({
        teamMp: box.minutes,
        teamPoss,
        oppPoss: oppPossVal,
        regulationTeamMinutes: regulation,
      });
      if (pace != null) {
        paceSum += pace;
        paceN += 1;
      }
    }

    const offRtg = nblRatingPer100(pts, poss);
    const defRtg = nblRatingPer100(oppPts, oppPoss);
    if (offRtg == null || defRtg == null || games <= 0) continue;

    teams.push({
      team: club.name,
      teamCode: club.code,
      shortName: club.shortName,
      games,
      offRtg: round1(offRtg),
      defRtg: round1(defRtg),
      netRtg: round1(offRtg - defRtg),
      pace: paceN > 0 ? round1(paceSum / paceN) : null,
    });
  }

  teams.sort((a, b) => b.offRtg - a.offRtg);

  return {
    year,
    seasonLabel: nblSeasonLabel(year),
    generatedAt: new Date().toISOString(),
    teams,
  };
}
