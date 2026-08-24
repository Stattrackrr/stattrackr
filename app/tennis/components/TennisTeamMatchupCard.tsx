'use client';

import { useEffect, useMemo, useState } from 'react';
import { tennisLastName, TENNIS_STAT_LABELS } from '@/lib/tennis/chartStats';

const STATS: Array<{ key: string; label: string; pct?: boolean }> = [
  { key: 'aces', label: TENNIS_STAT_LABELS.aces },
  { key: 'gamesWon', label: TENNIS_STAT_LABELS.gamesWon },
  { key: 'totalGames', label: TENNIS_STAT_LABELS.totalGames },
  { key: 'pointsWon', label: TENNIS_STAT_LABELS.pointsWon },
  { key: 'firstServePct', label: TENNIS_STAT_LABELS.firstServePct, pct: true },
  { key: 'moneyline', label: 'WIN %', pct: true },
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
    const scaled = key === 'moneyline' ? mean * 100 : mean <= 1 ? mean * 100 : mean;
    return `${scaled.toFixed(1)}%`;
  }
  return mean.toFixed(1);
}

export default function TennisTeamMatchupCard({
  isDark = false,
  teamName = null,
  opponentName = null,
}: {
  isDark?: boolean;
  teamName?: string | null;
  opponentName?: string | null;
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [playerLogs, setPlayerLogs] = useState<Array<Record<string, unknown>>>([]);
  const [oppLogs, setOppLogs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  const player = String(teamName || '').trim();
  const opponent = String(opponentName || '').trim();

  useEffect(() => {
    if (!player && !opponent) {
      setPlayerLogs([]);
      setOppLogs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      player
        ? fetch(`/api/tennis/matches?player=${encodeURIComponent(player)}`).then((r) => r.json())
        : Promise.resolve({ games: [] }),
      opponent
        ? fetch(`/api/tennis/matches?player=${encodeURIComponent(opponent)}`).then((r) => r.json())
        : Promise.resolve({ games: [] }),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setPlayerLogs(Array.isArray(a?.games) ? a.games.slice(-10) : []);
        setOppLogs(Array.isArray(b?.games) ? b.games.slice(-10) : []);
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerLogs([]);
          setOppLogs([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player, opponent]);

  const ready = useMemo(() => playerLogs.length + oppLogs.length > 0, [playerLogs, oppLogs]);

  if (!player || !opponent) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Select a player to compare last-10 form
      </div>
    );
  }

  if (loading && !ready) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Loading matchup…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Matchup · L10</h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <table className="w-full text-xs">
          <thead className="sticky top-0">
            <tr className={isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}>
              <th className="px-2 py-2 text-left font-semibold">Stat</th>
              <th className="px-2 py-2 text-center font-semibold">{tennisLastName(player)}</th>
              <th className="px-2 py-2 text-center font-semibold">{tennisLastName(opponent)}</th>
            </tr>
          </thead>
          <tbody>
            {STATS.map((stat) => (
              <tr
                key={stat.key}
                className={isDark ? 'odd:bg-[#0a1929] even:bg-[#0f172a]/40' : 'odd:bg-white even:bg-gray-50'}
              >
                <td className="px-2 py-1.5 text-gray-600 dark:text-gray-300">{stat.label}</td>
                <td className="px-2 py-1.5 text-center font-medium text-gray-900 dark:text-white">
                  {avg(playerLogs, stat.key, stat.pct)}
                </td>
                <td className="px-2 py-1.5 text-center font-medium text-gray-900 dark:text-white">
                  {avg(oppLogs, stat.key, stat.pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
