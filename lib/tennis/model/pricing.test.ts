import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  expit,
  hermegauss,
  holdProb,
  invert,
  logit,
  makeModel,
  matchArrays,
  MatchDist,
  NORMAL,
  priceIntegrated,
  ruleFromTuple,
  tbWinProb,
  withTau,
  type SetRule,
} from './pricing';

type Golden = {
  hold: Array<[number, number]>;
  tb: Array<[number, number, boolean, number, number]>;
  match: Array<{
    cfg: string;
    best_of: number;
    rule_n: Array<string | number>;
    rule_f: Array<string | number>;
    pA: number;
    pB: number;
    win: number;
    'tot21.5': number;
    'hcp-3.5': number;
    'gA12.5': number;
    setA: number;
    tot_pmf: number[];
  }>;
  inversion: { tau: number; keys: Array<Array<string | number>>; sig: number; prices: number[]; theta: number[]; cov: number[][]; coherence: number; integrated: Record<string, number> };
  tolerance: { dp: number; inversion: number };
};

const golden = JSON.parse(readFileSync(join(__dirname, 'golden_tennis.json'), 'utf8')) as Golden;
const DP = golden.tolerance.dp;
const INV = golden.tolerance.inversion;
const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);

/** The reference's ("tot", 21.5) style key as ours ("tot:21.5"). */
const keyOf = (t: Array<string | number>) => (t.length > 1 ? `${t[0]}:${t[1]}` : String(t[0]));
const pyKey = (t: Array<string | number>) => (t.length > 1 ? `('${t[0]}', ${t[1]})` : `('${t[0]}',)`);

// ---------- golden fixtures (port check) ----------

test('golden: hold and tiebreak', () => {
  for (const [p, v] of golden.hold) close(holdProb(p), v, DP, `hold ${p}`);
  for (const [a, b, first, target, v] of golden.tb) close(tbWinProb(a, b, first, target), v, DP, `tb ${a} ${b} ${first} ${target}`);
});

test('golden: every rule set and serve pair, all markets and the total-games distribution', () => {
  for (const c of golden.match) {
    const d = new MatchDist(matchArrays(c.pA, c.pB, c.best_of, ruleFromTuple(c.rule_n), ruleFromTuple(c.rule_f)));
    const tag = `${c.cfg} ${c.pA}/${c.pB}`;
    close(d.price('win'), c.win, DP, `${tag} win`);
    close(d.price('tot:21.5'), c['tot21.5'], DP, `${tag} tot 21.5`);
    close(d.price('hcp:-3.5'), c['hcp-3.5'], DP, `${tag} hcp -3.5`);
    close(d.price('gA:12.5'), c['gA12.5'], DP, `${tag} gA 12.5`);
    close(d.price('setA'), c.setA, DP, `${tag} setA`);
    c.tot_pmf.forEach((v, i) => close(d.tot[i] ?? 0, v, DP, `${tag} tot pmf[${i}]`));
  }
});

test('golden: inversion with tau and the integrated prices', () => {
  const g = golden.inversion;
  const keys = g.keys.map(keyOf);
  const model = makeModel(keys);
  const prices = Object.fromEntries(keys.map((k, i) => [k, g.prices[i]!]));
  const sig = Object.fromEntries(keys.map((k) => [k, g.sig]));
  const inv = invert(prices, sig, withTau(model, g.tau));
  close(inv.theta[0], g.theta[0]!, INV, 'theta A');
  close(inv.theta[1], g.theta[1]!, INV, 'theta B');
  for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) close(inv.cov[i]![j]!, g.cov[i]![j]!, INV, `cov ${i}${j}`);
  close(inv.coherence, g.coherence, INV, 'coherence');
  const integrated = priceIntegrated(inv.theta, inv.cov, g.tau, model);
  g.keys.forEach((t, i) => close(integrated[keys[i]!]!, g.integrated[pyKey(t)]!, INV, `integrated ${keys[i]}`));
});

test('Gauss-Hermite: order-5 nodes and weights (probabilists)', () => {
  const { x, w } = hermegauss(5);
  const nodes = [-2.856970013872806, -1.355626179974266, 0, 1.355626179974266, 2.856970013872806];
  const weights = [0.011257411327720691, 0.2220759220056126, 0.5333333333333333, 0.2220759220056126, 0.011257411327720691];
  nodes.forEach((v, i) => close(x[i]!, v, 1e-12, `node ${i}`));
  weights.forEach((v, i) => close(w[i]!, v, 1e-12, `weight ${i}`));
});

// ---------- the reference's tests, ported ----------

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

/** Independent point-level simulator: its own tiebreak and next-set server rules, no parity shortcuts. */
function simMatch(pA: number, pB: number, bestOf: number, ruleN: SetRule, ruleF: SetRule, u: () => number): [number, number, number, number] {
  const pt = (s: number) => (s === 0 ? u() < pA : u() >= pB);
  const game = (s: number) => {
    let a = 0;
    let b = 0;
    for (;;) {
      if (pt(s)) a += 1;
      else b += 1;
      if (Math.max(a, b) >= 4 && Math.abs(a - b) >= 2) return a > b;
    }
  };
  const tb = (s0: number, target: number) => {
    let a = 0;
    let b = 0;
    for (let n = 0; ; n += 1) {
      const s = n === 0 ? s0 : Math.floor((n - 1) / 2) % 2 === 0 ? 1 - s0 : s0;
      if (pt(s)) a += 1;
      else b += 1;
      if (Math.max(a, b) >= target && Math.abs(a - b) >= 2) return a > b;
    }
  };
  const oneSet = (rule: SetRule, srv: number): [[number, number], number] => {
    if (rule.kind === 'supertb') return [tb(srv, rule.target) ? [1, 0] : [0, 1], 1 - srv];
    let ga = 0;
    let gb = 0;
    for (;;) {
      if (rule.kind === 'tb' && ga === rule.at && gb === rule.at) return [tb(srv, rule.target) ? [ga + 1, gb] : [ga, gb + 1], 1 - srv];
      if (game(srv)) ga += 1;
      else gb += 1;
      srv = 1 - srv;
      if (Math.max(ga, gb) >= 6 && Math.abs(ga - gb) >= 2) return [[ga, gb], srv];
    }
  };
  const need = Math.floor(bestOf / 2) + 1;
  let sA = 0;
  let sB = 0;
  let GA = 0;
  let GB = 0;
  let srv = u() < 0.5 ? 0 : 1;
  while (sA < need && sB < need) {
    const final = sA === need - 1 && sB === need - 1;
    const [[a, b], next] = oneSet(final ? ruleF : ruleN, srv);
    srv = next;
    GA += a;
    GB += b;
    if (a > b) sA += 1;
    else sB += 1;
  }
  return [GA, GB, sA, sB];
}

function simMany(pA: number, pB: number, bestOf: number, ruleN: SetRule, ruleF: SetRule, N: number, seed: number, tau = 0) {
  const r = rng(seed);
  return Array.from({ length: N }, () => {
    const a = tau ? expit(logit(pA) + tau * r.n()) : pA;
    const b = tau ? expit(logit(pB) + tau * r.n()) : pB;
    return simMatch(a, b, bestOf, ruleN, ruleF, r.u);
  });
}

const CONFIGS: Record<string, [number, SetRule, SetRule]> = {
  bo3_tb: [3, NORMAL, NORMAL],
  bo5_tb: [5, NORMAL, NORMAL],
  bo3_supertb: [3, NORMAL, { kind: 'supertb', target: 10 }],
  bo5_adv: [5, NORMAL, { kind: 'adv' }],
  bo5_tb12: [5, NORMAL, { kind: 'tb', at: 12, target: 7 }],
};

test('hold and tiebreak against simulation; tiebreak swap symmetry', () => {
  const r = rng(3);
  let held = 0;
  for (let i = 0; i < 100000; i += 1) {
    let a = 0;
    let b = 0;
    for (;;) {
      if (r.u() < 0.62) a += 1;
      else b += 1;
      if (Math.max(a, b) >= 4 && Math.abs(a - b) >= 2) break;
    }
    if (a > b) held += 1;
  }
  close(held / 100000, holdProb(0.62), 0.006, 'hold vs sim');
  close(holdProb(0.5), 0.5, 1e-12, 'hold at 0.5');
  close(tbWinProb(0.66, 0.58, true) + tbWinProb(0.58, 0.66, false), 1, 1e-12, 'tiebreak swap');
  for (const target of [7, 10]) {
    let wins = 0;
    const N = 40000;
    for (let i = 0; i < N; i += 1) {
      let a = 0;
      let b = 0;
      for (let n = 0; ; n += 1) {
        const s = n === 0 ? 0 : Math.floor((n - 1) / 2) % 2 === 0 ? 1 : 0;
        if (s === 0 ? r.u() < 0.66 : r.u() >= 0.58) a += 1;
        else b += 1;
        if (Math.max(a, b) >= target && Math.abs(a - b) >= 2) break;
      }
      if (a > b) wins += 1;
    }
    close(wins / N, tbWinProb(0.66, 0.58, true, target), 0.01, `tiebreak to ${target} vs sim`);
  }
});

test('DP sums to 1 and is symmetric in the players', () => {
  for (const [name, [bo, rn, rf]] of Object.entries(CONFIGS)) {
    const d = new MatchDist(matchArrays(0.66, 0.58, bo, rn, rf));
    const total = [...d.arrays.values()].reduce((a, G) => a + G.reduce((s, row) => s + row.reduce((x, v) => x + v, 0), 0), 0);
    close(total, 1, 1e-6, `${name} total`);
    const e = new MatchDist(matchArrays(0.58, 0.66, bo, rn, rf));
    close(d.winA + e.winA, 1, 1e-9, `${name} win symmetry`);
    close(d.price('tot:20.5'), e.price('tot:20.5'), 1e-9, `${name} total symmetry`);
  }
});

test('DP against the independent simulator on every rule set', () => {
  for (const [name, [bo, rn, rf]] of Object.entries(CONFIGS)) {
    const N = bo === 3 ? 5000 : 3000;
    const s = simMany(0.66, 0.58, bo, rn, rf, N, 11);
    const d = new MatchDist(matchArrays(0.66, 0.58, bo, rn, rf));
    const need = Math.floor(bo / 2) + 1;
    const share = (f: (m: [number, number, number, number]) => boolean) => s.filter(f).length / N;
    close(share((m) => m[2] === need), d.price('win'), 0.03, `${name} win`);
    close(share((m) => m[0] + m[1] > 21.5), d.price('tot:21.5'), 0.03, `${name} total over 21.5`);
    close(share((m) => m[0] - m[1] > 3.5), d.price('hcp:-3.5'), 0.03, `${name} handicap -3.5`);
    close(share((m) => m[0] > 12.5), d.price('gA:12.5'), 0.03, `${name} games won over 12.5`);
    close(share((m) => m[2] + m[3] > bo - 1.5), d.price(`sets:${bo - 1.5}`), 0.03, `${name} sets`);
    const meanSim = s.reduce((a, m) => a + m[0] + m[1], 0) / N;
    const meanDp = d.tot.reduce((a, v, i) => a + i * v, 0);
    close(meanSim, meanDp, 0.35, `${name} mean total games`);
  }
});

test('set-level markets: set betting, first-set winner and first-set scores add up and match the simulator', () => {
  for (const [name, [bo, rn, rf]] of Object.entries(CONFIGS)) {
    const need = Math.floor(bo / 2) + 1;
    const scores: string[] = [];
    for (let l = 0; l < need; l += 1) scores.push(`${need}-${l}`, `${l}-${need}`);
    const set1 = ['6-0', '6-1', '6-4', '7-5', '7-6', '0-6', '4-6', '6-7'];
    const p = makeModel(['win', 'set1win', ...scores.map((s) => `setbet:${s}`), ...set1.map((s) => `set1:${s}`)], bo, rn, rf)(0.66, 0.58);
    close(scores.reduce((a, s) => a + p[`setbet:${s}`]!, 0), 1, 1e-9, `${name} set betting sums to 1`);
    close(scores.filter((s) => s.startsWith(String(need))).reduce((a, s) => a + p[`setbet:${s}`]!, 0), p.win!, 1e-9, `${name} set betting vs win`);
    const sim = simMany(0.66, 0.58, bo, rn, rf, bo === 3 ? 5000 : 3000, 13);
    const straight = sim.filter((m) => m[2] === need && m[3] === 0).length / sim.length;
    close(straight, p[`setbet:${need}-0`]!, 0.03, `${name} straight-sets win vs sim`);
  }
  // First set alone: a set is a set, so first-set scores come straight from the set DP.
  const d = makeModel(['set1win', 'set1:6-0', 'set1:7-6', 'set1:6-7'])(0.66, 0.58);
  const r = rng(17);
  let won = 0;
  let love = 0;
  let tb = 0;
  const N = 40000;
  for (let i = 0; i < N; i += 1) {
    const [[a, b]] = [simFirstSet(0.66, 0.58, r.u)];
    if (a > b) won += 1;
    if (a === 6 && b === 0) love += 1;
    if (a + b === 13) tb += 1;
  }
  close(won / N, d.set1win!, 0.01, 'first-set winner vs sim');
  close(love / N, d['set1:6-0']!, 0.005, 'first set 6-0 vs sim');
  close(tb / N, d['set1:7-6']! + d['set1:6-7']!, 0.01, 'first-set tiebreak rate vs sim');
});

/** One standard set, random first server, by the simulator's own rules. */
function simFirstSet(pA: number, pB: number, u: () => number): [number, number] {
  const pt = (s: number) => (s === 0 ? u() < pA : u() >= pB);
  const game = (s: number) => {
    let a = 0;
    let b = 0;
    for (;;) {
      if (pt(s)) a += 1;
      else b += 1;
      if (Math.max(a, b) >= 4 && Math.abs(a - b) >= 2) return a > b;
    }
  };
  const tb = (s0: number) => {
    let a = 0;
    let b = 0;
    for (let n = 0; ; n += 1) {
      const s = n === 0 ? s0 : Math.floor((n - 1) / 2) % 2 === 0 ? 1 - s0 : s0;
      if (pt(s)) a += 1;
      else b += 1;
      if (Math.max(a, b) >= 7 && Math.abs(a - b) >= 2) return a > b;
    }
  };
  let srv = u() < 0.5 ? 0 : 1;
  let ga = 0;
  let gb = 0;
  for (;;) {
    if (ga === 6 && gb === 6) return tb(srv) ? [7, 6] : [6, 7];
    if (game(srv)) ga += 1;
    else gb += 1;
    srv = 1 - srv;
    if (Math.max(ga, gb) >= 6 && Math.abs(ga - gb) >= 2) return [ga, gb];
  }
}

const KEYS = ['win', 'tot:21.5', 'hcp:-2.5'];
const SIG = Object.fromEntries(KEYS.map((k) => [k, 0.03]));

test('inversion recovers known serve strengths, with honest posterior coverage', () => {
  const model = makeModel(KEYS);
  const truth: [number, number] = [logit(0.66), logit(0.6)];
  const base = model(0.66, 0.6);
  const r = rng(5);
  let cover = 0;
  const coh: number[] = [];
  const R = 60;
  for (let i = 0; i < R; i += 1) {
    const prices = Object.fromEntries(KEYS.map((k) => [k, expit(logit(base[k]!) + r.n() * SIG[k]!)]));
    const inv = invert(prices, SIG, model);
    const d = [inv.theta[0] - truth[0], inv.theta[1] - truth[1]];
    const [[a, b], [c, e]] = inv.cov;
    const det = a * e - b * c;
    const m = (d[0]! * (e * d[0]! - b * d[1]!) + d[1]! * (-c * d[0]! + a * d[1]!)) / det;
    if (m < 5.99) cover += 1;
    coh.push(inv.coherence);
  }
  assert.ok(cover / R >= 0.85 && cover / R <= 1, `coverage ${cover / R}`);
  const meanCoh = coh.reduce((a, v) => a + v, 0) / R;
  assert.ok(meanCoh > 0.5 && meanCoh < 1.6, `mean coherence ${meanCoh}`);
});

test('coherence flags an inconsistent handicap price', () => {
  const model = makeModel(KEYS);
  const base = model(0.66, 0.6);
  const bad = { ...base, 'hcp:-2.5': expit(logit(base['hcp:-2.5']!) + 0.3) };
  assert.ok(invert(base, SIG, model).coherence < 1e-6);
  assert.ok(invert(bad, SIG, model).coherence > 6.63, 'chi-square(1) 99%');
});

test('two prices fit exactly', () => {
  const keys = KEYS.slice(0, 2);
  const model = makeModel(keys);
  const inv = invert(model(0.66, 0.6), Object.fromEntries(keys.map((k) => [k, 0.03])), model);
  assert.ok(inv.coherence < 1e-8, String(inv.coherence));
  close(expit(inv.theta[0]), 0.66, 1e-4, 'pA');
  close(expit(inv.theta[1]), 0.6, 1e-4, 'pB');
});

test('correlated match effects (conditions moving both servers together): fewer mismatches, more games', () => {
  const at = (rho: number) => withTau(makeModel(['tot:19.5', 'tot:22.5', 'hcp:-3.5']), 0.25, 5, rho)(0.64, 0.62);
  const indep = at(0);
  const corr = at(0.6);
  assert.ok(1 - corr['tot:19.5']! < 1 - indep['tot:19.5']! - 0.03, 'short matches clearly less likely');
  assert.ok(corr['tot:22.5']! > indep['tot:22.5']! + 0.03, 'over 22.5 clearly more likely');
  assert.ok(corr['hcp:-3.5']! < indep['hcp:-3.5']!, 'big winning margins less likely');
});

test('overdispersion: totals priced with tau match a tau world; tau = 0 is too narrow', () => {
  const tau = 0.25;
  const s = simMany(0.66, 0.6, 3, NORMAL, NORMAL, 12000, 21, tau);
  const tot = s.map((m) => m[0] + m[1]);
  const pmfFor = (t: number) => {
    const { x, w } = hermegauss(5);
    let acc: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        const pmf = new MatchDist(matchArrays(expit(logit(0.66) + t * x[i]!), expit(logit(0.6) + t * x[j]!))).tot;
        if (acc.length < pmf.length) acc = [...acc, ...new Array<number>(pmf.length - acc.length).fill(0)];
        pmf.forEach((v, k) => (acc[k]! += w[i]! * w[j]! * v));
      }
    }
    const sum = acc.reduce((a, v) => a + v, 0);
    return acc.map((v) => v / sum);
  };
  const variance = (p: number[]) => {
    const m = p.reduce((a, v, i) => a + i * v, 0);
    return p.reduce((a, v, i) => a + i * i * v, 0) - m * m;
  };
  const mean = tot.reduce((a, v) => a + v, 0) / tot.length;
  const vSim = tot.reduce((a, v) => a + (v - mean) ** 2, 0) / tot.length;
  const p0 = pmfFor(0);
  const p1 = pmfFor(tau);
  assert.ok(Math.abs(variance(p1) / vSim - 1) < 0.06, `tau ${tau}: ${variance(p1)} vs sim ${vSim}`);
  assert.ok(variance(p0) / vSim < 0.95, `tau 0: ${variance(p0)} vs sim ${vSim}`);
  const r = rng(0);
  const pitVar = (pmf: number[]) => {
    const cdf: number[] = [];
    pmf.reduce((a, v, i) => (cdf[i] = a + v), 0);
    const pits = tot.map((x) => (x >= 1 ? cdf[x - 1]! : 0) + r.u() * (pmf[x] ?? 0));
    const m = pits.reduce((a, v) => a + v, 0) / pits.length;
    return pits.reduce((a, v) => a + (v - m) ** 2, 0) / pits.length;
  };
  assert.ok(Math.abs(pitVar(p1) - 1 / 12) < Math.abs(pitVar(p0) - 1 / 12), 'PIT variance closer to uniform with tau');
});
