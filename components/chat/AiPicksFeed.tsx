'use client';

import { ArrowUpDown, Check, Clock, Highlighter, Loader2, Minus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { supabase } from '@/lib/supabaseClient';
import { aiPicksAsRecordBets, fetchAddedPickIds, fetchAiPicks, setPickAdded } from '@/lib/aiPicks/client';
import { legBet, legSubject } from '@/lib/aiPicks/format';
import { getBookmakerInfo } from '@/lib/bookmakers';
import type { AiPick, AiPickLeg, AiPickStatus } from '@/lib/aiPicks/types';
import type { TennisTour } from '@/lib/tennis/types';
import { computePickRecordStats, formatUnits } from '@/lib/officialPicksRecordStats';

export const AI_PICKS_NAME = 'Stattrackr AI';
export const AI_PICKS_AVATAR = '/images/stattrackr-icon-192.png';

const SPORT_LABELS: Record<string, string> = { nbl: 'NBL', tennis: 'Tennis', nba: 'NBA', afl: 'AFL', mixed: 'Mixed' };
const SPORT_LOGOS: Record<string, string> = { nbl: '/images/nbl-logo.png', nba: '/images/nba-logo.png', afl: '/images/afl-logo.png' };
const TOUR_LOGOS: Record<TennisTour, string> = { ATP: '/images/atp-logo.webp', WTA: '/images/wta-logo.png' };

/** Tennis shows the ATP/WTA logo of its legs; the ball is only a fallback until the tour is known. */
function SportLogo({ sport, tours = [], className = 'h-3.5 w-3.5' }: { sport: string; tours?: TennisTour[]; className?: string }) {
  if (sport === 'tennis' && tours.length) {
    return (
      <>
        {tours.map((t) => (
          <img key={t} src={TOUR_LOGOS[t]} alt={t} className={`${className} flex-shrink-0 object-contain`} />
        ))}
      </>
    );
  }
  if (sport === 'tennis') {
    return (
      <svg viewBox="0 0 24 24" className={`${className} flex-shrink-0`} aria-hidden>
        <circle cx="12" cy="12" r="10.5" fill="#d4e83a" stroke="#a3b52a" strokeWidth="1" />
        <path d="M4.2 5.2a10 10 0 0 1 0 13.6M19.8 5.2a10 10 0 0 0 0 13.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  const src = SPORT_LOGOS[sport];
  if (!src) return null;
  return <img src={src} alt="" aria-hidden className={`${className} flex-shrink-0 object-contain`} />;
}

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

type TennisInfo = {
  tours: Record<string, TennisTour>;
  events: Record<string, { tour: TennisTour | null; names: Record<string, string> }>;
};

/** Swap api-tennis short names ("M. Karol") for full names, longest first so overlapping names don't clash. */
function withFullNames(text: string | null, names: Record<string, string> | undefined): string | null {
  if (!text || !names) return text;
  return Object.keys(names)
    .sort((a, b) => b.length - a.length)
    .reduce((out, short) => out.split(short).join(names[short]), text);
}

function displayLeg(leg: AiPickLeg, info: TennisInfo): AiPickLeg {
  if (leg.sport !== 'tennis') return leg;
  const names = info.events[leg.eventKey]?.names;
  return {
    ...leg,
    player: withFullNames(leg.player, names),
    team: withFullNames(leg.team, names),
    eventLabel: withFullNames(leg.eventLabel, names) ?? leg.eventLabel,
  };
}

/** Settled outcome for legs without a progress bar. A winner market's 1/0 is already in the status. */
function legOutcome(leg: AiPickLeg): string | null {
  if (leg.resultValue == null) return null;
  if (leg.market === 'spread' || leg.market === 'game_handicap') {
    return `Margin ${leg.resultValue > 0 ? '+' : ''}${leg.resultValue}`;
  }
  return null;
}

function LegBody({ leg, large = false }: { leg: AiPickLeg; large?: boolean }) {
  const who = legSubject(leg);
  const bet = legBet(leg);
  const outcome = legOutcome(leg);
  return (
    <>
      <div className={`font-semibold leading-snug text-gray-900 dark:text-white ${large ? 'text-base' : 'text-[15px]'}`}>
        {who || bet}
      </div>
      {who && <div className="mt-0.5 text-sm font-medium text-purple-600 dark:text-purple-300">{bet}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <span>{leg.eventLabel}</span>
        <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-500">
          <Clock className="h-3 w-3" />
          {fmtStart(leg.startsAt)}
        </span>
        {outcome && <span className="font-semibold text-gray-700 dark:text-gray-300">{outcome}</span>}
      </div>
      <LegProgress leg={leg} />
    </>
  );
}

const PROGRESS_TONE: Record<AiPickStatus, string> = {
  pending: 'bg-purple-500',
  win: 'bg-emerald-500',
  loss: 'bg-rose-500',
  push: 'bg-amber-500',
  void: 'bg-amber-500',
};

/** Sportsbet-style bar for over/under legs: fill to the result, tick at the line. */
function LegProgress({ leg }: { leg: AiPickLeg }) {
  if ((leg.side !== 'over' && leg.side !== 'under') || leg.line == null || leg.status === 'void') return null;
  const line = leg.line;
  const value = leg.resultValue;
  const max = Math.max(line, value ?? 0) * 1.25 || 1;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / max) * 100));
  const tone = PROGRESS_TONE[leg.status];
  return (
    <div className="mt-3">
      {value == null && (
        <div className="mb-2 flex justify-end text-[11px] text-gray-500 dark:text-gray-400">Awaiting result</div>
      )}
      <div className="relative mb-1 h-2 rounded-full bg-gray-200 dark:bg-white/10">
        {value != null && (
          <div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${pct(value)}%` }} />
        )}
        <div
          className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded bg-gray-500 dark:bg-gray-300"
          style={{ left: `${pct(line)}%` }}
          title={`Line ${line}`}
        />
        {value != null && (
          <span
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-px text-[11px] font-bold tabular-nums text-white ${tone}`}
            style={{ left: `${Math.min(94, Math.max(6, pct(value)))}%` }}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

const LEG_MARKER: Record<AiPickStatus, string> = {
  pending: 'bg-white text-gray-600 ring-1 ring-inset ring-gray-300 dark:bg-[#0f1a2b] dark:text-gray-300 dark:ring-white/20',
  win: 'bg-emerald-500 text-white',
  loss: 'bg-rose-500 text-white',
  push: 'bg-amber-500 text-white',
  void: 'bg-amber-500 text-white',
};

const SEGMENT_TONE: Record<AiPickStatus, string> = {
  pending: 'bg-gray-200 dark:bg-white/10',
  win: 'bg-emerald-500',
  loss: 'bg-rose-500',
  push: 'bg-amber-500',
  void: 'bg-amber-500',
};

function multiProgress(legs: AiPickLeg[]): string {
  const won = legs.filter((l) => l.status === 'win').length;
  const settled = legs.filter((l) => l.status !== 'pending').length;
  if (legs.some((l) => l.status === 'loss')) return 'Leg lost';
  if (settled === legs.length) return 'All legs settled';
  if (!settled) return `0 of ${legs.length} legs settled`;
  return `${won} of ${legs.length} legs won`;
}

/** Bet-slip view of a multi: one box, a segment per leg, and each leg's own status. */
function MultiSlip({ legs }: { legs: AiPickLeg[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/80 dark:border-white/[0.07]">
      <div className="flex items-center justify-between gap-3 bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
        <div className="flex flex-1 gap-1">
          {legs.map((l) => (
            <span key={l.id} className={`h-1.5 flex-1 rounded-full ${SEGMENT_TONE[l.status]}`} />
          ))}
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-gray-600 dark:text-gray-300">{multiProgress(legs)}</span>
      </div>
      <ol className="divide-y divide-gray-200/80 dark:divide-white/[0.06]">
        {legs.map((leg, i) => {
          const { Icon } = STATUS_META[leg.status];
          return (
            <li key={leg.id} className="flex items-start gap-3 px-3 py-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${LEG_MARKER[leg.status]}`}
              >
                {leg.status === 'pending' ? i + 1 : <Icon className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <div className="min-w-0 flex-1">
                <LegBody leg={leg} />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-gray-700 dark:bg-white/5 dark:text-gray-200">
                  @ {leg.price.toFixed(2)}
                </span>
                <StatusPill status={leg.status} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const ALT_BOOKS_SHOWN = 6;

/** Other books that priced every leg when the pick was posted, so users don't have to hunt for it. */
function AltBooks({ books, isMulti }: { books: AiPick['altBooks']; isMulti: boolean }) {
  const [open, setOpen] = useState(false);
  if (!books.length) return null;
  const shown = open ? books : books.slice(0, ALT_BOOKS_SHOWN);
  const hidden = books.length - shown.length;
  return (
    <div className="mx-4 -mt-2 mb-4 rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {isMulti ? 'Multi also available at' : 'Also available at'}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {shown.map((b) => (
          <span
            key={b.book}
            title={isMulti ? `Legs @ ${b.legs.map((p) => p.toFixed(2)).join(' x ')}` : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200 dark:bg-white/5 dark:text-gray-200 dark:ring-white/10"
          >
            <BookmakerLogo bookKey={b.book} className="h-3.5 w-3.5 shrink-0 rounded object-contain" />
            {getBookmakerInfo(b.book).name}
            <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{b.price.toFixed(2)}</span>
          </span>
        ))}
        {books.length > ALT_BOOKS_SHOWN && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-2 py-1 text-xs font-semibold text-purple-600 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-white/5"
          >
            {open ? 'Show less' : `+${hidden} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function pickTours(pick: AiPick, info: TennisInfo): TennisTour[] {
  const found = pick.legs
    .filter((l) => l.sport === 'tennis')
    .map((l) => info.events[l.eventKey]?.tour ?? (l.playerId ? info.tours[l.playerId] : undefined));
  return (['ATP', 'WTA'] as const).filter((t) => found.includes(t));
}

/** The member's own marker for "I have this bet on"; it changes nothing else on the card or the record. */
function AddedButton({ added, onToggle }: { added: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={added}
      title={added ? 'Highlighted for you. Tap to remove.' : 'Highlight a bet you have on'}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-colors ${
        added
          ? 'bg-orange-50 text-orange-700 ring-orange-500/30 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/30 dark:hover:bg-orange-500/20'
          : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50 dark:bg-transparent dark:text-gray-300 dark:ring-white/15 dark:hover:bg-white/5'
      }`}
    >
      {added ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Highlighter className="h-3 w-3" strokeWidth={2.5} />}
      {added ? 'Highlighted' : 'Highlight'}
    </button>
  );
}

function PickCard({
  pick,
  info,
  added,
  onToggleAdded,
  flash = false,
}: {
  pick: AiPick;
  info: TennisInfo;
  added: boolean;
  /** Missing when the member can't mark picks (signed out, or before the table exists). */
  onToggleAdded?: (pickId: string) => void;
  /** Briefly outlined after a pick alert opens the feed on this card. */
  flash?: boolean;
}) {
  const settled = pick.status !== 'pending';
  const profit = pick.profitUnits ?? 0;
  const isMulti = pick.kind === 'multi';
  const book = getBookmakerInfo(pick.bookmaker).name;
  const legs = pick.legs.map((l) => displayLeg(l, info));
  const single = legs[0];

  return (
    <article
      id={`pick-${pick.id}`}
      className={`relative overflow-hidden rounded-2xl border shadow-sm outline-offset-2 transition-[outline-color] duration-700 ${
        flash ? 'outline-2 outline-purple-500' : 'outline-2 outline-transparent'
      } ${
        added
          ? 'border-orange-400 bg-orange-50/60 ring-1 ring-orange-400/60 dark:border-orange-500/60 dark:bg-orange-500/[0.06] dark:ring-orange-500/40'
          : 'border-gray-200/80 bg-white dark:border-white/[0.07] dark:bg-[#0f1a2b]'
      }`}
    >
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
        <div className="flex shrink-0 items-center gap-1.5">
          {onToggleAdded && <AddedButton added={added} onToggle={() => onToggleAdded(pick.id)} />}
          <StatusPill status={pick.status} />
        </div>
      </div>

      <div className="px-4 pb-3 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-300">
          <SportLogo sport={pick.sport} tours={pickTours(pick, info)} />
          {SPORT_LABELS[pick.sport] ?? pick.sport}
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="text-gray-500 dark:text-gray-400">{isMulti ? `${pick.legs.length}-leg multi` : 'Single'}</span>
        </div>

        {!isMulti && single ? (
          <LegBody leg={single} large />
        ) : (
          <MultiSlip legs={legs} />
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
      <AltBooks books={pick.altBooks} isMulti={isMulti} />
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

/** Shown to everyone but the admin until AI picks are made public. */
export function AiPicksLearningPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
      <div className="w-full max-w-md rounded-2xl border border-purple-300/60 bg-white p-6 shadow-sm dark:border-purple-500/30 dark:bg-[#111c2d]">
        <div className="flex items-center justify-center gap-2">
          <img src={AI_PICKS_AVATAR} alt="" className="h-10 w-10 rounded-full object-cover" />
          <span className="flex items-center gap-1 text-base font-semibold text-gray-900 dark:text-white">
            {AI_PICKS_NAME}
            <Sparkles className="h-4 w-4 text-purple-500" aria-label="AI" />
          </span>
        </div>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
          <Loader2 className="h-3 w-3 animate-spin" />
          Learning phase
        </span>
        <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">Stattrackr AI is still learning</h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          It is posting and grading picks behind the scenes while it learns from every result. Picks will open here once it has built a proven track record.
        </p>
        <ul className="mt-4 space-y-2 text-left text-sm text-gray-700 dark:text-gray-300">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
            Scans NBL, NBA and tennis lines across every bookmaker
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
            Only posts when it finds a play worth taking
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
            Grades every pick and learns from the results
          </li>
        </ul>
      </div>
    </div>
  );
}

type Tab = 'pending' | 'resulted';
type SortKey = 'units-desc' | 'units-asc' | 'placed-recent' | 'next-up';

/** User-facing sort modes for the picks feed filter button. */

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'units-desc', label: 'Units high to low' },
  { id: 'units-asc', label: 'Units low to high' },
  { id: 'placed-recent', label: 'Placed most recently' },
  { id: 'next-up', label: 'Next up' },
];

/** Resulted picks have already been played, so "Next up" only applies to pending. */
const TAB_SORTS: Record<Tab, { default: SortKey; options: SortKey[] }> = {
  pending: { default: 'next-up', options: ['units-desc', 'units-asc', 'placed-recent', 'next-up'] },
  resulted: { default: 'placed-recent', options: ['units-desc', 'units-asc', 'placed-recent'] },
};

const time = (iso: string | null | undefined): number => {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : 0;
};

/** Earliest leg start — used for "Next up" (closest bet time). */
const nextUpAt = (pick: AiPick): number => {
  const fromFirst = time(pick.firstStartsAt);
  if (fromFirst) return fromFirst;
  const legStarts = pick.legs.map((l) => time(l.startsAt)).filter((t) => t > 0);
  if (legStarts.length) return Math.min(...legStarts);
  return time(pick.postedAt);
};

function sortPicks(picks: AiPick[], sort: SortKey): AiPick[] {
  const list = [...picks];
  switch (sort) {
    case 'units-desc':
      return list.sort((a, b) => b.units - a.units || time(b.postedAt) - time(a.postedAt));
    case 'units-asc':
      return list.sort((a, b) => a.units - b.units || time(b.postedAt) - time(a.postedAt));
    case 'placed-recent':
      return list.sort((a, b) => time(b.postedAt) - time(a.postedAt));
    case 'next-up':
      return list.sort((a, b) => nextUpAt(a) - nextUpAt(b) || time(b.postedAt) - time(a.postedAt));
  }
}

function tabOrder(picks: AiPick[], tab: Tab, sort: SortKey): AiPick[] {
  const filtered =
    tab === 'pending' ? picks.filter((p) => p.status === 'pending') : picks.filter((p) => p.status !== 'pending');
  return sortPicks(filtered, sort);
}

function PicksSortButton({
  sort,
  options,
  onChange,
}: {
  sort: SortKey;
  options: SortKey[];
  onChange: (next: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = SORT_OPTIONS.find((o) => o.id === sort)?.label ?? 'Sort';

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-300 dark:hover:bg-[#162338]"
        title="Sort picks"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        <span className="max-w-[9.5rem] truncate">{active}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg dark:border-gray-700 dark:bg-[#0f1a2b]"
        >
          {SORT_OPTIONS.filter((o) => options.includes(o.id)).map((option) => {
            const selected = option.id === sort;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  selected
                    ? 'font-semibold text-purple-700 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                {option.label}
                {selected ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const RESULTED_PAGE = 10;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

export function AiPicksFeed() {
  const [picks, setPicks] = useState<AiPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pending');
  const [sport, setSport] = useState<string>('all');
  const [sorts, setSorts] = useState<Record<Tab, SortKey>>({
    pending: TAB_SORTS.pending.default,
    resulted: TAB_SORTS.resulted.default,
  });
  const sort = sorts[tab];

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

  // null: the member can't mark picks (signed out, or before migrations/ai_pick_added.sql is run).
  const [addedIds, setAddedIds] = useState<Set<string> | null>(null);
  const loadAdded = useCallback(async () => {
    setAddedIds(await fetchAddedPickIds().catch(() => null));
  }, []);
  useEffect(() => {
    void loadAdded();
    // Marked on another device (phone after an alert, then the PC).
    const onFocus = () => void loadAdded();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAdded]);
  const addedRef = useRef(addedIds);
  useEffect(() => {
    addedRef.current = addedIds;
  }, [addedIds]);
  const toggleAdded = useCallback((pickId: string) => {
    if (!addedRef.current) return;
    const next = !addedRef.current.has(pickId);
    const mark = (on: boolean) =>
      setAddedIds((prev) => {
        if (!prev) return prev;
        const updated = new Set(prev);
        if (on) updated.add(pickId);
        else updated.delete(pickId);
        return updated;
      });
    mark(next);
    setPickAdded(pickId, next).catch(() => mark(!next));
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

  const [tennisInfo, setTennisInfo] = useState<TennisInfo>({ tours: {}, events: {} });
  const tennisQuery = useMemo(() => {
    const legs = picks.flatMap((p) => p.legs).filter((l) => l.sport === 'tennis');
    if (!legs.length) return '';
    const ids = [...new Set(legs.map((l) => l.playerId).filter(Boolean))].sort().join(',');
    const events = [...new Set(legs.map((l) => `${l.eventKey}@${l.startsAt.slice(0, 10)}`))].sort().join(',');
    return `ids=${encodeURIComponent(ids)}&events=${encodeURIComponent(events)}`;
  }, [picks]);
  useEffect(() => {
    if (!tennisQuery) return;
    let cancelled = false;
    fetch(`/api/ai-picks/tennis-players?${tennisQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Partial<TennisInfo> | null) => {
        if (!cancelled && body) setTennisInfo({ tours: body.tours ?? {}, events: body.events ?? {} });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tennisQuery]);

  const sports = useMemo(() => [...new Set(picks.map((p) => p.sport))].sort(), [picks]);
  const inSport = useMemo(() => picks.filter((p) => sport === 'all' || p.sport === sport), [picks, sport]);
  const pendingCount = inSport.filter((p) => p.status === 'pending').length;
  const resultedCount = inSport.length - pendingCount;
  const ordered = useMemo(() => tabOrder(inSport, tab, sort), [inSport, tab, sort]);
  const [resultedLimit, setResultedLimit] = useState(RESULTED_PAGE);
  const shown = tab === 'resulted' ? ordered.slice(0, resultedLimit) : ordered;
  const hiddenCount = ordered.length - shown.length;

  const topRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (loading) return;
    const container = scrollParent(topRef.current);
    if (container) container.scrollTop = 0;
  }, [tab, sport, sort, loading]);

  // A pick alert opens /picks?pick=<id>: show that pick's tab, scroll to it and outline it briefly.
  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('pick')
  );
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId || loading) return;
    const target = picks.find((p) => p.id === focusId);
    setFocusId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('pick');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    if (!target) return;
    setSport('all');
    setTab(target.status === 'pending' ? 'pending' : 'resulted');
    setResultedLimit(Math.max(RESULTED_PAGE, picks.length));
    setScrollToId(target.id);
  }, [focusId, loading, picks]);
  useEffect(() => {
    if (!scrollToId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`pick-${scrollToId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashId(scrollToId);
      setScrollToId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToId]);
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(timer);
  }, [flashId]);

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

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'pending', label: 'Pending', count: pendingCount },
    { id: 'resulted', label: 'Resulted', count: resultedCount },
  ];

  return (
    <div ref={topRef} className="flex min-h-full flex-col gap-3">
      <div className="-mx-5 -mt-4 space-y-3 bg-white/95 px-5 pb-3 pt-4 backdrop-blur dark:bg-[#0f1a2b]/95 relative z-10 sm:sticky sm:-top-4">
        <RecordStrip picks={picks} />

        <div role="tablist" aria-label="Picks" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.04]">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(t.id);
                  setResultedLimit(RESULTED_PAGE);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-[#1a2740] dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {t.label}
                <span
                  className={`min-w-[1.25rem] rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums ${
                    active ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300'
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className={`flex flex-wrap items-center gap-2 ${sports.length > 1 ? 'justify-between' : 'justify-end'}`}>
          {sports.length > 1 ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {['all', ...sports].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSport(s);
                    setResultedLimit(RESULTED_PAGE);
                  }}
                  className={`${chip(sport === s)} inline-flex items-center gap-1`}
                >
                  {s !== 'all' && <SportLogo sport={s} tours={s === 'tennis' ? ['ATP', 'WTA'] : []} className="h-3 w-3" />}
                  {s === 'all' ? 'All sports' : SPORT_LABELS[s] ?? s}
                </button>
              ))}
            </div>
          ) : null}
          <PicksSortButton
            sort={sort}
            options={TAB_SORTS[tab].options}
            onChange={(next) => {
              setSorts((prev) => ({ ...prev, [tab]: next }));
              setResultedLimit(RESULTED_PAGE);
            }}
          />
        </div>
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
              ? "No picks yet. Stattrackr AI watches NBL, NBA and tennis lines through the day and only posts when it finds a play worth taking."
              : tab === 'pending'
                ? 'No pending picks right now. New plays show up here as soon as they are posted.'
                : 'No resulted picks yet.'}
          </p>
        </div>
      ) : (
        <>
          {shown.map((pick) => (
            <PickCard
              key={pick.id}
              pick={pick}
              info={tennisInfo}
              added={addedIds?.has(pick.id) ?? false}
              onToggleAdded={addedIds ? toggleAdded : undefined}
              flash={flashId === pick.id}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setResultedLimit((n) => n + RESULTED_PAGE)}
              className="mx-auto rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-[#111c2d] dark:text-gray-200 dark:hover:bg-[#162338]"
            >
              Show {Math.min(RESULTED_PAGE, hiddenCount)} more
              <span className="ml-1.5 font-normal text-gray-500 dark:text-gray-400">({hiddenCount} left)</span>
            </button>
          )}
        </>
      )}

      <PicksDisclaimer />
    </div>
  );
}

function PicksDisclaimer() {
  const link = 'font-medium text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white';
  return (
    <p className="mt-auto border-t border-gray-200 pt-4 text-center text-[11px] leading-relaxed text-gray-500 dark:border-white/[0.07] dark:text-gray-400">
      Stattrackr AI picks are generated automatically from statistical models and are provided for information and
      entertainment only. They are not financial or betting advice, and past results do not guarantee future results. You
      must be 18+ to bet. Only bet what you can afford to lose. If gambling is causing you harm, call Gambling Help Online on{' '}
      <a href="tel:1800858858" className={link}>
        1800 858 858
      </a>{' '}
      or visit{' '}
      <a href="https://www.gamblinghelponline.org.au" target="_blank" rel="noopener noreferrer" className={link}>
        gamblinghelponline.org.au
      </a>
      .
    </p>
  );
}

export default AiPicksFeed;
