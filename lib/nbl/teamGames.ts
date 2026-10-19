/**
 * One row per team per game: possessions, pace (per 40 minutes, overtime scaled out), points and
 * ratings, from the team boxes summed out of the cached player logs. Only games where both teams'
 * boxes are complete are kept, since a missing player's minutes and shots would skew pace.
 */

import { NBL_CLUBS } from '@/lib/nblTeamCanonical';
import { nblGamePace, nblPossessions, nblRegulationTeamMinutes } from '@/lib/nbl/advancedRates';
import { findNblOpponentBox, loadNblTeamBoxes, type NblTeamBox } from '@/lib/nbl/teamBoxScores';

export type NblTeamGame = {
  matchId: string;
  date: string;
  season: number;
  team: string;
  opponent: string;
  isHome: boolean | null;
  pace: number;
  poss: number;
  oppPoss: number;
  pts: number;
  oppPts: number;
};

/** Box minutes below this share of regulation mean someone's log is missing. */
const COMPLETE_SHARE = 0.97;

const clubName = (code: string | null | undefined) => NBL_CLUBS.find((c) => c.code === code)?.name ?? null;

export function teamGamesFromBoxes(boxes: Map<string, NblTeamBox>, season: number): NblTeamGame[] {
  const regulation = nblRegulationTeamMinutes(season);
  const out: NblTeamGame[] = [];
  for (const box of boxes.values()) {
    const opp = findNblOpponentBox(boxes, box.matchId, box.teamCode, box.opponentCode);
    const team = clubName(box.teamCode);
    const opponent = clubName(opp?.teamCode);
    const date = box.date || opp?.date;
    if (!opp || !team || !opponent || !date) continue;
    if (box.minutes < regulation * COMPLETE_SHARE || opp.minutes < regulation * COMPLETE_SHARE) continue;
    const poss = nblPossessions(box.fga, box.fta, box.tov, box.orb);
    const oppPoss = nblPossessions(opp.fga, opp.fta, opp.tov, opp.orb);
    if (!poss || !oppPoss || poss <= 0 || oppPoss <= 0) continue;
    const pace = nblGamePace({ teamMp: box.minutes, teamPoss: poss, oppPoss, regulationTeamMinutes: regulation });
    if (pace == null || pace < 55 || pace > 110) continue;
    out.push({
      matchId: box.matchId,
      date,
      season,
      team,
      opponent,
      isHome: box.isHome ?? (opp.isHome != null ? !opp.isHome : null),
      pace,
      poss,
      oppPoss,
      pts: box.pts,
      oppPts: opp.pts,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function loadNblTeamGames(seasons: number[]): NblTeamGame[] {
  return seasons
    .flatMap((s) => teamGamesFromBoxes(loadNblTeamBoxes(s), s))
    .sort((a, b) => a.date.localeCompare(b.date));
}
