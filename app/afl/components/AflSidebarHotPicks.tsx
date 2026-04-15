'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getAflPlayerHeadshotUrl } from '@/lib/aflPlayerHeadshots';
import { buildAflHotPicksFromListRows, type AflHotPickCard } from '@/lib/aflHotPicksFromList';

function aflInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  if (parts.length === 1) return (parts[0]!.slice(0, 2) || '?').toUpperCase();
  return '?';
}

function statLabel(statType: string): string {
  const m: Record<string, string> = {
    disposals: 'Disposals',
    disposals_over: 'Disposals O',
    anytime_goal_scorer: 'ATS Goal',
    goals_over: 'Goals O',
  };
  return m[statType] || statType;
}

type Props = {
  excludePlayerName: string;
  isDark: boolean;
  onSelectPlayer: (player: { name: string; team?: string }) => void;
};

export function AflSidebarHotPicks({ excludePlayerName, isDark, onSelectPlayer }: Props) {
  const [picks, setPicks] = useState<AflHotPickCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ex = excludePlayerName?.trim();
    if (!ex) {
      setPicks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/afl/player-props/list', { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      const rows = Array.isArray(json?.data) ? json.data : [];
      setPicks(buildAflHotPicksFromListRows(rows, { excludePlayerName: ex, limit: 10 }));
    } catch {
      setError('Could not load picks');
      setPicks([]);
    } finally {
      setLoading(false);
    }
  }, [excludePlayerName]);

  useEffect(() => {
    void load();
  }, [load]);

  const muted = isDark ? 'text-gray-500' : 'text-gray-500';
  const cardBg = isDark ? 'bg-[#0f172a] border-gray-600' : 'bg-white border-gray-200';
  const titleCls = isDark ? 'text-white' : 'text-gray-900';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-1 pb-2">
        <h3 className={`text-xs font-bold uppercase tracking-wide ${titleCls}`}>Other hot picks</h3>
        <p className={`text-[10px] leading-snug mt-0.5 ${muted}`}>Disposal lines from today&apos;s slate</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 pb-2">
        {loading ? (
          <div className="space-y-2 px-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-16 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        ) : error ? (
          <p className={`text-xs px-1 ${muted}`}>{error}</p>
        ) : picks.length === 0 ? (
          <p className={`text-xs px-1 ${muted}`}>No other disposal lines available.</p>
        ) : (
          picks.map((p) => {
            const head = getAflPlayerHeadshotUrl(p.playerName);
            const hitPct =
              p.l5Hits != null && p.l5Total != null && p.l5Total > 0
                ? Math.round((p.l5Hits / p.l5Total) * 100)
                : null;
            const posLine = [p.aflFantasyPosition, p.aflDfsRole].filter(Boolean).join(' · ');
            return (
              <button
                key={`${p.playerName}-${p.statType}-${p.line}`}
                type="button"
                onClick={() =>
                  onSelectPlayer({
                    name: p.playerName,
                    team: p.playerTeam || undefined,
                  })
                }
                className={`w-full text-left rounded-xl border px-2.5 py-2 transition-colors hover:border-purple-400 dark:hover:border-purple-500 ${cardBg}`}
              >
                <div className="flex items-start gap-2">
                  {head ? (
                    <img
                      src={head}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-gray-200 dark:border-gray-600"
                    />
                  ) : (
                    <div
                      className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold border ${
                        isDark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-gray-100 border-gray-300 text-gray-700'
                      }`}
                    >
                      {aflInitials(p.playerName)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold truncate ${titleCls}`}>{p.playerName}</div>
                    {p.playerTeam ? (
                      <div className={`text-[10px] truncate ${muted}`}>{p.playerTeam}</div>
                    ) : null}
                    {posLine ? <div className={`text-[10px] mt-0.5 font-medium ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>{posLine}</div> : null}
                    <div className={`text-[11px] font-semibold mt-1 ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
                      {statLabel(p.statType)} {p.line > 0 ? 'O' : 'U'} {Math.abs(p.line)}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] tabular-nums">
                      {p.last5Avg != null ? (
                        <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>L5 avg {p.last5Avg.toFixed(1)}</span>
                      ) : null}
                      {hitPct != null ? (
                        <span className={isDark ? 'text-emerald-400' : 'text-emerald-700'}>L5 {hitPct}%</span>
                      ) : (
                        <span className={muted}>L5 —</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="flex-shrink-0 pt-2 border-t border-gray-200 dark:border-gray-700 px-1">
        <Link
          href="/props?sport=afl"
          className={`block text-center text-[11px] font-semibold py-1.5 rounded-lg transition-colors ${
            isDark ? 'text-purple-300 hover:bg-gray-800' : 'text-purple-700 hover:bg-purple-50'
          }`}
        >
          View all props →
        </Link>
      </div>
    </div>
  );
}
