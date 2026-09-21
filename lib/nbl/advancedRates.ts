/**
 * SpatialJam / Basketball-Reference box-score rates.
 * Percentages are 0–100. Pace is possessions per 40 minutes.
 */

export const NBL_FT_POSSESSION_WEIGHT = 0.44;

/** 40-min NBL: 5×40. 48-min era (pre-2018/19) used 5×48. */
export function nblRegulationTeamMinutes(year: number): number {
  return year >= 2018 ? 200 : 240;
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

/** Possessions = FGA + 0.44×FTA + TO − OR */
export function nblPossessions(fga: number, fta: number, tov: number, orb: number): number | null {
  if (![fga, fta, tov, orb].every(finite)) return null;
  return fga + NBL_FT_POSSESSION_WEIGHT * fta + tov - orb;
}

/** Player possessions used = FGA + 0.44×FTA + TO (no ORB subtraction). */
export function nblPossessionsUsed(fga: number, fta: number, tov: number): number | null {
  if (![fga, fta, tov].every(finite)) return null;
  return fga + NBL_FT_POSSESSION_WEIGHT * fta + tov;
}

/** Points per possession used = PTS / (FGA + 0.44×FTA + TO). */
export function nblPointsPerPossession(pts: number, possUsed: number): number | null {
  if (![pts, possUsed].every(finite) || possUsed <= 0) return null;
  return pts / possUsed;
}

/** Assists per possession used = AST / (FGA + 0.44×FTA + TO). */
export function nblAssistsPerPossession(ast: number, possUsed: number): number | null {
  if (![ast, possUsed].every(finite) || possUsed <= 0) return null;
  return ast / possUsed;
}

/**
 * USG% = 100 × ((FGA + 0.44×FTA + TOV) × (Tm MP / 5)) / (MP × (Tm FGA + 0.44×Tm FTA + Tm TOV))
 */
export function nblUsagePct(input: {
  mp: number;
  fga: number;
  fta: number;
  tov: number;
  teamMp: number;
  teamFga: number;
  teamFta: number;
  teamTov: number;
}): number | null {
  const { mp, fga, fta, tov, teamMp, teamFga, teamFta, teamTov } = input;
  if (![mp, fga, fta, tov, teamMp, teamFga, teamFta, teamTov].every(finite)) return null;
  if (mp <= 0 || teamMp <= 0) return null;
  const playerPlays = fga + NBL_FT_POSSESSION_WEIGHT * fta + tov;
  const teamPlays = teamFga + NBL_FT_POSSESSION_WEIGHT * teamFta + teamTov;
  if (teamPlays <= 0) return null;
  return (100 * playerPlays * (teamMp / 5)) / (mp * teamPlays);
}

/** TS% = PTS / (2 × (FGA + 0.44×FTA)), as 0–100. */
export function nblTrueShootingPct(pts: number, fga: number, fta: number): number | null {
  if (![pts, fga, fta].every(finite)) return null;
  const tsa = 2 * (fga + NBL_FT_POSSESSION_WEIGHT * fta);
  if (tsa <= 0) return null;
  return (pts / tsa) * 100;
}

/**
 * Rebound % = 100 × (REB × (Tm MP / 5)) / (MP × (Tm REB + Opp REB))
 * Use TRB/TRB, ORB/(Tm ORB + Opp DRB), or DRB/(Tm DRB + Opp ORB).
 */
export function nblReboundPct(input: {
  mp: number;
  playerReb: number;
  teamMp: number;
  teamReb: number;
  oppReb: number;
}): number | null {
  const { mp, playerReb, teamMp, teamReb, oppReb } = input;
  if (![mp, playerReb, teamMp, teamReb, oppReb].every(finite)) return null;
  if (mp <= 0 || teamMp <= 0) return null;
  const available = teamReb + oppReb;
  if (available <= 0) return null;
  return (100 * playerReb * (teamMp / 5)) / (mp * available);
}

/** Pace = [regulationTmMP / Team Minutes] × (Team Poss + Opp Poss) / 2 */
export function nblGamePace(input: {
  teamMp: number;
  teamPoss: number;
  oppPoss: number;
  regulationTeamMinutes?: number;
}): number | null {
  const teamMp = input.teamMp;
  const teamPoss = input.teamPoss;
  const oppPoss = input.oppPoss;
  const regulation = input.regulationTeamMinutes ?? 200;
  if (![teamMp, teamPoss, oppPoss, regulation].every(finite)) return null;
  if (teamMp <= 0) return null;
  return (regulation / teamMp) * ((teamPoss + oppPoss) / 2);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Offensive/defensive rating = 100 × points / possessions. */
export function nblRatingPer100(pts: number, poss: number): number | null {
  if (![pts, poss].every(finite) || poss <= 0) return null;
  return (100 * pts) / poss;
}
