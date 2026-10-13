'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { supabase } from '@/lib/supabaseClient';
import { aiPicksAsRecordBets, fetchAiPicks } from '@/lib/aiPicks/client';
import { legSelection } from '@/lib/aiPicks/format';
import type { AiPick, AiPickStatus } from '@/lib/aiPicks/types';
import { computePickRecordStats, formatUnits } from '@/lib/officialPicksRecordStats';

export const AI_PICKS_NAME = 'Stattrackr AI';
export const AI_PICKS_AVATAR = '/images/stattrackr-icon-192.png';

const SPORT_LABELS: Record<string, string> = { nbl: 'NBL', tennis: 'Tennis', nba: 'NBA', afl: 'AFL', mixed: 'Mixed' };

const STATUS_STYLES: Record<AiPickStatus, string> = {
  pending: 'bg-gray-500/15 text-gray-600 dark:text-gray-300',
  win: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  loss: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  push: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  void: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};

const STATUS_LABELS: Record<AiPickStatus, string> = {
  pending: 'Pending',
  win: 'Won',
  loss: 'Lost',
  push: 'Push',
  void: 'Void',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function StatusBadge({ status }: { status: AiPickStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function AiPosterRow({ postedAt }: { postedAt: string }) {
  return (
    <div className="flex items-center gap-2">
      <img src={AI_PICKS_AVATAR} alt={AI_PICKS_NAME} className="h-8 w-8 shrink-0 rounded-full object-cover" />
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-sm font-semibold text-gray-900 dark:text-white">
          {AI_PICKS_NAME}
          <Sparkles className="h-3.5 w-3.5 text-purple-500" aria-label="AI" />
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{fmtWhen(postedAt)}</div>
      </div>
    </div>
  );
}

function PickCard({ pick }: { pick: AiPick }) {
  const settled = pick.status !== 'pending';
  const profit = pick.profitUnits ?? 0;
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm dark:border-gray-700/80 dark:bg-[#111c2d]">
      <div className="flex items-start justify-between gap-2">
        <AiPosterRow postedAt={pick.postedAt} />
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-700 dark:text-purple-300">
            {SPORT_LABELS[pick.sport] ?? pick.sport} · {pick.kind === 'multi' ? `${pick.legs.length}-leg multi` : 'Single'}
          </span>
          <StatusBadge status={pick.status} />
        </div>
      </div>

      <h4 className="mt-3 text-[15px] font-semibold text-gray-900 dark:text-white">{pick.title}</h4>

      <div className="mt-2 space-y-1.5">
        {pick.legs.map((leg) => (
          <div
            key={leg.id}
            className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700/70 dark:bg-[#0a1929]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{legSelection(leg)}</div>
              <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                {leg.eventLabel} · {fmtWhen(leg.startsAt)}
                {leg.resultValue != null ? ` · Result: ${leg.resultValue}` : ''}
                {leg.resultNote ? ` · ${leg.resultNote}` : ''}
              </div>
            </div>
            {pick.kind === 'multi' && <span className="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">{leg.price.toFixed(2)}</span>}
            {pick.kind === 'multi' && leg.status !== 'pending' && <StatusBadge status={leg.status} />}
            <BookmakerLogo bookKey={leg.bookmaker} className="h-6 w-6 shrink-0 rounded-md object-contain" />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        <span>
          <span className="font-bold text-gray-900 dark:text-white">{pick.units}u</span> stake
        </span>
        <span>
          @ <span className="font-bold tabular-nums text-gray-900 dark:text-white">{pick.price.toFixed(2)}</span> {pick.bookmaker}
        </span>
        {settled && (
          <span className={`font-bold ${profit > 0 ? 'text-emerald-600 dark:text-emerald-400' : profit < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
            {formatUnits(profit, { showSign: true })}
          </span>
        )}
      </div>

      {pick.writeUp && <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{pick.writeUp}</p>}
    </article>
  );
}

function RecordStrip({ picks }: { picks: AiPick[] }) {
  const stats = useMemo(() => computePickRecordStats(aiPicksAsRecordBets(picks)), [picks]);
  const pending = picks.filter((p) => p.status === 'pending').length;
  const cells: Array<{ label: string; value: string; tone?: number }> = [
    { label: 'Units', value: formatUnits(stats.totalPL, { showSign: true }), tone: stats.totalPL },
    { label: 'ROI', value: `${stats.roi.toFixed(1)}%`, tone: stats.roi },
    { label: 'Win %', value: `${stats.winRate.toFixed(0)}%` },
    { label: 'Record', value: `${stats.wins}-${stats.losses}${stats.voids ? `-${stats.voids}` : ''}` },
    { label: 'Pending', value: String(pending) },
  ];
  return (
    <div className="grid grid-cols-5 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700/80 dark:bg-[#111c2d]">
      {cells.map((c, i) => (
        <div key={c.label} className={`px-2 py-2 text-center ${i ? 'border-l border-gray-200 dark:border-gray-700/80' : ''}`}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{c.label}</div>
          <div
            className={`text-sm font-bold tabular-nums ${
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
