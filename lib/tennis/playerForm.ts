/**
 * Punter-facing player form: rank-band win rates + splits vs opponent styles.
 * Opponent quality uses that opponent's other-match averages, not this match's scoreline.
 */

import { tennisLastName } from '@/lib/tennis/chartStats';
import { tennisCacheMtime } from '@/lib/tennis/apiTennis';
import { tennisHandForName } from '@/lib/tennis/hands';
import {
  PLAYER_FORM_SPLIT_WINDOW,
  type PlayerFormInsight,
  type PlayerFormOpponentNote,
  type PlayerFormRankBand,
  type PlayerFormStatBlock,
  type PlayerFormStyleSplit,
  type PlayerFormTone,
  type TennisPlayerFormPayload,
} from '@/lib/tennis/playerFormShared';
import { tennisRankHistoryMtime, tennisRankOnDate } from '@/lib/tennis/rankHistory';
import {
  loadPlayerMatches,
  loadTennisPlayers,
  tourForPlayer,
  type TennisMatchRow,
  type TennisTour,
} from '@/lib/tennis/data';

const MIN_SPLIT = 4;
const MIN_OPP_PROFILE = 6;
const PROFILE_WINDOW = 20;
const PLAYER_FORM_CUTS_VERSION = 2;

type OppStyle = {
  rpw: number | null;
  spw: number | null;
  aces: number | null;
  firstServePct: number | null;
  matches: number;
};

type TourCuts = {
  rpwLow: number;
  rpwHigh: number;
  spwLow: number;
  spwHigh: number;
  aceHigh: number;
};

type FormRuntime = {
  generation: number;
  cuts: Partial<Record<TennisTour, TourCuts>>;
  profiles: Map<string, OppStyle>;
};

function formRuntime(): FormRuntime {
  const g = globalThis as typeof globalThis & { __tennisPlayerForm?: FormRuntime };
  const generation = tennisCacheMtime() + tennisRankHistoryMtime() + PLAYER_FORM_CUTS_VERSION;
  if (!g.__tennisPlayerForm || g.__tennisPlayerForm.generation !== generation) {
    g.__tennisPlayerForm = { generation, cuts: {}, profiles: new Map() };
  }
  return g.__tennisPlayerForm;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function normalizeHand(hand: string | null | undefined): 'R' | 'L' | null {
  const key = String(hand || '')
    .trim()
    .toUpperCase();
  if (key === 'R' || key.startsWith('RIGHT')) return 'R';
  if (key === 'L' || key.startsWith('LEFT')) return 'L';
  return null;
}

function normalizeSurface(surface: string | null | undefined): 'hard' | 'clay' | 'grass' | null {
  const key = String(surface || '')
    .trim()
    .toLowerCase();
  if (key === 'hard' || key === 'clay' || key === 'grass') return key;
  return null;
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
  const games = num(row.serveGames);
  const faced = num(row.breakPointsFaced);
  const saved = num(row.breakPointsSaved);
  if (games == null || games <= 0 || faced == null || saved == null) return null;
  const broken = Math.max(0, faced - saved);
  return ((games - Math.min(games, broken)) / games) * 100;
}

function opponentRank(row: TennisMatchRow): number | null {
  const fromHistory = tennisRankOnDate(row.opponentId, row.date);
  if (fromHistory?.rank) return fromHistory.rank;
  return num(row.opponentRank);
}

function emptyStats(): PlayerFormStatBlock {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    winPct: null,
    aces: null,
    totalGames: null,
    holdPct: null,
    rpw: null,
    over215: null,
    over225: null,
  };
}

function summarize(rows: TennisMatchRow[]): PlayerFormStatBlock {
  if (!rows.length) return emptyStats();
  const wins = rows.filter((row) => row.isWin).length;
  const withGames = rows.map((row) => num(row.totalGames)).filter((v): v is number => v != null);
  return {
    matches: rows.length,
    wins,
    losses: rows.length - wins,
    winPct: (wins / rows.length) * 100,
    aces: mean(rows.map((row) => num(row.aces)).filter((v): v is number => v != null)),
    totalGames: mean(withGames),
    holdPct: mean(rows.map(holdPct).filter((v): v is number => v != null)),
    rpw: mean(rows.map((row) => num(row.returnPointsWonPct)).filter((v): v is number => v != null)),
    over215: withGames.length ? (withGames.filter((n) => n >= 22).length / withGames.length) * 100 : null,
    over225: withGames.length ? (withGames.filter((n) => n >= 23).length / withGames.length) * 100 : null,
  };
}

function profileFromRows(rows: TennisMatchRow[]): OppStyle {
  const sample = [...rows]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .slice(-PROFILE_WINDOW);
  return {
    rpw: mean(sample.map((row) => num(row.returnPointsWonPct)).filter((v): v is number => v != null)),
    spw: mean(sample.map((row) => num(row.servicePointsWonPct)).filter((v): v is number => v != null)),
    aces: mean(sample.map((row) => num(row.aces)).filter((v): v is number => v != null)),
    firstServePct: mean(sample.map((row) => num(row.firstServePct)).filter((v): v is number => v != null)),
    matches: sample.length,
  };
}

function opponentProfile(opponentId: string, excludeMatchId?: string | null): OppStyle | null {
  if (!opponentId) return null;
  const runtime = formRuntime();
  const cacheKey = excludeMatchId ? `${opponentId}::${excludeMatchId}` : opponentId;
  const cached = runtime.profiles.get(cacheKey);
  if (cached) return cached;
  let rows = loadPlayerMatches({ playerId: opponentId });
  if (excludeMatchId) rows = rows.filter((row) => row.matchId !== excludeMatchId);
  if (rows.length < MIN_OPP_PROFILE) {
    runtime.profiles.set(cacheKey, { rpw: null, spw: null, aces: null, firstServePct: null, matches: rows.length });
    return runtime.profiles.get(cacheKey) || null;
  }
  const profile = profileFromRows(rows);
  runtime.profiles.set(cacheKey, profile);
  return profile;
}

function tourCuts(tour: TennisTour): TourCuts {
  const runtime = formRuntime();
  const cached = runtime.cuts[tour];
  if (cached) return cached;
  const rpws: number[] = [];
  const spws: number[] = [];
  const aces: number[] = [];
  for (const player of loadTennisPlayers({ currentOnly: true })) {
    if (player.tour !== tour) continue;
    const rows = loadPlayerMatches({ playerId: player.playerId, tour }).slice(-PROFILE_WINDOW);
    if (rows.length < 8) continue;
    const rpw = mean(rows.map((row) => num(row.returnPointsWonPct)).filter((v): v is number => v != null));
    const spw = mean(rows.map((row) => num(row.servicePointsWonPct)).filter((v): v is number => v != null));
    const ace = mean(rows.map((row) => num(row.aces)).filter((v): v is number => v != null));
    if (rpw != null) rpws.push(rpw);
    if (spw != null) spws.push(spw);
    if (ace != null) aces.push(ace);
  }
  rpws.sort((a, b) => a - b);
  spws.sort((a, b) => a - b);
  aces.sort((a, b) => a - b);
  const cuts: TourCuts = {
    rpwLow: rpws.length ? percentile(rpws, 0.25) : 35,
    rpwHigh: rpws.length ? percentile(rpws, 0.75) : 41,
    spwLow: spws.length ? percentile(spws, 0.25) : 59,
    spwHigh: spws.length ? percentile(spws, 0.75) : 66,
    aceHigh: aces.length ? percentile(aces, 0.75) : 8,
  };
  runtime.cuts[tour] = cuts;
  return cuts;
}

function returnLabel(rpw: number | null, cuts: TourCuts): 'weak' | 'average' | 'strong' | null {
  if (rpw == null) return null;
  if (rpw <= cuts.rpwLow) return 'weak';
  if (rpw >= cuts.rpwHigh) return 'strong';
  return 'average';
}

function serveLabel(spw: number | null, cuts: TourCuts): 'weak' | 'average' | 'strong' | null {
  if (spw == null) return null;
  if (spw <= cuts.spwLow) return 'weak';
  if (spw >= cuts.spwHigh) return 'strong';
  return 'average';
}

function fmtPct(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function signed(delta: number, digits = 1): string {
  const abs = Math.abs(delta).toFixed(digits);
  return delta >= 0 ? `+${abs}` : `-${abs}`;
}

function toneFromWinPct(winPct: number | null, baseline: number | null): PlayerFormTone {
  if (winPct == null) return 'neutral';
  const vs = baseline == null ? winPct : winPct - baseline;
  if (baseline == null) {
    if (winPct >= 60) return 'good';
    if (winPct >= 45) return 'ok';
    return 'bad';
  }
  if (vs >= 8) return 'good';
  if (vs <= -8) return 'bad';
  return 'ok';
}

function wlText(stats: PlayerFormStatBlock): string {
  return `${stats.wins}-${stats.losses} (${fmtPct(stats.winPct, 0)})`;
}

const RANK_BANDS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: 'top10', label: 'Top 10', min: 1, max: 10 },
  { id: 'r11_20', label: '11–20', min: 11, max: 20 },
  { id: 'r21_50', label: '21–50', min: 21, max: 50 },
  { id: 'r51_100', label: '51–100', min: 51, max: 100 },
  { id: 'r100p', label: '100+', min: 101, max: 9999 },
];

function buildInsights(opts: {
  playerName: string;
  baseline: PlayerFormStatBlock;
  rankBands: PlayerFormRankBand[];
  styleSplits: PlayerFormStyleSplit[];
  opponent: PlayerFormOpponentNote | null;
}): PlayerFormInsight[] {
  const { playerName, baseline, rankBands, styleSplits, opponent } = opts;
  const last = tennisLastName(playerName);
  const out: PlayerFormInsight[] = [];

  if (opponent) {
    const returnSplit =
      opponent.returnLabel === 'weak'
        ? styleSplits.find((s) => s.id === 'weak_return')
        : opponent.returnLabel === 'strong'
          ? styleSplits.find((s) => s.id === 'strong_return')
          : null;
    const serveSplit =
      opponent.serveLabel === 'weak'
        ? styleSplits.find((s) => s.id === 'weak_serve')
        : opponent.serveLabel === 'strong'
          ? styleSplits.find((s) => s.id === 'big_serve')
          : null;
    const surfaceSplit =
      opponent.surface === 'hard' || opponent.surface === 'clay' || opponent.surface === 'grass'
        ? styleSplits.find((s) => s.id === opponent.surface)
        : null;
    const rank =
      opponent.rank != null
        ? RANK_BANDS.find((b) => opponent.rank! >= b.min && opponent.rank! <= b.max)
        : null;
    const rankStats = rank ? rankBands.find((b) => b.id === rank.id) : null;

    const bits: string[] = [];
    if (opponent.returnLabel && opponent.rpw != null) {
      bits.push(`${opponent.returnLabel} returner (${fmtPct(opponent.rpw, 1)} RPW)`);
    }
    if (opponent.serveLabel && opponent.serveLabel !== 'average' && opponent.aces != null) {
      bits.push(`${opponent.serveLabel} serve (${fmtNum(opponent.aces)} aces)`);
    }
    const title = `${tennisLastName(opponent.name)}${opponent.rank ? ` #${opponent.rank}` : ''}`;
    const lines: string[] = [];
    if (bits.length) lines.push(bits.join(' · '));
    if (returnSplit && returnSplit.matches >= MIN_SPLIT && returnSplit.aces != null) {
      const vs = baseline.aces != null ? signed(returnSplit.aces - baseline.aces) : null;
      lines.push(
        `${last} vs ${returnSplit.label.toLowerCase()}: ${fmtNum(returnSplit.aces)} aces${
          vs ? ` (${vs} vs avg)` : ''
        }, ${wlText(returnSplit)}`
      );
    } else if (serveSplit && serveSplit.matches >= MIN_SPLIT) {
      lines.push(
        `${last} vs ${serveSplit.label.toLowerCase()}: ${wlText(serveSplit)}, ${fmtNum(serveSplit.totalGames)} games`
      );
    }
    if (rankStats && rankStats.matches >= MIN_SPLIT) {
      lines.push(`Vs ${rank?.label}: ${wlText(rankStats)}, ${fmtNum(rankStats.totalGames)} games`);
    } else if (surfaceSplit && surfaceSplit.matches >= MIN_SPLIT) {
      lines.push(
        `On ${opponent.surface}: ${wlText(surfaceSplit)}, ${fmtNum(surfaceSplit.totalGames)} games`
      );
    }
    if (lines.length) {
      out.push({
        id: 'upcoming',
        title,
        body: lines.join(' · '),
        tone: toneFromWinPct(returnSplit?.winPct ?? rankStats?.winPct ?? null, baseline.winPct),
        pinned: true,
      });
    }
  }

  const scored: Array<{ insight: PlayerFormInsight; score: number }> = [];
  for (const split of styleSplits) {
    if (split.matches < MIN_SPLIT) continue;
    const winDelta =
      split.winPct != null && baseline.winPct != null ? split.winPct - baseline.winPct : 0;
    const aceDelta = split.aces != null && baseline.aces != null ? split.aces - baseline.aces : 0;
    const gamesDelta =
      split.totalGames != null && baseline.totalGames != null
        ? split.totalGames - baseline.totalGames
        : 0;
    const score = Math.abs(winDelta) + Math.abs(aceDelta) * 8 + Math.abs(gamesDelta) * 3;
    if (score < 10) continue;
    const parts = [wlText(split)];
    if (split.aces != null) {
      const vs = baseline.aces != null ? ` (${signed(split.aces - baseline.aces)})` : '';
      parts.push(`${fmtNum(split.aces)} aces${vs}`);
    }
    if (split.totalGames != null) {
      parts.push(`${fmtNum(split.totalGames)} games`);
    }
    if (split.over225 != null && Math.abs((split.over225 ?? 0) - (baseline.over225 ?? 0)) >= 8) {
      parts.push(`${fmtPct(split.over225, 0)} O22.5`);
    }
    scored.push({
      score,
      insight: {
        id: split.id,
        title: split.label,
        body: parts.join(' · '),
        tone: toneFromWinPct(split.winPct, baseline.winPct),
      },
    });
  }
  for (const band of rankBands) {
    if (band.matches < MIN_SPLIT) continue;
    const winDelta = band.winPct != null && baseline.winPct != null ? band.winPct - baseline.winPct : 0;
    if (Math.abs(winDelta) < 10) continue;
    scored.push({
      score: Math.abs(winDelta) + 4,
      insight: {
        id: band.id,
        title: `Vs ${band.label}`,
        body: `${wlText(band)} · ${fmtNum(band.totalGames)} games · ${fmtNum(band.aces)} aces`,
        tone: toneFromWinPct(band.winPct, baseline.winPct),
      },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const item of scored) {
    if (out.length >= 4) break;
    if (out.some((row) => row.id === item.insight.id)) continue;
    out.push(item.insight);
  }
  return out;
}

export function buildTennisPlayerForm(opts: {
  playerName: string;
  opponentName?: string | null;
  tour?: TennisTour | null;
}): TennisPlayerFormPayload {
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim();
  const tour =
    opts.tour ||
    tourForPlayer(null, playerName) ||
    tourForPlayer(null, opponentName) ||
    'ATP';
  const resolved = resolvePlayer(playerName, tour);
  const cuts = tourCuts(tour);
  const all = loadPlayerMatches({
    playerId: resolved.id,
    playerName: resolved.id ? null : playerName,
    tour,
  }).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const splitRows = all.slice(-PLAYER_FORM_SPLIT_WINDOW).map((row) => ({
    ...row,
    opponentHand: row.opponentHand || tennisHandForName(row.opponent),
  }));
  const recentRows = all.slice(-20).reverse();
  const baseline = summarize(splitRows);

  const rankBands: PlayerFormRankBand[] = RANK_BANDS.map((band) => {
    const sample = splitRows.filter((row) => {
      const rank = opponentRank(row);
      return rank != null && rank >= band.min && rank <= band.max;
    });
    return { ...band, ...summarize(sample) };
  });

  const tagged = splitRows.map((row) => ({
    row,
    style: opponentProfile(row.opponentId, row.matchId),
  }));

  const styleDefs: Array<{
    id: string;
    label: string;
    hint: string;
    test: (row: TennisMatchRow, style: OppStyle | null) => boolean;
  }> = [
    {
      id: 'weak_return',
      label: 'Weak returners',
      hint: `Opp RPW ≤ ${cuts.rpwLow.toFixed(1)}%`,
      test: (_row, style) => style?.rpw != null && style.rpw <= cuts.rpwLow,
    },
    {
      id: 'strong_return',
      label: 'Strong returners',
      hint: `Opp RPW ≥ ${cuts.rpwHigh.toFixed(1)}%`,
      test: (_row, style) => style?.rpw != null && style.rpw >= cuts.rpwHigh,
    },
    {
      id: 'weak_serve',
      label: 'Weak servers',
      hint: `Opp SPW ≤ ${cuts.spwLow.toFixed(1)}%`,
      test: (_row, style) => style?.spw != null && style.spw <= cuts.spwLow,
    },
    {
      id: 'big_serve',
      label: 'Big servers',
      hint: `Opp aces ≥ ${cuts.aceHigh.toFixed(1)}`,
      test: (_row, style) => style?.aces != null && style.aces >= cuts.aceHigh,
    },
    {
      id: 'lefties',
      label: 'Vs lefties',
      hint: 'Opponent left-handed',
      test: (row) => normalizeHand(row.opponentHand) === 'L',
    },
    {
      id: 'hard',
      label: 'On hard',
      hint: 'Hard-court matches',
      test: (row) => normalizeSurface(row.surface) === 'hard',
    },
    {
      id: 'clay',
      label: 'On clay',
      hint: 'Clay-court matches',
      test: (row) => normalizeSurface(row.surface) === 'clay',
    },
    {
      id: 'grass',
      label: 'On grass',
      hint: 'Grass-court matches',
      test: (row) => normalizeSurface(row.surface) === 'grass',
    },
    {
      id: 'bo3',
      label: 'Best of 3',
      hint: 'Tour / 500 / 250',
      test: (row) => Number(row.bestOf) < 5,
    },
    {
      id: 'bo5',
      label: 'Best of 5',
      hint: 'Grand Slam',
      test: (row) => Number(row.bestOf) >= 5,
    },
    {
      id: 'after_loss',
      label: 'After a loss',
      hint: 'Next match bounce',
      test: () => false,
    },
  ];

  const afterLoss: TennisMatchRow[] = [];
  const afterWin: TennisMatchRow[] = [];
  for (let i = 1; i < splitRows.length; i += 1) {
    if (splitRows[i - 1].isWin) afterWin.push(splitRows[i]);
    else afterLoss.push(splitRows[i]);
  }

  const styleSplits: PlayerFormStyleSplit[] = styleDefs
    .map((def) => {
      let sample: TennisMatchRow[] = [];
      if (def.id === 'after_loss') sample = afterLoss;
      else if (def.id === 'after_win') sample = afterWin;
      else sample = tagged.filter((item) => def.test(item.row, item.style)).map((item) => item.row);
      if (tour === 'WTA' && (def.id === 'bo3' || def.id === 'bo5')) return null;
      return { id: def.id, label: def.label, hint: def.hint, ...summarize(sample) };
    })
    .filter((row): row is PlayerFormStyleSplit => Boolean(row && row.matches >= MIN_SPLIT));

  let opponent: PlayerFormOpponentNote | null = null;
  if (opponentName) {
    const opp = resolvePlayer(opponentName, tour);
    const oppRows = loadPlayerMatches({
      playerId: opp.id,
      playerName: opp.id ? null : opponentName,
      tour,
    });
    const profile = profileFromRows(oppRows);
    const last = [...oppRows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).at(-1);
    opponent = {
      name: opp.name || opponentName,
      rank: tennisRankOnDate(opp.id || '', last?.date || null)?.rank ?? num(last?.playerRank),
      rpw: profile.rpw,
      firstServePct: profile.firstServePct,
      aces: profile.aces,
      returnLabel: returnLabel(profile.rpw, cuts),
      serveLabel: serveLabel(profile.spw, cuts),
      surface: last ? normalizeSurface(last.surface) : null,
    };
  }

  const insights = buildInsights({
    playerName: resolved.name || playerName,
    baseline,
    rankBands,
    styleSplits,
    opponent,
  });

  return {
    tour,
    player: { id: resolved.id, name: resolved.name || playerName },
    splitWindow: PLAYER_FORM_SPLIT_WINDOW,
    baseline,
    rankBands,
    styleSplits,
    insights,
    opponent,
    recent: recentRows.map((row) => ({
      matchId: row.matchId,
      date: row.date,
      opponent: row.opponent,
      opponentIoc: row.opponentIoc,
      opponentRank: opponentRank(row),
      surface: row.surface || null,
      tourneyName: row.tourneyName || null,
      round: row.round || null,
      score: row.score,
      isWin: row.isWin,
      aces: num(row.aces),
      totalGames: num(row.totalGames),
      tour: row.tour,
      isGrandSlam: Boolean(row.isGrandSlam),
    })),
  };
}
