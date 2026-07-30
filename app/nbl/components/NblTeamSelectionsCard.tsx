'use client';

import { useEffect, useState } from 'react';

type Starter = {
  playerId: string | null;
  name: string;
  jersey?: string | null;
  slot: string;
  positionLabel: string;
  imageUrl?: string | null;
};

type TeamLineup = {
  team: string;
  lineup: {
    starters: Starter[];
  };
  match?: {
    opponent?: string;
    tipoff?: string | null;
    homeTeam?: string;
    awayTeam?: string;
    homeScore?: string | null;
    awayScore?: string | null;
    matchSlug?: string | null;
  } | null;
};

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatches(lineupName: string, selected?: string | null): boolean {
  if (!selected?.trim() || !lineupName?.trim()) return false;
  const a = normalizeName(lineupName);
  const b = normalizeName(selected);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aw = a.split(' ').filter(Boolean);
  const bw = b.split(' ').filter(Boolean);
  if (!aw.length || !bw.length) return false;
  return aw[aw.length - 1] === bw[bw.length - 1];
}

function shortLastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  return parts[parts.length - 1];
}

function StarterChip({
  name,
  jersey,
  slot,
  imageUrl,
  isDark,
  highlight,
}: {
  name: string;
  jersey?: string | null;
  slot: string;
  imageUrl?: string | null;
  isDark: boolean;
  highlight?: boolean;
}) {
  const badge = jersey && String(jersey).trim() ? String(jersey).trim() : '–';
  const pos = (slot || '–').toUpperCase();

  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 min-w-0 transition-colors ${
        highlight
          ? 'bg-purple-500/20 ring-2 ring-purple-500'
          : isDark
            ? 'bg-[#0d2137] ring-1 ring-white/10 hover:ring-white/20'
            : 'bg-white ring-1 ring-gray-200 hover:ring-gray-300'
      }`}
    >
      <div className="relative flex-shrink-0">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className={`w-9 h-9 rounded-full object-cover object-top ${
              isDark ? 'bg-gray-800' : 'bg-gray-100'
            }`}
          />
        ) : (
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
              isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {shortLastName(name).slice(0, 1)}
          </div>
        )}
        <span
          className={`absolute -bottom-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-md text-[9px] font-bold flex items-center justify-center ${
            isDark ? 'bg-gray-950 text-white ring-1 ring-white/20' : 'bg-gray-900 text-white'
          }`}
        >
          {badge}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-semibold leading-tight ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}
        >
          {name}
        </div>
        <div
          className={`text-[10px] font-semibold tracking-wide uppercase mt-0.5 ${
            isDark ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          {pos}
        </div>
      </div>
    </div>
  );
}

function TeamColumn({
  data,
  isDark,
  selectedPlayerName,
}: {
  data: TeamLineup;
  isDark: boolean;
  selectedPlayerName?: string | null;
}) {
  const starters = (data.lineup.starters || []).slice(0, 5);
  return (
    <div className="min-w-0 flex-1">
      <div
        className={`text-[11px] font-bold tracking-wide uppercase mb-2.5 truncate ${
          isDark ? 'text-gray-300' : 'text-gray-700'
        }`}
      >
        {data.team}
      </div>
      <div className="space-y-2">
        {starters.map((p) => (
          <StarterChip
            key={`${p.slot}-${p.playerId || p.name}`}
            name={p.name}
            jersey={p.jersey}
            slot={p.slot || p.positionLabel || '–'}
            imageUrl={p.imageUrl}
            isDark={isDark}
            highlight={nameMatches(p.name, selectedPlayerName)}
          />
        ))}
      </div>
    </div>
  );
}

/** Real starting five from last completed SportRadar box score. */
export function NblTeamSelectionsCard({
  isDark = false,
  playerTeam,
  opponentTeam,
  selectedPlayerName,
}: {
  isDark?: boolean;
  playerTeam?: string | null;
  opponentTeam?: string | null;
  selectedPlayerName?: string | null;
}) {
  const [team, setTeam] = useState<TeamLineup | null>(null);
  const [opponent, setOpponent] = useState<TeamLineup | null>(null);
  const [sharedMatch, setSharedMatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = playerTeam?.trim();
    if (!t) {
      setTeam(null);
      setOpponent(null);
      setSharedMatch(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ team: t });
    if (opponentTeam?.trim()) params.set('opponent', opponentTeam.trim());

    fetch(`/api/nbl/lineups?${params}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load lineups');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setTeam(json.team ?? null);
        setOpponent(json.opponent ?? null);
        setSharedMatch(Boolean(json.sharedMatch));
      })
      .catch((e) => {
        if (cancelled) return;
        setTeam(null);
        setOpponent(null);
        setSharedMatch(false);
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerTeam, opponentTeam]);

  const matchLabel =
    sharedMatch && team?.match
      ? `${team.match.homeTeam || ''} ${team.match.homeScore ?? ''}–${team.match.awayScore ?? ''} ${team.match.awayTeam || ''}`.trim()
      : null;

  return (
    <div className="w-full px-3">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          {sharedMatch ? 'Starting fives' : 'Most recent starters'}
        </h3>
        {matchLabel ? (
          <span
            className={`text-[10px] font-medium truncate ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}
          >
            {matchLabel}
          </span>
        ) : null}
      </div>

      {!playerTeam?.trim() && (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Select a player or team to see the starting five.
        </p>
      )}

      {playerTeam?.trim() && loading && (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Loading…</p>
      )}

      {error && (
        <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
      )}

      {!loading && !error && team && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 items-start">
          <TeamColumn data={team} isDark={isDark} selectedPlayerName={selectedPlayerName} />
          {opponent ? (
            <>
              <div
                className={`hidden sm:flex self-center text-[10px] font-bold tracking-widest uppercase ${
                  isDark ? 'text-gray-600' : 'text-gray-300'
                }`}
              >
                vs
              </div>
              <TeamColumn
                data={opponent}
                isDark={isDark}
                selectedPlayerName={selectedPlayerName}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
