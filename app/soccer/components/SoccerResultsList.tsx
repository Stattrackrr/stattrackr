'use client';

import type { SoccerwayMatchStat, SoccerwayMatchStats, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

type SoccerResultsListProps = {
  selectedTeamName: string | null;
  matches: SoccerwayRecentMatch[];
  loading: boolean;
  error: string | null;
  emptyTextClassName: string;
  isDark: boolean;
};

function normalizeTeamName(value: string): string {
  return value.trim().toLowerCase();
}

function getSelectedTeamSide(match: SoccerwayRecentMatch, selectedTeamName: string): 'home' | 'away' | null {
  const selected = normalizeTeamName(selectedTeamName);
  if (normalizeTeamName(match.homeTeam) === selected) return 'home';
  if (normalizeTeamName(match.awayTeam) === selected) return 'away';
  return null;
}

function findMatchStat(stats: SoccerwayMatchStats | null | undefined, statName: string, periodName = 'Match'): SoccerwayMatchStat | null {
  const period = stats?.periods.find((item) => item.name.toLowerCase() === periodName.toLowerCase());
  if (!period) return null;

  for (const category of period.categories) {
    const stat = category.stats.find((entry) => entry.name.toLowerCase() === statName.toLowerCase());
    if (stat) return stat;
  }

  return null;
}

function getDisplayPair(match: SoccerwayRecentMatch, selectedTeamName: string, stat: SoccerwayMatchStat | null): string | null {
  if (!stat) return null;
  const side = getSelectedTeamSide(match, selectedTeamName);
  if (side === 'away') return `${stat.awayValue ?? '—'}-${stat.homeValue ?? '—'}`;
  return `${stat.homeValue ?? '—'}-${stat.awayValue ?? '—'}`;
}

function getQuickStats(match: SoccerwayRecentMatch, selectedTeamName: string): Array<{ label: string; value: string }> {
  const items = [
    { label: 'xG', stat: findMatchStat(match.stats, 'Expected goals (xG)') },
    { label: 'SOT', stat: findMatchStat(match.stats, 'Shots on target') },
    { label: 'Corners', stat: findMatchStat(match.stats, 'Corner kicks') },
    { label: 'YC', stat: findMatchStat(match.stats, 'Yellow cards') },
    { label: 'RC', stat: findMatchStat(match.stats, 'Red cards') },
  ];

  return items
    .map((item) => {
      const value = getDisplayPair(match, selectedTeamName, item.stat);
      return value ? { label: item.label, value } : null;
    })
    .filter((item): item is { label: string; value: string } => item != null);
}

export function SoccerResultsList({
  selectedTeamName,
  matches,
  loading,
  error,
  emptyTextClassName,
  isDark,
}: SoccerResultsListProps) {
  if (!selectedTeamName) {
    return (
      <div className={`flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm ${emptyTextClassName}`}>
        Select a team above to load recent results from Soccerway.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2 p-1">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className={`h-14 animate-pulse rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
            style={{ animationDelay: `${i * 0.06}s` }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="px-2 py-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (matches.length === 0) {
    return <div className={`px-2 py-6 text-center text-sm ${emptyTextClassName}`}>No recent results parsed for this team.</div>;
  }

  return (
    <ul className="space-y-2 pb-2">
      {matches.map((match) => {
        const selectedLower = selectedTeamName.trim().toLowerCase();
        const homeHighlight = match.homeTeam.trim().toLowerCase() === selectedLower;
        const awayHighlight = match.awayTeam.trim().toLowerCase() === selectedLower;
        const selectedTeamSide = getSelectedTeamSide(match, selectedTeamName);
        const valuePrefix = selectedTeamSide ? `${selectedTeamName} / Opp` : 'Home / Away';
        const quickStats = getQuickStats(match, selectedTeamName);
        const dateLabel =
          match.kickoffUnix != null
            ? new Date(match.kickoffUnix * 1000).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—';
        const absUrl = `https://www.soccerway.com${match.summaryPath.startsWith('/') ? match.summaryPath : `/${match.summaryPath}`}`;

        return (
          <li key={match.matchId}>
            <div
              className={`block rounded-lg border px-3 py-2.5 transition hover:bg-gray-50 dark:hover:bg-[#132337] ${
                isDark ? 'border-gray-700 bg-black/20' : 'border-gray-200 bg-white'
              }`}
            >
              <a href={absUrl} target="_blank" rel="noopener noreferrer" className="block">
                <div className={`mb-1 text-[11px] uppercase tracking-wide ${emptyTextClassName}`}>{dateLabel}</div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span
                    className={`min-w-0 flex-1 truncate text-left ${
                      homeHighlight ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {match.homeTeam}
                  </span>
                  <span className="flex-shrink-0 font-mono text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {match.homeScore} – {match.awayScore}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-right ${
                      awayHighlight ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {match.awayTeam}
                  </span>
                </div>
                {quickStats.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickStats.map((item) => (
                      <span
                        key={`${match.matchId}-${item.label}`}
                        className="rounded-full border border-gray-300/80 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:border-gray-600 dark:bg-[#0f172a] dark:text-gray-200"
                      >
                        {item.label} {item.value}
                      </span>
                    ))}
                  </div>
                ) : null}
              </a>
              {match.stats?.periods?.length ? (
                <details
                  className="mt-2 rounded-md border border-gray-200/80 bg-gray-50/70 px-2 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-[#0b1626] dark:text-gray-200"
                  onToggle={(e) => {
                    const target = e.currentTarget;
                    if (target.open) {
                      window.requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest' }));
                    }
                  }}
                >
                  <summary
                    className="cursor-pointer list-none font-semibold text-purple-700 dark:text-purple-300"
                    onClick={(e) => {
                      e.preventDefault();
                      const details = e.currentTarget.parentElement as HTMLDetailsElement | null;
                      if (details) details.open = !details.open;
                    }}
                  >
                    Full team stats
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{valuePrefix}</div>
                    {match.stats.periods.map((period) => (
                      <div key={`${match.matchId}-${period.name}`} className="space-y-1.5">
                        <div className="font-semibold text-gray-800 dark:text-gray-100">{period.name}</div>
                        {period.categories.map((category) => (
                          <div
                            key={`${match.matchId}-${period.name}-${category.name}`}
                            className="rounded-md border border-gray-200 bg-white/80 p-2 dark:border-gray-700 dark:bg-black/20"
                          >
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              {category.name}
                            </div>
                            <div className="grid gap-1">
                              {category.stats.map((stat) => {
                                const displayPair = getDisplayPair(match, selectedTeamName, stat);
                                return (
                                  <div
                                    key={`${match.matchId}-${period.name}-${category.name}-${stat.id ?? stat.name}`}
                                    className="flex items-center justify-between gap-3"
                                  >
                                    <span className="min-w-0 flex-1 truncate">{stat.name}</span>
                                    <span className="flex-shrink-0 font-mono tabular-nums text-gray-900 dark:text-gray-100">
                                      {displayPair ?? `${stat.homeValue ?? '—'}-${stat.awayValue ?? '—'}`}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
