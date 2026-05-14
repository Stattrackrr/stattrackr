'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
const DEPTH_ROLE_OPTIONS = [
  { key: 'key_fwd', label: 'KEY FWD', apiPosition: 'FWD' },
  { key: 'gen_fwd', label: 'GEN FWD', apiPosition: 'FWD' },
  { key: 'ins_mid', label: 'INS MID', apiPosition: 'MID' },
  { key: 'ruck', label: 'RUCK', apiPosition: 'RUC' },
  { key: 'wng_def', label: 'WNG DEF', apiPosition: 'DEF' },
  { key: 'gen_def', label: 'GEN DEF', apiPosition: 'DEF' },
  { key: 'des_kck', label: 'DES KCK', apiPosition: 'DEF' },
] as const;
const SEASON_OPTIONS = [2026, 2025] as const;
const DVP_CACHE_TTL = 2 * 60 * 1000;
const DVP_CLIENT_CACHE_VERSION = 'v2';
const dvpBatchCache = new Map<string, { data: DvpBatchResponse; timestamp: number }>();
const dvpBatchInFlight = new Map<string, Promise<DvpBatchResponse | null>>();

type DvpBatchResponse = {
  success: boolean;
  opponents: string[];
  metrics: Record<string, {
    values: Record<string, number>;
    ranks: Record<string, number>;
    teamTotalValues?: Record<string, number>;
    teamTotalRanks?: Record<string, number>;
    rawTeamTotalValues?: Record<string, number>;
    rawTeamTotalRanks?: Record<string, number>;
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

/** Resolve target (e.g. "Kangaroos") to canonical key (e.g. "northmelbourne") using TEAM_ALIASES so we can match API opponents that use full names (e.g. "North Melbourne"). */
function targetToCanonicalKey(tn: string): string | null {
  if (!tn) return null;
  if (Object.prototype.hasOwnProperty.call(TEAM_ALIASES, tn)) return tn;
  for (const [key, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.includes(tn)) return key;
  }
  return null;
}

function findOpponentKey(target: string, opponents: string[]): string {
  if (!target) return opponents[0] || '';
  const tn = normalizeText(target);
  const exact = opponents.find((o) => normalizeText(o) === tn);
  if (exact) return exact;
  // Match by alias/canonical BEFORE partial: e.g. "Kangaroos" -> North Melbourne, and "North Melbourne Kangaroos" must resolve to North Melbourne not Melbourne (partial would match "melbourne" substring and wrongly return Demons).
  const canonicalTarget = targetToCanonicalKey(tn);
  if (canonicalTarget) {
    const byCanonical = opponents.find((o) => normalizeText(o) === canonicalTarget);
    if (byCanonical) return byCanonical;
  }
  const partial = opponents.find((o) => normalizeText(o).includes(tn) || tn.includes(normalizeText(o)));
  if (partial) return partial;
  return opponents[0] || '';
}

export default function AflDvpCard({
  isDark,
  playerName,
  opponentTeam,
  season,
  logoByTeam,
  playerPosition,
}: {
  isDark: boolean;
  playerName: string | null;
  opponentTeam: string;
  season: number;
  logoByTeam: Record<string, string>;
  /** Player's position from page (DEF/MID/FWD/RUC). When set, DvP uses this instead of defaulting to MID. */
  playerPosition?: 'DEF' | 'MID' | 'FWD' | 'RUC' | null;
}) {
  type PositionKey = (typeof AFL_POSITIONS)[number];
  type DepthRoleKey = (typeof DEPTH_ROLE_OPTIONS)[number]['key'];
  const DEPTH_ROLE_KEY_TO_API_POS: Record<DepthRoleKey, PositionKey> = {
    key_fwd: 'FWD',
    gen_fwd: 'FWD',
    ins_mid: 'MID',
    ruck: 'RUC',
    wng_def: 'DEF',
    gen_def: 'DEF',
    des_kck: 'DEF',
  };
  const [mounted, setMounted] = useState(false);
  const [viewMode, setViewMode] = useState<'depth' | 'basic'>('depth');
  const [selectedSeason, setSelectedSeason] = useState<2025 | 2026>(2026);
  const [loading, setLoading] = useState(false);
  const [depthLoading, setDepthLoading] = useState(false);
  const [hasResolvedBasicLoad, setHasResolvedBasicLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [perStat, setPerStat] = useState<Record<string, number | null>>({});
  const [perRank, setPerRank] = useState<Record<string, number | null>>({});
  const [depthPerStat, setDepthPerStat] = useState<Record<DepthRoleKey, Record<string, number | null>>>({
    key_fwd: {},
    gen_fwd: {},
    ins_mid: {},
    ruck: {},
    wng_def: {},
    gen_def: {},
    des_kck: {},
  });
  const [depthPerRank, setDepthPerRank] = useState<Record<DepthRoleKey, Record<string, number | null>>>({
    key_fwd: {},
    gen_fwd: {},
    ins_mid: {},
    ruck: {},
    wng_def: {},
    gen_def: {},
    des_kck: {},
  });
  const [allTeams, setAllTeams] = useState<string[]>([]);
  const [posSel, setPosSel] = useState<(typeof AFL_POSITIONS)[number] | null>(null);
  const [depthPosSel, setDepthPosSel] = useState<DepthRoleKey>('ins_mid');
  const [oppSel, setOppSel] = useState<string>(opponentTeam || '');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const opponentTeamRef = useRef(opponentTeam);
  opponentTeamRef.current = opponentTeam;
  const userChangedOpponentRef = useRef(false);

  useEffect(() => setMounted(true), []);
  // Sync from parent only when user hasn't chosen an opponent yet, so their dropdown choice isn't overwritten.
  useEffect(() => {
    if (!userChangedOpponentRef.current) setOppSel(opponentTeam || '');
  }, [opponentTeam]);
  useEffect(() => {
    userChangedOpponentRef.current = false;
  }, [playerName]);

  // Prefer page's player position so DvP matches the header (e.g. DEF for Jaspa Fletcher)
  useEffect(() => {
    const name = String(playerName || '').trim();
    if (!name) {
      setPosSel(null);
      return;
    }
    const posFromPage = playerPosition && AFL_POSITIONS.includes(playerPosition) ? playerPosition : null;
    if (posFromPage) {
      setPosSel(posFromPage);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/afl/fantasy-positions?season=${selectedSeason}&player=${encodeURIComponent(name)}`);
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
  }, [playerName, selectedSeason, playerPosition]);

  useEffect(() => {
    // Keep depth role picker aligned with resolved basic position.
    if (!posSel) return;
    if (posSel === 'RUC') setDepthPosSel('ruck');
    else if (posSel === 'MID') setDepthPosSel('ins_mid');
    else if (posSel === 'FWD') setDepthPosSel('gen_fwd');
    else if (posSel === 'DEF') setDepthPosSel('wng_def');
  }, [posSel]);

  useEffect(() => {
    let abort = false;
    const run = async () => {
      setError(null);
      const targetPos = posSel;
      const targetOpp = oppSel || opponentTeam;
      if (!targetPos) {
        setPerStat({});
        setPerRank({});
        setHasResolvedBasicLoad(false);
        return;
      }

      setHasResolvedBasicLoad(false);
      const cacheKey = `${DVP_CLIENT_CACHE_VERSION}:${selectedSeason}:${targetPos}`;
      const cached = dvpBatchCache.get(cacheKey);
      const now = Date.now();
      const skipClientCache = process.env.NODE_ENV === 'development';
      const isFresh = !skipClientCache && cached && (now - cached.timestamp) < DVP_CACHE_TTL;
      const statsCsv = DVP_METRICS.map((m) => m.key).join(',');
      const bust = process.env.NODE_ENV === 'development' ? '&bust=1' : '';

      const applyFromData = (data: DvpBatchResponse) => {
        const opponents = data.opponents || [];
        setAllTeams(opponents);
        const parentOpp = userChangedOpponentRef.current ? null : opponentTeamRef.current?.trim();
        const parentKey = parentOpp ? findOpponentKey(parentOpp, opponents) : '';
        // Keep parent matchup aligned unless user manually changed opponent.
        if (parentKey && parentKey !== oppSel) setOppSel(parentKey);
        const fallbackKey = findOpponentKey(targetOpp, opponents);
        const oppKey = parentKey || fallbackKey;
        if (!parentKey && oppKey && oppKey !== oppSel) {
          const isDefaultFirst = !targetOpp && fallbackKey === (opponents[0] || '');
          if (!isDefaultFirst) setOppSel(oppKey);
        }
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
      };

      if (isFresh && cached) {
        applyFromData(cached.data);
        setHasResolvedBasicLoad(true);
        setLoading(false);
        return;
      }

      // Use stale cache immediately for instant UI, then refresh in background.
      if (cached?.data) {
        applyFromData(cached.data);
      }

      setLoading(true);
      try {
        let request = dvpBatchInFlight.get(cacheKey);
        if (!request) {
          request = fetch(
            `/api/afl/dvp/batch?season=${selectedSeason}&position=${targetPos}&stats=${encodeURIComponent(statsCsv)}${bust}`
          )
            .then(async (res) => {
              const data = (await res.json().catch(() => ({}))) as DvpBatchResponse & { error?: string };
              if (!res.ok || !data?.success) return null;
              return data as DvpBatchResponse;
            })
            .catch(() => null)
            .finally(() => {
              dvpBatchInFlight.delete(cacheKey);
            });
          dvpBatchInFlight.set(cacheKey, request);
        }
        const data = await request;
        if (abort) return;
        if (!data?.success) {
          if (!cached?.data) setError('Unable to load DvP data.');
          setHasResolvedBasicLoad(true);
          setLoading(false);
          return;
        }
        dvpBatchCache.set(cacheKey, { data, timestamp: Date.now() });
        applyFromData(data);
      } catch {
        if (!abort && !cached?.data) setError('Unable to load DvP data.');
      } finally {
        if (!abort) {
          setHasResolvedBasicLoad(true);
          setLoading(false);
        }
      }
    };
    run();
    return () => { abort = true; };
  }, [oppSel, posSel, opponentTeam, selectedSeason]);

  useEffect(() => {
    let abort = false;
    const run = async () => {
      if (viewMode !== 'depth') return;
      setDepthError(null);
      const targetOpp = oppSel || opponentTeam;
      if (!targetOpp) {
        setDepthPerStat({ key_fwd: {}, gen_fwd: {}, ins_mid: {}, ruck: {}, wng_def: {}, gen_def: {}, des_kck: {} });
        setDepthPerRank({ key_fwd: {}, gen_fwd: {}, ins_mid: {}, ruck: {}, wng_def: {}, gen_def: {}, des_kck: {} });
        return;
      }
      const statsCsv = DVP_METRICS.map((m) => m.key).join(',');
      const bust = process.env.NODE_ENV === 'development' ? '&bust=1' : '';
      const skipClientCache = process.env.NODE_ENV === 'development';

      const nextDepthPerStat: Record<DepthRoleKey, Record<string, number | null>> = {
        key_fwd: {},
        gen_fwd: {},
        ins_mid: {},
        ruck: {},
        wng_def: {},
        gen_def: {},
        des_kck: {},
      };
      const nextDepthPerRank: Record<DepthRoleKey, Record<string, number | null>> = {
        key_fwd: {},
        gen_fwd: {},
        ins_mid: {},
        ruck: {},
        wng_def: {},
        gen_def: {},
        des_kck: {},
      };

      const byRoleData: Partial<Record<DepthRoleKey, DvpBatchResponse>> = {};
      const applyDepthFromRoleData = (roleData: Partial<Record<DepthRoleKey, DvpBatchResponse>>) => {
        const firstData = DEPTH_ROLE_OPTIONS
          .map((r) => roleData[r.key])
          .find((d) => d?.success);
        const opponents = firstData?.opponents || [];
        if (opponents.length > 0) {
          setAllTeams(opponents);
          if (!userChangedOpponentRef.current) {
            const parentOpp = opponentTeamRef.current?.trim();
            const preferred = parentOpp ? findOpponentKey(parentOpp, opponents) : findOpponentKey(targetOpp, opponents);
            if (preferred && preferred !== oppSel) setOppSel(preferred);
          }
        }

        for (const role of DEPTH_ROLE_OPTIONS) {
          const posData = roleData[role.key];
          if (!posData?.success) continue;
          const oppKey = findOpponentKey(targetOpp, posData.opponents || []);
          for (const m of DVP_METRICS) {
            const metric = posData.metrics?.[m.key];
            const value = metric?.teamTotalValues?.[oppKey];
            const rank = metric?.teamTotalRanks?.[oppKey];
            nextDepthPerStat[role.key][m.key] = typeof value === 'number' ? value : null;
            nextDepthPerRank[role.key][m.key] = typeof rank === 'number' ? rank : null;
          }
        }

        setDepthPerStat({ ...nextDepthPerStat });
        setDepthPerRank({ ...nextDepthPerRank });
      };

      try {
        const roleRequests = DEPTH_ROLE_OPTIONS.map((role) => {
          const position = DEPTH_ROLE_KEY_TO_API_POS[role.key];
          const cacheKey = `${DVP_CLIENT_CACHE_VERSION}:depth:${selectedSeason}:${position}:${role.key}`;
          const cached = dvpBatchCache.get(cacheKey);
          const isFresh = !skipClientCache && cached && (Date.now() - cached.timestamp) < DVP_CACHE_TTL;
          if (cached?.data?.success) {
            byRoleData[role.key] = cached.data;
          }
          return { role, position, cacheKey, isFresh };
        });

        const hasCachedData = Object.keys(byRoleData).length > 0;
        if (hasCachedData) {
          applyDepthFromRoleData(byRoleData);
        }

        const rolesToFetch = roleRequests.filter((r) => !r.isFresh);
        if (rolesToFetch.length === 0) {
          setDepthLoading(false);
          return;
        }
        setDepthLoading(!hasCachedData);

        await Promise.all(
          rolesToFetch.map(async ({ role, position, cacheKey }) => {
            let request = dvpBatchInFlight.get(cacheKey);
            if (!request) {
              request = fetch(
                `/api/afl/dvp/batch?season=${selectedSeason}&mode=depth&position=${position}&depthRole=${role.key}&stats=${encodeURIComponent(statsCsv)}${bust}`
              )
                .then(async (res) => {
                  const payload = (await res.json().catch(() => ({}))) as DvpBatchResponse & { error?: string };
                  if (!res.ok || !payload?.success) return null;
                  return payload as DvpBatchResponse;
                })
                .catch(() => null)
                .finally(() => {
                  dvpBatchInFlight.delete(cacheKey);
                });
              dvpBatchInFlight.set(cacheKey, request);
            }
            const data = await request;
            if (abort) return;
            if (data?.success) {
              dvpBatchCache.set(cacheKey, { data, timestamp: Date.now() });
              byRoleData[role.key] = data;
            }
          })
        );
        if (abort) return;

        applyDepthFromRoleData(byRoleData);
      } catch {
        if (!abort) setDepthError('Unable to load depth DvP data.');
      } finally {
        if (!abort) setDepthLoading(false);
      }
    };
    run();
    return () => { abort = true; };
  }, [oppSel, opponentTeam, selectedSeason, viewMode]);

  // Warm all positions in the background so switching position feels instant.
  useEffect(() => {
    let cancelled = false;
    const skipClientCache = process.env.NODE_ENV === 'development';
    const statsCsv = DVP_METRICS.map((m) => m.key).join(',');
    const bust = process.env.NODE_ENV === 'development' ? '&bust=1' : '';

    const warm = async (position: (typeof AFL_POSITIONS)[number]) => {
      const cacheKey = `${DVP_CLIENT_CACHE_VERSION}:${selectedSeason}:${position}`;
      const cached = dvpBatchCache.get(cacheKey);
      const isFresh = !skipClientCache && cached && (Date.now() - cached.timestamp) < DVP_CACHE_TTL;
      if (isFresh || dvpBatchInFlight.has(cacheKey)) return;
      const request = fetch(
        `/api/afl/dvp/batch?season=${selectedSeason}&position=${position}&stats=${encodeURIComponent(statsCsv)}${bust}`
      )
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as DvpBatchResponse & { error?: string };
          if (!res.ok || !data?.success) return null;
          return data as DvpBatchResponse;
        })
        .catch(() => null)
        .finally(() => {
          dvpBatchInFlight.delete(cacheKey);
        });
      dvpBatchInFlight.set(cacheKey, request);
      const data = await request;
      if (cancelled || !data?.success) return;
      dvpBatchCache.set(cacheKey, { data, timestamp: Date.now() });
    };

    AFL_POSITIONS.forEach((p) => {
      void warm(p);
    });
    DEPTH_ROLE_OPTIONS.forEach((role) => {
      const position = DEPTH_ROLE_KEY_TO_API_POS[role.key];
      const cacheKey = `${DVP_CLIENT_CACHE_VERSION}:depth:${selectedSeason}:${position}:${role.key}`;
      const cached = dvpBatchCache.get(cacheKey);
      const isFresh = !skipClientCache && cached && (Date.now() - cached.timestamp) < DVP_CACHE_TTL;
      if (isFresh || dvpBatchInFlight.has(cacheKey)) return;
      const request = fetch(
        `/api/afl/dvp/batch?season=${selectedSeason}&mode=depth&position=${position}&depthRole=${role.key}&stats=${encodeURIComponent(statsCsv)}${bust}`
      )
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as DvpBatchResponse & { error?: string };
          if (!res.ok || !data?.success) return null;
          return data as DvpBatchResponse;
        })
        .catch(() => null)
        .finally(() => {
          dvpBatchInFlight.delete(cacheKey);
        });
      dvpBatchInFlight.set(cacheKey, request);
      void request.then((data) => {
        if (cancelled || !data?.success) return;
        dvpBatchCache.set(cacheKey, { data, timestamp: Date.now() });
      });
    });
    return () => { cancelled = true; };
  }, [selectedSeason]);

  const depthPosLabel = DEPTH_ROLE_OPTIONS.find((r) => r.key === depthPosSel)?.label || 'Select Position';
  const posLabel = viewMode === 'depth' ? depthPosLabel : (posSel || 'Select Position');
  const teamCount = allTeams.length || 18;
  const fmt = (v?: number | null, isPercentage?: boolean) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    return isPercentage ? `${v.toFixed(1)}%` : v.toFixed(1);
  };
  const rankStyles = (rank?: number | null) => {
    if (rank == null || rank === 0) {
      return {
        borderColor: mounted && isDark ? 'border-slate-700' : 'border-slate-300',
        badgeColor: mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600',
      };
    }
    if (rank >= 16) {
      return {
        borderColor: mounted && isDark ? 'border-green-900' : 'border-green-800',
        badgeColor: 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100',
      };
    }
    if (rank >= 13) {
      return {
        borderColor: mounted && isDark ? 'border-green-800' : 'border-green-600',
        badgeColor: 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100',
      };
    }
    if (rank >= 10) {
      return {
        borderColor: mounted && isDark ? 'border-orange-800' : 'border-orange-600',
        badgeColor: 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100',
      };
    }
    if (rank >= 7) {
      return {
        borderColor: mounted && isDark ? 'border-orange-900' : 'border-orange-700',
        badgeColor: 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200',
      };
    }
    if (rank >= 4) {
      return {
        borderColor: mounted && isDark ? 'border-red-800' : 'border-red-600',
        badgeColor: 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100',
      };
    }
    return {
      borderColor: mounted && isDark ? 'border-red-900' : 'border-red-800',
      badgeColor: 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100',
    };
  };
  const depthHasData = DEPTH_ROLE_OPTIONS.some((r) => Object.keys(depthPerStat[r.key]).length > 0);
  const basicHasData = Object.keys(perStat).length > 0;
  const showBasicSkeleton = !!posSel && !error && !basicHasData && (!hasResolvedBasicLoad || loading);

  if (!playerName) {
    return <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Select a player to view DvP.</div>;
  }

  return (
    <div className="mb-4 sm:mb-6 w-full min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2 sm:mb-2">
        <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">Defense vs Position</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('depth')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'depth'
                  ? 'bg-purple-600 text-white'
                  : mounted && isDark
                    ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                    : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              Depth
            </button>
            <button
              type="button"
              onClick={() => setViewMode('basic')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'basic'
                  ? 'bg-purple-600 text-white'
                  : mounted && isDark
                    ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                    : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              Basic
            </button>
          </div>
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
            {SEASON_OPTIONS.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setSelectedSeason(y)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedSeason === y
                    ? 'bg-purple-600 text-white'
                    : mounted && isDark
                      ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                      : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0`}>
        <div className="px-3 sm:px-3 py-3 sm:py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Position</div>
            <button
              onClick={() => setPosOpen((o) => !o)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm font-bold ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'} ${posLabel !== 'Select Position' ? 'bg-purple-600 border-purple-600 text-white' : ''}`}
            >
              <span>{posLabel}</span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            {posOpen && (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-[#0a1929] border-gray-600' : 'bg-white border-gray-300'}`}>
                  {viewMode === 'depth'
                    ? DEPTH_ROLE_OPTIONS.map((role) => (
                      <button
                        key={role.key}
                        onClick={() => { setDepthPosSel(role.key); setPosOpen(false); }}
                        className={`w-full px-3 py-2 text-sm font-bold text-left ${depthPosSel === role.key ? 'bg-purple-600 text-white' : (mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900')}`}
                      >
                        {role.label}
                      </button>
                    ))
                    : AFL_POSITIONS.map((p) => (
                      <button
                        key={p}
                        onClick={() => { setPosSel(p); setPosOpen(false); }}
                        className={`w-full px-3 py-2 text-sm font-bold text-left ${posSel === p ? 'bg-purple-600 text-white' : (mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900')}`}
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
                        onClick={() => { userChangedOpponentRef.current = true; setOppSel(t); setOppOpen(false); }}
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

        {viewMode === 'depth' ? (
          depthError ? (
            <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">Error loading depth DvP stats: {depthError}</div>
          ) : depthLoading && !depthHasData ? (
            <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
              {DVP_METRICS.map((m, index) => (
                <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${mounted && isDark ? 'border-slate-700' : 'border-slate-300'} px-3 py-2.5`}>
                  <div className={`h-4 w-40 rounded animate-pulse ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} style={{ animationDelay: `${index * 0.08}s` }} />
                </div>
              ))}
            </div>
          ) : !depthHasData ? (
            <div className={`px-3 py-3 text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>No depth DvP data available yet.</div>
          ) : (
            <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
              {DVP_METRICS.map((m) => (
                <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${rankStyles(depthPerRank[depthPosSel]?.[m.key]).borderColor} px-3 py-2.5`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>{m.label}{depthPosLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${mounted && isDark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                        {fmt(depthPerStat[depthPosSel]?.[m.key], m.isPercentage)}
                      </span>
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${rankStyles(depthPerRank[depthPosSel]?.[m.key]).badgeColor}`}>
                        {typeof depthPerRank[depthPosSel]?.[m.key] === 'number' && (depthPerRank[depthPosSel]?.[m.key] as number) > 0
                          ? `#${depthPerRank[depthPosSel]?.[m.key]}`
                          : depthPerRank[depthPosSel]?.[m.key] === 0
                            ? 'N/A'
                            : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : showBasicSkeleton ? (
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
        ) : selectedSeason === 2026 && (error || (posSel && hasResolvedBasicLoad && !loading && !basicHasData)) ? (
          <div className={`px-3 py-3 text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            2026 DvP will show once the AFL Process Stats workflow has run (builds DvP and caches it).
          </div>
        ) : error ? (
          <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">Error loading DvP stats: {error}</div>
        ) : !posSel ? (
          <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">Select a position above to view DvP stats.</div>
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

