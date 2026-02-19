'use client';

import { useEffect, useMemo, useState } from 'react';
import { AFL_TEAM_TO_FOOTYWIRE } from '@/lib/aflTeamMapping';

const DVP_METRICS = [
  { key: 'goals', label: 'Goals vs ', isPercentage: false },
  { key: 'disposals', label: 'Disposals vs ', isPercentage: false },
  { key: 'marks', label: 'Marks vs ', isPercentage: false },
  { key: 'kicks', label: 'Kicks vs ', isPercentage: false },
  { key: 'handballs', label: 'Handballs vs ', isPercentage: false },
  { key: 'tackles', label: 'Tackles vs ', isPercentage: false },
  { key: 'inside_50s', label: 'Inside 50s vs ', isPercentage: false },
  { key: 'clearances', label: 'Clearances vs ', isPercentage: false },
] as const;

const AFL_POSITIONS = ['DEF', 'MID', 'FWD', 'RUC'] as const;
const DVP_CACHE_TTL = 2 * 60 * 1000;
const dvpBatchCache = new Map<string, { data: DvpBatchResponse; timestamp: number }>();

type DvpBatchResponse = {
  success: boolean;
  opponents: string[];
  metrics: Record<string, {
    values: Record<string, number>;
    ranks: Record<string, number>;
    teamTotalValues?: Record<string, number>;
    teamTotalRanks?: Record<string, number>;
    samples?: Record<string, number>;
    teamGames?: Record<string, number>;
  }>;
};

type FantasyPositionRow = { name: string; position: string };

const TEAM_ALIASES: Record<string, string[]> = {
  adelaide: ['adelaide', 'adelaidecrows', 'crows'],
  brisbane: ['brisbane', 'brisbanelions', 'lions'],
  carlton: ['carlton', 'carltonblues', 'blues'],
  collingwood: ['collingwood', 'collingwoodmagpies', 'magpies'],
  essendon: ['essendon', 'essendonbombers', 'bombers'],
  fremantle: ['fremantle', 'fremantledockers', 'dockers'],
  geelong: ['geelong', 'geelongcats', 'cats'],
  goldcoast: ['goldcoast', 'goldcoastsuns', 'suns'],
  gws: ['gws', 'gwsgiants', 'greaterwesternsydney', 'greaterwesternsydneygiants', 'giants'],
  hawthorn: ['hawthorn', 'hawthornhawks', 'hawks'],
  melbourne: ['melbourne', 'melbournedemons', 'demons'],
  northmelbourne: ['northmelbourne', 'northmelbournekangaroos', 'kangaroos', 'north'],
  portadelaide: ['portadelaide', 'portadelaidepower', 'power', 'port'],
  richmond: ['richmond', 'richmondtigers', 'tigers'],
  stkilda: ['stkilda', 'stkildasaints', 'saints'],
  sydney: ['sydney', 'sydneyswans', 'swans'],
  westcoast: ['westcoast', 'westcoasteagles', 'eagles'],
  westernbulldogs: ['westernbulldogs', 'westernbulldogsfootballclub', 'bulldogs', 'footscray'],
};

function normalizeText(v: string): string {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  const normalized = normalizeText(teamName);
  if (!normalized) return null;
  if (logoByTeam[normalized]) return logoByTeam[normalized];
  for (const aliases of Object.values(TEAM_ALIASES)) {
    if (!aliases.includes(normalized)) continue;
    for (const alias of aliases) {
      if (logoByTeam[alias]) return logoByTeam[alias];
    }
    // Fuzzy fallback: sometimes API keys are full team names, sometimes nicknames.
    for (const [key, logo] of Object.entries(logoByTeam)) {
      if (aliases.some((alias) => key.includes(alias) || alias.includes(key))) return logo;
    }
  }
  return null;
}

function teamDisplayName(teamName: string): string {
  const direct = AFL_TEAM_TO_FOOTYWIRE[teamName];
  if (direct) return direct;
  const lower = String(teamName || '').toLowerCase().trim();
  const entry = Object.entries(AFL_TEAM_TO_FOOTYWIRE).find(([k]) => k.toLowerCase() === lower);
  return entry?.[1] || teamName;
}

function pickBestPosition(playerName: string, players: FantasyPositionRow[]): (typeof AFL_POSITIONS)[number] | null {
  const target = normalizeText(playerName);
  if (!target) return null;
  const exact = players.find((p) => normalizeText(p.name) === target);
  const fromExact = String(exact?.position || '').toUpperCase();
  if (AFL_POSITIONS.includes(fromExact as (typeof AFL_POSITIONS)[number])) return fromExact as (typeof AFL_POSITIONS)[number];
  const fuzzy = players.find((p) => normalizeText(p.name).includes(target) || target.includes(normalizeText(p.name)));
  const fromFuzzy = String(fuzzy?.position || '').toUpperCase();
  if (AFL_POSITIONS.includes(fromFuzzy as (typeof AFL_POSITIONS)[number])) return fromFuzzy as (typeof AFL_POSITIONS)[number];
  return null;
}

function findOpponentKey(target: string, opponents: string[]): string {
  if (!target) return opponents[0] || '';
  const tn = normalizeText(target);
  const exact = opponents.find((o) => normalizeText(o) === tn);
  if (exact) return exact;
  const partial = opponents.find((o) => normalizeText(o).includes(tn) || tn.includes(normalizeText(o)));
  return partial || opponents[0] || '';
}

export default function AflDvpCard({
  isDark,
  playerName,
  opponentTeam,
  season,
  logoByTeam,
}: {
  isDark: boolean;
  playerName: string | null;
  opponentTeam: string;
  season: number;
  logoByTeam: Record<string, string>;
}) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perStat, setPerStat] = useState<Record<string, number | null>>({});
  const [perRank, setPerRank] = useState<Record<string, number | null>>({});
  const [allTeams, setAllTeams] = useState<string[]>([]);
  const [posSel, setPosSel] = useState<(typeof AFL_POSITIONS)[number] | null>(null);
  const [oppSel, setOppSel] = useState<string>(opponentTeam || '');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => setOppSel(opponentTeam || ''), [opponentTeam]);

  useEffect(() => {
    const name = String(playerName || '').trim();
    if (!name) {
      setPosSel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/afl/fantasy-positions?season=${season}&player=${encodeURIComponent(name)}`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const rows = Array.isArray(json?.players) ? (json.players as FantasyPositionRow[]) : [];
        const pos = pickBestPosition(name, rows);
        if (pos) setPosSel(pos);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [playerName, season]);

  useEffect(() => {
    let abort = false;
    const run = async () => {
      setError(null);
      const targetPos = posSel;
      const targetOpp = oppSel || opponentTeam;
      if (!targetPos) {
        setPerStat({});
        setPerRank({});
        return;
      }

      const cacheKey = `${season}:${targetPos}`;
      const cached = dvpBatchCache.get(cacheKey);
      const now = Date.now();
      const isFresh = cached && (now - cached.timestamp) < DVP_CACHE_TTL;

      if (isFresh && cached) {
        const opponents = cached.data.opponents || [];
        setAllTeams(opponents);
        const oppKey = findOpponentKey(targetOpp, opponents);
        if (oppKey && oppKey !== oppSel) setOppSel(oppKey);
        const statMap: Record<string, number | null> = {};
        const rankMap: Record<string, number | null> = {};
        for (const m of DVP_METRICS) {
          const metric = cached.data.metrics?.[m.key];
          const value = metric?.teamTotalValues?.[oppKey];
          const rank = metric?.teamTotalRanks?.[oppKey];
          statMap[m.key] = typeof value === 'number' ? value : null;
          rankMap[m.key] = typeof rank === 'number' ? rank : null;
        }
        setPerStat(statMap);
        setPerRank(rankMap);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const statsCsv = DVP_METRICS.map((m) => m.key).join(',');
        const res = await fetch(
          `/api/afl/dvp/batch?season=${season}&position=${targetPos}&stats=${encodeURIComponent(statsCsv)}`
        );
        const data = (await res.json().catch(() => ({}))) as DvpBatchResponse & { error?: string };
        if (abort) return;
        if (!res.ok || !data?.success) {
          setError(data?.error || 'Unable to load DvP data.');
          setLoading(false);
          return;
        }
        dvpBatchCache.set(cacheKey, { data, timestamp: Date.now() });
        const opponents = data.opponents || [];
        setAllTeams(opponents);
        const oppKey = findOpponentKey(targetOpp, opponents);
        if (oppKey && oppKey !== oppSel) setOppSel(oppKey);
        const statMap: Record<string, number | null> = {};
        const rankMap: Record<string, number | null> = {};
        for (const m of DVP_METRICS) {
          const metric = data.metrics?.[m.key];
          const value = metric?.teamTotalValues?.[oppKey];
          const rank = metric?.teamTotalRanks?.[oppKey];
          statMap[m.key] = typeof value === 'number' ? value : null;
          rankMap[m.key] = typeof rank === 'number' ? rank : null;
        }
        setPerStat(statMap);
        setPerRank(rankMap);
      } catch {
        if (!abort) setError('Unable to load DvP data.');
      } finally {
        if (!abort) setLoading(false);
      }
    };
    run();
    return () => { abort = true; };
  }, [oppSel, posSel, opponentTeam, season]);

  const posLabel = posSel || 'Select Position';
  const teamCount = allTeams.length || 18;
  const fmt = (v?: number | null, isPercentage?: boolean) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    return isPercentage ? `${v.toFixed(1)}%` : v.toFixed(1);
  };

  if (!playerName) {
    return <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Select a player to view DvP.</div>;
  }

  return (
    <div className="mb-4 sm:mb-6 w-full min-w-0">
      <div className="flex items-center justify-between mb-2 sm:mb-2">
        <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">Defense vs Position</h3>
        <span className="text-xs sm:text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0`}>
        <div className="px-3 sm:px-3 py-3 sm:py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Position</div>
            <button
              onClick={() => setPosOpen((o) => !o)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm font-bold ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'} ${posSel ? 'bg-purple-600 border-purple-600 text-white' : ''}`}
            >
              <span>{posLabel}</span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            {posOpen && (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-[#0a1929] border-gray-600' : 'bg-white border-gray-300'}`}>
                  {AFL_POSITIONS.map((p) => (
                    <button
                      key={p}
                      onClick={() => { setPosSel(p); setPosOpen(false); }}
                      className={`w-full px-3 py-2 text-sm font-bold text-left ${posLabel === p ? 'bg-purple-600 text-white' : (mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900')}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setPosOpen(false)} />
              </>
            )}
          </div>

          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Opponent Team</div>
            <button
              onClick={() => setOppOpen((o) => !o)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md border text-sm ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <span className="flex items-center gap-2">
                {(oppSel || opponentTeam) && resolveTeamLogo(oppSel || opponentTeam || '', logoByTeam) && (
                  <img src={resolveTeamLogo(oppSel || opponentTeam || '', logoByTeam) || ''} alt={oppSel || opponentTeam || 'OPP'} className="w-6 h-6 object-contain" />
                )}
                <span className="font-semibold">{teamDisplayName(oppSel || opponentTeam || '')}</span>
              </span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            {oppOpen && (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                  <div className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain" onWheel={(e) => e.stopPropagation()}>
                    {allTeams.map((t) => (
                      <button
                        key={t}
                        onClick={() => { setOppSel(t); setOppOpen(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm text-left ${mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                      >
                        {resolveTeamLogo(t, logoByTeam) && <img src={resolveTeamLogo(t, logoByTeam) || ''} alt={t} className="w-5 h-5 object-contain" />}
                        <span className="font-medium">{teamDisplayName(t)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            )}
          </div>
        </div>

        <div className={`px-3 pb-2 text-[10px] ${mounted && isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          Team Total conceded to selected position (per team-game).
        </div>

        {error ? (
          <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">Error loading DvP stats: {error}</div>
        ) : !posSel ? (
          <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">Select a position above to view DvP stats.</div>
        ) : loading && Object.keys(perStat).length === 0 ? (
          <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {DVP_METRICS.map((m, index) => (
              <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${mounted && isDark ? 'border-slate-700' : 'border-slate-300'} px-3 py-2.5`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" style={{ animationDelay: `${index * 0.1}s` }} />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" style={{ animationDelay: `${index * 0.1 + 0.05}s` }} />
                    <div className="h-5 w-10 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" style={{ animationDelay: `${index * 0.1 + 0.1}s` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {DVP_METRICS.map((m) => {
              const rank = perRank[m.key];
              let borderColor: string;
              let badgeColor: string;
              if (rank == null || rank === 0) {
                borderColor = mounted && isDark ? 'border-slate-700' : 'border-slate-300';
                badgeColor = mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
              } else if (rank >= 16) {
                borderColor = mounted && isDark ? 'border-green-900' : 'border-green-800';
                badgeColor = 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
              } else if (rank >= 13) {
                borderColor = mounted && isDark ? 'border-green-800' : 'border-green-600';
                badgeColor = 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
              } else if (rank >= 10) {
                borderColor = mounted && isDark ? 'border-orange-800' : 'border-orange-600';
                badgeColor = 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100';
              } else if (rank >= 7) {
                borderColor = mounted && isDark ? 'border-orange-900' : 'border-orange-700';
                badgeColor = 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
              } else if (rank >= 4) {
                borderColor = mounted && isDark ? 'border-red-800' : 'border-red-600';
                badgeColor = 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
              } else {
                borderColor = mounted && isDark ? 'border-red-900' : 'border-red-800';
                badgeColor = 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
              }

              return (
                <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${borderColor} px-3 py-2.5`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>{m.label}{posLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${mounted && isDark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                        {fmt(perStat[m.key], m.isPercentage)}
                      </span>
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}>
                        {typeof rank === 'number' && rank > 0 ? `#${rank}` : rank === 0 ? 'N/A' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

