'use client';

import { useEffect, useMemo, useState } from 'react';

type LineupPlayer = {
  playerId: string | null;
  name: string;
  jersey?: string | null;
  slot?: string;
  position?: string | null;
  positionLabel?: string;
  imageUrl?: string | null;
};

type TeamLineup = {
  team: string;
  lineup: {
    starters: LineupPlayer[];
    bench?: LineupPlayer[];
  };
  match?: {
    opponent?: string;
    tipoff?: string | null;
    homeTeam?: string;
    awayTeam?: string;
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

function shortTeamLabel(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
  // Prefer last word for NBL clubs ("Illawarra Hawks" → "Hawks")
  return parts[parts.length - 1];
}

function formatMatchDate(tipoff?: string | null): string | null {
  if (!tipoff) return null;
  const d = new Date(tipoff);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function PlayerChip({
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

function PlayerColumn({
  title,
  players,
  isDark,
  selectedPlayerName,
}: {
  title: string;
  players: LineupPlayer[];
  isDark: boolean;
  selectedPlayerName?: string | null;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div
        className={`text-[10px] font-bold tracking-wide uppercase mb-2 ${
          isDark ? 'text-gray-400' : 'text-gray-500'
        }`}
      >
        {title}
      </div>
      {players.length ? (
        <div className="space-y-2">
          {players.map((p) => (
            <PlayerChip
              key={`${title}-${p.slot || p.position || 'x'}-${p.playerId || p.name}`}
              name={p.name}
              jersey={p.jersey}
              slot={p.slot || p.positionLabel || p.position || '–'}
              imageUrl={p.imageUrl}
              isDark={isDark}
              highlight={nameMatches(p.name, selectedPlayerName)}
            />
          ))}
        </div>
      ) : (
        <p className={`text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>None listed</p>
      )}
    </div>
  );
}

/** Most recent game for the player's team — selector for both sides; starters left, bench right. */
export function NblTeamSelectionsCard({
  isDark = false,
  playerTeam,
  selectedPlayerName,
  resolveTeamLogo,
}: {
  isDark?: boolean;
  playerTeam?: string | null;
  opponentTeam?: string | null;
  selectedPlayerName?: string | null;
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [playerSide, setPlayerSide] = useState<TeamLineup | null>(null);
  const [otherSide, setOtherSide] = useState<TeamLineup | null>(null);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = playerTeam?.trim();
    if (!t) {
      setPlayerSide(null);
      setOtherSide(null);
      setActiveTeam(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/nbl/lineups?${new URLSearchParams({ team: t })}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load lineups');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        const team = (json.team ?? null) as TeamLineup | null;
        const opp = (json.opponent ?? null) as TeamLineup | null;
        setPlayerSide(team);
        setOtherSide(opp);
        setActiveTeam(team?.team || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setPlayerSide(null);
        setOtherSide(null);
        setActiveTeam(null);
        setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playerTeam]);

  const teamOptions = useMemo(() => {
    const opts: TeamLineup[] = [];
    if (playerSide) opts.push(playerSide);
    if (otherSide) opts.push(otherSide);
    return opts;
  }, [playerSide, otherSide]);

  const active = useMemo(() => {
    if (!teamOptions.length) return null;
    return teamOptions.find((t) => t.team === activeTeam) || teamOptions[0];
  }, [teamOptions, activeTeam]);

  const starters = (active?.lineup.starters || []).slice(0, 5);
  const bench = active?.lineup.bench || [];
  const matchDate = formatMatchDate(playerSide?.match?.tipoff || otherSide?.match?.tipoff);

  return (
    <div className="w-full px-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-3">
        <h3
          className={`text-sm font-semibold justify-self-start ${
            isDark ? 'text-gray-200' : 'text-gray-800'
          }`}
        >
          Most recent lineup
        </h3>

        <div className="justify-self-center">
          {!loading && !error && teamOptions.length > 1 ? (
            <div className="flex gap-2">
              {teamOptions.map((opt) => {
                const selected = active?.team === opt.team;
                const logo = resolveTeamLogo?.(opt.team) ?? null;
                return (
                  <button
                    key={opt.team}
                    type="button"
                    onClick={() => setActiveTeam(opt.team)}
                    title={opt.team}
                    aria-label={opt.team}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors border ${
                      selected
                        ? 'bg-purple-600/20 border-purple-500 ring-2 ring-purple-500'
                        : isDark
                          ? 'bg-[#0a1929] border-gray-700 hover:bg-gray-800'
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logo}
                        alt={opt.team}
                        className="w-6 h-6 object-contain"
                      />
                    ) : (
                      <span
                        className={`text-[10px] font-bold ${
                          isDark ? 'text-gray-300' : 'text-gray-700'
                        }`}
                      >
                        {shortTeamLabel(opt.team).slice(0, 3).toUpperCase()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : !loading && !error && active ? (
            (() => {
              const logo = resolveTeamLogo?.(active.team) ?? null;
              return logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={active.team}
                  title={active.team}
                  className="w-7 h-7 object-contain"
                />
              ) : (
                <span
                  className={`text-[11px] font-bold tracking-wide uppercase ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  {shortTeamLabel(active.team)}
                </span>
              );
            })()
          ) : null}
        </div>

        <div className="justify-self-end">
          {matchDate ? (
            <span
              className={`text-[10px] font-medium truncate ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {matchDate}
            </span>
          ) : null}
        </div>
      </div>

      {!playerTeam?.trim() && (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Select a player or team to see their most recent starting five and bench.
        </p>
      )}

      {playerTeam?.trim() && loading && (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Loading…</p>
      )}

      {error && (
        <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
      )}

      {!loading && !error && active && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 items-start">
          <PlayerColumn
            title="Starting 5"
            players={starters}
            isDark={isDark}
            selectedPlayerName={selectedPlayerName}
          />
          <PlayerColumn
            title="Bench"
            players={bench}
            isDark={isDark}
            selectedPlayerName={selectedPlayerName}
          />
        </div>
      )}
    </div>
  );
}
