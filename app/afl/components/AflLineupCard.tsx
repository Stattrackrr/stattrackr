'use client';

import { useState, useEffect, memo } from 'react';

export type AflGameForLineup = {
  round?: string;
  opponent?: string;
  result?: string;
  match_url?: string;
};

export interface AflLineupCardProps {
  isDark: boolean;
  /** All games for the selected player (chronological). We use the selected game for lineup; default is last game. */
  gameLogs: AflGameForLineup[];
  /** Selected player's team (e.g. "Richmond", "Melbourne") to show that team's lineup. */
  team: string | null;
  /** Season year (e.g. 2025) used to resolve match URL from season page when match_url is missing. */
  season?: number;
  /** Name of the selected player (from search) to highlight in the team list. */
  selectedPlayerName?: string | null;
}

type LineupPlayer = {
  number: number | null;
  name: string;
  subbedOn?: boolean;
  subbedOff?: boolean;
  role?: 'starter' | 'interchange';
  /** Short position label (e.g. "MF", "KD") when available from scraped data. */
  position?: string;
};

type LineupResponse = {
  match_url?: string;
  team_label?: string;
  players?: LineupPlayer[];
  home_players?: LineupPlayer[];
  away_players?: LineupPlayer[];
  home_team?: string;
  away_team?: string;
  error?: string;
};

/** "Surname, First" → "First Surname" for display. */
function nameFirstLast(name: string): string {
  const s = (name || '').trim();
  const i = s.indexOf(',');
  if (i > 0) {
    const first = s.slice(i + 1).trim();
    const last = s.slice(0, i).trim();
    return first && last ? `${first} ${last}` : s;
  }
  return s;
}

/** Normalize name for matching (display order, lowercase). */
function normalizeNameForMatch(name: string): string {
  return nameFirstLast((name || '').trim()).toLowerCase().replace(/\s+/g, ' ');
}

/** Strip "AFL Tables - " (or similar) prefix from team label for display. */
function stripAflTablesPrefix(label: string): string {
  return (label || '').replace(/^AFL\s+Tables\s*[-–—]\s*/i, '').trim() || label || '';
}

/** Renders a team's players as a single list (number + name, optional sub on/off badges). */
function TeamLineupList({
  players,
  isDark,
  prefix,
  highlightPlayerName,
}: {
  players: LineupPlayer[];
  isDark: boolean;
  prefix: string;
  highlightPlayerName?: string | null;
}) {
  const highlightNorm = highlightPlayerName ? normalizeNameForMatch(highlightPlayerName) : '';
  const renderPlayer = (p: LineupPlayer, i: number) => {
    const isHighlight = highlightNorm && normalizeNameForMatch(p.name) === highlightNorm;
    return (
    <li
      key={`${prefix}-${i}`}
      className={`flex flex-nowrap items-center gap-2 text-[13px] ${isDark ? 'text-gray-200' : 'text-gray-800'} ${
        isHighlight ? (isDark ? 'bg-purple-900/50 ring-1 ring-purple-500/60 rounded px-1.5 py-0.5' : 'bg-purple-100 ring-1 ring-purple-400/60 rounded px-1.5 py-0.5')
      : ''}`}
    >
      <span
        className={`flex-shrink-0 w-7 min-w-[1.75rem] text-right tabular-nums font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
      >
        {p.number != null ? p.number : ''}
      </span>
      <span className="truncate min-w-0 flex-1">{nameFirstLast(p.name)}</span>
      {p.position && (
        <span
          className={`flex-shrink-0 text-[10px] px-1 py-0.5 rounded font-medium ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
          title="Position"
        >
          {p.position}
        </span>
      )}
      {(p.subbedOn || p.subbedOff) && (
        <span
          className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
            p.subbedOn
              ? isDark
                ? 'bg-emerald-900/60 text-emerald-300'
                : 'bg-emerald-100 text-emerald-800'
              : isDark
                ? 'bg-amber-900/50 text-amber-300'
                : 'bg-amber-100 text-amber-800'
          }`}
          title={p.subbedOn ? 'Subbed on' : 'Subbed off'}
        >
          {p.subbedOn ? 'On' : 'Off'}
        </span>
      )}
    </li>
    );
  };

  return <ul className="space-y-0.5">{players.map(renderPlayer)}</ul>;
}

/** Normalize AFLTables match URL for consistent API calls. */
function normalizeMatchUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname?.toLowerCase().includes('afltables.com')) return u;
    let path = parsed.pathname.replace(/\/+/g, '/');
    const gamesMatch = path.match(/\/games\/(\d{4})\/([^/]+\.html?)$/i);
    if (gamesMatch && !path.includes('/stats/games/')) {
      path = `/afl/stats/games/${gamesMatch[1]}/${gamesMatch[2]}`;
    } else {
      path = path.replace(/\/stats\/\.\.\/games\//, '/stats/games/');
    }
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search || ''}`;
  } catch {
    return u;
  }
}

/**
 * Team selections: lineups from AFLTables scrape (match-lineup) or FootyWire fallback.
 * No positions — team lists only (number + name).
 */
const AflLineupCard = memo(function AflLineupCard({
  isDark,
  gameLogs,
  team,
  season = new Date().getFullYear(),
  selectedPlayerName = null,
}: AflLineupCardProps) {
  const [data, setData] = useState<LineupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const games = gameLogs?.length ? gameLogs : [];
  const lastGame = games.length > 0 ? games[games.length - 1] : undefined;
  const matchUrl = lastGame?.match_url ?? null;
  const fallbackOpponent = (lastGame?.opponent || '').replace(/^vs\.?\s*/i, '').trim();

  const canFetch =
    team?.trim() &&
    (games.length > 0 || !!matchUrl?.trim());

  useEffect(() => {
    if (!canFetch) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchTeamRoster = async (teamName: string): Promise<LineupPlayer[]> => {
      const rr = await fetch(`/api/afl/team-roster?team=${encodeURIComponent(teamName)}&season=${encodeURIComponent(String(season))}`);
      const rj = (await rr.json()) as { players?: LineupPlayer[] };
      return Array.isArray(rj?.players) ? rj.players : [];
    };

    const tryFootyWire = (): void => {
      if (!team?.trim()) return;
      fetch(`/api/afl/footywire-lineup?team=${encodeURIComponent(team.trim())}`)
        .then((r) => r.json())
        .then(async (json: { players?: LineupPlayer[]; error?: string }) => {
          if (cancelled) return;
          if (json?.players?.length) {
            setData({ players: json.players });
            setError(null);
          } else {
            // Final fallback: season rosters for both teams when available.
            try {
              const teamRoster = await fetchTeamRoster(team.trim());
              const oppRoster = fallbackOpponent ? await fetchTeamRoster(fallbackOpponent) : [];
              if (cancelled) return;
              if (teamRoster.length > 0 || oppRoster.length > 0) {
                if (teamRoster.length > 0 && oppRoster.length > 0) {
                  setData({
                    home_team: team.trim(),
                    away_team: fallbackOpponent,
                    home_players: teamRoster,
                    away_players: oppRoster,
                  });
                } else {
                  setData({ players: teamRoster.length > 0 ? teamRoster : oppRoster });
                }
                setError(null);
              } else {
                setError('Lineup not available for this match.');
                setData(null);
              }
            } catch {
              if (!cancelled) {
                setError('Lineup not available for this match.');
                setData(null);
              }
            }
          }
        })
        .catch(async () => {
          if (!cancelled) {
            try {
              const teamRoster = await fetchTeamRoster(team.trim());
              const oppRoster = fallbackOpponent ? await fetchTeamRoster(fallbackOpponent) : [];
              if (cancelled) return;
              if (teamRoster.length > 0 || oppRoster.length > 0) {
                if (teamRoster.length > 0 && oppRoster.length > 0) {
                  setData({
                    home_team: team.trim(),
                    away_team: fallbackOpponent,
                    home_players: teamRoster,
                    away_players: oppRoster,
                  });
                } else {
                  setData({ players: teamRoster.length > 0 ? teamRoster : oppRoster });
                }
                setError(null);
              } else {
                setError('Lineup not available for this match.');
                setData(null);
              }
            } catch {
              if (!cancelled) {
                setError('Lineup not available for this match.');
                setData(null);
              }
            }
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    const recentGames = [...games].slice(-8).reverse();
    const tryMatchLineupFromRecentGames = async (): Promise<boolean> => {
      for (const g of recentGames) {
        if (cancelled) return false;
        const gMatchUrl = g?.match_url?.trim();
        const rawOpponent = g?.opponent ?? '';
        const opponentNorm = rawOpponent.replace(/^vs\.?\s*/i, '').trim() || rawOpponent;
        const params = new URLSearchParams({ team: team!.trim() });
        if (gMatchUrl) {
          params.set('match_url', normalizeMatchUrl(gMatchUrl));
        } else if (season && g?.round) {
          params.set('season', String(season));
          params.set('round', String(g.round));
          if (opponentNorm) params.set('opponent', opponentNorm);
        } else {
          continue;
        }

        try {
          const r = await fetch(`/api/afl/match-lineup?${params}`);
          const json = (await r.json()) as LineupResponse & { debug?: Record<string, unknown> };
          const hasAny =
            (json?.home_players?.length ?? 0) > 0 || (json?.away_players?.length ?? 0) > 0 || (json?.players?.length ?? 0) > 0;
          if (!json?.error && hasAny) {
            if (!cancelled) {
              setData(json);
              setError(null);
            }
            return true;
          }
        } catch {
          // try next game candidate
        }
      }
      return false;
    };

    (async () => {
      const found = await tryMatchLineupFromRecentGames();
      if (!found && !cancelled) tryFootyWire();
    })();

    return () => {
      cancelled = true;
    };
  }, [team, season, games, matchUrl, fallbackOpponent]);

  const team1Label = stripAflTablesPrefix(data?.home_team?.trim() || 'Team 1');
  const team2Label = stripAflTablesPrefix(data?.away_team?.trim() || 'Team 2');
  const sortByNumber = (a: LineupPlayer, b: LineupPlayer) => (a.number ?? 999) - (b.number ?? 999);
  const team1Players = ([...(data?.home_players ?? [])] as LineupPlayer[]).sort(sortByNumber);
  const team2Players = ([...(data?.away_players ?? [])] as LineupPlayer[]).sort(sortByNumber);
  const hasLegacyOnly = (data?.players?.length ?? 0) > 0 && team1Players.length === 0 && team2Players.length === 0;
  const legacyPlayers = ([...(data?.players ?? [])] as LineupPlayer[]).sort(sortByNumber);
  const hasAnyPlayers = team1Players.length > 0 || team2Players.length > 0 || legacyPlayers.length > 0;

  const showCard = team && games.length > 0;
  const hasMatchUrl = !!matchUrl?.trim();
  const emptyText = isDark ? 'text-gray-500' : 'text-gray-400';
  const hasBothTeams = team1Players.length > 0 && team2Players.length > 0;

  if (!showCard) {
    return (
      <div className={`h-full flex flex-col rounded-lg ${isDark ? 'bg-[#0a1929]' : 'bg-gray-50'}`}>
        <h3 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          Most recent team list
        </h3>
        <p className={`text-sm ${emptyText}`}>Select a player to see their most recent team list.</p>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col rounded-lg ${isDark ? 'bg-[#0a1929]' : 'bg-gray-50'}`}>
      <h3 className={`text-sm font-semibold mb-2 text-center ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        Most Recent Team List
      </h3>

      {loading ? (
        <div className={`flex-1 flex items-center justify-center text-sm ${emptyText}`}>
          Loading lineup…
        </div>
      ) : error ? (
        <div className={`text-sm ${emptyText}`}>
          <p>{error}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!hasAnyPlayers ? (
            <p className={`text-sm ${emptyText}`}>
              {hasMatchUrl ? 'No lineup data for this match.' : 'Match link not available for this game.'}
            </p>
          ) : hasLegacyOnly ? (
            <TeamLineupList players={legacyPlayers} isDark={isDark} prefix="legacy-" highlightPlayerName={selectedPlayerName} />
          ) : (
            <div className="grid grid-cols-2 gap-3 xl:gap-4 min-w-0">
              {team1Players.length > 0 && (
                <div className="min-w-0 flex flex-col">
                  <h4 className={`text-sm font-semibold mb-1 flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {team1Label}
                  </h4>
                  <TeamLineupList players={team1Players} isDark={isDark} prefix="1-" highlightPlayerName={selectedPlayerName} />
                </div>
              )}
              {team2Players.length > 0 && (
                <div className="min-w-0 flex flex-col">
                  <h4 className={`text-sm font-semibold mb-1 flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {team2Label}
                  </h4>
                  <TeamLineupList players={team2Players} isDark={isDark} prefix="2-" highlightPlayerName={selectedPlayerName} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default AflLineupCard;
