'use client';

import { useState, useEffect } from 'react';
import { getAflTeamColor, getAflTeamBadgeTextColor } from '@/lib/aflTeamColors';
import { getAflCanonicalTeamKey } from '@/lib/aflTeamCanonical';

const TEAM_SELECTIONS_URL = 'https://www.footywire.com/afl/footy/afl_team_selections';

/** Portrait field: order from top (FB) down to bottom (Fol). Fol is in side panel only. */
const FIELD_ORDER = ['FB', 'FF', 'HB', 'HF', 'C', 'Fol'];

/** 5 rows on the oval: one position per row, 3 players per team (same position both sides). Order top to bottom. */
const OVAL_POSITION_ORDER = ['FB', 'HB', 'C', 'HF', 'FF'] as const;

type PlayerEntry = { name: string; number?: string };

type TeamSelectionsData = {
  url: string;
  title: string | null;
  round_label: string | null;
  match: string | null;
  home_team: string | null;
  away_team: string | null;
  positions: Array<{ position: string; home_players: (string | PlayerEntry)[]; away_players: (string | PlayerEntry)[] }>;
  interchange: { home: string[]; away: string[] };
  ins?: { home: string[]; away: string[] };
  outs?: { home: string[]; away: string[] };
  emergencies: { home: string[]; away: string[] };
  average_attributes: {
    home: { height?: string; age?: string; games?: string };
    away: { height?: string; age?: string; games?: string };
  } | null;
  total_players_by_games: Array<{ category: string; home: string; away: string }> | null;
  error?: string;
};

type MatchEntry = TeamSelectionsData & { match: string; home_team: string; away_team: string };

/** Strict match: only when canonical keys are equal. Uses shared alt-name map so we never wrong-match (e.g. Adelaide vs Port Adelaide). */
function matchIncludesTeam(m: { home_team?: string | null; away_team?: string | null }, team: string): boolean {
  if (!team || !m.home_team || !m.away_team) return false;
  const tKey = getAflCanonicalTeamKey(team);
  const hKey = getAflCanonicalTeamKey(m.home_team);
  const aKey = getAflCanonicalTeamKey(m.away_team);
  if (!tKey || !hKey || !aKey) return false;
  if (tKey === 'GWS' && (hKey === 'Sydney' || aKey === 'Sydney')) return false;
  if (tKey === 'Sydney' && (hKey === 'GWS' || aKey === 'GWS')) return false;
  return tKey === hKey || tKey === aKey;
}

/** Normalise API player (string or { name, number? }) to PlayerEntry. */
function toPlayerEntry(p: string | PlayerEntry): PlayerEntry {
  return typeof p === 'string' ? { name: p } : { name: p.name, number: p.number };
}

/** Opposite end of ground: defending team's FB = attacking team's FF, etc. Used for 2nd line label. */
function oppositePositionLabel(pos: string): string {
  if (pos === 'FB') return 'FF';
  if (pos === 'FF') return 'FB';
  if (pos === 'HB') return 'HF';
  if (pos === 'HF') return 'HB';
  return pos; // C stays C
}

/** Normalize name for comparison: lowercase, collapse spaces, remove punctuation. */
function normalizeNameForMatch(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** True if lineup player name matches the searched/selected player (handles "P. Dangerfield" vs "Patrick Dangerfield"). */
function lineupNameMatchesSelected(lineupName: string, selectedName: string | null | undefined): boolean {
  if (!selectedName?.trim() || !lineupName?.trim()) return false;
  const a = normalizeNameForMatch(lineupName);
  const b = normalizeNameForMatch(selectedName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aWords = a.split(/\s+/).filter(Boolean);
  const bWords = b.split(/\s+/).filter(Boolean);
  if (aWords.length === 0 || bWords.length === 0) return false;
  const aLast = aWords[aWords.length - 1];
  const bLast = bWords[bWords.length - 1];
  if (aLast !== bLast) return false;
  const aFirst = aWords[0];
  const bFirst = bWords[0];
  return aFirst === bFirst || (aFirst.length === 1 && bFirst.startsWith(aFirst)) || (bFirst.length === 1 && aFirst.startsWith(bFirst));
}

function matchIncludesExpectedOpponent(
  m: { home_team?: string | null; away_team?: string | null },
  team: string | null | undefined,
  opponent: string | null | undefined
): boolean {
  if (!team?.trim() || !opponent?.trim() || !m.home_team || !m.away_team) return false;
  const teamKey = getAflCanonicalTeamKey(team);
  const opponentKey = getAflCanonicalTeamKey(opponent);
  const homeKey = getAflCanonicalTeamKey(m.home_team);
  const awayKey = getAflCanonicalTeamKey(m.away_team);
  if (!teamKey || !opponentKey || !homeKey || !awayKey) return false;
  return (
    (teamKey === homeKey && opponentKey === awayKey) ||
    (teamKey === awayKey && opponentKey === homeKey)
  );
}

/** Single player chip: jumper number (or initial) in badge + name. uniformWidth = same width as largest for symmetry on oval. */
function PlayerChip({
  name,
  number,
  isHome,
  teamColor,
  isDark,
  uniformWidth,
  highlight,
}: {
  name: string;
  number?: string | null;
  isHome: boolean;
  /** Team brand color (hex); when set, used for badge instead of default red/grey. */
  teamColor?: string | null;
  isDark: boolean;
  uniformWidth?: boolean;
  /** When true, show purple highlight for the searched player. */
  highlight?: boolean;
}) {
  const initial = name.trim() ? name.trim().split(/\s+/).pop()?.[0] ?? '?' : '–';
  const badgeLabel = number != null && number !== '' ? number : initial;
  const defaultBg = isHome ? 'bg-red-500 text-white' : 'bg-slate-500 text-white';
  const boxCls = isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200';
  const highlightCls = highlight ? 'ring-2 ring-purple-500 bg-purple-500/20 dark:bg-purple-500/30' : '';
  const badgeStyle = teamColor ? { backgroundColor: teamColor, color: getAflTeamBadgeTextColor(teamColor) } : undefined;
  const badgeCls = !teamColor ? defaultBg : '';
  return (
    <div className={`flex items-center rounded-md border py-1 min-w-0 ${uniformWidth ? 'w-[4.25rem] min-w-[4.25rem] max-w-[4.25rem] sm:w-[5.25rem] sm:min-w-[5.25rem] sm:max-w-[5.25rem] min-[1520px]:w-[6.25rem] min-[1520px]:min-w-[6.25rem] min-[1520px]:max-w-[6.25rem] min-[1600px]:w-[7.25rem] min-[1600px]:min-w-[7.25rem] min-[1600px]:max-w-[7.25rem] gap-0.5 sm:gap-1 min-[1520px]:gap-1 min-[1600px]:gap-1 px-1 sm:px-1.5 min-[1520px]:px-1.5' : 'gap-2 px-2'} ${boxCls} ${highlightCls}`}>
      <span className={`flex-shrink-0 rounded font-bold flex items-center justify-center ${!teamColor ? defaultBg : badgeCls} ${uniformWidth ? 'w-4 h-4 text-[9px] sm:w-[18px] sm:h-[18px] sm:text-[9px] min-[1520px]:w-5 min-[1520px]:h-5 min-[1520px]:text-[10px] min-[1600px]:w-5 min-[1600px]:h-5 min-[1600px]:text-[10px]' : 'w-6 h-6 text-xs'}`} style={badgeStyle}>
        {badgeLabel}
      </span>
      <span className={`truncate font-medium ${uniformWidth ? 'text-[10px] sm:text-[11px] min-[1520px]:text-xs min-[1600px]:text-xs' : 'text-sm'} ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        {name}
      </span>
    </div>
  );
}

export function AflTeamSelectionsCard({
  isDark,
  playerTeam,
  selectedPlayerName,
  expectedOpponentTeam,
  resolveTeamLogo,
}: {
  isDark: boolean;
  /** Selected player's team (e.g. "Geelong Cats", "Gold Coast") – used to show that team's match lineup. */
  playerTeam?: string | null;
  /** Name of the searched/selected player – highlighted in purple in the lineup. */
  selectedPlayerName?: string | null;
  /**
   * When set, indicates the opponent for the NEXT game (from fixture/odds).
   * If the FootyWire matchup's opponent differs, we label the card "Most Recent Lineup" instead of "Lineups".
   */
  expectedOpponentTeam?: string | null;
  /**
   * Resolve a team name to logo URL (from dashboard state). When provided, title shows home-logo vs away-logo.
   */
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [data, setData] = useState<TeamSelectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);

  const fetchLineup = (refresh = false) => {
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', '1');
    if (playerTeam?.trim()) params.set('team', playerTeam.trim());
    if (expectedOpponentTeam?.trim()) params.set('opponent', expectedOpponentTeam.trim());
    const q = params.toString() ? `?${params.toString()}` : '';
    return fetch(`/api/afl/footywire-team-selections${q}`).then((r) => r.json());
  };

  useEffect(() => {
    let cancelled = false;
    setRetried(false);
    setLoading(true);
    setError(null);

    fetchLineup()
      .then((json) => {
        if (cancelled) return;
        if (json?.error && !json?.url) {
          setError(json.error);
          setData(null);
          return;
        }
        const initialMatchMismatch =
          playerTeam?.trim() &&
          expectedOpponentTeam?.trim() &&
          json?.home_team &&
          json?.away_team &&
          !matchIncludesExpectedOpponent(
            { home_team: json.home_team, away_team: json.away_team },
            playerTeam,
            expectedOpponentTeam
          );
        if (initialMatchMismatch && !retried) {
          setRetried(true);
          fetchLineup(true)
            .then((retryJson) => {
              if (cancelled) return;
              const retryPositions = Array.isArray(retryJson?.positions) ? retryJson.positions : [];
              const retryInterchange = retryJson?.interchange ?? { home: [], away: [] };
              setData({
                url: retryJson?.url ?? TEAM_SELECTIONS_URL,
                title: retryJson?.title ?? null,
                round_label: retryJson?.round_label ?? null,
                match: retryJson?.match ?? null,
                home_team: retryJson?.home_team ?? null,
                away_team: retryJson?.away_team ?? null,
                positions: retryPositions,
                interchange: retryInterchange,
                ins: retryJson?.ins ?? { home: [], away: [] },
                outs: retryJson?.outs ?? { home: [], away: [] },
                emergencies: retryJson?.emergencies ?? { home: [], away: [] },
                average_attributes: retryJson?.average_attributes ?? null,
                total_players_by_games: retryJson?.total_players_by_games ?? null,
              });
              setError(retryJson?.error ?? null);
            })
            .catch((e) => {
              if (!cancelled) setError(e?.message ?? 'Failed to load');
            })
            .finally(() => {
              if (!cancelled) setLoading(false);
            });
          return;
        }
        const positions = Array.isArray(json?.positions) ? json.positions : [];
        const inter = json?.interchange ?? { home: [], away: [] };
        let hasLineup = positions.length > 0 || (inter.home?.length ?? 0) > 0 || (inter.away?.length ?? 0) > 0;

        if (!hasLineup && Array.isArray(json?.matches) && json.matches.length > 0) {
          const matches = json.matches as MatchEntry[];
          // Only use a match that strictly includes the requested team; never fall back to another game (e.g. GWS must not show Sydney v Carlton).
          const forTeam = playerTeam?.trim()
            ? matches.find((m) => matchIncludesExpectedOpponent(m, playerTeam, expectedOpponentTeam))
              ?? matches.find((m) => matchIncludesTeam(m, playerTeam))
            : null;
          const chosen = forTeam ?? null;
          const chosenHasBothTeams = (): boolean => {
            if (!chosen?.positions?.length && !chosen?.interchange?.home?.length && !chosen?.interchange?.away?.length) return false;
            let homeCount = (chosen.interchange?.home ?? []).length + (chosen.emergencies?.home ?? []).length;
            let awayCount = (chosen.interchange?.away ?? []).length + (chosen.emergencies?.away ?? []).length;
            for (const row of chosen.positions ?? []) {
              homeCount += (row.home_players ?? []).length;
              awayCount += (row.away_players ?? []).length;
            }
            return homeCount > 0 && awayCount > 0;
          };
          if (chosen && chosen.home_team && chosen.away_team && chosenHasBothTeams()) {
            hasLineup = true;
            setData({
              url: json?.url ?? TEAM_SELECTIONS_URL,
              title: json?.title ?? chosen?.title ?? null,
              round_label: json?.round_label ?? chosen?.round_label ?? null,
              match: chosen?.match ?? null,
              home_team: chosen?.home_team ?? null,
              away_team: chosen?.away_team ?? null,
              positions: chosen?.positions ?? [],
              interchange: chosen?.interchange ?? { home: [], away: [] },
              ins: chosen?.ins ?? { home: [], away: [] },
              outs: chosen?.outs ?? { home: [], away: [] },
              emergencies: chosen?.emergencies ?? { home: [], away: [] },
              average_attributes: chosen?.average_attributes ?? null,
              total_players_by_games: chosen?.total_players_by_games ?? null,
            });
            setError(null);
            return;
          }
        }

        if (!hasLineup && json?.match && json?.home_team && json?.away_team && !retried) {
          setRetried(true);
          fetchLineup(true).then((retryJson) => {
            if (cancelled) return;
            const retryPos = Array.isArray(retryJson?.positions) ? retryJson.positions : [];
            const retryInter = retryJson?.interchange ?? { home: [], away: [] };
            let retryHome = (retryInter.home ?? []).length + ((retryJson?.emergencies as { home?: string[] })?.home ?? []).length;
            let retryAway = (retryInter.away ?? []).length + ((retryJson?.emergencies as { away?: string[] })?.away ?? []).length;
            for (const row of retryPos) {
              retryHome += (row.home_players ?? []).length;
              retryAway += (row.away_players ?? []).length;
            }
            const retryHasBoth = retryHome > 0 && retryAway > 0;
            if (retryHasBoth && retryJson?.home_team && retryJson?.away_team) {
              setData({
                url: retryJson?.url ?? TEAM_SELECTIONS_URL,
                title: retryJson?.title ?? null,
                round_label: retryJson?.round_label ?? null,
                match: retryJson?.match ?? null,
                home_team: retryJson?.home_team ?? null,
                away_team: retryJson?.away_team ?? null,
                positions: retryPos,
                interchange: retryInter,
                ins: retryJson?.ins ?? { home: [], away: [] },
                outs: retryJson?.outs ?? { home: [], away: [] },
                emergencies: retryJson?.emergencies ?? { home: [], away: [] },
                average_attributes: retryJson?.average_attributes ?? null,
                total_players_by_games: retryJson?.total_players_by_games ?? null,
              });
              setError(null);
            }
          }).finally(() => { if (!cancelled) setLoading(false); });
          return;
        }
        setData({
          url: json?.url ?? TEAM_SELECTIONS_URL,
          title: json?.title ?? null,
          round_label: json?.round_label ?? null,
          match: json?.match ?? null,
          home_team: json?.home_team ?? null,
          away_team: json?.away_team ?? null,
          positions,
          interchange: inter,
          ins: json?.ins ?? { home: [], away: [] },
          outs: json?.outs ?? { home: [], away: [] },
          emergencies: json?.emergencies ?? { home: [], away: [] },
          average_attributes: json?.average_attributes ?? null,
          total_players_by_games: json?.total_players_by_games ?? null,
        });
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? 'Failed to load');
          setData({ url: TEAM_SELECTIONS_URL, title: null, round_label: null, match: null, home_team: null, away_team: null, positions: [], interchange: { home: [], away: [] }, ins: { home: [], away: [] }, outs: { home: [], away: [] }, emergencies: { home: [], away: [] }, average_attributes: null, total_players_by_games: null });
        }
      })
      .finally(() => {
        if (!cancelled && !retried) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  // Refetch when playerTeam changes so we show the correct match lineup
  // eslint-disable-next-line react-hooks/exhaustive-deps -- retried is internal, avoid extra runs
  }, [expectedOpponentTeam, playerTeam]);

  const borderCls = isDark ? 'border-gray-600' : 'border-gray-200';
  const bgCls = isDark ? 'bg-[#0a1929]' : 'bg-gray-50';
  const mutedCls = isDark ? 'text-gray-400' : 'text-gray-500';

  if (loading) {
    return (
      <div className={`rounded-lg border p-3 ${borderCls} ${bgCls}`}>
        <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>AFL Team Selections</h3>
        <p className={`text-sm ${mutedCls}`}>Loading lineup…</p>
      </div>
    );
  }

  const allPositionRows = data?.positions ?? [];
  const getByPos = (pos: string) => allPositionRows.find((r) => r.position === pos || (pos === 'Fol' && (r.position === 'FOL' || r.position === 'Fol')));
  const orderedFieldRows = FIELD_ORDER.map((pos) => getByPos(pos)).filter(Boolean) as Array<{ position: string; home_players: string[]; away_players: string[] }>;
  const folRow = getByPos('Fol');

  const followersHome = (folRow?.home_players ?? []).map(toPlayerEntry);
  const followersAway = (folRow?.away_players ?? []).map(toPlayerEntry);
  const ovalRows: { position: string; players: PlayerEntry[]; isHome: boolean }[] = [];
  OVAL_POSITION_ORDER.forEach((pos) => {
    const row = getByPos(pos);
    const homeThree = (row?.home_players ?? []).slice(0, 3).map(toPlayerEntry);
    const awayThree = (row?.away_players ?? []).slice(0, 3).map(toPlayerEntry);
    if (homeThree.length > 0) ovalRows.push({ position: pos, players: homeThree, isHome: true });
    if (awayThree.length > 0) ovalRows.push({ position: pos, players: awayThree, isHome: false });
  });
  const hasFieldRows = ovalRows.length > 0;
  const interHome = data?.interchange?.home ?? [];
  const interAway = data?.interchange?.away ?? [];
  const followersInterleaved: { p: PlayerEntry; isHome: boolean }[] = [];
  for (let i = 0; i < Math.max(followersHome.length, followersAway.length); i++) {
    if (followersHome[i]) followersInterleaved.push({ p: followersHome[i], isHome: true });
    if (followersAway[i]) followersInterleaved.push({ p: followersAway[i], isHome: false });
  }
  const interchangeInterleaved: { name: string; isHome: boolean }[] = [];
  for (let i = 0; i < Math.max(interHome.length, interAway.length); i++) {
    if (interHome[i]) interchangeInterleaved.push({ name: interHome[i], isHome: true });
    if (interAway[i]) interchangeInterleaved.push({ name: interAway[i], isHome: false });
  }
  const emergHome = data?.emergencies?.home ?? [];
  const emergAway = data?.emergencies?.away ?? [];
  const insHome = data?.ins?.home ?? [];
  const insAway = data?.ins?.away ?? [];
  const outsHome = data?.outs?.home ?? [];
  const outsAway = data?.outs?.away ?? [];
  const homeTeam = data?.home_team ?? 'Home';
  const awayTeam = data?.away_team ?? 'Away';
  const homeColor = getAflTeamColor(homeTeam);
  const awayColor = getAflTeamColor(awayTeam);
  const hasContent = hasFieldRows || followersHome.length > 0 || followersAway.length > 0 || interHome.length > 0 || interAway.length > 0 || emergHome.length > 0 || emergAway.length > 0 || insHome.length > 0 || insAway.length > 0 || outsHome.length > 0 || outsAway.length > 0;
  const hasHomePlayers = followersHome.length > 0 || interHome.length > 0 || emergHome.length > 0 || insHome.length > 0 || outsHome.length > 0 || ovalRows.some((r) => r.isHome);
  const hasAwayPlayers = followersAway.length > 0 || interAway.length > 0 || emergAway.length > 0 || insAway.length > 0 || outsAway.length > 0 || ovalRows.some((r) => !r.isHome);
  const hasBothTeams = hasHomePlayers && hasAwayPlayers;
  const hasSuccessfulMatch = Boolean(data?.home_team && data?.away_team);
  const showLineup = Boolean(playerTeam) && hasSuccessfulMatch && hasContent && hasBothTeams;

  // Decide whether this lineup is for the upcoming game (team vs expectedOpponentTeam) or just the most recent game.
  let isUpcomingLineup: boolean | null = null;
  if (showLineup) {
    const playerKey = playerTeam ? getAflCanonicalTeamKey(playerTeam) : null;
    const expectedOppKey = expectedOpponentTeam ? getAflCanonicalTeamKey(expectedOpponentTeam) : null;
    const homeKey = getAflCanonicalTeamKey(homeTeam);
    const awayKey = getAflCanonicalTeamKey(awayTeam);
    if (playerKey && (homeKey || awayKey)) {
      const opponentKey = playerKey === homeKey ? awayKey : playerKey === awayKey ? homeKey : null;
      if (expectedOppKey && opponentKey) {
        isUpcomingLineup = opponentKey === expectedOppKey;
      }
    }
  }

  const baseTitle =
    showLineup && isUpcomingLineup === false ? 'Most Recent Lineup' : 'Confirmed Lineups';

  return (
    <div className={`rounded-lg border p-3 ${borderCls} ${bgCls}`}>
      {/* Title + match */}
      <h3 className={`text-sm font-semibold mb-2 flex items-center gap-3 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        <span>{baseTitle}</span>
        {showLineup && hasSuccessfulMatch && resolveTeamLogo && (
          <span className="flex items-center gap-1.5">
            {resolveTeamLogo(homeTeam) && (
              <img
                src={resolveTeamLogo(homeTeam) ?? ''}
                alt={homeTeam}
                className="w-5 h-5 sm:w-6 sm:h-6 object-contain rounded-full bg-gray-900/10"
              />
            )}
            <span className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>vs</span>
            {resolveTeamLogo(awayTeam) && (
              <img
                src={resolveTeamLogo(awayTeam) ?? ''}
                alt={awayTeam}
                className="w-5 h-5 sm:w-6 sm:h-6 object-contain rounded-full bg-gray-900/10"
              />
            )}
          </span>
        )}
      </h3>

      {error && !data?.match && <p className={`text-sm ${mutedCls}`}>{error}</p>}

      {!showLineup && !error && (
        <p className={`text-sm ${mutedCls}`}>
          No lineups available. Come back later.
        </p>
      )}

      {showLineup && (
        <>
          {/* Legend: team names with team-colored dots */}
          <div className="flex items-center justify-center gap-4 mb-3">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: homeColor }} aria-hidden />
              {homeTeam}
            </span>
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: awayColor }} aria-hidden />
              {awayTeam}
            </span>
          </div>

          {/* Portrait layout: stack when viewport < 1520px; from 1520px up = Followers | Field | Interchange */}
          <div className="flex flex-col min-[1520px]:flex-row gap-3 items-stretch">
            {/* Center: AFL pitch – first when stacked (order-1), middle when side-by-side (order-2) */}
            <div className="flex-1 min-w-0 flex flex-col items-center order-1 min-[1520px]:order-2 min-h-[320px] sm:min-h-[380px] min-[1520px]:min-h-[400px]">
              <div className="relative rounded-[50%] aspect-[1/1.25] w-full min-w-[220px] max-w-[340px] sm:min-w-[280px] sm:max-w-[440px] md:min-w-[340px] md:max-w-[520px] flex-shrink-0 min-h-[220px] sm:min-h-[280px]">
                {/* Field layer: green oval + markings (clipped to oval) */}
                <div className="absolute inset-0 rounded-[50%] bg-green-700 border-2 border-green-800 overflow-hidden" aria-hidden>
                  {/* Inner outline a few pixels in from the edge (thick so 50m lines meet it) */}
                  <div className="absolute inset-[4px] rounded-[50%] border-[3px] border-white/50 pointer-events-none" aria-hidden />
                  {/* 50m lines as curved arcs, ending at the inner outline */}
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden>
                    <path d="M 12 25 Q 50 52 88 25" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" strokeLinecap="round" />
                    <path d="M 12 100 Q 50 73 88 100" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" strokeLinecap="round" />
                  </svg>
                  {/* Center square */}
                  <div className="absolute top-1/2 left-1/2 w-[14%] min-w-[36px] aspect-square -translate-x-1/2 -translate-y-1/2 border-2 border-white/60 rounded-sm bg-transparent" title="Centre square" />
                </div>
                {/* Content layer: player rows on top; on mobile no left padding so position labels sit further left */}
                <div className="relative z-10 flex flex-col gap-0 py-3 pl-0 pr-2 sm:py-6 sm:px-5 md:py-8 md:px-6 h-full justify-center items-center overflow-visible pointer-events-auto">
                  {hasFieldRows ? (
                    ovalRows.map((row, ri) => {
                      const isEndOfPositionPair = (ri + 1) % 2 === 0 && ri < ovalRows.length - 1;
                      const isSecondLineInPair = ri % 2 === 1;
                      const positionLabel = isSecondLineInPair ? oppositePositionLabel(row.position) : row.position;
                      return (
                      <div key={ri} className={`flex items-center justify-start sm:justify-center gap-1 sm:gap-1.5 min-[1520px]:gap-2 flex-shrink-0 w-full -ml-3 sm:ml-0 ${isEndOfPositionPair ? 'mb-3 sm:mb-4 min-[1520px]:mb-5 min-[1600px]:mb-6 py-1 sm:py-1.5 min-[1520px]:py-2' : 'py-0 sm:py-0.5'}`}>
                        <span className="flex-shrink-0 text-sm sm:text-xs min-[1520px]:text-sm font-bold w-8 sm:w-7 min-[1520px]:w-8 text-purple-300">{positionLabel}</span>
                        <div className="grid grid-cols-3 gap-x-0.5 sm:gap-x-1 min-[1520px]:gap-x-1 min-[1600px]:gap-x-1 gap-y-0 min-w-0 flex-1 justify-items-center w-[min(100%,13.5rem)] sm:w-[min(100%,16.5rem)] min-[1520px]:w-[min(100%,19.5rem)] min-[1600px]:w-[min(100%,22.5rem)]" role="group" aria-label={`${row.position} ${row.isHome ? homeTeam : awayTeam}`}>
                          {row.players.slice(0, 3).map((p, i) => (
                            <PlayerChip key={i} name={p.name} number={p.number} isHome={row.isHome} teamColor={row.isHome ? homeColor : awayColor} isDark={false} uniformWidth highlight={lineupNameMatchesSelected(p.name, selectedPlayerName)} />
                          ))}
                        </div>
                      </div>
                    ); })
                  ) : (
                    <p className={`text-[10px] text-center ${isDark ? 'text-green-200' : 'text-green-900'}`}>No positions parsed</p>
                  )}
                </div>
              </div>
            </div>

            {/* Below field when stacked (order-2); from 1520px up wrapper has contents so panels sit left/right of field */}
            <div className="flex flex-row gap-3 order-2 min-[1520px]:contents flex-wrap min-[1520px]:flex-nowrap">
              {/* Left when side-by-side: Followers, then Ins & Outs (home, away, home, away …) */}
              <div className={`rounded-lg border ${borderCls} p-2 flex flex-col flex-1 min-w-0 sm:min-w-[6rem] min-[1520px]:flex-none min-[1520px]:w-32 min-[1520px]:min-w-[8rem] min-[1600px]:w-36 min-[1600px]:min-w-[9rem] flex-shrink-0 min-[1520px]:order-1`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${mutedCls}`}>Followers</p>
                <div className="flex flex-col gap-1 overflow-y-auto">
                  {followersInterleaved.map(({ p, isHome }, i) => (
                    <PlayerChip key={`f-${i}`} name={p.name} number={p.number} isHome={isHome} teamColor={isHome ? homeColor : awayColor} isDark={isDark} highlight={lineupNameMatchesSelected(p.name, selectedPlayerName)} />
                  ))}
                  {followersInterleaved.length === 0 && (
                    <span className={`text-[10px] ${mutedCls}`}>—</span>
                  )}
                </div>
                {/* Ins & Outs – under Followers */}
                {(insHome.length > 0 || insAway.length > 0 || outsHome.length > 0 || outsAway.length > 0) && (
                  <div className="mt-2 pt-2 border-t border-gray-500/40">
                    <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${mutedCls}`}>Ins & Outs</p>
                    <div className="flex flex-col gap-1.5">
                      {(insHome.length > 0 || insAway.length > 0) && (
                        <div className="flex flex-col gap-1">
                          <span className={`text-[10px] font-medium ${mutedCls}`}>Ins</span>
                          <div className="flex flex-wrap gap-1">
                            {insHome.map((name, i) => (
                              <PlayerChip key={`inh-${i}`} name={name} isHome teamColor={homeColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                            ))}
                            {insAway.map((name, i) => (
                              <PlayerChip key={`ina-${i}`} name={name} isHome={false} teamColor={awayColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                            ))}
                          </div>
                        </div>
                      )}
                      {(outsHome.length > 0 || outsAway.length > 0) && (
                        <div className="flex flex-col gap-1">
                          <span className={`text-[10px] font-medium ${mutedCls}`}>Outs</span>
                          <div className="flex flex-wrap gap-1">
                            {outsHome.map((name, i) => (
                              <PlayerChip key={`outh-${i}`} name={name} isHome teamColor={homeColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                            ))}
                            {outsAway.map((name, i) => (
                              <PlayerChip key={`outa-${i}`} name={name} isHome={false} teamColor={awayColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Right when side-by-side: Interchanges (home, away, home, away …) */}
              <div className={`rounded-lg border ${borderCls} p-2 flex flex-col flex-1 min-w-0 sm:min-w-[6rem] min-[1520px]:flex-none min-[1520px]:w-32 min-[1520px]:min-w-[8rem] min-[1600px]:w-36 min-[1600px]:min-w-[9rem] flex-shrink-0 min-[1520px]:order-3`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${mutedCls}`}>Interchanges</p>
                <div className="flex flex-col gap-1 overflow-y-auto">
                  {interchangeInterleaved.map(({ name, isHome }, i) => (
                    <PlayerChip key={`i-${i}`} name={name} isHome={isHome} teamColor={isHome ? homeColor : awayColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                  ))}
                  {interchangeInterleaved.length === 0 && (
                    <span className={`text-[10px] ${mutedCls}`}>—</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Emergencies – below the main grid */}
          {(emergHome.length > 0 || emergAway.length > 0) && (
            <div className={`mt-3 pt-3 border-t ${borderCls}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wide mb-2 ${mutedCls}`}>Emergencies</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-[10px] font-medium ${mutedCls}`}>{homeTeam}:</span>
                  {emergHome.map((name, i) => (
                    <PlayerChip key={`eh-${i}`} name={name} isHome teamColor={homeColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-[10px] font-medium ${mutedCls}`}>{awayTeam}:</span>
                  {emergAway.map((name, i) => (
                    <PlayerChip key={`ea-${i}`} name={name} isHome={false} teamColor={awayColor} isDark={isDark} highlight={lineupNameMatchesSelected(name, selectedPlayerName)} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
