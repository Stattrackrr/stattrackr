/**
 * Fill hold/break/points stats from API-Tennis pointbypoint when `statistics` is empty.
 * Aces, double faults, 1st-serve % and speeds cannot be recovered from PBP.
 */

export type ApiPointByPointPoint = {
  number_point?: string | number;
  score?: string;
  break_point?: string | number | null;
  set_point?: string | number | null;
  match_point?: string | number | null;
};

export type ApiPointByPointGame = {
  set_number?: string;
  number_game?: string | number;
  player_served?: string | null;
  serve_winner?: string | null;
  serve_lost?: string | null;
  score?: string;
  points?: ApiPointByPointPoint[];
};

export type DerivedPbpSide = {
  serveGames: number;
  serviceGamesWon: number;
  returnGamesWon: number;
  servePoints: number | null;
  servePointsWon: number | null;
  returnPointsWon: number | null;
  returnPointsFaced: number | null;
  pointsWon: number | null;
  totalPoints: number | null;
  breakPointsFaced: number;
  breakPointsSaved: number;
  breakPointsConverted: number;
  breakPointsSavedPct: number | null;
  breakPointsConvertedPct: number | null;
  servicePointsWonPct: number | null;
  returnPointsWonPct: number | null;
  matchPointsSaved: number | null;
};

export type DerivedPbpStats = {
  first: DerivedPbpSide;
  second: DerivedPbpSide;
};

type Side = 'first' | 'second';

type Acc = {
  serveGames: number;
  serviceGamesWon: number;
  returnGamesWon: number;
  servePoints: number;
  servePointsWon: number;
  returnPointsWon: number;
  returnPointsFaced: number;
  pointsWon: number;
  breakPointsFaced: number;
  breakPointsSaved: number;
  breakPointsConverted: number;
  matchPointsSaved: number;
};

function emptyAcc(): Acc {
  return {
    serveGames: 0,
    serviceGamesWon: 0,
    returnGamesWon: 0,
    servePoints: 0,
    servePointsWon: 0,
    returnPointsWon: 0,
    returnPointsFaced: 0,
    pointsWon: 0,
    breakPointsFaced: 0,
    breakPointsSaved: 0,
    breakPointsConverted: 0,
    matchPointsSaved: 0,
  };
}

function parseSide(raw: unknown): Side | null {
  const s = String(raw || '').toLowerCase();
  if (s.includes('first')) return 'first';
  if (s.includes('second')) return 'second';
  return null;
}

function pct(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return (num / den) * 100;
}

function other(side: Side): Side {
  return side === 'first' ? 'second' : 'first';
}

type Score = { a: number; b: number; tb: boolean };

function parseToken(raw: string): { n: number; kind: 'game' | 'tb' | 'ad' } | null {
  const t = raw.trim().toUpperCase();
  if (t === 'A' || t === 'AD' || t === 'ADV') return { n: 4, kind: 'ad' };
  if (t === 'LOVE') return { n: 0, kind: 'game' };
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (n === 15) return { n: 1, kind: 'game' };
  if (n === 30) return { n: 2, kind: 'game' };
  if (n === 40) return { n: 3, kind: 'game' };
  if (n === 0) return { n: 0, kind: 'game' };
  return { n, kind: 'tb' };
}

function parsePointScore(raw: unknown): Score | null {
  const m = String(raw || '')
    .trim()
    .match(/^([0-9A-Za-z]+)\s*[-–]\s*([0-9A-Za-z]+)$/);
  if (!m) return null;
  const left = parseToken(m[1]);
  const right = parseToken(m[2]);
  if (!left || !right) return null;
  const tb = left.kind === 'tb' || right.kind === 'tb';
  const mixedCall =
    (left.kind === 'game' && (left.n === 1 || left.n === 2 || left.n === 3) && right.kind === 'tb') ||
    (right.kind === 'game' && (right.n === 1 || right.n === 2 || right.n === 3) && left.kind === 'tb');
  if (mixedCall) return null;
  return { a: left.n, b: right.n, tb };
}

function gameOver(a: number, b: number): boolean {
  return (a >= 4 && a - b >= 2) || (b >= 4 && b - a >= 2);
}

function applyWin(score: Score, winner: Side): Score & { done: boolean } {
  if (score.tb) {
    const a = score.a + (winner === 'first' ? 1 : 0);
    const b = score.b + (winner === 'second' ? 1 : 0);
    const done = (a >= 7 && a - b >= 2) || (b >= 7 && b - a >= 2);
    return { a, b, tb: true, done };
  }
  let a = score.a + (winner === 'first' ? 1 : 0);
  let b = score.b + (winner === 'second' ? 1 : 0);
  if (a >= 3 && b >= 3 && a === b) {
    a = 3;
    b = 3;
  }
  return { a, b, tb: false, done: gameOver(a, b) };
}

function scoresEqual(x: Score, y: Score): boolean {
  return x.tb === y.tb && x.a === y.a && x.b === y.b;
}

function winnerFromTransition(prev: Score, next: Score): Side | 'dup' | null {
  if (prev.tb !== next.tb) return null;
  if (scoresEqual(prev, next)) return 'dup';
  const first = applyWin(prev, 'first');
  if (!first.done && scoresEqual(first, next)) return 'first';
  const second = applyWin(prev, 'second');
  if (!second.done && scoresEqual(second, next)) return 'second';
  return null;
}

function isSetWin(gamesA: number, gamesB: number, tb: boolean): boolean {
  if (tb) return (gamesA === 7 && gamesB === 6) || (gamesB === 7 && gamesA === 6);
  if (gamesA >= 6 && gamesA - gamesB >= 2) return true;
  if (gamesB >= 6 && gamesB - gamesA >= 2) return true;
  return false;
}

function matchPointFor(
  state: Score,
  setsFirst: number,
  setsSecond: number,
  gamesFirst: number,
  gamesSecond: number
): Side | null {
  if (applyWin(state, 'first').done) {
    const winsSet = state.tb || isSetWin(gamesFirst + 1, gamesSecond, false);
    if (winsSet && setsFirst + 1 >= 2) return 'first';
  }
  if (applyWin(state, 'second').done) {
    const winsSet = state.tb || isSetWin(gamesFirst, gamesSecond + 1, false);
    if (winsSet && setsSecond + 1 >= 2) return 'second';
  }
  return null;
}

function finishSide(acc: Acc, hasPoints: boolean): DerivedPbpSide {
  const broken = Math.max(0, acc.serveGames - acc.serviceGamesWon);
  const converted = Math.max(acc.breakPointsConverted, acc.returnGamesWon);
  let faced = acc.breakPointsFaced;
  let saved = acc.breakPointsSaved;
  if (saved + broken > faced) faced = saved + broken;
  if (faced - saved < broken) saved = Math.max(0, faced - broken);
  return {
    serveGames: acc.serveGames,
    serviceGamesWon: acc.serviceGamesWon,
    returnGamesWon: acc.returnGamesWon,
    servePoints: hasPoints ? acc.servePoints : null,
    servePointsWon: hasPoints ? acc.servePointsWon : null,
    returnPointsWon: hasPoints ? acc.returnPointsWon : null,
    returnPointsFaced: hasPoints ? acc.returnPointsFaced : null,
    pointsWon: hasPoints ? acc.pointsWon : null,
    totalPoints: hasPoints ? acc.servePoints + acc.returnPointsFaced : null,
    breakPointsFaced: faced,
    breakPointsSaved: saved,
    breakPointsConverted: converted,
    breakPointsSavedPct: pct(saved, faced),
    breakPointsConvertedPct: null,
    servicePointsWonPct: hasPoints ? pct(acc.servePointsWon, acc.servePoints) : null,
    returnPointsWonPct: hasPoints ? pct(acc.returnPointsWon, acc.returnPointsFaced) : null,
    matchPointsSaved: acc.matchPointsSaved,
  };
}

function creditPoint(acc: Record<Side, Acc>, server: Side, winner: Side, bp: boolean, mpFor: Side | null) {
  const returner = other(server);
  acc[winner].pointsWon += 1;
  acc[server].servePoints += 1;
  acc[returner].returnPointsFaced += 1;
  if (winner === server) acc[server].servePointsWon += 1;
  else acc[returner].returnPointsWon += 1;
  if (bp) {
    acc[server].breakPointsFaced += 1;
    if (winner === server) acc[server].breakPointsSaved += 1;
    else acc[returner].breakPointsConverted += 1;
  }
  if (mpFor && winner !== mpFor) acc[other(mpFor)].matchPointsSaved += 1;
}

export function derivePointByPointStats(games: ApiPointByPointGame[] | null | undefined): DerivedPbpStats | null {
  if (!Array.isArray(games) || games.length === 0) return null;

  const acc: Record<Side, Acc> = { first: emptyAcc(), second: emptyAcc() };
  let setsFirst = 0;
  let setsSecond = 0;
  let gamesFirst = 0;
  let gamesSecond = 0;
  let currentSet: string | null = null;

  for (const game of games) {
    const setLabel = String(game.set_number || '').trim() || currentSet || '';
    if (currentSet != null && setLabel && setLabel !== currentSet) {
      gamesFirst = 0;
      gamesSecond = 0;
    }
    if (setLabel) currentSet = setLabel;

    const server = parseSide(game.player_served);
    const winner = parseSide(game.serve_winner) || (parseSide(game.serve_lost) ? other(parseSide(game.serve_lost)!) : null);
    const points = Array.isArray(game.points) ? game.points : [];
    const looksTb =
      /tie/i.test(setLabel) ||
      points.some((pt) => {
        const parsed = parsePointScore(pt.score);
        return Boolean(parsed?.tb);
      });

    if (server && winner && !looksTb) {
      acc[server].serveGames += 1;
      if (winner === server) acc[server].serviceGamesWon += 1;
      else acc[other(server)].returnGamesWon += 1;
    }

    let state: Score = looksTb ? { a: 0, b: 0, tb: true } : { a: 0, b: 0, tb: false };
    for (const pt of points) {
      const next = parsePointScore(pt.score);
      if (!next) continue;
      if (looksTb && !next.tb && next.a === 0 && next.b === 0) continue;
      if (!looksTb && next.tb) continue;
      const who = winnerFromTransition(state, next);
      if (who === 'dup' || who == null) continue;
      const returner = server ? other(server) : null;
      const bp =
        !state.tb && server != null && returner != null && applyWin(state, returner).done;
      const mpFor = matchPointFor(state, setsFirst, setsSecond, gamesFirst, gamesSecond);
      if (server) creditPoint(acc, server, who, bp, mpFor);
      else acc[who].pointsWon += 1;
      state = { a: next.a, b: next.b, tb: next.tb };
    }

    const alreadyOver = state.tb
      ? (state.a >= 7 && state.a - state.b >= 2) || (state.b >= 7 && state.b - state.a >= 2)
      : gameOver(state.a, state.b);
    if (server && winner && !alreadyOver) {
      const needed = applyWin(state, winner);
      if (needed.done) {
        const returner = other(server);
        const bp = !state.tb && applyWin(state, returner).done;
        const mpFor = matchPointFor(state, setsFirst, setsSecond, gamesFirst, gamesSecond);
        creditPoint(acc, server, winner, bp, mpFor);
      }
    }

    if (winner && !looksTb) {
      if (winner === 'first') gamesFirst += 1;
      else gamesSecond += 1;
      if (isSetWin(gamesFirst, gamesSecond, false)) {
        if (gamesFirst > gamesSecond) setsFirst += 1;
        else setsSecond += 1;
        gamesFirst = 0;
        gamesSecond = 0;
      }
    } else if (winner && looksTb) {
      if (winner === 'first') {
        gamesFirst += 1;
        setsFirst += 1;
      } else {
        gamesSecond += 1;
        setsSecond += 1;
      }
      gamesFirst = 0;
      gamesSecond = 0;
    }
  }

  if (acc.first.serveGames + acc.second.serveGames <= 0) return null;

  const hasPoints = acc.first.pointsWon + acc.second.pointsWon > 0;
  const first = finishSide(acc.first, hasPoints);
  const second = finishSide(acc.second, hasPoints);

  const firstChances = second.breakPointsFaced;
  const secondChances = first.breakPointsFaced;
  first.breakPointsConvertedPct = pct(first.breakPointsConverted, firstChances);
  second.breakPointsConvertedPct = pct(second.breakPointsConverted, secondChances);
  if (hasPoints) {
    const total = (first.pointsWon || 0) + (second.pointsWon || 0);
    first.totalPoints = total;
    second.totalPoints = total;
  }
  if (first.matchPointsSaved === 0 && second.matchPointsSaved === 0) {
    first.matchPointsSaved = 0;
    second.matchPointsSaved = 0;
  }

  return { first, second };
}
