'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAflPlayerHeadshotUrl } from '@/lib/aflPlayerHeadshots';
import { formatAflFantasyDfsPositionLabel } from '@/lib/aflDfsRoleLabels';
import { buildAflHotPicksFromListRows, type AflHotPickCard } from '@/lib/aflHotPicksFromList';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { AflPropsPlayerAvatar } from '@/components/AflPropsPlayerAvatar';

/** Same keys as props page so sessionStorage is shared. */
import {
  readAflTeamLogosSessionCache,
  writeAflTeamLogosSessionCache,
} from '@/lib/aflTeamLogosClientCache';

/** Club portraits cache — keep in sync with `app/props/page.tsx`. */
const AFL_PORTRAIT_RESOLVER_VERSION = '10';
const AFL_PORTRAIT_VERSION_KEY = 'st_afl_portrait_resolver_v';
const AFL_PORTRAIT_EXTRAS_KEY = 'st_afl_portrait_extras_v10';
const AFL_PORTRAIT_EXTRAS_LS_KEY_PREFIX = 'st_afl_portrait_extras_ls_v';
const AFL_PORTRAIT_EXTRAS_LS_KEY = `${AFL_PORTRAIT_EXTRAS_LS_KEY_PREFIX}${AFL_PORTRAIT_RESOLVER_VERSION}`;
const AFL_PORTRAIT_EXTRAS_LS_TS_KEY = `${AFL_PORTRAIT_EXTRAS_LS_KEY}_ts`;
const AFL_PORTRAIT_EXTRAS_LS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AFL_PORTRAIT_FETCH_BATCH_SIZE = 16;
const AFL_PORTRAIT_RETRY_DELAY_MS = 2 * 60 * 1000;

function aflInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  if (parts.length === 1) return (parts[0]!.slice(0, 2) || '?').toUpperCase();
  return '?';
}

/** Match AFL props row copy (e.g. Disposals Over 27.5). */
function formatHotPickStatLine(statType: string, line: number): string {
  const st = String(statType || '').toLowerCase();
  const side = line > 0 ? 'Over' : 'Under';
  const n = Math.abs(line);
  if (st === 'disposals' || st === 'disposals_over') return `Disposals ${side} ${n}`;
  if (st === 'goals_over') return `Goals ${side} ${n}`;
  if (st === 'anytime_goal_scorer') return 'Anytime goal';
  return `${st.replace(/_/g, ' ')} ${side} ${n}`;
}

function tryAflTeamLogoUrl(teamDisplayName: string, aflLogoByTeam: Record<string, string>): string | null {
  const n = (t: string) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!teamDisplayName) return null;
  if (aflLogoByTeam[n(teamDisplayName)]) return aflLogoByTeam[n(teamDisplayName)];
  for (const w of teamDisplayName.split(/\s+/)) {
    if (aflLogoByTeam[n(w)]) return aflLogoByTeam[n(w)];
  }
  return null;
}

function MatchupLogosAfl({
  homeTeamRaw,
  awayTeamRaw,
  playerTeamRaw,
  aflLogoByTeam,
  isDark,
}: {
  homeTeamRaw: string | null | undefined;
  awayTeamRaw: string | null | undefined;
  playerTeamRaw: string | null | undefined;
  aflLogoByTeam: Record<string, string>;
  isDark: boolean;
}) {
  const gameHome = toOfficialAflTeamDisplayName(homeTeamRaw || '');
  const gameAway = toOfficialAflTeamDisplayName(awayTeamRaw || '');
  if (!gameHome || !gameAway) return null;

  const playerTeam = toOfficialAflTeamDisplayName(playerTeamRaw || '') || gameHome;
  const opponent = playerTeam === gameHome ? gameAway : playerTeam === gameAway ? gameHome : gameAway;
  let homeD = playerTeam;
  let awayD = opponent;
  if (homeD && awayD && homeD === awayD) awayD = '';

  const homeLogoUrl = homeD ? tryAflTeamLogoUrl(homeD, aflLogoByTeam) : null;
  const awayLogoUrl = awayD ? tryAflTeamLogoUrl(awayD, aflLogoByTeam) : null;
  const placeholder = `w-5 h-5 rounded-full border flex-shrink-0 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`;

  return (
    <div className="flex items-center gap-1 flex-shrink-0 min-w-0">
      {homeLogoUrl ? (
        <img src={homeLogoUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0 opacity-100" />
      ) : (
        <div className={placeholder} />
      )}
      <span className={`text-[9px] flex-shrink-0 leading-none ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>vs</span>
      {awayLogoUrl ? (
        <img src={awayLogoUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0 opacity-100" />
      ) : (
        <div className={placeholder} />
      )}
    </div>
  );
}

type Props = {
  excludePlayerName: string;
  isDark: boolean;
  onSelectPlayer: (player: { name: string; team?: string }) => void;
};

export function AflSidebarHotPicks({ excludePlayerName, isDark, onSelectPlayer }: Props) {
  const [mounted, setMounted] = useState(false);
  const [picks, setPicks] = useState<AflHotPickCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aflLogoByTeam, setAflLogoByTeam] = useState<Record<string, string>>({});
  const [aflPlayerNumbers, setAflPlayerNumbers] = useState<Record<string, number>>({});
  const [aflPortraitExtras, setAflPortraitExtras] = useState<Record<string, string>>({});
  const [aflPortraitBatchLoading, setAflPortraitBatchLoading] = useState(false);
  const aflPortraitExtrasRef = useRef<Record<string, string>>({});
  const aflPortraitFetchedRef = useRef<Set<string>>(new Set());
  const aflPortraitMissUntilRef = useRef<Map<string, number>>(new Map());
  const aflPortraitFetchGenRef = useRef(0);

  useEffect(() => {
    aflPortraitExtrasRef.current = aflPortraitExtras;
  }, [aflPortraitExtras]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hydrate club portraits from session/localStorage (same buckets as props page).
  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(AFL_PORTRAIT_VERSION_KEY) !== AFL_PORTRAIT_RESOLVER_VERSION) {
        sessionStorage.setItem(AFL_PORTRAIT_VERSION_KEY, AFL_PORTRAIT_RESOLVER_VERSION);
        sessionStorage.removeItem(AFL_PORTRAIT_EXTRAS_KEY);
        try {
          if (typeof localStorage !== 'undefined') {
            for (let i = localStorage.length - 1; i >= 0; i -= 1) {
              const key = localStorage.key(i);
              if (
                key &&
                key.startsWith(AFL_PORTRAIT_EXTRAS_LS_KEY_PREFIX) &&
                key !== AFL_PORTRAIT_EXTRAS_LS_KEY &&
                key !== AFL_PORTRAIT_EXTRAS_LS_TS_KEY
              ) {
                localStorage.removeItem(key);
              }
            }
          }
        } catch {
          /* ignore */
        }
        aflPortraitFetchedRef.current = new Set();
        aflPortraitMissUntilRef.current = new Map();
        setAflPortraitExtras({});
        return;
      }

      let parsed: Record<string, string> | null = null;
      const sessionRaw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AFL_PORTRAIT_EXTRAS_KEY) : null;
      if (sessionRaw) {
        const maybe = JSON.parse(sessionRaw) as Record<string, string> | null;
        if (maybe && typeof maybe === 'object') parsed = maybe;
      }
      if (!parsed && typeof localStorage !== 'undefined') {
        const lsRaw = localStorage.getItem(AFL_PORTRAIT_EXTRAS_LS_KEY);
        const lsTsRaw = localStorage.getItem(AFL_PORTRAIT_EXTRAS_LS_TS_KEY);
        const lsTs = lsTsRaw ? parseInt(lsTsRaw, 10) : 0;
        const lsAge = Number.isFinite(lsTs) ? Date.now() - lsTs : Infinity;
        if (lsRaw && lsAge < AFL_PORTRAIT_EXTRAS_LS_TTL_MS) {
          const maybe = JSON.parse(lsRaw) as Record<string, string> | null;
          if (maybe && typeof maybe === 'object') parsed = maybe;
        }
      }
      if (!parsed) return;
      const next: Record<string, string> = {};
      for (const [name, url] of Object.entries(parsed)) {
        if (typeof name !== 'string' || !name.trim()) continue;
        if (typeof url !== 'string' || !url.trim()) continue;
        next[name] = url;
      }
      if (Object.keys(next).length > 0) {
        setAflPortraitExtras(next);
        aflPortraitFetchedRef.current = new Set(Object.keys(next));
        aflPortraitMissUntilRef.current = new Map();
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (Object.keys(aflPortraitExtras).length === 0) return;
      const serialized = JSON.stringify(aflPortraitExtras);
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(AFL_PORTRAIT_EXTRAS_KEY, serialized);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AFL_PORTRAIT_EXTRAS_LS_KEY, serialized);
        localStorage.setItem(AFL_PORTRAIT_EXTRAS_LS_TS_KEY, Date.now().toString());
      }
    } catch {
      /* ignore */
    }
  }, [aflPortraitExtras]);

  useEffect(() => {
    const cached = readAflTeamLogosSessionCache();
    if (cached && Object.keys(cached).length > 0) {
      setAflLogoByTeam(cached);
      return;
    }

    fetch('/api/afl/team-logos', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { logos?: Record<string, string> } | null) => {
        if (data?.logos && typeof data.logos === 'object' && Object.keys(data.logos).length > 0) {
          setAflLogoByTeam(data.logos);
          writeAflTeamLogosSessionCache(data.logos);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (picks.length === 0) return;
    const season = new Date().getFullYear();
    Promise.all([
      fetch(`/api/afl/league-player-stats?season=${season}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/afl/league-player-stats?season=${season - 1}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([curr, prev]) => {
        const map: Record<string, number> = {};
        const add = (data: { players?: Array<{ name?: string; number?: number }> } | null) => {
          if (!data?.players) return;
          for (const pl of data.players) {
            const name = (pl?.name ?? '').trim();
            const num = typeof pl?.number === 'number' && Number.isFinite(pl.number) ? pl.number : null;
            if (name && num != null) map[name] = num;
          }
        };
        add(prev);
        add(curr);
        setAflPlayerNumbers(map);
      })
      .catch(() => {});
  }, [picks]);

  // Resolve club-site portraits like the props table (`/api/afl/player-portraits`).
  useEffect(() => {
    if (picks.length === 0) {
      setAflPortraitBatchLoading(false);
      return;
    }
    const extras = aflPortraitExtrasRef.current;
    const players: { name: string; team?: string; homeTeam?: string; awayTeam?: string }[] = [];
    const seen = new Set<string>();
    for (const pick of picks) {
      const n = String(pick.playerName ?? '').trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      if (getAflPlayerHeadshotUrl(n)) continue;
      if (extras[n]) continue;
      if (aflPortraitFetchedRef.current.has(n)) continue;
      const missUntil = aflPortraitMissUntilRef.current.get(n) ?? 0;
      if (missUntil > Date.now()) continue;
      players.push({
        name: n,
        team: pick.playerTeam || undefined,
        homeTeam: pick.homeTeam || undefined,
        awayTeam: pick.awayTeam || undefined,
      });
    }
    if (players.length === 0) {
      setAflPortraitBatchLoading(false);
      return;
    }
    setAflPortraitBatchLoading(true);
    const fetchGen = ++aflPortraitFetchGenRef.current;
    const chunks: Array<typeof players> = [];
    for (let i = 0; i < players.length; i += AFL_PORTRAIT_FETCH_BATCH_SIZE) {
      chunks.push(players.slice(i, i + AFL_PORTRAIT_FETCH_BATCH_SIZE));
    }
    void Promise.all(
      chunks.map(async (batch) => {
        try {
          const r = await fetch('/api/afl/player-portraits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ players: batch }),
          });
          if (!r.ok) {
            for (const pl of batch) {
              aflPortraitMissUntilRef.current.set(pl.name, Date.now() + AFL_PORTRAIT_RETRY_DELAY_MS);
            }
            return;
          }
          const data = (await r.json()) as { portraits?: Record<string, string | null> };
          const portraits = data.portraits ?? {};
          for (const pl of batch) {
            const resolvedUrl = portraits[pl.name];
            if (resolvedUrl) {
              aflPortraitFetchedRef.current.add(pl.name);
              aflPortraitMissUntilRef.current.delete(pl.name);
            } else {
              aflPortraitMissUntilRef.current.set(pl.name, Date.now() + AFL_PORTRAIT_RETRY_DELAY_MS);
            }
          }
          // Always merge successful URLs — do not drop them when a newer fetch starts.
          setAflPortraitExtras((prev) => {
            const next = { ...prev };
            for (const [name, url] of Object.entries(portraits)) {
              if (url) next[name] = url;
            }
            return next;
          });
        } catch {
          for (const pl of batch) {
            aflPortraitMissUntilRef.current.set(pl.name, Date.now() + AFL_PORTRAIT_RETRY_DELAY_MS);
          }
        }
      })
    ).finally(() => {
      if (aflPortraitFetchGenRef.current === fetchGen) {
        setAflPortraitBatchLoading(false);
      }
    });
  }, [picks]);

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
      setPicks(buildAflHotPicksFromListRows(rows, { excludePlayerName: ex, limit: 20 }));
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
  const cardBg = isDark
    ? 'bg-[#0f172a]/90 border-[#463e6b]/90 shadow-[0_6px_18px_rgba(0,0,0,0.2),0_0_22px_rgba(124,58,237,0.16)]'
    : 'bg-white border-gray-200 shadow-[0_6px_18px_rgba(0,0,0,0.06),0_0_16px_rgba(124,58,237,0.08)]';
  const titleCls = isDark ? 'text-white' : 'text-gray-900';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-1 pb-1.5">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400 flex items-center justify-center gap-1 w-full">
          Other hot picks
          <span aria-hidden className="select-none">
            🔥
          </span>
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5 pb-1.5">
        {loading ? (
          <div className="space-y-1.5 px-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-[4.5rem] rounded-md animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        ) : error ? (
          <p className={`text-xs px-1 ${muted}`}>{error}</p>
        ) : picks.length === 0 ? (
          <p className={`text-xs px-1 ${muted}`}>No other disposal lines right now.</p>
        ) : (
          picks.map((p) => {
            const headJson = getAflPlayerHeadshotUrl(p.playerName);
            const headExtra = aflPortraitExtras[p.playerName];
            const headshotUrl = headJson ?? headExtra ?? null;
            const hitPct =
              p.l5Hits != null && p.l5Total != null && p.l5Total > 0
                ? Math.round((p.l5Hits / p.l5Total) * 100)
                : null;
            const l5HitRateGood = hitPct != null && hitPct >= 50;
            const posLine = formatAflFantasyDfsPositionLabel(p.aflFantasyPosition, p.aflDfsRole);
            const jersey = aflPlayerNumbers[p.playerName];
            const jerseyNum = typeof jersey === 'number' && Number.isFinite(jersey) ? jersey : null;
            const aflAvatarPending =
              aflPortraitBatchLoading &&
              !headJson &&
              !headExtra &&
              !aflPortraitFetchedRef.current.has(p.playerName);
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
                className={`w-full text-left rounded-md border px-1.5 py-1.5 transition-colors hover:border-purple-400/80 dark:hover:border-purple-500/80 ${cardBg}`}
              >
                <div className="flex items-start gap-1.5 min-w-0">
                  {aflAvatarPending ? (
                    <div
                      className="w-10 h-10 rounded-full flex-shrink-0 border-2 animate-pulse bg-gray-200 dark:bg-gray-600"
                      style={{
                        borderColor: mounted && isDark ? '#4b5563' : '#e5e7eb',
                      }}
                      aria-hidden
                    />
                  ) : (
                    <AflPropsPlayerAvatar
                      headshotUrl={headshotUrl}
                      jerseyNumber={jerseyNum}
                      initials={aflInitials(p.playerName)}
                      isDark={isDark}
                      mounted={mounted}
                      size="sm"
                    />
                  )}
                  <div className="flex-1 min-w-0 leading-snug">
                    <div className={`text-[13px] font-semibold leading-tight truncate ${titleCls}`}>{p.playerName}</div>
                    {posLine ? (
                      <div
                        className={`text-[11px] font-semibold leading-tight truncate mt-px ${isDark ? 'text-gray-400' : 'text-gray-600'}`}
                      >
                        {posLine}
                      </div>
                    ) : null}
                    <div className={`text-xs font-medium leading-tight mt-px ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                      {formatHotPickStatLine(p.statType, p.line)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 w-full min-w-0 flex-wrap">
                      <div className="flex-shrink-0">
                        {p.homeTeam && p.awayTeam ? (
                          <MatchupLogosAfl
                            homeTeamRaw={p.homeTeam}
                            awayTeamRaw={p.awayTeam}
                            playerTeamRaw={p.playerTeam}
                            aflLogoByTeam={aflLogoByTeam}
                            isDark={isDark}
                          />
                        ) : p.playerTeam ? (
                          <div className={`text-[10px] truncate max-w-[7rem] ${muted}`}>{p.playerTeam}</div>
                        ) : null}
                      </div>
                      <div className="flex flex-row flex-wrap items-baseline gap-x-2 gap-y-0 leading-tight text-[11px] tabular-nums min-w-0">
                        {p.last5Avg != null ? (
                          <span className={isDark ? 'text-white' : 'text-gray-900'}>L5 avg {p.last5Avg.toFixed(1)}</span>
                        ) : null}
                        {hitPct != null ? (
                          <span
                            className={
                              l5HitRateGood
                                ? isDark
                                  ? 'text-emerald-400'
                                  : 'text-emerald-700'
                                : isDark
                                  ? 'text-gray-400'
                                  : 'text-gray-600'
                            }
                          >
                            L5 {hitPct}%
                          </span>
                        ) : (
                          <span className={muted}>L5 —</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="flex-shrink-0 pt-1.5 border-t border-gray-200 dark:border-gray-700 px-1">
        <Link
          href="/props?sport=afl"
          className={`block text-center text-[11px] font-semibold py-1 rounded-md transition-colors ${
            isDark ? 'text-purple-300 hover:bg-gray-800/80' : 'text-purple-700 hover:bg-purple-50'
          }`}
        >
          View all props →
        </Link>
      </div>
    </div>
  );
}
