'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type TeamStat = {
  name: string | null;
  type: string | null;
  label: string | null;
  value: string | null;
};

type TeamParticipant = {
  side: string | null;
  team: string | null;
  stats: TeamStat[];
};

type SummaryEvent = {
  type: string;
  label?: string;
  minute?: string;
  details?: string[];
};

type PlayerCategory = {
  url: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  rawRowCount: number;
};

type SoccerSample = {
  generatedAt?: string;
  source?: string;
  eventId?: string;
  match?: {
    ogTitle?: string;
    ogDescription?: string;
    heading?: string;
    teams?: string[];
    score?: {
      homeTeam?: string;
      awayTeam?: string;
      homeScore?: number;
      awayScore?: number;
    };
  };
  summary?: {
    parsedEvents?: SummaryEvent[];
    playerLinks?: Array<{ href: string; label: string }>;
  };
  teamStats?: {
    participants?: TeamParticipant[];
  };
  odds?: {
    geo?: {
      countryCode?: string;
      subdivisionCode?: string;
    };
    bookmakers?: Array<{
      id?: number | null;
      name?: string | null;
    }>;
    summary?: {
      bookmakerCount?: number;
      marketCount?: number;
      groupedMarketCount?: number;
    };
    groupedMarkets?: Array<{
      key?: string;
      bettingType?: string | null;
      bettingScope?: string | null;
      offerCount?: number;
      offers?: Array<{
        bookmakerId?: number | null;
        bookmakerName?: string | null;
        hasLiveBettingOffers?: boolean;
        odds?: Array<{
          participant?: string | null;
          selection?: string | null;
          value?: string | null;
          opening?: string | null;
          handicap?: string | null;
        }>;
      }>;
    }>;
  };
  playerStats?: Record<string, PlayerCategory>;
};

type TeamDiscoveryCompetition = {
  country: string;
  competition: string;
  url: string;
  teamCount: number;
  teams: Array<{
    name: string;
    href: string;
    competition: string;
    country: string;
  }>;
};

type TeamDiscoverySample = {
  generatedAt?: string;
  source?: string;
  summary?: {
    competitionCount?: number;
    totalDiscoveredRows?: number;
    uniqueTeams?: number;
  };
  competitions?: TeamDiscoveryCompetition[];
  uniqueTeams?: Array<{
    name: string;
    href: string;
    competitions: Array<{
      country: string;
      competition: string;
    }>;
  }>;
};

type SoccerDashboardPayload = {
  matchSample?: SoccerSample | null;
  teamSample?: TeamDiscoverySample | null;
};

function formatStatKey(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parsePlayerDisplay(value: unknown): { name: string; role: string | null } {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.+?)(Goalkeeper|Midfielder|Forward|Defender|Wingback|Attacking midfielder|Centre-back|Center-back|Fullback|Striker|Winger)$/i);
  if (!match) return { name: raw, role: null };
  return {
    name: match[1].trim(),
    role: match[2].trim(),
  };
}

function formatOddsLabel(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function SoccerPage() {
  const [data, setData] = useState<SoccerDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSample = useCallback(async (refresh = false) => {
    try {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params = new URLSearchParams({ includeTeams: '1' });
      if (refresh) params.set('refresh', '1');

      const response = await fetch(`/api/soccer/sample?${params.toString()}`, {
        cache: 'no-store',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load soccer sample');
      }

      setData(payload as SoccerDashboardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load soccer sample');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSample(false);
  }, [loadSample]);

  const matchSample = data?.matchSample || null;
  const teamSample = data?.teamSample || null;
  const playerCategories = useMemo(() => Object.entries(matchSample?.playerStats || {}), [matchSample]);
  const topRows = (matchSample?.playerStats?.top?.rows || []).slice(0, 8);
  const recentEvents = (matchSample?.summary?.parsedEvents || [])
    .filter((event) => event.type === 'event' && event.minute)
    .slice(0, 12);
  const teamUniverse = (teamSample?.uniqueTeams || []).slice(0, 80);
  const groupedOddsMarkets = (matchSample?.odds?.groupedMarkets || []).slice(0, 8);

  return (
    <main className="min-h-screen bg-[#050d1a] px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-4 inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
              Soccerway live scrape
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">Soccer</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
              This page now loads both the latest Soccerway match sample and the seeded team discovery
              sample so we can inspect game stats and every team we can currently return.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadSample(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Refreshing scrape...' : 'Refresh scrape'}
          </button>
        </div>

        {loading ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
            Loading soccer scrape sample...
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
            {error}
          </div>
        ) : !data ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
            No soccer sample available yet.
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="text-xs uppercase tracking-[0.2em] text-emerald-200/80">Current sample</div>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  {matchSample?.match?.ogTitle || matchSample?.match?.heading || 'Latest Soccerway match'}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  {matchSample?.match?.ogDescription || 'No match description available.'}
                </p>

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-400">Source</div>
                    <div className="mt-2 text-sm font-medium text-white">{matchSample?.source || 'Soccerway'}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-400">Event ID</div>
                    <div className="mt-2 text-sm font-medium text-white">{matchSample?.eventId || 'n/a'}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-400">Generated</div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {matchSample?.generatedAt ? new Date(matchSample.generatedAt).toLocaleString() : 'n/a'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Scoreboard</div>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-slate-300">
                      {matchSample?.match?.score?.homeTeam || matchSample?.match?.teams?.[0] || 'Home'}
                    </span>
                    <span className="text-xl font-semibold text-white">{matchSample?.match?.score?.homeScore ?? '-'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-slate-300">
                      {matchSample?.match?.score?.awayTeam || matchSample?.match?.teams?.[1] || 'Away'}
                    </span>
                    <span className="text-xl font-semibold text-white">{matchSample?.match?.score?.awayScore ?? '-'}</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                    Player links found: {matchSample?.summary?.playerLinks?.length || 0}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Team universe</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Seeded from Soccerway standings pages so we can see every team currently returned.
                  </p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div>{teamSample?.summary?.uniqueTeams || 0} unique teams</div>
                  <div>{teamSample?.summary?.competitionCount || 0} competitions</div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
                <div className="space-y-3">
                  {(teamSample?.competitions || []).map((competition) => (
                    <div key={`${competition.country}-${competition.competition}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="text-sm font-medium text-white">{competition.competition}</div>
                      <div className="mt-1 text-xs text-slate-400">{competition.country}</div>
                      <div className="mt-3 text-sm text-emerald-200">{competition.teamCount} teams</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-medium text-white">Returned teams</div>
                    <div className="text-xs text-slate-400">Showing first {teamUniverse.length}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {teamUniverse.map((team) => (
                      <div key={team.href} className="rounded-lg border border-white/5 bg-white/5 px-3 py-3">
                        <div className="text-sm font-medium text-slate-100">{team.name}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {team.competitions.map((entry) => `${entry.country} - ${entry.competition}`).join(' | ')}
                        </div>
                        <div className="mt-2 break-all text-[11px] text-emerald-200/80">{team.href}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Team stats</h2>
                  <span className="text-xs text-slate-400">From internal stats endpoint</span>
                </div>
                <div className="mt-4 space-y-4">
                  {(matchSample?.teamStats?.participants || []).map((participant) => (
                    <div key={`${participant.side}-${participant.team}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="font-medium text-white">{participant.team || participant.side || 'Team'}</div>
                        <div className="text-xs uppercase tracking-wide text-slate-400">{participant.side || 'n/a'}</div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {participant.stats.map((stat) => (
                          <div key={`${participant.team}-${stat.type}-${stat.name}`} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                            <div className="text-xs text-slate-400">{stat.name || stat.type || 'Stat'}</div>
                            <div className="mt-1 text-sm font-medium text-white">{stat.label || stat.value || '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Recent events</h2>
                  <span className="text-xs text-slate-400">Parsed from summary tab</span>
                </div>
                <div className="mt-4 space-y-3">
                  {recentEvents.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                      No parsed events available.
                    </div>
                  ) : (
                    recentEvents.map((event, index) => (
                      <div key={`${event.minute}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="text-sm font-medium text-emerald-200">{event.minute}'</div>
                        <div className="mt-2 text-sm text-slate-200">{event.details?.join(' ') || 'Event details unavailable'}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Odds markets</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Pulled from Soccerway&apos;s odds feed behind the dedicated odds tab.
                  </p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div>{matchSample?.odds?.summary?.groupedMarketCount || 0} grouped markets</div>
                  <div>{matchSample?.odds?.summary?.bookmakerCount || 0} bookmakers</div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-medium text-white">Feed context</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <div>Geo: {matchSample?.odds?.geo?.countryCode || 'n/a'} / {matchSample?.odds?.geo?.subdivisionCode || 'n/a'}</div>
                    <div>Bookmakers: {(matchSample?.odds?.bookmakers || []).map((bookmaker) => bookmaker.name).filter(Boolean).join(', ') || 'n/a'}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {groupedOddsMarkets.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                      No odds markets available.
                    </div>
                  ) : (
                    groupedOddsMarkets.map((market, index) => (
                      <div key={`${market.key}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">{formatOddsLabel(market.bettingType)}</div>
                            <div className="mt-1 text-xs text-slate-400">
                              {formatOddsLabel(market.bettingScope)} · {market.offerCount || 0} bookmaker offers
                            </div>
                          </div>
                          <div className="text-[11px] text-emerald-200">Grouped market</div>
                        </div>

                        <div className="mt-4 space-y-3">
                          {(market.offers || []).slice(0, 2).map((offer, offerIndex) => (
                            <div key={`${offer.bookmakerName}-${offerIndex}`} className="rounded-lg border border-white/5 bg-white/5 p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <div className="text-xs font-medium text-slate-200">{offer.bookmakerName || 'Unknown bookmaker'}</div>
                                <div className="text-[11px] text-slate-400">
                                  {offer.hasLiveBettingOffers ? 'Live offers' : 'Pre-match'}
                                </div>
                              </div>
                              <div className="space-y-2">
                                {(offer.odds || []).slice(0, 5).map((entry, entryIndex) => (
                                  <div key={`${entry.participant}-${entry.selection}-${entryIndex}`} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                                    <div className="text-xs text-slate-300">
                                      {entry.participant || entry.selection || (entry.handicap ? `Line ${entry.handicap}` : 'Selection')}
                                      {entry.participant && entry.selection ? ` · ${entry.selection}` : ''}
                                      {!entry.participant && !entry.selection && entry.handicap ? '' : ''}
                                      {entry.handicap ? ` (${entry.handicap})` : ''}
                                    </div>
                                    <div className="text-sm font-medium text-white">
                                      {entry.value || '-'}
                                      {entry.opening ? <span className="ml-2 text-xs text-slate-500">open {entry.opening}</span> : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Top player rows</h2>
                <span className="text-xs text-slate-400">From `player-stats/top`</span>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="px-3 py-2 font-medium">Player</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Rating</th>
                      <th className="px-3 py-2 font-medium">Shots</th>
                      <th className="px-3 py-2 font-medium">xG</th>
                      <th className="px-3 py-2 font-medium">Touches</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {topRows.map((row, index) => {
                      const playerInfo = parsePlayerDisplay(row.player);
                      return (
                        <tr key={`${playerInfo.name}-${index}`} className="text-slate-200">
                          <td className="px-3 py-3">{playerInfo.name || '-'}</td>
                          <td className="px-3 py-3 text-slate-400">{playerInfo.role || '-'}</td>
                          <td className="px-3 py-3">{String(row.ratingrating ?? '-')}</td>
                          <td className="px-3 py-3">{String(row.total_shotstotal_shots ?? '-')}</td>
                          <td className="px-3 py-3">{String(row.expected_goals_xg_expected_goals_xg ?? '-')}</td>
                          <td className="px-3 py-3">{String(row.touchestouches ?? '-')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Player stat categories</h2>
                <span className="text-xs text-slate-400">Rendered category tables</span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {playerCategories.map(([category, categoryData]) => (
                  <div key={category} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-white">{formatStatKey(category)}</div>
                      <div className="text-xs text-slate-400">{categoryData.rawRowCount} rows</div>
                    </div>
                    <div className="mt-3 text-xs text-slate-400">
                      {categoryData.headers.slice(0, 6).join(' | ')}
                    </div>
                    <div className="mt-4 space-y-2">
                      {categoryData.rows.slice(0, 3).map((row, index) => {
                        const playerInfo = parsePlayerDisplay(row.player);
                        return (
                          <div key={`${category}-${playerInfo.name}-${index}`} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                            <div className="text-sm font-medium text-slate-100">{playerInfo.name || 'Unknown player'}</div>
                            <div className="mt-1 text-xs text-slate-400">{playerInfo.role || 'Role unavailable'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
