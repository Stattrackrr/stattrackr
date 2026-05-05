'use client';

import { useEffect, useMemo, useState } from 'react';

type SoccerInjuryRow = {
  player: string;
  status: 'injury' | 'suspension' | 'absence';
  reason: string;
  estimatedReturn: string | null;
  playerUrl: string | null;
};

type SoccerInjuriesResponse = {
  teamHref: string;
  teamName: string;
  sourcePage: string;
  supported: boolean;
  source: 'soccerway';
  generatedAt: string;
  injuries: SoccerInjuryRow[];
  error?: string;
};

type SoccerInjuriesCardProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
};

type ViewMode = 'selected' | 'opponent';

function formatDisplayPlayerName(value: string): string {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 1) return String(value || '').trim();
  const last = parts.at(-1) ?? '';
  const remaining = parts.slice(0, -1);
  return [last, ...remaining].join(' ');
}

function formatEstimatedReturn(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw || raw === '?') return null;

  const [day, month, year] = raw.split('.');
  if (!day || !month || !year) return raw;

  const date = new Date(`${year}-${month}-${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getStatusLabel(status: SoccerInjuryRow['status']): string {
  if (status === 'suspension') return 'Suspension';
  if (status === 'absence') return 'Absent';
  return 'Injury';
}

function formatInjuryReason(reason: string | null | undefined, status: SoccerInjuryRow['status']): string {
  const raw = String(reason || '').trim();
  if (!raw) return getStatusLabel(status);

  const cleaned = raw
    .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, ' ')
    .replace(
      /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?/gi,
      ' '
    )
    .replace(
      /\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?/gi,
      ' '
    )
    .replace(/([A-Za-z])(\d{1,2}\.\d{1,2}\.\d{2,4})/g, '$1 ')
    .replace(/\b(?:since|from|on)\b\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-,:/|]+\s*$/g, '')
    .trim();

  return cleaned || getStatusLabel(status);
}

function getReasonClasses(status: SoccerInjuryRow['status'], isDark: boolean): string {
  if (status === 'suspension') {
    return isDark ? 'bg-red-950/50 text-red-300' : 'bg-red-50 text-red-700';
  }
  if (status === 'absence') {
    return isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700';
  }
  return isDark ? 'bg-emerald-950/50 text-emerald-300' : 'bg-emerald-50 text-emerald-700';
}

function renderEstimatedReturnPill(estimatedReturn: string | null, isDark: boolean) {
  const label = formatEstimatedReturn(estimatedReturn);
  if (!label) return null;
  return (
    <span
      className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isDark ? 'bg-violet-950/50 text-violet-200' : 'bg-violet-50 text-violet-700'
      }`}
    >
      Expected return {label}
    </span>
  );
}

function InjuriesHeader() {
  return (
    <div className="relative flex items-center justify-center mt-1 mb-2 flex-shrink-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Injuries</h3>
    </div>
  );
}

export function SoccerInjuriesCard({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  emptyTextClass,
  showSkeleton = false,
}: SoccerInjuriesCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('selected');
  const [teamData, setTeamData] = useState<SoccerInjuriesResponse | null>(null);
  const [opponentData, setOpponentData] = useState<SoccerInjuriesResponse | null>(null);

  const canFetch = Boolean(teamHref?.trim() && opponentHref?.trim() && teamName?.trim() && opponentName?.trim());

  useEffect(() => {
    if (!canFetch || !teamHref || !opponentHref) {
      setTeamData(null);
      setOpponentData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const fetchInjuries = async (href: string) => {
      const response = await fetch(
        `/api/soccer/injuries?href=${encodeURIComponent(href)}&teamName=${encodeURIComponent(
          href === teamHref ? teamName ?? '' : opponentName ?? ''
        )}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        }
      );
      const payload = (await response.json().catch(() => null)) as SoccerInjuriesResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load injuries');
      }
      return payload;
    };

    void Promise.all([fetchInjuries(teamHref), fetchInjuries(opponentHref)])
      .then(([selectedPayload, opponentPayload]) => {
        if (cancelled) return;
        setTeamData(selectedPayload);
        setOpponentData(opponentPayload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setTeamData(null);
        setOpponentData(null);
        setError(err instanceof Error ? err.message : 'Failed to load injuries');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canFetch, opponentHref, teamHref]);

  const currentData = viewMode === 'opponent' ? opponentData : teamData;
  const selectedLabel = teamData?.teamName || teamName || 'Selected team';
  const opponentLabel = opponentData?.teamName || opponentName || 'Opponent';

  const content = useMemo(() => {
    if (!currentData) return null;
    if (!currentData.supported) {
      return { mode: 'unsupported' as const };
    }
    if (!currentData.injuries.length) {
      return { mode: 'empty' as const, message: `No current injuries listed for ${currentData.teamName}.` };
    }
    const priority = { injury: 0, suspension: 1, absence: 2 } as const;
    const injuries = [...currentData.injuries].sort((a, b) => {
      const statusDiff = priority[a.status] - priority[b.status];
      if (statusDiff !== 0) return statusDiff;
      return formatDisplayPlayerName(a.player).localeCompare(formatDisplayPlayerName(b.player));
    });
    return { mode: 'list' as const, injuries };
  }, [currentData]);

  if (showSkeleton || loading) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <InjuriesHeader />
        <div className="flex flex-col px-3 pb-10">
          <div className={`mb-2 h-10 rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          <div className={`h-20 rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
        </div>
      </div>
    );
  }

  if (!canFetch) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <InjuriesHeader />
        <div className="flex items-center px-3 pb-10 pt-1">
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <InjuriesHeader />
        <div className="flex items-center justify-center px-3 py-6 pb-10">
          <div className={`text-sm ${emptyTextClass}`}>N/A</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      <InjuriesHeader />
      <div className="flex flex-col px-3 pb-10">
        <div className="mb-2">
          <div className={`inline-flex w-full items-center rounded-xl border p-1 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
            <button
              type="button"
              onClick={() => setViewMode('selected')}
              className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                viewMode === 'selected'
                  ? 'bg-green-600 text-white shadow-sm'
                  : isDark
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              <span className="block truncate">{selectedLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('opponent')}
              className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                viewMode === 'opponent'
                  ? 'bg-red-600 text-white shadow-sm'
                  : isDark
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              <span className="block truncate">{opponentLabel}</span>
            </button>
          </div>
        </div>

        {!currentData || !content ? (
          <div className={`text-sm py-4 ${emptyTextClass}`}>No data available come back later</div>
        ) : content.mode === 'unsupported' ? (
          <div className="flex justify-center py-6">
            <div className={`text-sm ${emptyTextClass}`}>N/A</div>
          </div>
        ) : content.mode === 'empty' ? (
          <div className={`rounded-xl border px-3 py-4 text-sm ${isDark ? 'border-gray-700 bg-[#0f172a] text-gray-300' : 'border-gray-200 bg-gray-50/80 text-gray-600'}`}>
            {content.message}
          </div>
        ) : (
          <div className="max-h-[min(420px,58vh)] overflow-y-auto overflow-x-hidden pr-1 pb-4 custom-scrollbar">
            <div className="space-y-1">
              {content.injuries.map((injury) => (
                <div
                  key={`${injury.player}-${injury.reason}-${injury.status}`}
                  className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                    isDark ? 'border-gray-700 bg-[#0f172a] hover:bg-[#132033]' : 'border-gray-200 bg-gray-50/80 hover:bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {injury.playerUrl ? (
                      <a
                        href={injury.playerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`block truncate text-xs font-semibold leading-tight ${isDark ? 'text-white hover:text-purple-300' : 'text-slate-900 hover:text-purple-700'}`}
                      >
                        {formatDisplayPlayerName(injury.player)}
                      </a>
                    ) : (
                      <div className={`truncate text-xs font-semibold leading-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                        {formatDisplayPlayerName(injury.player)}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                    <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getReasonClasses(injury.status, isDark)}`}>
                      {formatInjuryReason(injury.reason, injury.status)}
                    </span>
                    {renderEstimatedReturnPill(injury.estimatedReturn, isDark)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
