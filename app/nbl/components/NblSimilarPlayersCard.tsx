'use client';

import { useEffect, useMemo, useState } from 'react';
import { NBL_SHOT_CHART_SEASON_YEAR } from '@/lib/nblTeamCanonical';
import type { NblSimilarPlayersPayload } from '@/lib/nbl/similarPlayersShared';

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(Math.round(n));
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const s = String(raw);
    return s.length >= 10 ? s.slice(0, 10) : s;
  }
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
}

/** Green = over the line, red = under. Neutral when no line. */
function statVsLineClass(
  value: number | null | undefined,
  line: number | null | undefined,
  isDark: boolean
): string {
  if (value == null || line == null || !Number.isFinite(value) || !Number.isFinite(line)) {
    return isDark ? 'text-white' : 'text-gray-900';
  }
  if (value > line) return isDark ? 'text-emerald-400' : 'text-emerald-600';
  if (value < line) return isDark ? 'text-red-400' : 'text-red-600';
  return isDark ? 'text-amber-300' : 'text-amber-600';
}

export function NblSimilarPlayersCard({
  isDark = false,
  season = NBL_SHOT_CHART_SEASON_YEAR,
  playerId = null,
  opponentName = null,
  selectedStat = 'points',
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  season?: number;
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
}) {
  const [payload, setPayload] = useState<NblSimilarPlayersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId || !opponentName || opponentName === 'All') {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      playerId,
      opponent: opponentName,
      stat: selectedStat || 'points',
      year: String(season),
      limit: '8',
    });

    fetch(`/api/nbl/similar-players?${params.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load');
        return json as NblSimilarPlayersPayload;
      })
      .then((json) => {
        if (cancelled) return;
        setPayload(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setPayload(null);
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerId, opponentName, selectedStat, season]);

  const oppLabel = payload?.opponent?.name || opponentName || 'opponent';
  const statLabel = payload?.statLabel || selectedStat || 'Points';

  // Hard rule: each player appears at most once (their most recent vs-opponent game).
  const rows = useMemo(() => {
    const list = payload?.similar || [];
    const byPlayer = new Map<string, (typeof list)[number]>();
    for (const row of list) {
      const key =
        row.playerId ||
        String(row.name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
      if (!key) continue;
      const existing = byPlayer.get(key);
      if (
        !existing ||
        String(row.date || '').localeCompare(String(existing.date || '')) > 0
      ) {
        byPlayer.set(key, row);
      }
    }
    return [...byPlayer.values()];
  }, [payload?.similar]);

  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const strong = isDark ? 'text-white' : 'text-gray-900';
  const rowBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const headBorder = isDark ? 'border-gray-700' : 'border-gray-200';

  return (
    <div className="w-full min-h-[140px]">
      <div className="mb-1.5 px-0.5">
        <div className={`text-sm font-semibold ${strong}`}>Similar Players</div>
      </div>

      {!playerId || !opponentName || opponentName === 'All' ? (
        <div className={`text-xs ${muted} py-6 text-center`}>
          Select a player and opponent to see similar players.
        </div>
      ) : loading ? (
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`h-10 rounded-md animate-pulse ${
                isDark ? 'bg-gray-800/50' : 'bg-gray-100'
              }`}
            />
          ))}
        </div>
      ) : error ? (
        <div className="text-xs text-red-500 dark:text-red-400 py-6 text-center">{error}</div>
      ) : !rows.length ? (
        <div className={`text-xs ${muted} py-6 text-center`}>
          No similar players found vs {oppLabel}.
        </div>
      ) : (
        <div>
          <div
            className={`grid grid-cols-[minmax(0,1fr)_3.75rem_3.5rem_3.5rem_3.5rem] gap-x-2 px-1 pb-1.5 mb-0.5 border-b ${headBorder}`}
          >
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>
              Player
            </span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              Date
            </span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              Mins
            </span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              {statLabel}
            </span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              Line
            </span>
          </div>

          <div>
            {rows.map((row) => (
              <div
                key={row.playerId || row.name}
                className={`grid grid-cols-[minmax(0,1fr)_3.75rem_3.5rem_3.5rem_3.5rem] gap-x-2 items-center px-1 py-2 border-b last:border-0 ${rowBorder}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {row.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.imageUrl}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover shrink-0 bg-gray-200 dark:bg-gray-700"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full shrink-0 bg-gray-200 dark:bg-gray-700" />
                  )}
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold ${strong} truncate leading-tight`}>
                      {row.name}
                    </div>
                    <div className={`text-[10px] ${muted} truncate leading-tight`}>
                      {row.team}
                    </div>
                  </div>
                </div>
                <div className={`text-[11px] tabular-nums text-right ${muted}`}>
                  {fmtDate(row.date)}
                </div>
                <div className={`text-xs font-medium tabular-nums text-right ${strong}`}>
                  {fmtInt(row.minutes)}
                </div>
                <div
                  className={`text-[13px] font-bold tabular-nums text-right ${statVsLineClass(
                    row.value,
                    row.line,
                    isDark
                  )}`}
                >
                  {fmtInt(row.value)}
                </div>
                <div className={`text-xs font-medium tabular-nums text-right ${muted}`}>
                  {row.line != null ? fmtInt(row.line) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NblSimilarPlayersCard;
