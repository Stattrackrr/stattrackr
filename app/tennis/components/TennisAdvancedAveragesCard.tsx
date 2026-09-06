'use client';

import { useEffect, useMemo, useState } from 'react';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import {
  ADV_AVG_BEST_OF,
  ADV_AVG_COLUMNS,
  ADV_AVG_GLOSSARY,
  ADV_AVG_VS_RANKS,
  ADV_AVG_WINDOWS,
  type AdvAvgBestOf,
  type AdvAvgSide,
  type AdvAvgTone,
  type AdvAvgVsRank,
  type AdvAvgWindow,
  type TennisAdvancedAveragesPayload,
} from '@/lib/tennis/advancedAveragesShared';

function handLabel(hand: 'R' | 'L' | null | undefined): string {
  if (hand === 'R') return 'Righty';
  if (hand === 'L') return 'Lefty';
  return '';
}

function toneClass(tone: AdvAvgTone, isDark: boolean): string {
  if (tone === 'good') return 'text-emerald-500 dark:text-emerald-400';
  if (tone === 'ok') return 'text-amber-500 dark:text-amber-400';
  if (tone === 'bad') return 'text-rose-500 dark:text-rose-400';
  if (tone === 'empty') return isDark ? 'text-gray-600' : 'text-gray-300';
  return isDark ? 'text-gray-200' : 'text-gray-800';
}

function FilterSelect<T extends string>({
  value,
  options,
  isDark,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  isDark: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        isDark
          ? 'border-gray-700 bg-[#071422] text-gray-300'
          : 'border-gray-200 bg-white text-gray-700'
      }`}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function TennisAdvancedAveragesCard({
  isDark = false,
  playerName = null,
  opponentName = null,
  tour = 'ATP',
}: {
  isDark?: boolean;
  playerName?: string | null;
  opponentName?: string | null;
  tour?: 'ATP' | 'WTA' | null;
}) {
  const [windowN, setWindowN] = useState<AdvAvgWindow>(15);
  const [bestOf, setBestOf] = useState<AdvAvgBestOf>('all');
  const [vsRank, setVsRank] = useState<AdvAvgVsRank>('all');
  const [side, setSide] = useState<'player' | 'opponent'>('player');
  const [payload, setPayload] = useState<TennisAdvancedAveragesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = String(playerName || '').trim();
  const opponent = String(opponentName || '').trim();
  const tourKey = tour === 'WTA' ? 'WTA' : 'ATP';

  useEffect(() => {
    if (!player) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      player,
      tour: tourKey,
      year: String(TENNIS_CURRENT_YEAR),
      window: String(windowN),
      bestOf,
      vsRank,
    });
    if (opponent) qs.set('opponent', opponent);
    fetch(`/api/tennis/advanced-averages?${qs.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load averages');
        return json as TennisAdvancedAveragesPayload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPayload(null);
        setError(err.message || 'Failed to load averages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player, opponent, tourKey, windowN, bestOf, vsRank]);

  useEffect(() => {
    if (!opponent) setSide('player');
  }, [opponent]);

  const active: AdvAvgSide | null = useMemo(() => {
    if (!payload) return null;
    if (side === 'opponent' && payload.opponent) return payload.opponent;
    return payload.player;
  }, [payload, side]);

  const playerTab = payload?.player.name || player || 'Player';
  const opponentTab = payload?.opponent?.name || opponent;
  const opponentHand = handLabel(payload?.opponent?.hand ?? null);

  return (
    <div className="flex min-h-[360px] w-full flex-col px-1.5 py-1">
      <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Advanced Averages</h3>
        <div className="flex items-center gap-1.5">
          <FilterSelect value={vsRank} options={ADV_AVG_VS_RANKS} isDark={isDark} onChange={setVsRank} />
          <FilterSelect value={windowN} options={ADV_AVG_WINDOWS} isDark={isDark} onChange={setWindowN} />
          <FilterSelect value={bestOf} options={ADV_AVG_BEST_OF} isDark={isDark} onChange={setBestOf} />
        </div>
      </div>

      {player ? (
        <div
          className={`mb-2 flex flex-shrink-0 overflow-hidden rounded-lg border ${
            isDark ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <button
            type="button"
            onClick={() => setSide('player')}
            className={`min-w-0 flex-1 truncate px-2 py-1.5 text-xs font-medium ${
              side === 'player'
                ? isDark
                  ? 'bg-[#10233a] text-white'
                  : 'bg-gray-100 text-gray-900'
                : isDark
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {playerTab}
          </button>
          {opponentTab ? (
            <button
              type="button"
              onClick={() => setSide('opponent')}
              className={`min-w-0 flex-1 truncate px-2 py-1.5 text-xs font-medium ${
                side === 'opponent'
                  ? isDark
                    ? 'bg-[#10233a] text-white'
                    : 'bg-gray-100 text-gray-900'
                  : isDark
                    ? 'text-gray-400 hover:text-gray-200'
                    : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {opponentTab}
              {opponentHand ? ` (${opponentHand})` : ''}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto custom-scrollbar">
        {!player ? (
          <div className={`py-6 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Select a player to see advanced averages.
          </div>
        ) : loading && !payload ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className={`h-8 w-full animate-pulse rounded ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
              />
            ))}
          </div>
        ) : error ? (
          <div className="py-4 text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : (
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                <th className="sticky left-0 z-10 bg-inherit px-2 py-1.5 text-left font-medium">Totals</th>
                {ADV_AVG_COLUMNS.map((col) => (
                  <th key={col.key} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(active?.rows || []).map((row) => (
                <tr
                  key={row.key}
                  className={
                    row.highlight
                      ? isDark
                        ? 'bg-rose-950/35'
                        : 'bg-rose-50'
                      : isDark
                        ? 'odd:bg-white/[0.02]'
                        : 'odd:bg-gray-50/80'
                  }
                >
                  <td
                    className={`sticky left-0 z-10 px-2 py-1.5 font-medium ${
                      isDark ? 'bg-[#0a1929] text-gray-200' : 'bg-white text-gray-800'
                    }`}
                  >
                    {row.label}
                  </td>
                  {ADV_AVG_COLUMNS.map((col) => {
                    const cell = row.cells[col.key];
                    return (
                      <td
                        key={col.key}
                        className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${toneClass(cell.tone, isDark)}`}
                      >
                        {cell.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        className={`mt-2 grid flex-shrink-0 grid-cols-2 gap-x-4 gap-y-0.5 border-t pt-2 text-[10px] sm:grid-cols-3 ${
          isDark ? 'border-gray-800 text-gray-500' : 'border-gray-200 text-gray-400'
        }`}
      >
        {ADV_AVG_GLOSSARY.map((item) => (
          <div key={item.abbr} className="truncate">
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>{item.abbr}</span>
            {': '}
            {item.meaning}
          </div>
        ))}
      </div>
    </div>
  );
}
