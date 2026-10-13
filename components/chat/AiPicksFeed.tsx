'use client';

import { Check, Clock, Loader2, Minus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { supabase } from '@/lib/supabaseClient';
import { aiPicksAsRecordBets, fetchAiPicks } from '@/lib/aiPicks/client';
import { legSelection } from '@/lib/aiPicks/format';
import { getBookmakerInfo } from '@/lib/bookmakers';
import type { AiPick, AiPickLeg, AiPickStatus } from '@/lib/aiPicks/types';
import { computePickRecordStats, formatUnits } from '@/lib/officialPicksRecordStats';

export const AI_PICKS_NAME = 'Stattrackr AI';
export const AI_PICKS_AVATAR = '/images/stattrackr-icon-192.png';

const SPORT_LABELS: Record<string, string> = { nbl: 'NBL', tennis: 'Tennis', nba: 'NBA', afl: 'AFL', mixed: 'Mixed' };

const STATUS_META: Record<AiPickStatus, { label: string; pill: string; accent: string; Icon: typeof Clock }> = {
  pending: {
    label: 'Pending',
    pill: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-white/10',
    accent: 'bg-purple-500/70',
    Icon: Clock,
  },
  win: {
    label: 'Won',
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
    accent: 'bg-emerald-500',
    Icon: Check,
  },
  loss: {
    label: 'Lost',
    pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
    accent: 'bg-rose-500',
    Icon: X,
  },
  push: {
    label: 'Push',
    pill: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
    accent: 'bg-amber-500',
    Icon: Minus,
  },
  void: {
    label: 'Void',
    pill: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
    accent: 'bg-amber-500',
    Icon: Minus,
  },
};

function fmtPosted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function fmtStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function StatusPill({ status, compact = false }: { status: AiPickStatus; compact?: boolean }) {
  const { label, pill, Icon } = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset ${pill} ${
        compact ? 'p-1' : 'px-2 py-0.5 text-[11px] font-semibold'
      }`}
      title={label}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {!compact && label}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{children}</div>
    </div>
  );
}

function legMeta(leg: AiPickLeg): string {
  const parts = [leg.eventLabel, fmtStart(leg.startsAt)];
  if (leg.resultValue != null) parts.push(`Result ${leg.resultValue}`);
  return parts.filter(Boolean).join(' · ');
}

function PickCard({ pick }: { pick: AiPick }) {
  const settled = pick.status !== 'pending';
  const profit = pick.profitUnits ?? 0;
  const isMulti = pick.kind === 'multi';
  const book = getBookmakerInfo(pick.bookmaker).name;
  const single = pick.legs[0];

  return (
    <article className="relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-white/[0.07] dark:bg-[#0f1a2b]">
      <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_META[pick.status].accent}`} aria-hidden />

      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <img src={AI_PICKS_AVATAR} alt={AI_PICKS_NAME} className="h-6 w-6 shrink-0 rounded-full object-cover" />
          <span className="flex items-center gap-1 text-[13px] font-semibold text-gray-900 dark:text-white">
            {AI_PICKS_NAME}
            <Sparkles className="h-3 w-3 text-purple-500" aria-label="AI" />
          </span>
          <span className="truncate text-[11px] text-gray-400 dark:text-gray-500">· {fmtPosted(pick.postedAt)}</span>
        </div>
        <StatusPill status={pick.status} />
      </div>

      <div className="px-4 pb-3 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-300">
          {SPORT_LABELS[pick.sport] ?? pick.sport}
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="text-gray-500 dark:text-gray-400">{isMulti ? `${pick.legs.length}-leg multi` : 'Single'}</span>
        </div>

        {!isMulti && single ? (
          <>
            <h4 className="text-base font-semibold leading-snug text-gray-900 dark:text-white">{legSelection(single)}</h4>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{legMeta(single)}</p>
          </>
        ) : (
          <ol className="space-y-2">
            {pick.legs.map((leg, i) => (
              <li key={leg.id} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/10 text-[10px] font-bold text-purple-600 dark:text-purple-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-snug text-gray-900 dark:text-white">{legSelection(leg)}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">{legMeta(leg)}</div>
                </div>
                <span className="mt-0.5 text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-300">{leg.price.toFixed(2)}</span>
                {leg.status !== 'pending' && <StatusPill status={leg.status} compact />}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mx-4 mb-4 grid grid-cols-3 divide-x divide-gray-200/80 rounded-xl bg-gray-50 dark:divide-white/[0.07] dark:bg-white/[0.03]">
        <Stat label="Odds">{pick.price.toFixed(2)}</Stat>
        <Stat label={settled ? 'Result' : 'Stake'}>
          {settled ? (
            <span className={profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : profit < 0 ? 'text-rose-600 dark:text-rose-400' : ''}>
              {formatUnits(profit, { showSign: true })}
            </span>
          ) : (
            `${pick.units}u`
          )}
        </Stat>
        <Stat label="Bookmaker">
          <span className="flex items-center gap-1.5">
            <BookmakerLogo bookKey={pick.bookmaker} className="h-4 w-4 shrink-0 rounded object-contain" />
            <span className="truncate">{book}</span>
          </span>
        </Stat>
      </div>
    </article>
  );
}

function RecordStrip({ picks }: { picks: AiPick[] }) {
  const stats = useMemo(() => computePickRecordStats(aiPicksAsRecordBets(picks)), [picks]);
  const pending = picks.filter((p) => p.status === 'pending').length;
  const cells: Array<{ label: string; value: string; tone?: number }> = [
    { label: 'Units', value: formatUnits(stats.totalPL, { showSign: true }), tone: stats.totalPL },
    { label: 'ROI', value: `${stats.roi.toFixed(1)}%`, tone: stats.roi },
    { label: 'Record', value: `${stats.wins}-${stats.losses}${stats.voids ? `-${stats.voids}` : ''}` },
    { label: 'Pending', value: String(pending) },
  ];
  return (
    <div className="grid grid-cols-4 divide-x divide-gray-200/80 rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:divide-white/[0.07] dark:border-white/[0.07] dark:bg-[#0f1a2b]">
      {cells.map((c) => (
        <div key={c.label} className="px-2 py-2.5 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{c.label}</div>
          <div
            className={`mt-0.5 text-base font-bold tabular-nums ${
              c.tone == null || c.tone === 0
                ? 'text-gray-900 dark:text-white'
                : c.tone > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

type Filter = 'all' | 'pending' | 'settled';

export function AiPicksFeed() {
  const [picks, setPicks] = useState<AiPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sport, setSport] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      setPicks(await fetchAiPicks());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI picks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel('ai-picks-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_picks' }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const sports = useMemo(() => [...new Set(picks.map((p) => p.sport))].sort(), [picks]);
  const shown = picks.filter(
    (p) =>
      (sport === 'all' || p.sport === sport) &&
      (filter === 'all' || (filter === 'pending' ? p.status === 'pending' : p.status !== 'pending'))
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading AI picks...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
      active
        ? 'border-purple-600 bg-purple-600 text-white'
        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338]'
    }`;

  return (
    <div className="space-y-3">
      <RecordStrip picks={picks} />

      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'pending', 'settled'] as Filter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={chip(filter === f)}>
            {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Settled'}
          </button>
        ))}
        {sports.length > 1 && <span className="mx-1 h-4 w-px bg-gray-300 dark:bg-gray-700" />}
        {sports.length > 1 &&
          ['all', ...sports].map((s) => (
            <button key={s} type="button" onClick={() => setSport(s)} className={chip(sport === s)}>
              {s === 'all' ? 'All sports' : SPORT_LABELS[s] ?? s}
            </button>
          ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700">
          <div className="flex items-center gap-1.5 text-base font-semibold text-gray-900 dark:text-white">
            <img src={AI_PICKS_AVATAR} alt="" className="h-6 w-6 rounded-full" />
            {AI_PICKS_NAME}
            <Sparkles className="h-4 w-4 text-purple-500" />
          </div>
          <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
            {picks.length === 0
              ? "No picks yet. Stattrackr AI watches NBL and tennis lines through the day and only posts when it finds a play worth taking."
              : 'No picks match this filter.'}
          </p>
        </div>
      ) : (
        shown.map((pick) => <PickCard key={pick.id} pick={pick} />)
      )}
    </div>
  );
}

export default AiPicksFeed;
