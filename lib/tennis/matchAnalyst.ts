import { tennisBestOf } from '@/lib/tennis/apiTennis';
import { tennisLastName } from '@/lib/tennis/chartStats';
import { tennisHandForName } from '@/lib/tennis/hands';
import { tennisRankOnDate } from '@/lib/tennis/rankHistory';
import {
  loadPlayerMatches,
  loadTennisPlayers,
  tourForPlayer,
  type TennisMatchRow,
  type TennisTour,
} from '@/lib/tennis/data';
import type {
  TennisAnalystDriver,
  TennisAnalystEdge,
  TennisAnalystPlayer,
  TennisAnalystStats,
  TennisMatchAnalysis,
} from '@/lib/tennis/matchAnalystShared';

export type { TennisMatchAnalysis } from '@/lib/tennis/matchAnalystShared';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number, digits = 1): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function normalizeSurface(surface: string | null | undefined): 'hard' | 'clay' | 'grass' | null {
  const key = String(surface || '')
    .trim()
    .toLowerCase();
  if (key === 'hard' || key === 'clay' || key === 'grass') return key;
  return null;
}

function surfaceLabel(surface: string | null): string | null {
  if (!surface) return null;
  return surface.charAt(0).toUpperCase() + surface.slice(1);
}

function resolvePlayer(
  name: string,
  preferredTour: TennisTour
): { id: string | null; name: string; tour: TennisTour } {
  const players = loadTennisPlayers();
  const key = normName(name);
  if (!key) return { id: null, name, tour: preferredTour };
  const hit =
    players.find((p) => p.tour === preferredTour && normName(p.name) === key) ||
    players.find((p) => normName(p.name) === key);
  return {
    id: hit?.playerId ?? null,
    name: hit?.name || name,
    tour: hit?.tour || preferredTour,
  };
}

function holdPct(row: TennisMatchRow): number | null {
  const held = num(row.serviceGamesWon);
  const games = num(row.serveGames);
  if (held != null && games != null && games > 0) return (held / games) * 100;
  const faced = num(row.breakPointsFaced);
  const saved = num(row.breakPointsSaved);
  if (games == null || games <= 0 || faced == null || saved == null) return null;
  const broken = Math.max(0, faced - saved);
  return ((games - Math.min(games, broken)) / games) * 100;
}

function breakPct(row: TennisMatchRow): number | null {
  const broke = num(row.returnGamesWon);
  const serveGames = num(row.serveGames);
  const total = num(row.totalGames);
  if (broke != null && serveGames != null && total != null && total > serveGames) {
    return (broke / (total - serveGames)) * 100;
  }
  return null;
}

function windowRows(rows: TennisMatchRow[], n: number): TennisMatchRow[] {
  return rows.slice(-n);
}

function emptyStats(): TennisAnalystStats {
  return {
    matches: 0,
    record: '0-0',
    winPct: null,
    gameWinPct: null,
    setWinPct: null,
    holdPct: null,
    breakPct: null,
    aces: null,
    acesAllowed: null,
    df: null,
    firstServePct: null,
    firstServeWonPct: null,
    secondServeWonPct: null,
    spw: null,
    rpw: null,
    bpConv: null,
    bpSaved: null,
    gamesWon: null,
    gamesLost: null,
    totalGames: null,
    over215: null,
    over225: null,
  };
}

function summarize(rows: TennisMatchRow[]): TennisAnalystStats {
  if (!rows.length) return emptyStats();
  const wins = rows.filter((row) => row.isWin).length;
  const gamesWon = mean(rows.map((row) => num(row.gamesWon)).filter((v): v is number => v != null));
  const gamesLost = mean(rows.map((row) => num(row.gamesLost)).filter((v): v is number => v != null));
  const totalGames = mean(rows.map((row) => num(row.totalGames)).filter((v): v is number => v != null));
  const setsWon = mean(rows.map((row) => num(row.setsWon)).filter((v): v is number => v != null));
  const setsLost = mean(rows.map((row) => num(row.setsLost)).filter((v): v is number => v != null));
  const gamePlayed = gamesWon != null && gamesLost != null ? gamesWon + gamesLost : null;
  const setPlayed = setsWon != null && setsLost != null ? setsWon + setsLost : null;
  const withGames = rows.map((row) => num(row.totalGames)).filter((v): v is number => v != null);
  return {
    matches: rows.length,
    record: `${wins}-${rows.length - wins}`,
    winPct: round((wins / rows.length) * 100, 1),
    gameWinPct:
      gamePlayed != null && gamePlayed > 0 && gamesWon != null ? round((gamesWon / gamePlayed) * 100, 1) : null,
    setWinPct: setPlayed != null && setPlayed > 0 && setsWon != null ? round((setsWon / setPlayed) * 100, 1) : null,
    holdPct: roundMaybe(mean(rows.map(holdPct).filter((v): v is number => v != null)), 1),
    breakPct: roundMaybe(mean(rows.map(breakPct).filter((v): v is number => v != null)), 1),
    aces: roundMaybe(mean(rows.map((row) => num(row.aces)).filter((v): v is number => v != null)), 1),
    acesAllowed: roundMaybe(mean(rows.map((row) => num(row.opponentAces)).filter((v): v is number => v != null)), 1),
    df: roundMaybe(mean(rows.map((row) => num(row.doubleFaults)).filter((v): v is number => v != null)), 1),
    firstServePct: roundMaybe(mean(rows.map((row) => num(row.firstServePct)).filter((v): v is number => v != null)), 1),
    firstServeWonPct: roundMaybe(
      mean(rows.map((row) => num(row.firstServeWonPct)).filter((v): v is number => v != null)),
      1
    ),
    secondServeWonPct: roundMaybe(
      mean(rows.map((row) => num(row.secondServeWonPct)).filter((v): v is number => v != null)),
      1
    ),
    spw: roundMaybe(mean(rows.map((row) => num(row.servicePointsWonPct)).filter((v): v is number => v != null)), 1),
    rpw: roundMaybe(mean(rows.map((row) => num(row.returnPointsWonPct)).filter((v): v is number => v != null)), 1),
    bpConv: roundMaybe(
      mean(rows.map((row) => num(row.breakPointsConvertedPct)).filter((v): v is number => v != null)),
      1
    ),
    bpSaved: roundMaybe(mean(rows.map((row) => num(row.breakPointsSavedPct)).filter((v): v is number => v != null)), 1),
    gamesWon: roundMaybe(gamesWon, 1),
    gamesLost: roundMaybe(gamesLost, 1),
    totalGames: roundMaybe(totalGames, 1),
    over215: withGames.length ? round((withGames.filter((n) => n >= 22).length / withGames.length) * 100, 0) : null,
    over225: withGames.length ? round((withGames.filter((n) => n >= 23).length / withGames.length) * 100, 0) : null,
  };
}

function roundMaybe(value: number | null, digits: number): number | null {
  return value == null ? null : round(value, digits);
}

function formRecord(rows: TennisMatchRow[]): { record: string; winPct: number | null } {
  if (!rows.length) return { record: '0-0', winPct: null };
  const wins = rows.filter((row) => row.isWin).length;
  return { record: `${wins}-${rows.length - wins}`, winPct: round((wins / rows.length) * 100, 1) };
}

function inferSurface(playerRows: TennisMatchRow[], oppRows: TennisMatchRow[]): 'hard' | 'clay' | 'grass' | null {
  const recent = [...playerRows.slice(-3), ...oppRows.slice(-3)]
    .map((row) => normalizeSurface(row.surface))
    .filter((s): s is 'hard' | 'clay' | 'grass' => Boolean(s));
  if (!recent.length) return normalizeSurface(playerRows.at(-1)?.surface || oppRows.at(-1)?.surface);
  const counts = { hard: 0, clay: 0, grass: 0 };
  for (const s of recent) counts[s] += 1;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as 'hard' | 'clay' | 'grass') || null;
}

function buildPlayer(
  name: string,
  tour: TennisTour,
  rows: TennisMatchRow[],
  surface: 'hard' | 'clay' | 'grass' | null
): TennisAnalystPlayer {
  const resolved = resolvePlayer(name, tour);
  const last = rows.at(-1);
  const rank =
    tennisRankOnDate(resolved.id || '', last?.date || null)?.rank ?? num(last?.playerRank);
  const l15 = summarize(windowRows(rows, 15));
  const surfaceRows = surface ? rows.filter((row) => normalizeSurface(row.surface) === surface).slice(-15) : [];
  return {
    name: resolved.name || name,
    last: tennisLastName(resolved.name || name),
    rank,
    hand: tennisHandForName(resolved.name || name) || last?.hand || null,
    l5: formRecord(windowRows(rows, 5)),
    l10: formRecord(windowRows(rows, 10)),
    l15,
    surface:
      surface && surfaceRows.length >= 4
        ? { surface, stats: summarize(surfaceRows) }
        : null,
  };
}

function logit(p: number): number {
  const x = clamp(p, 0.03, 0.97);
  return Math.log(x / (1 - x));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function pairwiseProb(a: number | null, b: number | null, scale: number): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return sigmoid((a - b) / scale);
}

function rankProb(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a <= 0 || b <= 0) return null;
  return sigmoid((Math.log(b + 1) - Math.log(a + 1)) / 0.9);
}

function ncdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

function fairOdds(p: number): number {
  return round(1 / clamp(p, 0.06, 0.94), 2);
}

function fmtPct(value: number | null, digits = 1): string {
  if (value == null) return '—';
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null, digits = 1): string {
  if (value == null) return '—';
  return value.toFixed(digits);
}

function bo3Games(rows: TennisMatchRow[]): number {
  const sample = rows.filter((row) => Number(row.bestOf) < 5).slice(-15);
  const values = (sample.length >= 6 ? sample : rows.slice(-15))
    .map((row) => num(row.totalGames))
    .filter((v): v is number => v != null);
  return mean(values) ?? 22;
}

function pickStats(player: TennisAnalystPlayer): TennisAnalystStats {
  return player.surface?.stats.matches && player.surface.stats.matches >= 6 ? player.surface.stats : player.l15;
}

function buildDrivers(
  player: TennisAnalystPlayer,
  opponent: TennisAnalystPlayer,
  a: TennisAnalystStats,
  b: TennisAnalystStats,
  winnerLast: string
): TennisAnalystDriver[] {
  const rows: Array<TennisAnalystDriver & { gap: number }> = [
    { label: 'Hold %', player: a.holdPct, opponent: b.holdPct, unit: '%', lean: '', gap: 0 },
    { label: 'Break %', player: a.breakPct, opponent: b.breakPct, unit: '%', lean: '', gap: 0 },
    { label: 'Game win %', player: a.gameWinPct, opponent: b.gameWinPct, unit: '%', lean: '', gap: 0 },
    { label: 'Set win %', player: a.setWinPct, opponent: b.setWinPct, unit: '%', lean: '', gap: 0 },
    { label: 'L10 form', player: player.l10.winPct, opponent: opponent.l10.winPct, unit: '%', lean: '', gap: 0 },
    { label: 'Aces', player: a.aces, opponent: b.aces, unit: 'n', lean: '', gap: 0 },
    { label: 'Serve pts', player: a.spw, opponent: b.spw, unit: '%', lean: '', gap: 0 },
    { label: 'Return pts', player: a.rpw, opponent: b.rpw, unit: '%', lean: '', gap: 0 },
  ];
  const out: TennisAnalystDriver[] = [];
  for (const row of rows) {
    if (row.player == null || row.opponent == null) continue;
    const gap = row.player - row.opponent;
    if (Math.abs(gap) < 0.8) continue;
    out.push({
      label: row.label,
      player: row.player,
      opponent: row.opponent,
      unit: row.unit,
      lean: gap > 0 ? player.last : opponent.last,
    });
  }
  out.sort((x, y) => {
    const gx = Math.abs((x.player || 0) - (x.opponent || 0));
    const gy = Math.abs((y.player || 0) - (y.opponent || 0));
    const xFav = x.lean === winnerLast ? 1 : 0;
    const yFav = y.lean === winnerLast ? 1 : 0;
    return yFav - xFav || gy - gx;
  });
  return out.slice(0, 5);
}

function edge(
  id: string,
  market: string,
  selection: string,
  leanSide: TennisAnalystEdge['leanSide'],
  probability: number,
  line: string | null,
  reference: number,
  why: string
): TennisAnalystEdge {
  const p = round(clamp(probability, 0.08, 0.92) * 100, 1);
  const modelPts = round(p - reference * 100, 1);
  return {
    id,
    market,
    selection,
    leanSide,
    probability: p,
    fairOdds: fairOdds(p / 100),
    line,
    modelPts,
    why,
    score: Math.abs(p / 100 - reference),
  };
}

export function buildTennisMatchAnalysis(opts: {
  playerName: string;
  opponentName: string;
  tour?: TennisTour | null;
  isGrandSlam?: boolean;
}): TennisMatchAnalysis | null {
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  if (!playerName || !opponentName) return null;

  const preferred =
    opts.tour === 'WTA' || opts.tour === 'ATP' ? opts.tour : tourForPlayer(null, playerName) || 'ATP';
  const playerRes = resolvePlayer(playerName, preferred);
  const oppRes = resolvePlayer(opponentName, playerRes.tour);
  const tour = playerRes.tour;
  const playerRows = loadPlayerMatches({
    playerId: playerRes.id,
    playerName: playerRes.id ? null : playerName,
    tour,
  });
  const oppRows = loadPlayerMatches({
    playerId: oppRes.id,
    playerName: oppRes.id ? null : opponentName,
    tour,
  });
  if (!playerRows.length || !oppRows.length) return null;

  const surface = inferSurface(playerRows, oppRows);
  const player = buildPlayer(playerName, tour, playerRows, surface);
  const opponent = buildPlayer(opponentName, tour, oppRows, surface);
  const a = pickStats(player);
  const b = pickStats(opponent);
  const bestOf = tennisBestOf(tour, Boolean(opts.isGrandSlam));

  const oppKey = normName(opponent.name);
  const h2hRows = playerRows.filter((row) => normName(row.opponent) === oppKey);
  const h2hWins = h2hRows.filter((row) => row.isWin).length;
  const surfaceH2h = surface ? h2hRows.filter((row) => normalizeSurface(row.surface) === surface) : [];
  const surfaceWins = surfaceH2h.filter((row) => row.isWin).length;

  const parts: Array<{ label: string; p: number | null; w: number }> = [
    { label: 'Hold %', p: pairwiseProb(a.holdPct, b.holdPct, 7.5), w: 1.35 },
    { label: 'Break %', p: pairwiseProb(a.breakPct, b.breakPct, 9), w: 1.2 },
    { label: 'Game win %', p: pairwiseProb(a.gameWinPct, b.gameWinPct, 5.5), w: 1.1 },
    { label: 'Set win %', p: pairwiseProb(a.setWinPct, b.setWinPct, 11), w: 0.9 },
    { label: 'L10 form', p: pairwiseProb(player.l10.winPct, opponent.l10.winPct, 16), w: 0.75 },
    { label: 'Serve pts', p: pairwiseProb(a.spw, b.spw, 4.5), w: 0.7 },
    { label: 'Return pts', p: pairwiseProb(a.rpw, b.rpw, 4.5), w: 0.7 },
    { label: 'Ranking', p: rankProb(player.rank, opponent.rank), w: 0.5 },
    {
      label: 'H2H',
      p: h2hRows.length ? (h2hWins + 1) / (h2hRows.length + 2) : null,
      w: h2hRows.length >= 3 ? Math.min(0.32, 0.12 + h2hRows.length * 0.02) : 0,
    },
    {
      label: 'Surface',
      p:
        player.surface && opponent.surface
          ? pairwiseProb(player.surface.stats.winPct, opponent.surface.stats.winPct, 14)
          : null,
      w: player.surface && opponent.surface ? 0.55 : 0,
    },
  ];

  let logOdds = 0;
  let weight = 0;
  let agreePlayer = 0;
  let agreeOpp = 0;
  for (const part of parts) {
    if (part.p == null || part.w <= 0) continue;
    logOdds += part.w * logit(part.p);
    weight += part.w;
    if (part.p >= 0.54) agreePlayer += 1;
    if (part.p <= 0.46) agreeOpp += 1;
  }
  const raw = weight > 0 ? sigmoid(logOdds / weight) : 0.5;
  const playerWin = clamp(raw, 0.12, 0.88);
  const winnerSide: 'player' | 'opponent' = playerWin >= 0.5 ? 'player' : 'opponent';
  const winner = winnerSide === 'player' ? player.last : opponent.last;
  const playerWinPct = round(playerWin * 100, 1);
  const opponentWinPct = round(100 - playerWinPct, 1);

  let confidence = 4.8;
  if (a.matches >= 12 && b.matches >= 12) confidence += 1.4;
  else if (a.matches >= 8 && b.matches >= 8) confidence += 0.6;
  const signals = agreePlayer + agreeOpp;
  if (signals >= 4 && (agreePlayer === 0 || agreeOpp === 0)) confidence += 1.4;
  else if (agreePlayer >= 2 && agreeOpp >= 2) confidence -= 0.8;
  if (h2hRows.length >= 4) confidence += 0.4;
  if (player.rank != null && opponent.rank != null) confidence += 0.3;
  if (player.surface && opponent.surface) confidence += 0.3;
  confidence = round(clamp(confidence, 3.5, 9.2), 1);

  const drivers = buildDrivers(player, opponent, a, b, winner);

  let expectedTotal = 0.5 * (bo3Games(playerRows) + bo3Games(oppRows));
  if ((a.holdPct ?? 80) >= 84 && (b.holdPct ?? 80) >= 84) expectedTotal += 0.8;
  if ((a.holdPct ?? 80) <= 74 && (b.holdPct ?? 80) <= 74) expectedTotal -= 0.8;

  const matchMargin = (2 * playerWin - 1) * (bestOf === 5 ? 6 : 4.2);
  const statMargin = (((a.gameWinPct ?? 50) - (b.gameWinPct ?? 50)) / 100) * expectedTotal;
  const margin = 0.7 * matchMargin + 0.3 * statMargin;
  const gamesSd = bestOf === 5 ? 8.2 : 6.2;
  const pPlayerMinus15 = 1 - ncdf((1.5 - margin) / gamesSd);
  const pOppMinus15 = ncdf((-1.5 - margin) / gamesSd);
  const pPlayerMinus25 = 1 - ncdf((2.5 - margin) / gamesSd);
  const pOppMinus25 = ncdf((-2.5 - margin) / gamesSd);
  const pPlayerMinus35 = 1 - ncdf((3.5 - margin) / gamesSd);
  const pOppMinus35 = ncdf((-3.5 - margin) / gamesSd);
  const pPlayerMinus55 = 1 - ncdf((5.5 - margin) / gamesSd);
  const pOppMinus55 = ncdf((-5.5 - margin) / gamesSd);
  const playerCover15Pct = round(pPlayerMinus15 * 100, 1);
  const playerCover25Pct = round(pPlayerMinus25 * 100, 1);
  const playerCover35Pct = round(pPlayerMinus35 * 100, 1);
  const playerCover55Pct = round(pPlayerMinus55 * 100, 1);
  const opponentCover15Pct = round(pOppMinus15 * 100, 1);
  const opponentCover25Pct = round(pOppMinus25 * 100, 1);
  const opponentCover35Pct = round(pOppMinus35 * 100, 1);
  const opponentCover55Pct = round(pOppMinus55 * 100, 1);
  const expectedWinnerMargin = round(winnerSide === 'player' ? margin : -margin, 1);

  const totalsLine = tour === 'WTA' ? 21.5 : 22.5;
  const pOver = 1 - ncdf((totalsLine - expectedTotal) / 6.4);

  const acesA = 0.58 * (a.aces ?? 5) + 0.42 * (b.acesAllowed ?? 5);
  const acesB = 0.58 * (b.aces ?? 5) + 0.42 * (a.acesAllowed ?? 5);
  const acesLine = tour === 'WTA' ? 5.5 : 11.5;
  const pAcesOver = 1 - ncdf((acesLine - (acesA + acesB)) / 4.2);

  const mlWinnerPct = winnerSide === 'player' ? playerWinPct : opponentWinPct;
  const ml = edge(
    'ml',
    'Moneyline',
    winner,
    winnerSide,
    mlWinnerPct / 100,
    null,
    0.5,
    `${winner} ${fmtPct(winnerSide === 'player' ? a.holdPct : b.holdPct)} hold. L10 ${
      winnerSide === 'player' ? player.l10.record : opponent.l10.record
    } vs ${winnerSide === 'player' ? opponent.l10.record : player.l10.record}.`
  );

  const pFavMinus15 = winnerSide === 'player' ? pPlayerMinus15 : pOppMinus15;
  const games =
    pFavMinus15 >= 0.52
      ? edge(
          'games',
          'Games -1.5',
          `${winner} -1.5`,
          winnerSide,
          pFavMinus15,
          '-1.5',
          0.5,
          `Projected game margin ${round(winnerSide === 'player' ? margin : -margin, 1)} toward ${winner}.`
        )
      : edge(
          'games',
          'Games +1.5',
          `${winnerSide === 'player' ? opponent.last : player.last} +1.5`,
          winnerSide === 'player' ? 'opponent' : 'player',
          1 - pFavMinus15,
          '+1.5',
          0.5,
          `${winner} is only ${round(pFavMinus15 * 100, 1)}% to cover -1.5, so the underdog +1.5 is the games side.`
        );

  const totalsLeanOver = pOver >= 0.5;
  const totals = edge(
    'totals',
    `Total ${totalsLine}`,
    `${totalsLeanOver ? 'Over' : 'Under'} ${totalsLine}`,
    totalsLeanOver ? 'over' : 'under',
    totalsLeanOver ? pOver : 1 - pOver,
    String(totalsLine),
    0.5,
    `Projected ${round(expectedTotal, 1)} BO3 games. ${player.last} L15 ${fmtNum(player.l15.totalGames)}, ${opponent.last} ${fmtNum(
      opponent.l15.totalGames
    )}.`
  );

  const acesLeanOver = pAcesOver >= 0.5;
  const aces = edge(
    'aces',
    `Total aces ${acesLine}`,
    `${acesLeanOver ? 'Over' : 'Under'} ${acesLine} aces`,
    acesLeanOver ? 'over' : 'under',
    acesLeanOver ? pAcesOver : 1 - pAcesOver,
    String(acesLine),
    0.5,
    `${player.last} projected ${round(acesA, 1)} aces vs ${opponent.last} ${round(acesB, 1)} (L15 ${fmtNum(a.aces)} / allowed ${fmtNum(
      b.acesAllowed
    )}).`
  );

  const others = [games, totals, aces]
    .map((item) => {
      const chalk = item.probability >= 68 ? 0.4 : 1;
      return { ...item, score: item.score * chalk };
    })
    .sort((x, y) => y.score - x.score);
  const ranked = [ml, ...others];

  return {
    tour,
    surface,
    bestOf,
    player,
    opponent,
    h2h: {
      matches: h2hRows.length,
      playerWins: h2hWins,
      opponentWins: h2hRows.length - h2hWins,
      record: h2hRows.length ? `${h2hWins}-${h2hRows.length - h2hWins}` : '0-0',
      surfaceRecord: surfaceH2h.length ? `${surfaceWins}-${surfaceH2h.length - surfaceWins} ${surface}` : null,
      avgGames: roundMaybe(
        mean(h2hRows.map((row) => num(row.totalGames)).filter((v): v is number => v != null)),
        1
      ),
      recent: h2hRows
        .slice(-5)
        .reverse()
        .map((row) => ({
          date: row.date,
          winner: row.isWin ? player.last : opponent.last,
          score: row.score || '',
        })),
    },
    model: {
      winner,
      winnerSide,
      playerWinPct,
      opponentWinPct,
      playerFairOdds: fairOdds(playerWinPct / 100),
      opponentFairOdds: fairOdds(opponentWinPct / 100),
      confidence,
      drivers,
      expectedWinnerMargin,
      playerCover15Pct,
      playerCover25Pct,
      playerCover35Pct,
      playerCover55Pct,
      opponentCover15Pct,
      opponentCover25Pct,
      opponentCover35Pct,
      opponentCover55Pct,
      winnerCover15Pct: winnerSide === 'player' ? playerCover15Pct : opponentCover15Pct,
      winnerCover25Pct: winnerSide === 'player' ? playerCover25Pct : opponentCover25Pct,
    },
    edges: ranked,
    bestEdge: ranked[0] || ml,
    marketOdds: null,
  };
}

function winLossWords(record: string): string {
  const match = String(record || '').trim().match(/^(\d+)\s*-\s*(\d+)/);
  if (!match) return String(record || '');
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  return `${wins} win${wins === 1 ? '' : 's'} and ${losses} loss${losses === 1 ? '' : 'es'}`;
}

export function compactTennisAnalysis(analysis: TennisMatchAnalysis) {
  const slim = (side: TennisAnalystPlayer) => ({
    name: side.name,
    rank: side.rank,
    last5: winLossWords(side.l5.record),
    last10: winLossWords(side.l10.record),
    last15: {
      record: winLossWords(side.l15.record),
      winPct: side.l15.winPct,
      gameWinPct: side.l15.gameWinPct,
      setWinPct: side.l15.setWinPct,
      holdPct: side.l15.holdPct,
      breakPct: side.l15.breakPct,
      aces: side.l15.aces,
      acesAllowed: side.l15.acesAllowed,
      spw: side.l15.spw,
      rpw: side.l15.rpw,
      bpConv: side.l15.bpConv,
      bpSaved: side.l15.bpSaved,
      firstServePct: side.l15.firstServePct,
      firstServeWonPct: side.l15.firstServeWonPct,
      secondServeWonPct: side.l15.secondServeWonPct,
      totalGames: side.l15.totalGames,
      gamesWon: side.l15.gamesWon,
    },
    surface: side.surface
      ? {
          surface: side.surface.surface,
          record: winLossWords(side.surface.stats.record),
          holdPct: side.surface.stats.holdPct,
          breakPct: side.surface.stats.breakPct,
          winPct: side.surface.stats.winPct,
        }
      : null,
  });
  const totalsEdge = analysis.edges.find((row) => row.id === 'totals');
  const acesEdge = analysis.edges.find((row) => row.id === 'aces');
  return {
    match: `${analysis.player.name} versus ${analysis.opponent.name}`,
    tour: analysis.tour,
    surface: analysis.surface,
    player: slim(analysis.player),
    opponent: slim(analysis.opponent),
    h2h: {
      matches: analysis.h2h.matches,
      record: winLossWords(analysis.h2h.record),
      avgGames: analysis.h2h.avgGames,
    },
    model: {
      winner: analysis.model.winner,
      playerWinPct: analysis.model.playerWinPct,
      opponentWinPct: analysis.model.opponentWinPct,
      expectedWinnerMargin: analysis.model.expectedWinnerMargin,
      playerCover15Pct: analysis.model.playerCover15Pct,
      playerCover25Pct: analysis.model.playerCover25Pct,
      playerCover35Pct: analysis.model.playerCover35Pct,
      playerCover55Pct: analysis.model.playerCover55Pct,
      opponentCover15Pct: analysis.model.opponentCover15Pct,
      opponentCover25Pct: analysis.model.opponentCover25Pct,
      opponentCover35Pct: analysis.model.opponentCover35Pct,
      opponentCover55Pct: analysis.model.opponentCover55Pct,
      winnerCover15Pct: analysis.model.winnerCover15Pct,
      winnerCover25Pct: analysis.model.winnerCover25Pct,
    },
    totals: totalsEdge
      ? { selection: totalsEdge.selection, probability: totalsEdge.probability, line: totalsEdge.line }
      : null,
    aces: acesEdge
      ? { selection: acesEdge.selection, probability: acesEdge.probability, line: acesEdge.line }
      : null,
    marketOdds: null,
  };
}

export function formatAnalystReasoning(analysis: TennisMatchAnalysis, question?: string): string {
  const q = String(question || '').toLowerCase();
  const { player, opponent, model, h2h, surface } = analysis;
  const winner = model.winner;
  const winPct = model.winnerSide === 'player' ? model.playerWinPct : model.opponentWinPct;
  const fair = model.winnerSide === 'player' ? model.playerFairOdds : model.opponentFairOdds;
  const a = pickStats(player);
  const b = pickStats(opponent);
  const surfaceBit = surface ? ` on ${surfaceLabel(surface)}` : '';
  const acesEdge = analysis.edges.find((e) => e.id === 'aces');
  const totalsEdge = analysis.edges.find((e) => e.id === 'totals');
  const gamesEdge = analysis.edges.find((e) => e.id === 'games');

  if (/ace/.test(q)) {
    const lean =
      acesEdge && Math.abs(acesEdge.probability - 50) >= 4
        ? `Model lean: ${acesEdge.selection} at ${acesEdge.probability.toFixed(1)}% (fair ${acesEdge.fairOdds.toFixed(2)}).`
        : `No strong total-aces lean versus ${acesEdge?.line || 'the standard line'}. Treat it as a coin flip.`;
    return `${player.last} averages ${fmtNum(a.aces)} aces and allows ${fmtNum(a.acesAllowed)} (L15). ${opponent.last} averages ${fmtNum(b.aces)} and allows ${fmtNum(b.acesAllowed)}. ${lean} Moneyline still sits with ${winner} at ${winPct.toFixed(1)}% (fair ${fair.toFixed(2)}).`;
  }
  if (/total|over|under|22\.5|21\.5/.test(q) && totalsEdge) {
    return `${totalsEdge.why} Model: ${totalsEdge.selection} at ${totalsEdge.probability.toFixed(1)}% (fair ${totalsEdge.fairOdds.toFixed(2)}). Moneyline remains ${winner} ${winPct.toFixed(1)}%.`;
  }
  if (/spread|handicap|\+1\.5|-1\.5|cover/.test(q) && gamesEdge) {
    return `${gamesEdge.why} Model: ${gamesEdge.selection} at ${gamesEdge.probability.toFixed(1)}% (fair ${gamesEdge.fairOdds.toFixed(2)}). Headline remains ${winner} ML at ${winPct.toFixed(1)}% (fair ${fair.toFixed(2)}).`;
  }
  if (/h2h|head/.test(q) && h2h.matches) {
    return [
      `H2H ${player.last} vs ${opponent.last}: ${h2h.record}${h2h.surfaceRecord ? ` (${h2h.surfaceRecord})` : ''}.`,
      h2h.recent.length
        ? `Recent: ${h2h.recent
            .slice(0, 3)
            .map((row) => `${row.winner}${row.score ? ` ${row.score}` : ''}`)
            .join(', ')}.`
        : '',
      `Model still prices ${winner} ${winPct.toFixed(1)}% (fair ${fair.toFixed(2)}) because live form and serve/return trump old H2H when they disagree.`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (/break|hold/.test(q)) {
    return `${player.last} converts ${fmtPct(a.breakPct)} of return games and holds ${fmtPct(a.holdPct)} (L15${surfaceBit}). ${opponent.last} holds ${fmtPct(b.holdPct)} / breaks ${fmtPct(b.breakPct)}. That serve-return gap is why the model is on ${winner} at ${winPct.toFixed(1)}% (fair ${fair.toFixed(2)}).`;
  }

  const top = model.drivers.filter((d) => d.lean === winner).slice(0, 2);
  const driverText = top.length
    ? top
        .map((d) => {
          const left = d.lean === player.last ? d.player : d.opponent;
          const right = d.lean === player.last ? d.opponent : d.player;
          const unit = d.unit === '%' ? '%' : '';
          return `${d.label.toLowerCase()} (${left}${unit} vs ${right}${unit})`;
        })
        .join(' and ')
    : analysis.bestEdge.why;
  const other = analysis.edges.find((e) => e.id !== 'ml' && Math.abs(e.probability - 50) >= 3);

  return [
    `${winner} has the stronger underlying profile${surfaceBit}, particularly through ${driverText}. ${
      player.l10.winPct != null && opponent.l10.winPct != null
        ? `Recent form: ${player.last} ${player.l10.record} vs ${opponent.last} ${opponent.l10.record} over L10.`
        : ''
    }`,
    `Biggest edge is the moneyline: ${winner} at ${winPct.toFixed(1)}% (fair ${fair.toFixed(2)}).`,
    other ? `Next look: ${other.selection} at ${other.probability.toFixed(1)}% (fair ${other.fairOdds.toFixed(2)}).` : '',
    h2h.matches ? `H2H ${h2h.record}${h2h.surfaceRecord ? `, ${h2h.surfaceRecord}` : ''}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
