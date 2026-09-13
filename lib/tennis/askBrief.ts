import {
  formatTennisSetScore,
  parseTennisSetsFromPlayerView,
  tennisLastName,
  tennisScoreIsRetired,
} from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { buildTennisAdvancedAverages } from '@/lib/tennis/advancedAverages';
import { loadPlayerMatches, tennisDvpProfile } from '@/lib/tennis/data';
import { tennisHandForName } from '@/lib/tennis/hands';
import { buildTennisPlayerForm } from '@/lib/tennis/playerForm';
import { buildTennisPlayerMatchup } from '@/lib/tennis/playerMatchup';
import { buildTennisSimilarPlayers } from '@/lib/tennis/similarPlayers';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

export type TennisAskEdge = {
  id: string;
  market: string;
  lean: string;
  why: string;
  score: number;
};

export type TennisAskLogRow = {
  date: string | null;
  opponent: string;
  result: 'W' | 'L';
  score: string;
  surface: string | null;
  aces: number | null;
  opponentAces: number | null;
  df: number | null;
  totalGames: number | null;
  gamesWon: number | null;
  gamesLost: number | null;
  firstServePct: number | null;
  rpw: number | null;
  dr: number | null;
  bpWon: number | null;
};

export type TennisAskBrief = {
  tour: TennisTour;
  player: string;
  opponent: string | null;
  playerHand: 'R' | 'L' | null;
  opponentHand: 'R' | 'L' | null;
  form: {
    record: string;
    winPct: number | null;
    aces: number | null;
    df: number | null;
    games: number | null;
    holdPct: number | null;
    rpw: number | null;
    insights: string[];
    vsRank: Array<{ band: string; record: string; winPct: number | null; games: number | null }>;
    vsStyle: Array<{
      split: string;
      record: string;
      winPct: number | null;
      aces: number | null;
      games: number | null;
      holdPct: number | null;
    }>;
    recent: TennisAskLogRow[];
  };
  opponentForm: {
    record: string;
    winPct: number | null;
    aces: number | null;
    games: number | null;
    holdPct: number | null;
    rpw: number | null;
    recent: TennisAskLogRow[];
  } | null;
  opponentProfile: {
    name: string;
    rank: number | null;
    returnLabel: string | null;
    serveLabel: string | null;
    rpw: number | null;
    aces: number | null;
    surface: string | null;
  } | null;
  averages: {
    player: Record<string, Record<string, string>>;
    opponent: Record<string, Record<string, string>> | null;
  };
  matchup: Array<{
    stat: string;
    player: string;
    playerRank: number | null;
    opponent: string;
    opponentRank: number | null;
  }>;
  dvp: Array<{ stat: string; value: string; rank: number | null; field: number }>;
  similarVsOpponent: Array<{
    name: string;
    hand: 'R' | 'L' | null;
    isWin: boolean;
    score: string;
    aces: number | null;
    totalGames: number | null;
    gamesWon: number | null;
    firstServePct: number | null;
    h2h: string;
  }>;
  edges: TennisAskEdge[];
};

function round(value: number | null | undefined, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function cellMap(side: { rows: Array<{ key: string; cells: Record<string, { text: string }> }> } | null) {
  const all = side?.rows.find((row) => row.key === 'all');
  if (!all) return {};
  return Object.fromEntries(Object.entries(all.cells).map(([key, cell]) => [key, cell.text]));
}

function splitMaps(
  side: { rows: Array<{ key: string; label: string; cells: Record<string, { text: string }> }> } | null
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const row of side?.rows || []) {
    out[row.label] = Object.fromEntries(Object.entries(row.cells).map(([key, cell]) => [key, cell.text]));
  }
  return out;
}

function formatScore(row: TennisMatchRow): string {
  const sets = parseTennisSetsFromPlayerView(row.score, row.isWin);
  const text = sets.map(formatTennisSetScore).join(' ');
  if (!text) return String(row.score || '—');
  return tennisScoreIsRetired(row.score) ? `${text} RET` : text;
}

function recentLogs(playerName: string, tour: TennisTour, playerId?: string | null): TennisAskLogRow[] {
  return loadPlayerMatches({ playerId, playerName, tour })
    .slice(-10)
    .reverse()
    .map((row) => ({
      date: row.date,
      opponent: tennisLastName(row.opponent),
      result: row.isWin ? 'W' : 'L',
      score: formatScore(row),
      surface: row.surface || null,
      aces: round(row.aces),
      opponentAces: round(row.opponentAces),
      df: round(row.doubleFaults),
      totalGames: round(row.totalGames, 0),
      gamesWon: round(row.gamesWon, 0),
      gamesLost: round(row.gamesLost, 0),
      firstServePct: round(row.firstServePct, 0),
      rpw: round(row.returnPointsWonPct, 1),
      dr: round(row.dominanceRatio, 2),
      bpWon: round(row.breakPointsConverted, 0),
    }));
}

function fmt(value: number | null, suffix = '', digits = 1): string {
  if (value == null) return '—';
  return `${value.toFixed(digits)}${suffix}`;
}

export function buildTennisAskBrief(opts: {
  playerName: string;
  opponentName?: string | null;
  tour?: TennisTour | null;
  isGrandSlam?: boolean;
}): TennisAskBrief {
  const playerName = String(opts.playerName || '').trim();
  const opponentName = String(opts.opponentName || '').trim() || null;
  const form = buildTennisPlayerForm({
    playerName,
    opponentName,
    tour: opts.tour,
  });
  const tour = form.tour;
  const averages = buildTennisAdvancedAverages({
    playerName,
    opponentName,
    tour,
    window: 15,
    year: TENNIS_CURRENT_YEAR,
  });
  const matchup = opponentName
    ? buildTennisPlayerMatchup({
        playerName,
        opponentName,
        tour,
        window: 15,
        year: TENNIS_CURRENT_YEAR,
        bestOf: tour === 'WTA' || !opts.isGrandSlam ? 3 : 5,
      })
    : null;
  const dvp = opponentName
    ? tennisDvpProfile({ tour, year: TENNIS_CURRENT_YEAR, opponentName })
    : null;

  const playerAvg = cellMap(averages.player);
  const oppAvg = averages.opponent ? cellMap(averages.opponent) : null;
  const oppForm = opponentName
    ? buildTennisPlayerForm({ playerName: opponentName, opponentName: playerName, tour })
    : null;
  const similar = opponentName
    ? buildTennisSimilarPlayers({
        playerName,
        opponentName,
        tour,
        stat: 'aces',
        limit: 6,
      })
    : null;
  const playerLast = tennisLastName(form.player.name || playerName);
  const oppLast = opponentName ? tennisLastName(opponentName) : 'opponent';

  const edges: TennisAskEdge[] = [];
  if (oppAvg) {
    const playerBp = playerAvg.bpw || '';
    const oppHold = oppAvg.hold || '';
    const oppBroken = oppAvg.bpgu || '';
    if (playerBp && oppHold) {
      const bpn = Number.parseFloat(playerBp);
      const holdn = Number.parseFloat(oppHold);
      const brokenN = Number.parseFloat(oppBroken);
      const score = (Number.isFinite(bpn) ? bpn - 36 : 0) + (Number.isFinite(holdn) ? 78 - holdn : 0) + (Number.isFinite(brokenN) ? (brokenN - 2.2) * 10 : 0);
      if (Number.isFinite(bpn) && Number.isFinite(holdn)) {
        const leanBreaks = score >= 3;
        edges.push({
          id: 'breaks',
          market: leanBreaks ? 'Breaks' : 'Hold',
          lean: leanBreaks
            ? `${playerLast} should break ${oppLast} more than usual`
            : `${oppLast} should hold better than average vs ${playerLast}`,
          why: `${playerLast} converts ${playerBp} of break points (L15). ${oppLast} holds ${oppHold} and concedes ${oppBroken || '—'} breaks per match.`,
          score: Math.max(4, Math.abs(score)),
        });
      }
    }
    const playerAces = Number.parseFloat(playerAvg.aces || '');
    const oppAceAll = Number.parseFloat(oppAvg.aceAll || '');
    if (Number.isFinite(playerAces) && Number.isFinite(oppAceAll)) {
      const score = (playerAces - 6) + (oppAceAll - 6);
      if (score >= 2.5) {
        edges.push({
          id: 'aces',
          market: 'Aces',
          lean: `${playerLast} ace count should play up vs ${oppLast}`,
          why: `${playerLast} averages ${fmt(playerAces)} aces (L15). ${oppLast} allows ${fmt(oppAceAll)} aces per match.`,
          score,
        });
      }
    }
    const playerGames = Number.parseFloat((playerAvg.games || '').split('/')[1] || '');
    const oppGames = Number.parseFloat((oppAvg.games || '').split('/')[1] || '');
    if (Number.isFinite(playerGames) && Number.isFinite(oppGames)) {
      const avg = (playerGames + oppGames) / 2;
      const slam = Boolean(opts.isGrandSlam) && tour === 'ATP';
      const ref = slam ? 38.5 : 22.5;
      edges.push({
        id: 'totals',
        market: 'Totals',
        lean: avg >= ref ? `Totals lean long (~${avg.toFixed(1)} games)` : `Totals lean short (~${avg.toFixed(1)} games)`,
        why: `${playerLast} matches average ${fmt(playerGames)} games. ${oppLast} matches average ${fmt(oppGames)} games.`,
        score: Math.abs(avg - ref),
      });
    }
  }

  const oppRank = form.opponent?.rank ?? null;
  if (oppRank != null) {
    const band = form.rankBands.find((row) => {
      if (row.id === 'top10') return oppRank <= 10;
      if (row.id === 'r11_20') return oppRank >= 11 && oppRank <= 20;
      if (row.id === 'r21_50') return oppRank >= 21 && oppRank <= 50;
      if (row.id === 'r51_100') return oppRank >= 51 && oppRank <= 100;
      return oppRank >= 101;
    });
    if (band && band.matches >= 4 && band.winPct != null) {
      edges.push({
        id: 'rank',
        market: 'Match',
        lean:
          band.winPct >= 60
            ? `${playerLast} matches up well vs ${band.label}`
            : `${playerLast} struggles vs ${band.label}`,
        why: `Vs ${band.label} last ${form.splitWindow}: ${band.wins}-${band.losses} (${Math.round(band.winPct)}%), ${fmt(band.totalGames)} games.`,
        score: Math.abs(band.winPct - 50) / 4,
      });
    }
  }

  edges.sort((a, b) => b.score - a.score);

  return {
    tour,
    player: form.player.name || playerName,
    opponent: form.opponent?.name || opponentName,
    playerHand: tennisHandForName(form.player.name || playerName),
    opponentHand: opponentName ? tennisHandForName(form.opponent?.name || opponentName) : null,
    form: {
      record: `${form.baseline.wins}-${form.baseline.losses}`,
      winPct: round(form.baseline.winPct, 0),
      aces: round(form.baseline.aces),
      df: Number.isFinite(Number.parseFloat(playerAvg.df || ''))
        ? Number.parseFloat(playerAvg.df)
        : null,
      games: round(form.baseline.totalGames),
      holdPct: round(form.baseline.holdPct, 0),
      rpw: round(form.baseline.rpw, 1),
      insights: form.insights.map((row) => `${row.title}: ${row.body}`),
      vsRank: form.rankBands
        .filter((row) => row.matches > 0)
        .map((row) => ({
          band: row.label,
          record: `${row.wins}-${row.losses}`,
          winPct: round(row.winPct, 0),
          games: round(row.totalGames),
        })),
      vsStyle: form.styleSplits.map((row) => ({
        split: row.label,
        record: `${row.wins}-${row.losses}`,
        winPct: round(row.winPct, 0),
        aces: round(row.aces),
        games: round(row.totalGames),
        holdPct: round(row.holdPct, 0),
      })),
      recent: recentLogs(form.player.name || playerName, tour, form.player.id),
    },
    opponentForm: oppForm
      ? {
          record: `${oppForm.baseline.wins}-${oppForm.baseline.losses}`,
          winPct: round(oppForm.baseline.winPct, 0),
          aces: round(oppForm.baseline.aces),
          games: round(oppForm.baseline.totalGames),
          holdPct: round(oppForm.baseline.holdPct, 0),
          rpw: round(oppForm.baseline.rpw, 1),
          recent: recentLogs(oppForm.player.name || opponentName || '', tour, oppForm.player.id),
        }
      : null,
    opponentProfile: form.opponent
      ? {
          name: form.opponent.name,
          rank: form.opponent.rank,
          returnLabel: form.opponent.returnLabel,
          serveLabel: form.opponent.serveLabel,
          rpw: round(form.opponent.rpw, 1),
          aces: round(form.opponent.aces),
          surface: form.opponent.surface,
        }
      : null,
    averages: {
      player: splitMaps(averages.player),
      opponent: averages.opponent ? splitMaps(averages.opponent) : null,
    },
    matchup: (matchup?.rows || []).map((row) => ({
      stat: row.label,
      player: row.playerValue == null ? '—' : row.pct ? `${row.playerValue.toFixed(1)}%` : row.playerValue.toFixed(1),
      playerRank: row.playerRank,
      opponent: row.opponentValue == null ? '—' : row.pct ? `${row.opponentValue.toFixed(1)}%` : row.opponentValue.toFixed(1),
      opponentRank: row.opponentRank,
    })),
    dvp: (dvp?.metrics || [])
      .filter((row) => row.value != null)
      .map((row) => ({
        stat: row.label,
        value: row.pct && row.value != null ? `${row.value.toFixed(1)}%` : row.value == null ? '—' : row.value.toFixed(1),
        rank: row.rank,
        field: row.fieldSize,
      })),
    similarVsOpponent: (similar?.similar || []).map((row) => ({
      name: tennisLastName(row.name),
      hand: row.hand,
      isWin: row.isWin,
      score: row.score,
      aces: row.stats?.aces ?? null,
      totalGames: row.stats?.totalGames ?? null,
      gamesWon: row.stats?.gamesWon ?? null,
      firstServePct: row.stats?.firstServePct ?? null,
      h2h: `${row.h2hWins}-${row.h2hLosses}`,
    })),
    edges: edges.slice(0, 6),
  };
}

function tokenHash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function h2hRecord(playerName: string, opponentName: string, tour: TennisTour): {
  matches: number;
  wins: number;
  losses: number;
} {
  const last = tennisLastName(opponentName).toLowerCase();
  if (!last) return { matches: 0, wins: 0, losses: 0 };
  const vs = loadPlayerMatches({ playerName, tour }).filter(
    (row) => tennisLastName(row.opponent).toLowerCase() === last
  );
  const wins = vs.filter((row) => row.isWin).length;
  return { matches: vs.length, wins, losses: vs.length - wins };
}

function gamesAskLine(avg: number | null, bestOf: 3 | 5, listed?: number | null): number {
  if (listed != null && Number.isFinite(listed)) return listed;
  if (bestOf === 5) {
    if (avg != null && avg >= 42) return 43.5;
    if (avg != null && avg >= 38) return 38.5;
    return 36.5;
  }
  if (avg != null && avg >= 24) return 23.5;
  if (avg != null && avg >= 22) return 22.5;
  return 21.5;
}

export function buildTennisAskSuggestions(
  brief: TennisAskBrief,
  opts?: { isGrandSlam?: boolean; listedTotalLine?: number | null }
): string[] {
  const o = tennisLastName(brief.opponent) || 'him';
  const slam = Boolean(opts?.isGrandSlam);
  const bestOf: 3 | 5 = brief.tour === 'WTA' || !slam ? 3 : 5;
  const seed = tokenHash(`${brief.player}|${brief.opponent}|${brief.tour}`);
  const h2h = h2hRecord(brief.player, brief.opponent || '', brief.tour);
  const aceAvg = brief.form.aces;
  const gamesAvg = brief.form.games;
  const oppGames = brief.opponentForm?.games ?? null;
  const hold = brief.form.holdPct;
  const df = brief.form.df;
  const winPct = brief.form.winPct ?? 50;
  const similar = brief.similarVsOpponent;
  const similarWins = similar.filter((row) => row.isWin).length;
  const leftSplit = brief.form.vsStyle.find((row) => /left/i.test(row.split));
  const byCat = new Map<string, Array<{ q: string; w: number }>>();

  const add = (cat: string, q: string, w: number) => {
    const list = byCat.get(cat) || [];
    list.push({ q, w });
    byCat.set(cat, list);
  };

  if (aceAvg != null && aceAvg >= 3) {
    const n = Math.max(4, Math.round(aceAvg));
    const stretch = n + 3;
    if (aceAvg >= 12) {
      add('aces', `Is ${n}+ aces a realistic number for him?`, 8);
      add('aces', `Is ${stretch}+ aces too high?`, 6);
    } else if (aceAvg >= 7) {
      add('aces', `Is ${n}+ aces a good number?`, 8);
      add('aces', `Is ${stretch}+ aces too high for this match?`, 6);
    } else {
      add('aces', `Will he reach ${n} aces?`, 7);
    }
    const aceAll = brief.dvp.find((row) => /ace/i.test(row.stat));
    if (aceAll?.rank != null && aceAll.rank <= 10) {
      add('aces', `${o} allows a lot of aces. Is ${n}+ realistic?`, 7);
    }
  }

  if (gamesAvg != null || oppGames != null || opts?.listedTotalLine != null) {
    const avg =
      gamesAvg != null && oppGames != null ? (gamesAvg + oppGames) / 2 : (gamesAvg ?? oppGames);
    const line = gamesAskLine(avg, bestOf, opts?.listedTotalLine);
    if (bestOf === 5) {
      add('games', `Is over ${line} games a good total in this slam?`, 8);
      add('games', 'Does this match go to four or five sets?', 6);
    } else if ((avg ?? 0) >= 24) {
      add('games', `Is over ${line} games the better side?`, 7);
    } else {
      add('games', `Is under ${line} games realistic?`, 7);
    }
  }

  if (h2h.matches >= 3 && h2h.wins === 0) {
    add('side', `He is 0-${h2h.losses} against ${o}. Is he still worth backing?`, 9);
  } else if (h2h.matches >= 3 && h2h.losses === 0) {
    add('side', `He is ${h2h.wins}-0 in the head to head. Is the moneyline the right play?`, 9);
  } else if (h2h.matches >= 4) {
    add('side', `The head to head is ${h2h.wins}-${h2h.losses}. Winner or games?`, 6);
  }

  if (winPct <= 42) add('side', 'His recent form is poor. Is he still worth backing?', 7);
  else if (winPct >= 75 && h2h.wins === 0 && h2h.matches >= 3) {
    add('side', 'His form is strong, but he has never beaten this opponent. Still back him?', 8);
  } else if (winPct >= 75) {
    add('side', 'His form is strong. Is the moneyline the right play?', 5);
  }

  if (hold != null && hold >= 88 && brief.opponentProfile?.returnLabel === 'weak') {
    add('side', 'His hold rate is strong. Does he cover 1.5 games?', 7);
  } else if (hold != null && hold < 78) {
    add('side', 'He has been getting broken often. Can he hold serve here?', 7);
  }

  if (brief.playerHand === 'L') {
    add('style', 'Does the left-handed serve matter in this matchup?', 7);
  }
  if (brief.opponentHand === 'L' && leftSplit?.winPct != null) {
    add(
      'style',
      leftSplit.winPct < 45
        ? 'He has struggled against left-handers. Should we oppose him?'
        : 'He usually plays well against left-handers. Does that hold here?',
      7
    );
  }
  if (df != null && df >= 4) {
    add('style', 'He has been making a lot of double faults. Should we avoid the serve markets?', 6);
  }
  if (similar.length >= 5 && similarWins <= 1) {
    add('style', `Similar players have struggled against ${o}. Should we oppose him?`, 7);
  } else if (similar.length >= 5 && similarWins / similar.length >= 0.7) {
    add('style', `Similar players have done well against ${o}. Is the moneyline the right play?`, 5);
  }

  const cats = ['aces', 'games', 'side', 'style'];
  const rotated = [...cats.slice(seed % cats.length), ...cats.slice(0, seed % cats.length)];
  const picked: string[] = [];
  const used = new Set<string>();

  const takeBest = (cat: string) => {
    const list = (byCat.get(cat) || []).sort((a, b) => b.w - a.w || a.q.localeCompare(b.q));
    const next = list.find((row) => !used.has(row.q));
    if (!next) return;
    used.add(next.q);
    picked.push(next.q);
  };

  if (bestOf === 5 && opts?.listedTotalLine != null) takeBest('games');
  for (const cat of rotated) {
    if (picked.length >= 3) break;
    takeBest(cat);
  }
  if (picked.length < 3) {
    for (const cat of cats) {
      if (picked.length >= 3) break;
      takeBest(cat);
    }
  }

  return picked.slice(0, 3);
}
