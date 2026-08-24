'use client';

import { useEffect, useState } from 'react';
import { fetchJsonDeduped } from '@/lib/clientFetchDedupe';
import {
  NBL_CLUBS,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

type LadderRow = {
  pos: number | null;
  team: string;
  teamCode?: string | null;
  teamLogo?: string | null;
  played: number;
  win: number;
  loss: number;
  points_for: number | null;
  points_against: number | null;
  points_percentage: number | null;
};

type LadderData = {
  year: number;
  seasonLabel?: string;
  teams: LadderRow[];
};

function getNblClub(teamName: string, teamCode?: string | null) {
  if (teamCode) {
    const byCode = NBL_CLUBS.find((c) => c.code === teamCode.toUpperCase());
    if (byCode) return byCode;
  }
  return (
    NBL_CLUBS.find(
      (c) =>
        c.name === teamName ||
        normalizeTeamKey(c.name) === normalizeTeamKey(teamName) ||
        normalizeTeamKey(c.shortName) === normalizeTeamKey(teamName)
    ) ?? null
  );
}

/** Nickname for the ladder: Kings, Hawks, Phoenix, etc. */
function getNblTeamShortName(teamName: string, teamCode?: string | null): string {
  const club = getNblClub(teamName, teamCode);
  if (club) return club.shortName;
  const words = String(teamName || '').trim().split(/\s+/);
  return words[words.length - 1] || teamName;
}

function resolveTeamLogo(
  row: LadderRow,
  logoByTeam: Record<string, string>
): string | null {
  if (row.teamLogo) return row.teamLogo;
  const candidates = [row.team, row.teamCode, resolveNblClubName(row.team)].filter(
    Boolean
  ) as string[];
  for (const name of candidates) {
    if (logoByTeam[name]) return logoByTeam[name];
    const key = normalizeTeamKey(name);
    if (logoByTeam[key]) return logoByTeam[key];
    for (const [logoKey, url] of Object.entries(logoByTeam)) {
      if (normalizeTeamKey(logoKey) === key) return url;
    }
  }
  return null;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(Math.round(v));
}

/** NBL points % is stored as a ratio (1.1379 → 113.8). */
function fmtPointsPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const pct = v <= 3 ? v * 100 : v;
  return pct.toFixed(1);
}

export function NblLadderCard({
  isDark = false,
  logoByTeam = {},
}: {
  isDark?: boolean;
  logoByTeam?: Record<string, string>;
}) {
  const [data, setData] = useState<LadderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJsonDeduped<{
      error?: string;
      year?: number;
      seasonLabel?: string;
      teams?: LadderRow[];
    }>('/api/nbl/ladder')
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData({
          year: json.year ?? 0,
          seasonLabel: json.seasonLabel,
          teams: json.teams ?? [],
        });
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
    return () => {
      cancelled = true;
    };
  }, []);

  const teams = data?.teams ?? [];

  if (loading && teams.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-gray-500 dark:text-gray-400">
        Loading ladder…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-amber-600 dark:text-amber-400">
        {error ?? 'No data'}
      </div>
    );
  }

  if (!teams.length) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-gray-500 dark:text-gray-400">
        No ladder data
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">NBL Ladder</h3>
        {data.seasonLabel ? (
          <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {data.seasonLabel}
          </span>
        ) : null}
      </div>
      <div
        className={`rounded-lg border overflow-x-hidden overflow-y-auto max-h-[520px] min-h-[320px] pb-3 custom-scrollbar ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        }`}
      >
        <table className="w-full text-xs min-w-[380px] table-fixed">
          <thead className="sticky top-0 z-10">
            <tr className={`min-h-[40px] ${isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-7">#</th>
              <th className="px-2 py-2.5 text-left align-middle font-semibold">Team</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Played">
                P
              </th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Wins">
                W
              </th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8" title="Losses">
                L
              </th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-10" title="Points For">
                PF
              </th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-10" title="Points Against">
                PA
              </th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-12" title="Points Percentage">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((row, idx) => {
              const logo = resolveTeamLogo(row, logoByTeam);
              return (
                <tr
                  key={`${row.team}-${row.pos}`}
                  className={`h-9 ${
                    idx % 2 === 0
                      ? isDark
                        ? 'bg-[#0a1929]'
                        : 'bg-white'
                      : isDark
                        ? 'bg-[#0f172a]/50'
                        : 'bg-gray-50'
                  }`}
                >
                  <td className="px-1.5 py-0 text-center align-middle text-gray-500 dark:text-gray-400 font-medium h-9">
                    {row.pos ?? idx + 1}
                  </td>
                  <td className="px-2 py-0 align-middle font-medium text-gray-900 dark:text-white whitespace-nowrap h-9">
                    <div className="flex items-center gap-1.5 h-7 overflow-hidden">
                      <span className="leading-none">{getNblTeamShortName(row.team, row.teamCode)}</span>
                      {logo ? (
                        <span className="inline-flex h-5 w-5 flex-shrink-0 overflow-hidden rounded-sm">
                          <img
                            src={logo}
                            alt=""
                            className="h-5 w-5 object-contain object-center"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                    {fmtInt(row.played)}
                  </td>
                  <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                    {fmtInt(row.win)}
                  </td>
                  <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                    {fmtInt(row.loss)}
                  </td>
                  <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                    {fmtInt(row.points_for)}
                  </td>
                  <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                    {fmtInt(row.points_against)}
                  </td>
                  <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                    {fmtPointsPct(row.points_percentage)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
