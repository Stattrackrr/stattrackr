import { gaussian, mulberry32 } from '@/lib/tennisAi/rng';

export type SimPoint = {
  pA: number;
  pB: number;
  bestOf: 3 | 5;
  uncertainty: number;
};

export type SimSummary = {
  sims: number;
  matchWinA: number;
  matchWinB: number;
  firstSetA: number;
  tiebreak: number;
  setScores: Record<string, number>;
  totalGames: number[];
  gamesA: number[];
  gamesB: number[];
  setsPlayed: number[];
  firstSetGames: number[];
  serviceGamesA: number[];
  serviceGamesB: number[];
  /** Index 0 is a game margin of -MARGIN_OFFSET. */
  gameMargin: number[];
};

function holdGame(p: number): number {
  const q = 1 - p;
  const p2 = p * p;
  const q2 = q * q;
  const deuce = p2 / (p2 + q2);
  return p ** 4 + 4 * p ** 4 * q + 10 * p ** 4 * q * q + 20 * p ** 3 * q ** 3 * deuce;
}

function playGame(p: number, rand: () => number): boolean {
  return rand() < holdGame(p);
}

function playTiebreak(pA: number, pB: number, aServesFirst: boolean, rand: () => number): { a: boolean; points: number } {
  let a = 0;
  let b = 0;
  let i = 0;
  while (true) {
    const serverA = aServesFirst ? i % 4 === 0 || i % 4 === 3 : i % 4 === 1 || i % 4 === 2;
    if (rand() < (serverA ? pA : 1 - pB)) a += 1;
    else b += 1;
    i += 1;
    if ((a >= 7 || b >= 7) && Math.abs(a - b) >= 2) return { a: a > b, points: a + b };
    if (i > 80) return { a: a >= b, points: a + b };
  }
}

function playSet(pA: number, pB: number, aServesFirst: boolean, rand: () => number): {
  a: boolean;
  gamesA: number;
  gamesB: number;
  tiebreak: boolean;
  serviceGamesA: number;
  serviceGamesB: number;
} {
  let gamesA = 0;
  let gamesB = 0;
  let serviceGamesA = 0;
  let serviceGamesB = 0;
  let i = 0;
  let tiebreak = false;
  while (true) {
    const aServes = aServesFirst ? i % 2 === 0 : i % 2 === 1;
    if (gamesA === 6 && gamesB === 6) {
      tiebreak = true;
      const tb = playTiebreak(pA, pB, aServes, rand);
      if (tb.a) gamesA += 1;
      else gamesB += 1;
      serviceGamesA += 1;
      serviceGamesB += 1;
      break;
    }
    const serverHolds = playGame(aServes ? pA : pB, rand);
    if (aServes) {
      serviceGamesA += 1;
      if (serverHolds) gamesA += 1;
      else gamesB += 1;
    } else {
      serviceGamesB += 1;
      if (serverHolds) gamesB += 1;
      else gamesA += 1;
    }
    i += 1;
    if ((gamesA >= 6 || gamesB >= 6) && Math.abs(gamesA - gamesB) >= 2) break;
    if (i > 40) break;
  }
  return {
    a: gamesA > gamesB,
    gamesA,
    gamesB,
    tiebreak,
    serviceGamesA,
    serviceGamesB,
  };
}

function sampleP(mean: number, uncertainty: number, rand: () => number): number {
  if (!(uncertainty > 0)) return mean;
  return Math.min(0.9, Math.max(0.35, mean + gaussian(rand) * uncertainty));
}

export function simulateMatch(input: SimPoint, sims = 20000, seed = 1): SimSummary {
  const rand = mulberry32(seed);
  const need = input.bestOf === 5 ? 3 : 2;
  const setScores: Record<string, number> = {};
  const totalGames = new Array(90).fill(0);
  const gamesA = new Array(60).fill(0);
  const gamesB = new Array(60).fill(0);
  const setsPlayed = new Array(6).fill(0);
  const firstSetGames = new Array(20).fill(0);
  const serviceGamesA = new Array(40).fill(0);
  const serviceGamesB = new Array(40).fill(0);
  const MARGIN_OFFSET = 40;
  const gameMargin = new Array(MARGIN_OFFSET * 2 + 1).fill(0);
  let winsA = 0;
  let firstA = 0;
  let tiebreaks = 0;
  for (let s = 0; s < sims; s += 1) {
    const pA = sampleP(input.pA, input.uncertainty, rand);
    const pB = sampleP(input.pB, input.uncertainty, rand);
    const aFirst = rand() < 0.5;
    let setsA = 0;
    let setsB = 0;
    let gA = 0;
    let gB = 0;
    let svA = 0;
    let svB = 0;
    let anyTb = false;
    let setIndex = 0;
    while (setsA < need && setsB < need) {
      const set = playSet(pA, pB, setIndex % 2 === 0 ? aFirst : !aFirst, rand);
      if (set.a) setsA += 1;
      else setsB += 1;
      gA += set.gamesA;
      gB += set.gamesB;
      svA += set.serviceGamesA;
      svB += set.serviceGamesB;
      anyTb = anyTb || set.tiebreak;
      if (setIndex === 0) {
        if (set.a) firstA += 1;
        const fg = Math.min(firstSetGames.length - 1, set.gamesA + set.gamesB);
        firstSetGames[fg] += 1;
      }
      setIndex += 1;
    }
    if (setsA > setsB) winsA += 1;
    const key = `${setsA}-${setsB}`;
    setScores[key] = (setScores[key] || 0) + 1;
    totalGames[Math.min(totalGames.length - 1, gA + gB)] += 1;
    gamesA[Math.min(gamesA.length - 1, gA)] += 1;
    gamesB[Math.min(gamesB.length - 1, gB)] += 1;
    setsPlayed[Math.min(setsPlayed.length - 1, setsA + setsB)] += 1;
    serviceGamesA[Math.min(serviceGamesA.length - 1, svA)] += 1;
    serviceGamesB[Math.min(serviceGamesB.length - 1, svB)] += 1;
    const marginIndex = Math.min(gameMargin.length - 1, Math.max(0, gA - gB + MARGIN_OFFSET));
    gameMargin[marginIndex] += 1;
    if (anyTb) tiebreaks += 1;
  }
  const rate = (count: number) => count / sims;
  const norm = (hist: number[]) => hist.map((count) => count / sims);
  const scores: Record<string, number> = {};
  for (const [key, count] of Object.entries(setScores)) scores[key] = count / sims;
  return {
    sims,
    matchWinA: rate(winsA),
    matchWinB: rate(sims - winsA),
    firstSetA: rate(firstA),
    tiebreak: rate(tiebreaks),
    setScores: scores,
    totalGames: norm(totalGames),
    gamesA: norm(gamesA),
    gamesB: norm(gamesB),
    setsPlayed: norm(setsPlayed),
    firstSetGames: norm(firstSetGames),
    serviceGamesA: norm(serviceGamesA),
    serviceGamesB: norm(serviceGamesB),
    gameMargin: norm(gameMargin),
  };
}

export const GAME_MARGIN_OFFSET = 40;

export function probCoverLine(marginHist: number[], line: number, offset = GAME_MARGIN_OFFSET): { over: number; under: number; push: number } {
  let over = 0;
  let under = 0;
  let push = 0;
  const whole = Math.abs(line - Math.round(line)) < 1e-6;
  marginHist.forEach((prob, index) => {
    const margin = index - offset;
    const settled = margin + line;
    if (whole && Math.abs(settled) < 1e-9) push += prob;
    else if (settled > 0) over += prob;
    else under += prob;
  });
  return { over, under, push };
}

export function probOverHist(hist: number[], line: number): { over: number; under: number; push: number } {
  let over = 0;
  let under = 0;
  let push = 0;
  const whole = Math.abs(line - Math.round(line)) < 1e-6;
  hist.forEach((prob, value) => {
    if (whole) {
      if (value > line) over += prob;
      else if (value < line) under += prob;
      else push += prob;
    } else if (value > line) over += prob;
    else under += prob;
  });
  return { over, under, push };
}

export function meanOfHist(hist: number[]): number {
  return hist.reduce((total, prob, value) => total + prob * value, 0);
}

export function setScoreWinProb(scores: Record<string, number>, side: 'A' | 'B'): number {
  let total = 0;
  for (const [key, prob] of Object.entries(scores)) {
    const [a, b] = key.split('-').map(Number);
    if (side === 'A' ? a > b : b > a) total += prob;
  }
  return total;
}

export function percentile(hist: number[], q: number): number {
  let cum = 0;
  for (let value = 0; value < hist.length; value += 1) {
    cum += hist[value];
    if (cum >= q) return value;
  }
  return hist.length - 1;
}
