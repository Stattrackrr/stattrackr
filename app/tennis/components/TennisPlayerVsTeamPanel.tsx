'use client';

import { useMemo } from 'react';
import { tennisLastName, TENNIS_STAT_LABELS } from '@/lib/tennis/chartStats';

const ROWS: Array<{ key: string; label: string; pct?: boolean }> = [
  { key: 'aces', label: TENNIS_STAT_LABELS.aces },
  { key: 'doubleFaults', label: TENNIS_STAT_LABELS.doubleFaults },
  { key: 'gamesWon', label: TENNIS_STAT_LABELS.gamesWon },
  { key: 'pointsWon', label: TENNIS_STAT_LABELS.pointsWon },
  { key: 'firstServePct', label: TENNIS_STAT_LABELS.firstServePct, pct: true },
  { key: 'returnPointsWon', label: TENNIS_STAT_LABELS.returnPointsWon },
];

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function avg(rows: Array<Record<string, unknown>>, key: string, pct?: boolean): string {
  const vals = rows.map((r) => toNum(r[key])).filter((n): n is number => n != null);
  if (!vals.length) return '—';
  const mean = vals.reduce((s, n) => s + n, 0) / vals.length;
  if (pct) {
    const scaled = mean <= 1 ? mean * 100 : mean;
    return `${scaled.toFixed(1)}%`;
  }
  return mean.toFixed(1);
}

export function TennisPlayerVsTeamPanel({
  isDark = false,
  playerName = null,
  opponentName = null,
  gameLogs = [],
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  season?: number;
  playerName?: string | null;
  playerTeam?: string | null;
  opponentName?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
}) {
  const opponent = String(opponentName || '').trim();
  const h2h = useMemo(
    () => (gameLogs || []).filter((g) => String(g.opponent || '').trim() === opponent),
    [gameLogs, opponent]
  );
  const seasonRows = useMemo(() => (gameLogs || []).slice(-20), [gameLogs]);

  if (!playerName) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Select a player
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <table className="w-full text-xs">
        <thead>
          <tr className={isDark ? 'text-gray-300' : 'text-gray-700'}>
            <th className="px-2 py-2 text-left font-semibold">Stat</th>
            <th className="px-2 py-2 text-center font-semibold">L20</th>
            <th className="px-2 py-2 text-center font-semibold">
              vs {opponent ? tennisLastName(opponent) : 'Opp'}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr
              key={row.key}
              className={isDark ? 'odd:bg-[#0a1929] even:bg-[#0f172a]/40' : 'odd:bg-white even:bg-gray-50'}
            >
              <td className="px-2 py-1.5">{row.label}</td>
              <td className="px-2 py-1.5 text-center font-medium">{avg(seasonRows, row.key, row.pct)}</td>
              <td className="px-2 py-1.5 text-center font-medium">{avg(h2h, row.key, row.pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
