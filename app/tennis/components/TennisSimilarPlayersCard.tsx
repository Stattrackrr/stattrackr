'use client';

import { useEffect, useMemo, useState } from 'react';
import { tennisLastName } from '@/lib/tennis/chartStats';
import { tennisFlagUrl } from '@/lib/tennis/flags';

type RankRow = {
  pos: number | null;
  team: string;
  teamCode?: string | null;
  points_for?: number | null;
};

type SimilarPlayerMeta = {
  name?: string | null;
  imageUrl?: string | null;
  ioc?: string | null;
};

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

export function TennisSimilarPlayersCard({
  isDark = false,
  playerName = null,
  tour = 'ATP',
  players = [],
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  season?: number;
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
  tour?: 'ATP' | 'WTA';
  players?: SimilarPlayerMeta[];
}) {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(false);
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const strong = isDark ? 'text-white' : 'text-gray-900';
  const rowBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const headBorder = isDark ? 'border-gray-700' : 'border-gray-200';

  const imageByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const player of players) {
      const key = normName(player.name);
      const url = String(player.imageUrl || '').trim();
      if (key && url) map.set(key, url);
    }
    return map;
  }, [players]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tennis/rankings?tour=${tour}&limit=100`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const teams: RankRow[] = Array.isArray(json?.teams) ? json.teams : [];
        teams.sort((a, b) => (Number(a.pos) || 9999) - (Number(b.pos) || 9999));
        const idx = teams.findIndex((row) => normName(row.team) === normName(playerName));
        const windowSize = 8;
        let start = idx >= 0 ? Math.max(0, idx - 3) : 0;
        if (start + windowSize > teams.length) start = Math.max(0, teams.length - windowSize);
        setRows(teams.slice(start, start + windowSize));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tour, playerName]);

  if (!playerName) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${muted}`}>
        Select a player to see nearby rankings.
      </div>
    );
  }

  if (loading && !rows.length) {
    return (
      <div className="space-y-1.5 min-h-[160px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-9 rounded-md animate-pulse ${isDark ? 'bg-gray-800/50' : 'bg-gray-100'}`}
          />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${muted}`}>
        No ranking neighbors found.
      </div>
    );
  }

  return (
    <div className="w-full min-h-[160px]">
      <div
        className={`grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem] gap-x-2 px-1 pb-1.5 mb-0.5 border-b ${headBorder}`}
      >
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>#</span>
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Player</span>
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
          Pts
        </span>
      </div>
      <div>
        {rows.map((row) => {
          const active = normName(row.team) === normName(playerName);
          const imageUrl = imageByName.get(normName(row.team));
          const flagUrl = tennisFlagUrl(row.teamCode);
          const pts =
            typeof row.points_for === 'number' && Number.isFinite(row.points_for)
              ? Math.round(row.points_for).toLocaleString('en-AU')
              : '—';
          return (
            <div
              key={`${row.pos}-${row.team}`}
              className={`grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem] gap-x-2 items-center px-1 py-1.5 border-b last:border-0 ${rowBorder} ${
                active ? 'bg-purple-100 dark:bg-purple-900/40 rounded-md' : ''
              }`}
            >
              <span className={`text-xs tabular-nums ${muted}`}>{row.pos ?? '—'}</span>
              <div className="flex items-center gap-2 min-w-0">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover shrink-0 bg-gray-200 dark:bg-gray-700"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full shrink-0 bg-gray-200 dark:bg-gray-700" />
                )}
                {flagUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={flagUrl}
                    alt=""
                    className="h-[9px] w-[13px] object-cover rounded-[1px] shrink-0"
                  />
                ) : null}
                <span className={`text-xs font-semibold truncate ${strong}`}>
                  {tennisLastName(row.team)}
                </span>
              </div>
              <span className={`text-[11px] tabular-nums text-right ${muted}`}>{pts}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
