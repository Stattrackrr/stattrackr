'use client';

import { useState, useEffect } from 'react';
import { rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';

type InjuryRow = {
  team: string;
  player: string;
  injury: string;
  returning: string;
};

type InjuriesData = {
  injuries: InjuryRow[];
  generatedAt?: string;
};

export function AflInjuriesCard({ isDark, playerTeam }: { isDark: boolean; playerTeam?: string | null }) {
  const [data, setData] = useState<InjuriesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllAfl, setShowAllAfl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/afl/injuries')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData({
          injuries: json.injuries ?? [],
          generatedAt: json.generatedAt,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load injuries');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="w-full min-w-0 h-full flex items-center justify-center min-h-[320px] text-sm text-gray-500 dark:text-gray-400">
        Loading injury list…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full min-w-0 h-full flex items-center justify-center min-h-[320px] text-sm text-amber-600 dark:text-amber-400">
        {error ?? 'No data'}
      </div>
    );
  }

  const injuryTeamName = playerTeam ? rosterTeamToInjuryTeam(playerTeam) : null;
  const useTeamFilter = !showAllAfl && injuryTeamName;
  const injuries = useTeamFilter
    ? data.injuries.filter((i) => (i.team || '').toLowerCase() === injuryTeamName.toLowerCase())
    : data.injuries;
  const byTeam = new Map<string, InjuryRow[]>();
  for (const i of injuries) {
    const t = i.team || 'Unknown';
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(i);
  }
  const teams = [...byTeam.keys()].sort();
  const hasTeamToggle = !!playerTeam;

  if (!injuries.length) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col min-h-[320px]">
        <div className="flex items-center justify-between mb-2 gap-2 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AFL Injury List</h3>
          {hasTeamToggle && (
            <button
              type="button"
              onClick={() => setShowAllAfl((v) => !v)}
              className={`flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                showAllAfl
                  ? isDark ? 'bg-purple-600/20 border-purple-500 text-purple-300' : 'bg-purple-100 border-purple-400 text-purple-700'
                  : isDark ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {showAllAfl ? 'Team only' : 'Season wide'}
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center min-h-[120px] text-sm text-gray-500 dark:text-gray-400">
          {useTeamFilter ? `No injuries listed for ${injuryTeamName}` : 'No injuries listed'}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2 gap-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AFL Injury List</h3>
        {hasTeamToggle && (
          <button
            type="button"
            onClick={() => setShowAllAfl((v) => !v)}
            className={`flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
              showAllAfl
                ? isDark
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                  : 'bg-purple-100 border-purple-400 text-purple-700'
                : isDark
                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {showAllAfl ? 'Team only' : 'Season wide'}
          </button>
        )}
      </div>
      <div
        className={`rounded-lg border overflow-y-auto flex-1 min-h-0 custom-scrollbar ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        }`}
      >
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {teams.map((team) => (
            <div key={team} className="p-2">
              <div
                className={`text-xs font-semibold mb-1.5 text-left ${
                  isDark ? 'text-purple-300' : 'text-purple-700'
                }`}
              >
                {team}
              </div>
              <table className="w-full text-xs border-collapse table-fixed">
                <colgroup>
                  <col className="w-[45%]" />
                  <col className="w-[30%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <tbody>
                  {byTeam.get(team)!.map((row, idx) => (
                    <tr
                      key={`${row.player}-${idx}`}
                      className={`${isDark ? 'bg-[#0f172a]/50' : 'bg-gray-50'}`}
                    >
                      <td className="py-1 px-2 font-medium text-gray-900 dark:text-white whitespace-nowrap text-left">
                        {row.player}
                      </td>
                      <td className="py-1 px-2 text-gray-500 dark:text-gray-400 whitespace-nowrap text-center">
                        {row.injury || '—'}
                      </td>
                      <td
                        className={`py-1 px-2 text-right whitespace-nowrap ${
                          row.returning?.toLowerCase().includes('season')
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {row.returning || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
