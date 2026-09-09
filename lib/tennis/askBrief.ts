import { tennisLastName } from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { buildTennisAdvancedAverages } from '@/lib/tennis/advancedAverages';
import { tennisDvpProfile } from '@/lib/tennis/data';
import { buildTennisPlayerForm } from '@/lib/tennis/playerForm';
import { buildTennisPlayerMatchup } from '@/lib/tennis/playerMatchup';
import type { TennisTour } from '@/lib/tennis/types';

export type TennisAskEdge = {
  id: string;
  market: string;
  lean: string;
  why: string;
  score: number;
};

export type TennisAskBrief = {
  tour: TennisTour;
  player: string;
  opponent: string | null;
  form: {
    record: string;
    winPct: number | null;
    aces: number | null;
    games: number | null;
    holdPct: number | null;
    rpw: number | null;
    insights: string[];
    vsRank: Array<{ band: string; record: string; winPct: number | null; games: number | null }>;
    vsStyle: Array<{ split: string; record: string; aces: number | null; games: number | null }>;
    recent: Array<{ date: string | null; opponent: string; rank: number | null; result: 'W' | 'L'; aces: number | null; games: number | null }>;
  };
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
    player: Record<string, string>;
    opponent: Record<string, string> | null;
  };
  matchup: Array<{ stat: string; player: string; playerRank: number | null; opponent: string; opponentRank: number | null }>;
  dvp: Array<{ stat: string; value: string; rank: number | null; field: number }>;
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

function fmt(value: number | null, suffix = '', digits = 1): string {
  if (value == null) return '—';
  return `${value.toFixed(digits)}${suffix}`;
}

export function buildTennisAskBrief(opts: {
  playerName: string;
  opponentName?: string | null;
  tour?: TennisTour | null;
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
        bestOf: tour === 'WTA' ? 3 : 3,
      })
    : null;
  const dvp = opponentName
    ? tennisDvpProfile({ tour, year: TENNIS_CURRENT_YEAR, opponentName })
    : null;

  const playerAvg = cellMap(averages.player);
  const oppAvg = averages.opponent ? cellMap(averages.opponent) : null;
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
      edges.push({
        id: 'totals',
        market: 'Totals',
        lean: avg >= 23 ? `Totals lean long (~${avg.toFixed(1)} games)` : `Totals lean short (~${avg.toFixed(1)} games)`,
        why: `${playerLast} matches average ${fmt(playerGames)} games. ${oppLast} matches average ${fmt(oppGames)} games.`,
        score: Math.abs(avg - 22.5),
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
    form: {
      record: `${form.baseline.wins}-${form.baseline.losses}`,
      winPct: round(form.baseline.winPct, 0),
      aces: round(form.baseline.aces),
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
      vsStyle: form.styleSplits.slice(0, 8).map((row) => ({
        split: row.label,
        record: `${row.wins}-${row.losses}`,
        aces: round(row.aces),
        games: round(row.totalGames),
      })),
      recent: form.recent.slice(0, 8).map((row) => ({
        date: row.date,
        opponent: tennisLastName(row.opponent),
        rank: row.opponentRank,
        result: row.isWin ? 'W' : 'L',
        aces: row.aces,
        games: row.totalGames,
      })),
    },
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
      player: playerAvg,
      opponent: oppAvg,
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
    edges: edges.slice(0, 4),
  };
}
