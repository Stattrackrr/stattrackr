'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEAM_FULL_NAMES, getEspnLogoUrl } from '../utils/teamUtils';
import { BdlSearchResult } from '../types';

const TEAM_NICKNAMES: Record<string, string> = {
  lakers: 'LAL', warriors: 'GSW', celtics: 'BOS', heat: 'MIA', bulls: 'CHI', knicks: 'NYK',
  nets: 'BKN', sixers: 'PHI', '76ers': 'PHI', mavs: 'DAL', spurs: 'SAS', rockets: 'HOU',
  cavs: 'CLE', blazers: 'POR', wolves: 'MIN', pels: 'NOP', grizz: 'MEM', thunder: 'OKC',
};

interface DashboardSearchProps {
  propsMode: 'player' | 'team';
  isPro: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: BdlSearchResult[];
  searchBusy: boolean;
  searchError: string | null;
  onSelectPlayer: (player: BdlSearchResult) => void | Promise<void>;
  onSelectTeam: (abbr: string) => void;
}

export function DashboardSearch({
  propsMode,
  isPro,
  searchQuery,
  setSearchQuery,
  searchResults,
  searchBusy,
  searchError,
  onSelectPlayer,
  onSelectTeam,
}: DashboardSearchProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const locked = propsMode === 'player' && !isPro;
  const q = searchQuery.trim().toLowerCase();

  const teamResults = useMemo(() => {
    if (propsMode !== 'team' || !q) return [];
    const nick = TEAM_NICKNAMES[q];
    return Object.entries(TEAM_FULL_NAMES)
      .filter(([abbr, name]) => abbr === nick || abbr.toLowerCase().startsWith(q) || name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [propsMode, q]);

  const count = propsMode === 'team' ? teamResults.length : searchResults.length;

  useEffect(() => {
    setActive(0);
  }, [q, propsMode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setSearchQuery('');
    setOpen(false);
  };

  const pick = (index: number) => {
    if (propsMode === 'team') {
      const hit = teamResults[index];
      if (!hit) return;
      onSelectTeam(hit[0]);
    } else {
      const hit = searchResults[index];
      if (!hit) return;
      void onSelectPlayer(hit);
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      close();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(count - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && count > 0) {
      e.preventDefault();
      pick(active);
    }
  };

  const showPanel = open && !locked && q.length > 0 && (propsMode === 'team' || q.length >= 2);
  const rowClass = (i: number) =>
    `w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
      i === active ? 'bg-purple-50 dark:bg-purple-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
    }`;

  return (
    <div ref={wrapRef} className="relative z-[70] w-full">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          readOnly={locked}
          onClick={locked ? () => router.push('/subscription') : undefined}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            propsMode === 'team'
              ? 'Search for a team...'
              : locked
                ? 'Upgrade to Pro to search players'
                : 'Search for a player...'
          }
          className={`w-full pl-9 pr-9 py-2 rounded-lg border text-sm bg-white dark:bg-[#0d2238] border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 ${
            locked ? 'cursor-pointer' : ''
          }`}
        />
        {searchQuery && !locked && (
          <button
            type="button"
            onClick={close}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0a1929] shadow-xl">
          {propsMode === 'team' ? (
            teamResults.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No teams found for &quot;{searchQuery}&quot;</div>
            ) : (
              teamResults.map(([abbr, name], i) => (
                <button key={abbr} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setActive(i)} className={rowClass(i)}>
                  <img src={getEspnLogoUrl(abbr)} alt="" className="w-6 h-6 object-contain" />
                  <span className="font-medium text-gray-900 dark:text-white">{name}</span>
                  <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{abbr}</span>
                </button>
              ))
            )
          ) : searchBusy && searchResults.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
          ) : searchError && searchResults.length === 0 ? (
            <div className="px-3 py-2 text-sm text-red-500">{searchError}</div>
          ) : searchResults.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No players found for &quot;{searchQuery}&quot;</div>
          ) : (
            searchResults.map((r, i) => (
              <button key={r.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setActive(i)} className={rowClass(i)}>
                {r.headshotUrl ? (
                  <img src={r.headshotUrl} alt="" className="w-8 h-8 rounded-full object-cover bg-gray-100 dark:bg-gray-800" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                )}
                <span className="font-medium text-gray-900 dark:text-white truncate">{r.full}</span>
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {[r.team, r.pos].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
