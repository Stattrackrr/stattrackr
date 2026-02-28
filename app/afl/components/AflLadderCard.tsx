'use client';

import { useState, useEffect } from 'react';

type LadderRow = {
  pos: number;
  team: string;
  played: number;
  win: number;
  loss: number;
  draw: number;
  points_for: number | null;
  points_against: number | null;
  percentage: number | null;
  premiership_points: number | null;
};

type LadderData = {
  season: number;
  teams: LadderRow[];
};

/** All 18 AFL teams (for 2026 placeholder when no stats yet). */
const ALL_AF_TEAMS = [
  'Adelaide Crows', 'Brisbane Lions', 'Carlton Blues', 'Collingwood Magpies', 'Essendon Bombers',
  'Fremantle Dockers', 'Geelong Cats', 'Gold Coast Suns', 'GWS Giants', 'Hawthorn Hawks',
  'Melbourne Demons', 'North Melbourne Kangaroos', 'Port Adelaide Power', 'Richmond Tigers',
  'St Kilda Saints', 'Sydney Swans', 'West Coast Eagles', 'Western Bulldogs',
];

/** Full team name (as in ladder data) -> 3-letter abbreviation */
const TEAM_TO_ABBREV: Record<string, string> = {
  'Adelaide Crows': 'ADE',
  'Brisbane Lions': 'BRI',
  'Carlton Blues': 'CAR',
  'Collingwood Magpies': 'COL',
  'Essendon Bombers': 'ESS',
  'Fremantle Dockers': 'FRE',
  'Geelong Cats': 'GEE',
  'Gold Coast Suns': 'GCS',
  'GWS Giants': 'GWS',
  'Hawthorn Hawks': 'HAW',
  'Melbourne Demons': 'MEL',
  'North Melbourne Kangaroos': 'NTH',
  'Port Adelaide Power': 'PTA',
  'Richmond Tigers': 'RIC',
  'St Kilda Saints': 'STK',
  'Sydney Swans': 'SYD',
  'West Coast Eagles': 'WCE',
  'Western Bulldogs': 'WBD',
};

const LADDER_SEASON_OPTIONS = [2026, 2025] as const;

function normalizeTeamKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveTeamLogo(teamName: string, logoByTeam: Record<string, string>): string | null {
  const key = normalizeTeamKey(teamName);
  if (!key) return null;
  if (logoByTeam[key]) return logoByTeam[key];
  for (const [logoKey, url] of Object.entries(logoByTeam)) {
    if (key.includes(logoKey) || logoKey.includes(key)) return url;
  }
  return null;
}

function getTeamAbbrev(teamName: string): string {
  return TEAM_TO_ABBREV[teamName] ?? (teamName.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase() || teamName.slice(0, 3).toUpperCase());
}

export function AflLadderCard({
  isDark,
  season: _seasonProp,
  logoByTeam = {},
}: {
  isDark: boolean;
  season: number;
  logoByTeam?: Record<string, string>;
}) {
  const [selectedSeason, setSelectedSeason] = useState<2025 | 2026>(2026);
  const [data, setData] = useState<LadderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/afl/ladder?season=${selectedSeason}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setData(null);
          return;
        }
        const teams = json.teams ?? [];
        setData({ season: json.season ?? selectedSeason, teams });
        setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load ladder');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedSeason]);

  const fmt = (v: number | null | undefined): string => {
    if (v == null) return '—';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };

  // For 2026: show all 18 teams with empty stats when there's no real 2026 data (API may return 2025 fallback—don't use it)
  const isEmpty2026 = selectedSeason === 2026 && (error || !data?.teams?.length || data.season !== 2026);
  const teams: LadderRow[] = isEmpty2026
    ? ALL_AF_TEAMS.map((team, i) => ({
        pos: i + 1,
        team,
        played: 0,
        win: 0,
        loss: 0,
        draw: 0,
        points_for: null,
        points_against: null,
        percentage: null,
        premiership_points: null,
      }))
    : (data?.teams ?? []);

  // Only show full-screen loading when we have no rows (initial load); keep showing table when switching seasons to avoid flash
  if (loading && teams.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-gray-500 dark:text-gray-400">
        Loading ladder…
      </div>
    );
  }

  if (!isEmpty2026 && (error || !data)) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-amber-600 dark:text-amber-400">
        {error ?? 'No data'}
      </div>
    );
  }

  if (!teams.length) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-gray-500 dark:text-gray-400">
        No ladder data. Run: npm run fetch:footywire-ladder
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AFL Ladder</h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
            {LADDER_SEASON_OPTIONS.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setSelectedSeason(y)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedSeason === y
                    ? 'bg-purple-600 text-white'
                    : isDark
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
      <div
        className={`rounded-lg border overflow-x-hidden overflow-y-auto max-h-[520px] min-h-[320px] custom-scrollbar ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        }`}
      >
        <table className="w-full text-xs min-w-[420px] table-fixed">
          <thead className="sticky top-0 z-10">
            <tr className={`min-h-[40px] ${isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-7">#</th>
              <th className="px-2 py-2.5 text-left align-middle font-semibold">Team</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Played">P</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Wins">W</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Losses">L</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Draws">D</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-10" title="Points For">PF</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-10" title="Points Against">PA</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-10" title="Premiership Points">Pts</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-12" title="Percentage">%</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((row, idx) => (
              <tr
                key={`${row.team}-${row.pos}`}
                className={`h-9 ${idx % 2 === 0
                  ? isDark
                    ? 'bg-[#0a1929]'
                    : 'bg-white'
                  : isDark
                    ? 'bg-[#0f172a]/50'
                    : 'bg-gray-50'
                }`}
              >
                <td className="px-1.5 py-0 text-center align-middle text-gray-500 dark:text-gray-400 font-medium h-9">
                  {row.pos}
                </td>
                <td className="px-2 py-0 align-middle font-medium text-gray-900 dark:text-white whitespace-nowrap h-9">
                  <div className="flex items-center gap-1.5 h-7 overflow-hidden">
                    <span className="leading-none">{getTeamAbbrev(row.team)}</span>
                    {resolveTeamLogo(row.team, logoByTeam) && (
                      <span className="inline-flex h-5 w-5 flex-shrink-0 overflow-hidden rounded-sm">
                        <img
                          src={resolveTeamLogo(row.team, logoByTeam) ?? ''}
                          alt=""
                          className="h-5 w-5 object-contain object-center"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.played)}</td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.win)}</td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.loss)}</td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.draw)}</td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.points_for)}</td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.points_against)}</td>
                <td className="px-1.5 py-0 text-center align-middle font-medium text-gray-900 dark:text-white h-9">{fmt(row.premiership_points)}</td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">{fmt(row.percentage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
