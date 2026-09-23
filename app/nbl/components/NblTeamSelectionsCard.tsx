'use client';

import { useEffect, useMemo, useState } from 'react';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

type NblPlayerRating = {
  playerId: string;
  name: string;
  team: string;
  games: number;
  minutes: number;
  offRtg: number | null;
  defRtg: number | null;
};

type NblPlayerRatingsPayload = {
  year: number;
  players: NblPlayerRating[];
};

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

const lineupCache = new Map<
  string,
  { team: TeamLineup | null; opponent: TeamLineup | null; at: number }
>();
const LINEUP_CACHE_TTL_MS = 30 * 60 * 1000;

const RATINGS_CACHE_VER = 2;
let ratingsCache: {
  year: number;
  ver: number;
  payload: NblPlayerRatingsPayload;
  at: number;
} | null = null;

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

function shortTeamLabel(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name;
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

function lookupRating(
  byId: Map<string, NblPlayerRating>,
  byName: Map<string, NblPlayerRating>,
  player: LineupPlayer | null | undefined
): NblPlayerRating | null {
  if (!player) return null;
  const id = String(player.playerId || '').trim();
  if (id && byId.has(id)) return byId.get(id) ?? null;
  return byName.get(normalizeName(player.name)) ?? null;
}

function fmtRtg(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? n.toFixed(1) : '—';
}

function barWidthPct(value: number | null | undefined, min: number, max: number): number {
  if (value == null || !Number.isFinite(value) || max <= min) return 0;
  return Math.max(8, Math.min(100, ((value - min) / (max - min)) * 100));
}

function lineupRatingRange(
  players: LineupPlayer[],
  byId: Map<string, NblPlayerRating>,
  byName: Map<string, NblPlayerRating>
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of players) {
    const r = lookupRating(byId, byName, p);
    if (r?.offRtg != null) {
      min = Math.min(min, r.offRtg);
      max = Math.max(max, r.offRtg);
    }
    if (r?.defRtg != null) {
      min = Math.min(min, r.defRtg);
      max = Math.max(max, r.defRtg);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 100 };
  const pad = Math.max(3, (max - min) * 0.28);
  return { min: min - pad, max };
}

function ButterflyRow({
  player,
  offRtg,
  defRtg,
  minRtg,
  maxRtg,
  isDark,
  highlight,
}: {
  player: LineupPlayer;
  offRtg: number | null;
  defRtg: number | null;
  minRtg: number;
  maxRtg: number;
  isDark: boolean;
  highlight?: boolean;
}) {
  const track = isDark
    ? 'bg-black/40 ring-1 ring-inset ring-white/[0.06]'
    : 'bg-gray-200/80 ring-1 ring-inset ring-black/[0.04]';
  const defFill = highlight
    ? 'bg-gradient-to-l from-red-400 to-red-600 shadow-[0_0_12px_rgba(248,113,113,0.55)]'
    : 'bg-gradient-to-l from-red-500 to-red-800 shadow-[0_0_10px_rgba(239,68,68,0.42)]';
  const offFill = highlight
    ? 'bg-gradient-to-r from-emerald-300 to-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.55)]'
    : 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.42)]';
  const nameClass = `text-[12px] font-semibold leading-tight truncate ${
    highlight ? 'text-purple-400' : isDark ? 'text-gray-100' : 'text-gray-900'
  }`;
  return (
    <div className="min-w-0">
      <div className={`sm:hidden mb-1 text-center ${nameClass}`} title={player.name}>
        {player.name}
      </div>
      <div className="flex items-center min-w-0">
        <span
          className={`w-[2.25rem] sm:w-[2.6rem] shrink-0 text-[11px] sm:text-[12px] tabular-nums font-semibold ${
            isDark ? 'text-red-400' : 'text-red-800'
          }`}
        >
          {fmtRtg(defRtg)}
        </span>
        <div
          className={`mx-1 sm:mx-1.5 flex h-4 sm:h-3.5 min-w-[3.75rem] sm:min-w-[1.5rem] flex-1 items-center justify-end overflow-hidden rounded-[3px] ${track}`}
        >
          <div
            className={`h-full rounded-[2px] ${defFill}`}
            style={{ width: `${barWidthPct(defRtg, minRtg, maxRtg)}%`, transition: 'width 400ms ease' }}
          />
        </div>
        <span className={`hidden sm:block w-[9.25rem] shrink-0 px-2 text-center ${nameClass}`} title={player.name}>
          {player.name}
        </span>
        <div
          className={`mx-1 sm:mx-1.5 h-4 sm:h-3.5 min-w-[3.75rem] sm:min-w-[1.5rem] flex-1 overflow-hidden rounded-[3px] ${track}`}
        >
          <div
            className={`h-full rounded-[2px] ${offFill}`}
            style={{ width: `${barWidthPct(offRtg, minRtg, maxRtg)}%`, transition: 'width 400ms ease' }}
          />
        </div>
        <span
          className={`w-[2.25rem] sm:w-[2.6rem] shrink-0 text-right text-[11px] sm:text-[12px] tabular-nums font-semibold ${
            isDark ? 'text-emerald-300' : 'text-emerald-700'
          }`}
        >
          {fmtRtg(offRtg)}
        </span>
      </div>
    </div>
  );
}

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
  const [ratings, setRatings] = useState<NblPlayerRating[] | null>(
    ratingsCache?.ver === RATINGS_CACHE_VER ? ratingsCache.payload.players : null
  );

  useEffect(() => {
    const t = playerTeam?.trim();
    if (!t) {
      setPlayerSide(null);
      setOtherSide(null);
      setActiveTeam(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cacheKey = t.toLowerCase();
    const cached = lineupCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LINEUP_CACHE_TTL_MS) {
      setPlayerSide(cached.team);
      setOtherSide(cached.opponent);
      setActiveTeam(cached.team?.team || null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlayerSide(null);
    setOtherSide(null);
    setActiveTeam(null);

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
        lineupCache.set(cacheKey, { team, opponent: opp, at: Date.now() });
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

  useEffect(() => {
    if (
      ratingsCache &&
      ratingsCache.ver === RATINGS_CACHE_VER &&
      Date.now() - ratingsCache.at < LINEUP_CACHE_TTL_MS
    ) {
      setRatings(ratingsCache.payload.players);
      return;
    }
    let cancelled = false;
    fetch(`/api/nbl/player-ratings?year=${NBL_CURRENT_SEASON_YEAR}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('ratings'))))
      .then((data: NblPlayerRatingsPayload) => {
        if (cancelled) return;
        ratingsCache = { year: data.year, ver: RATINGS_CACHE_VER, payload: data, at: Date.now() };
        setRatings(Array.isArray(data.players) ? data.players : []);
      })
      .catch(() => {
        if (!cancelled) setRatings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const ratingById = useMemo(() => {
    const m = new Map<string, NblPlayerRating>();
    for (const r of ratings || []) m.set(r.playerId, r);
    return m;
  }, [ratings]);
  const ratingByName = useMemo(() => {
    const m = new Map<string, NblPlayerRating>();
    for (const r of ratings || []) m.set(normalizeName(r.name), r);
    return m;
  }, [ratings]);

  const { min: minRtg, max: maxRtg } = lineupRatingRange(
    [...starters, ...bench],
    ratingById,
    ratingByName
  );

  const muted = isDark ? 'text-gray-500' : 'text-gray-400';
  const heading = isDark ? 'text-gray-200' : 'text-gray-800';

  return (
    <div className="w-full min-w-0 px-0">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-3">
        <h3 className={`text-sm font-semibold justify-self-start ${heading}`}>Roster breakdown</h3>

        <div className="justify-self-center">
          {!error && teamOptions.length > 1 ? (
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
                      <img src={logo} alt={opt.team} className="w-6 h-6 object-contain" />
                    ) : (
                      <span className={`text-[10px] font-bold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {shortTeamLabel(opt.team).slice(0, 3).toUpperCase()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : !error && active ? (
            (() => {
              const logo = resolveTeamLogo?.(active.team) ?? null;
              return logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={active.team} title={active.team} className="w-7 h-7 object-contain" />
              ) : (
                <span className={`text-[11px] font-bold tracking-wide uppercase ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {shortTeamLabel(active.team)}
                </span>
              );
            })()
          ) : null}
        </div>

        <div className="justify-self-end">
          {matchDate ? (
            <span className={`text-[10px] font-medium truncate ${muted}`}>{matchDate}</span>
          ) : null}
        </div>
      </div>

      {!playerTeam?.trim() && (
        <p className={`text-xs ${muted}`}>Select a player or team to see their most recent starting five and bench.</p>
      )}

      {playerTeam?.trim() && loading && !active && <p className={`text-xs ${muted}`}>Loading…</p>}

      {error && <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>}

      {!error && active && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center min-w-0">
            <span className={`shrink-0 text-[10px] font-bold tracking-wide ${isDark ? 'text-red-500/90' : 'text-red-800'}`}>
              Defensive rating
            </span>
            <span className="flex-1" />
            <span className={`shrink-0 text-right text-[10px] font-bold tracking-wide ${isDark ? 'text-emerald-400/80' : 'text-emerald-700'}`}>
              Offensive rating
            </span>
          </div>

          <div>
            <div className={`text-[10px] font-bold tracking-wide uppercase mb-2 text-center ${muted}`}>Starting 5</div>
            {starters.length ? (
              <div className="space-y-2">
                {starters.map((p) => {
                  const r = lookupRating(ratingById, ratingByName, p);
                  return (
                    <ButterflyRow
                      key={`st-${p.slot || p.position || 'x'}-${p.playerId || p.name}`}
                      player={p}
                      offRtg={r?.offRtg ?? null}
                      defRtg={r?.defRtg ?? null}
                      minRtg={minRtg}
                      maxRtg={maxRtg}
                      isDark={isDark}
                      highlight={nameMatches(p.name, selectedPlayerName)}
                    />
                  );
                })}
              </div>
            ) : (
              <p className={`text-[11px] ${muted}`}>None listed</p>
            )}
          </div>

          <div>
            <div className={`text-[10px] font-bold tracking-wide uppercase mb-2 text-center ${muted}`}>Bench</div>
            {bench.length ? (
              <div className="space-y-2">
                {bench.map((p) => {
                  const r = lookupRating(ratingById, ratingByName, p);
                  return (
                    <ButterflyRow
                      key={`bn-${p.slot || p.position || 'x'}-${p.playerId || p.name}`}
                      player={p}
                      offRtg={r?.offRtg ?? null}
                      defRtg={r?.defRtg ?? null}
                      minRtg={minRtg}
                      maxRtg={maxRtg}
                      isDark={isDark}
                      highlight={nameMatches(p.name, selectedPlayerName)}
                    />
                  );
                })}
              </div>
            ) : (
              <p className={`text-[11px] ${muted}`}>None listed</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
