'use client';

/**
 * Betting Tools board — arb / middles / EV / bonus flipper from Redis odds boards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { AflPropsPlayerAvatar } from '@/components/AflPropsPlayerAvatar';
import { TOOLS_SOFT_BOOKS, displayBook } from '@/lib/tools/books';
import { readToolsOpsCache, writeToolsOpsCache } from '@/lib/tools/clientCache';
import { clientNbaLogo, clientNblLogo } from '@/lib/tools/mediaClient';
import type { ToolsBonusFlip, ToolsOpportunity } from '@/lib/tools/types';
import { supabase } from '@/lib/supabaseClient';

/** Mirror scan qualityScore so All can re-rank cached payloads client-side. */
function clientQuality(op: ToolsOpportunity): number {
  if (op.kind === 'arb') return 0.12 + op.edge * 8;
  if (op.kind === 'middles') {
    if (op.middleExpected != null) return op.middleExpected / 100;
    return op.edge;
  }
  return op.edge;
}

type BoardTab = 'all' | 'arb' | 'middles' | 'ev' | 'bonus';
type ToolCardId = 'all' | 'arb' | 'ev' | 'middles' | 'bonus';
type MiddleSort = 'best' | 'gap' | 'risk' | 'profit';

const MIDDLE_SORTS: { id: MiddleSort; label: string }[] = [
  { id: 'best', label: 'Best overall' },
  { id: 'gap', label: 'Largest gap' },
  { id: 'risk', label: 'Lowest risk' },
  { id: 'profit', label: 'Highest profit' },
];

function compareMiddlesClient(a: ToolsOpportunity, b: ToolsOpportunity, sort: MiddleSort): number {
  if (sort === 'gap') {
    return (b.middleWidth ?? 0) - (a.middleWidth ?? 0) || clientQuality(b) - clientQuality(a);
  }
  if (sort === 'risk') {
    return (a.middleRisk ?? 999) - (b.middleRisk ?? 999) || (b.middleCollect ?? 0) - (a.middleCollect ?? 0);
  }
  if (sort === 'profit') {
    return (b.middleCollect ?? 0) - (a.middleCollect ?? 0) || (a.middleRisk ?? 999) - (b.middleRisk ?? 999);
  }
  // best = expected $ (gap × payoff vs risk)
  return clientQuality(b) - clientQuality(a) || (b.middleWidth ?? 0) - (a.middleWidth ?? 0);
}

/** Top cards — All first (like props combined), then each tool. */
const TOOL_CARDS: { id: ToolCardId; short: string; title: string }[] = [
  { id: 'all', short: 'ALL', title: 'Best first' },
  { id: 'arb', short: 'ARB', title: 'Arbitrage' },
  { id: 'ev', short: 'EV', title: 'Positive EV' },
  { id: 'middles', short: 'MID', title: 'Middles' },
  { id: 'bonus', short: 'BF', title: 'Bonus Flipper' },
];

const KIND_META = {
  arb: {
    label: 'ARB',
    chip: 'bg-emerald-500/15 text-emerald-300',
    chipLight: 'bg-emerald-50 text-emerald-800',
    edge: 'text-emerald-300',
    edgeLight: 'text-emerald-700',
    card: 'border-white/10 bg-[#0a1524]',
    cardLight: 'border-gray-200 bg-white',
    leg: 'border-white/10 bg-black/25',
    legLight: 'border-gray-100 bg-gray-50',
  },
  ev: {
    label: 'EV',
    chip: 'bg-amber-500/15 text-amber-300',
    chipLight: 'bg-amber-50 text-amber-900',
    edge: 'text-amber-300',
    edgeLight: 'text-amber-700',
    card: 'border-white/10 bg-[#0a1524]',
    cardLight: 'border-gray-200 bg-white',
    leg: 'border-white/10 bg-black/25',
    legLight: 'border-gray-100 bg-gray-50',
  },
  middles: {
    label: 'MID',
    chip: 'bg-sky-500/15 text-sky-300',
    chipLight: 'bg-sky-50 text-sky-900',
    edge: 'text-sky-300',
    edgeLight: 'text-sky-700',
    card: 'border-white/10 bg-[#0a1524]',
    cardLight: 'border-gray-200 bg-white',
    leg: 'border-white/10 bg-black/25',
    legLight: 'border-gray-100 bg-gray-50',
  },
} as const;

function sportLabel(sport: string) {
  const s = String(sport || '').trim();
  if (!s) return '';
  if (
    s === 'nbl' ||
    s === 'nba' ||
    s === 'nfl' ||
    s === 'ncaaf' ||
    s === 'nhl' ||
    s === 'mlb' ||
    s === 'afl' ||
    s === 'nrl' ||
    s === 'ufc' ||
    s === 'wnba'
  ) {
    return s.toUpperCase();
  }
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Pull tennis player id from a scan-provided image path. */
function tennisIdFromUrl(url: string | null | undefined): string | null {
  const raw = String(url || '');
  const api = raw.match(/\/api\/tennis\/headshot\/([^/?#]+)/i);
  if (api?.[1]) return decodeURIComponent(api[1]);
  const file = raw.match(/\/images\/tennis\/headshots\/([^/?#]+)\.(?:jpg|jpeg|png|webp)/i);
  if (file?.[1]) return decodeURIComponent(file[1]);
  return null;
}

/**
 * Candidate URLs for a tools avatar. Tennis always prefers the sniffed API route
 * (correct Content-Type under nosniff); static /images is a fallback only.
 * Retries absorb flaky loads when many cards mount at once across tab switches.
 */
function toolsAvatarCandidates(
  sport: string,
  name: string,
  provided: string | null | undefined
): string[] {
  const label = name.trim();
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    const v = String(u || '').trim();
    if (!v || out.includes(v)) return;
    out.push(v);
  };

  // Prefer an explicit URL (player headshot CDN, static file, API).
  // Ignore stale generic NBL league mark from older scans.
  if (!(sport === 'nbl' && /\/images\/nbl-logo\.png/i.test(String(provided || '')))) {
    push(provided);
  }

  if (sport === 'tennis') {
    const id = tennisIdFromUrl(provided);
    if (id) push(`/api/tennis/headshot/${encodeURIComponent(id)}`);
    if (label.length >= 2) {
      push(`/api/tools/side-image?sport=tennis&name=${encodeURIComponent(label)}`);
    }
    if (id) {
      push(`/images/tennis/headshots/${encodeURIComponent(id)}.jpg`);
      push(`/images/tennis/headshots/${encodeURIComponent(id)}.png`);
    }
    if (provided?.startsWith('/images/')) push(provided.split('?')[0]!);
    return out;
  }

  // NBA player headshots are https CDN — don't fall back to a team logo for person names.
  if (sport === 'nba' && provided?.includes('cdn.nba.com/headshots')) return out;
  if (sport === 'nba') push(clientNbaLogo(label));
  if (sport === 'nbl') {
    push(clientNblLogo(label));
    if (label.length >= 2) {
      push(`/api/tools/side-image?sport=nbl&name=${encodeURIComponent(label)}`);
    }
  }
  return out;
}

/** Walks candidate URLs when a load fails (tab-switch / connection churn). */
function ToolsSideAvatarRetry({
  sport,
  name,
  provided,
  isDark,
}: {
  sport: string;
  name: string;
  provided: string | null | undefined;
  isDark: boolean;
}) {
  const candidates = useMemo(
    () => toolsAvatarCandidates(sport, name, provided),
    [sport, name, provided]
  );
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [candidates]);
  const src = !failed ? candidates[idx] ?? null : null;

  if (!src) {
    return (
      <AflPropsPlayerAvatar headshotUrl={null} jerseyNumber={null} isDark={isDark} mounted size="md" />
    );
  }

  return (
    <div
      className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 ${
        isDark ? 'border-gray-600 bg-gray-700' : 'border-gray-200 bg-gray-200'
      }`}
      title={name}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt=""
        className="h-full w-full object-cover object-top"
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          if (idx + 1 < candidates.length) setIdx((i) => i + 1);
          else setFailed(true);
        }}
      />
    </div>
  );
}

function MatchHeader({
  home,
  away,
  homeImageUrl,
  awayImageUrl,
  subjectName,
  subjectImageUrl,
  match,
  market,
  sport,
  isDark,
}: {
  home: string;
  away: string;
  homeImageUrl: string | null;
  awayImageUrl: string | null;
  subjectName?: string | null;
  subjectImageUrl?: string | null;
  match: string;
  market: string;
  sport: string;
  isDark: boolean;
}) {
  const homeName = home || match.split(/\s+vs\s+/i)[0]?.trim() || match;
  const awayName = away || match.split(/\s+vs\s+/i)[1]?.trim() || match;
  // Player props: one headshot + player market title; match stays as context.
  if (subjectName) {
    return (
      <div className="mt-3 flex items-center gap-3">
        <ToolsSideAvatarRetry
          sport={sport}
          name={subjectName}
          provided={subjectImageUrl}
          isDark={isDark}
        />
        <div className="min-w-0 flex-1">
          <h2 className={`truncate text-base font-semibold tracking-tight sm:text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {market}
          </h2>
          <p className={`mt-0.5 truncate text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{match}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-3">
      <ToolsSideAvatarRetry sport={sport} name={homeName} provided={homeImageUrl} isDark={isDark} />
      <div className="min-w-0 flex-1">
        <h2 className={`truncate text-base font-semibold tracking-tight sm:text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {match}
        </h2>
        <p className={`mt-0.5 text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{market}</p>
      </div>
      <ToolsSideAvatarRetry sport={sport} name={awayName} provided={awayImageUrl} isDark={isDark} />
    </div>
  );
}

export function ToolsBoard({
  isDark,
  isAdmin,
  authReady = true,
}: {
  isDark: boolean;
  isAdmin: boolean;
  authReady?: boolean;
}) {
  const [tab, setTab] = useState<BoardTab>('all');
  const [middleSort, setMiddleSort] = useState<MiddleSort>('best');
  const [ops, setOps] = useState<ToolsOpportunity[]>(() => readToolsOpsCache() ?? []);
  const [flips, setFlips] = useState<ToolsBonusFlip[]>([]);
  const [boardLoading, setBoardLoading] = useState(() => !(readToolsOpsCache()?.length));
  const [bonusLoading, setBonusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminRequired, setAdminRequired] = useState(false);
  const bootstrappedRef = useRef(false);
  const opsLenRef = useRef(0);
  opsLenRef.current = ops.length;

  const [bonusAmount, setBonusAmount] = useState('50');
  const [bonusBook, setBonusBook] = useState<string>('sportsbet');
  const [heldBooks, setHeldBooks] = useState<string[]>(['sportsbet', 'pointsbet', 'tab', 'unibet']);
  const [bonusScanned, setBonusScanned] = useState(false);

  const muted = isDark ? 'text-slate-400' : 'text-gray-500';
  const card = isDark ? 'border-white/10 bg-[#0a1524]' : 'border-gray-200 bg-white';
  const pillIdle = isDark
    ? 'bg-white/5 text-slate-300 hover:bg-white/10'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200';

  // Always pull the full board once; tabs only filter client-side so switches stay instant.
  const loadOpportunities = useCallback(async (opts?: { quiet?: boolean; fresh?: boolean }) => {
    const quiet = opts?.quiet === true;
    if (!quiet) setBoardLoading(true);
    setError(null);
    setAdminRequired(false);
    try {
      const qs = new URLSearchParams({ sport: 'all', kind: 'all' });
      if (opts?.fresh) qs.set('fresh', '1');
      const res = await fetch(`/api/tools/opportunities?${qs}`, {
        headers: await authHeaders(),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (res.status === 403 && (json?.adminRequired || json?.proRequired)) {
        setAdminRequired(true);
        setOps([]);
        return;
      }
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not load tools.');
      const next = Array.isArray(json.opportunities) ? (json.opportunities as ToolsOpportunity[]) : [];
      setOps(next);
      writeToolsOpsCache(next);
    } catch (e) {
      if (!quiet || !opsLenRef.current) {
        setError(e instanceof Error ? e.message : 'Could not load tools.');
      }
      if (!quiet) setOps([]);
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const loadBonus = useCallback(async () => {
    setBonusLoading(true);
    setError(null);
    setAdminRequired(false);
    try {
      const res = await fetch('/api/tools/bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          bonus: Number(bonusAmount),
          bonusBook,
          heldBooks,
          sport: 'all',
        }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (res.status === 403 && (json?.adminRequired || json?.proRequired)) {
        setAdminRequired(true);
        setFlips([]);
        return;
      }
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not load bonus flips.');
      setFlips(Array.isArray(json.flips) ? json.flips : []);
      setBonusScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bonus flips.');
      setFlips([]);
      setBonusScanned(true);
    } finally {
      setBonusLoading(false);
    }
  }, [bonusAmount, bonusBook, heldBooks]);

  useEffect(() => {
    if (!authReady) return;
    if (!isAdmin) {
      setAdminRequired(true);
      return;
    }
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void loadOpportunities({ quiet: opsLenRef.current > 0 });
  }, [authReady, isAdmin, loadOpportunities]);

  const boardOps = useMemo(() => {
    if (tab === 'bonus') return [];
    if (tab === 'middles') {
      return [...ops]
        .filter((o) => o.kind === 'middles')
        .sort((a, b) => compareMiddlesClient(a, b, middleSort) || a.startMs - b.startMs);
    }
    const ranked = (list: ToolsOpportunity[]) =>
      [...list].sort((a, b) => clientQuality(b) - clientQuality(a) || a.startMs - b.startMs);
    if (tab === 'arb' || tab === 'ev') {
      return ranked(ops.filter((o) => o.kind === tab));
    }
    return ranked(ops.filter((o) => o.kind === 'arb' || o.kind === 'middles' || o.kind === 'ev'));
  }, [ops, tab, middleSort]);

  const toggleHeld = (book: string) => {
    setHeldBooks((prev) => (prev.includes(book) ? prev.filter((b) => b !== book) : [...prev, book]));
  };

  const toggleToolCard = (id: ToolCardId) => {
    if (id === 'all') {
      setTab('all');
      return;
    }
    // Props pattern: tap active tool again → back to All.
    setTab((prev) => (prev === id ? 'all' : id));
  };

  const loading = tab === 'bonus' ? bonusLoading : boardLoading;

  if (!authReady) {
    return (
      <div className={`rounded-xl border px-6 py-14 text-center text-sm ${card} ${muted}`}>
        Opening tools…
      </div>
    );
  }

  if (!isAdmin || adminRequired) {
    return (
      <div className={`rounded-xl border px-6 py-14 text-center ${card}`}>
        <p className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Admin only</p>
        <p className={`mx-auto mt-2 max-w-md text-sm ${muted}`}>
          Betting tools are limited to StatTrackr admin accounts for now.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-24 lg:pb-8">
      <div
        className={`mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-3 ${
          isDark ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <nav className="-mb-px flex flex-wrap gap-1" aria-label="Tools">
          {TOOL_CARDS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleToolCard(t.id)}
                className={`relative px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? isDark
                      ? 'text-white'
                      : 'text-gray-900'
                    : isDark
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'text-gray-500 hover:text-gray-800'
                }`}
                aria-label={t.title}
                aria-pressed={active}
                title={t.title}
              >
                <span className="tracking-wide">{t.short}</span>
                {active ? (
                  <span
                    className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${
                      isDark ? 'bg-white' : 'bg-gray-900'
                    }`}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          disabled={loading}
          onClick={() => (tab === 'bonus' ? void loadBonus() : void loadOpportunities({ fresh: true }))}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${pillIdle} disabled:opacity-50`}
        >
          {loading ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      {tab === 'middles' ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {MIDDLE_SORTS.map((s) => {
            const active = middleSort === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setMiddleSort(s.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  active
                    ? isDark
                      ? 'bg-white/15 text-white'
                      : 'bg-gray-900 text-white'
                    : pillIdle
                }`}
                aria-pressed={active}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

      {tab === 'bonus' ? (
        <BonusFlipper
          isDark={isDark}
          card={card}
          muted={muted}
          pillIdle={pillIdle}
          amount={bonusAmount}
          setAmount={setBonusAmount}
          bonusBook={bonusBook}
          setBonusBook={setBonusBook}
          heldBooks={heldBooks}
          toggleHeld={toggleHeld}
          flips={flips}
          loading={loading}
          scanned={bonusScanned}
          onScan={() => void loadBonus()}
        />
      ) : loading && !boardOps.length ? (
        <div className={`rounded-xl border border-dashed px-6 py-14 text-center text-sm ${muted}`}>
          Loading board…
        </div>
      ) : boardOps.length === 0 ? (
        <div className={`rounded-xl border border-dashed px-6 py-14 text-center text-sm ${muted}`}>
          No opportunities right now. Try Refresh.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
          {boardOps.map((op) => (
            <OpportunityCard key={op.id} op={op} isDark={isDark} />
          ))}
        </div>
      )}
    </div>
  );
}

const STAT_TILE = {
  borderDark: 'border-white/10 bg-black/20',
  borderLight: 'border-gray-100 bg-gray-50',
  labelDark: 'text-slate-400',
  labelLight: 'text-gray-500',
} as const;

function cardStats(op: ToolsOpportunity): { label: string; value: string }[] {
  if (op.kind === 'middles' && op.middleCollect != null && op.middleRisk != null) {
    return [
      { label: 'Risk', value: `$${op.middleRisk.toFixed(0)}` },
      { label: 'Profit', value: `$${op.middleCollect.toFixed(0)}` },
      ...(op.middleWidth != null ? [{ label: 'Gap', value: op.middleWidth.toFixed(1) }] : []),
    ];
  }
  if (op.kind === 'arb') {
    // Use edge (equalised ROI) so Profit matches the locked % — not rounded leg stakes.
    const stakeTotal = op.legs.reduce((s, l) => s + (l.stake ?? 0), 0) || 100;
    const profit = Math.max(0, op.edge * stakeTotal);
    return [
      { label: 'Profit', value: `$${profit.toFixed(2)}` },
      { label: 'ROI', value: `${(op.edge * 100).toFixed(1)}%` },
      { label: 'Stake', value: `$${stakeTotal.toFixed(0)}` },
    ];
  }
  if (op.kind === 'ev') {
    const best = op.legs[0];
    return [
      { label: 'Edge', value: `${op.edge >= 0 ? '+' : ''}${(op.edge * 100).toFixed(1)}%` },
      ...(op.fairOdds != null ? [{ label: 'Fair', value: op.fairOdds.toFixed(2) }] : []),
      ...(best ? [{ label: 'Best', value: best.odds.toFixed(2) }] : []),
    ];
  }
  return [];
}

function OpportunityCard({ op, isDark }: { op: ToolsOpportunity; isDark: boolean }) {
  const meta = KIND_META[op.kind];
  const stats = cardStats(op);
  return (
    <article className={`rounded-xl border p-4 sm:p-5 ${isDark ? meta.card : meta.cardLight}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${isDark ? meta.chip : meta.chipLight}`}>
            {meta.label}
          </span>
          <span className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
            {sportLabel(op.sport)}
          </span>
        </div>
        <div className={`text-sm font-semibold tabular-nums ${isDark ? meta.edge : meta.edgeLight}`}>{op.edgeLabel}</div>
      </div>

      <MatchHeader
        home={op.home}
        away={op.away}
        homeImageUrl={op.homeImageUrl}
        awayImageUrl={op.awayImageUrl}
        subjectName={op.subjectName}
        subjectImageUrl={op.subjectImageUrl}
        match={op.match}
        market={op.market}
        sport={op.sport}
        isDark={isDark}
      />

      {stats.length ? (
        <div className={`mt-3 grid gap-2 ${stats.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              className={`rounded-lg border px-3 py-2 ${isDark ? STAT_TILE.borderDark : STAT_TILE.borderLight}`}
            >
              <div
                className={`text-[10px] font-medium uppercase tracking-wide ${
                  isDark ? STAT_TILE.labelDark : STAT_TILE.labelLight
                }`}
              >
                {stat.label}
              </div>
              <div className={`mt-0.5 text-sm font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-1.5">
        {op.legs.map((leg) => {
          const subtitle =
            leg.stake != null
              ? `Stake $${Number(leg.stake).toFixed(0)}`
              : leg.edge != null
                ? `${leg.edge >= 0 ? '+' : ''}${(leg.edge * 100).toFixed(1)}% edge`
                : null;
          return (
            <div
              key={`${leg.bookKey}-${leg.selection}-${leg.odds}`}
              className={`rounded-lg border px-3 py-2.5 ${isDark ? meta.leg : meta.legLight}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <BookmakerLogo bookKey={leg.bookKey || leg.book} className="h-5 w-5 shrink-0 rounded object-contain" />
                  <span className={`truncate text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {leg.book} {leg.selection || op.market}
                  </span>
                </span>
                <span className={`shrink-0 text-base font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {leg.odds.toFixed(2)}
                </span>
              </div>
              {subtitle ? (
                <div className={`mt-1 text-xs tabular-nums ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{subtitle}</div>
              ) : null}
              {op.kind === 'ev' && (op.sharp?.length || op.fairOdds != null) && leg === op.legs[0] ? (
                <div
                  className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums ${
                    isDark ? 'text-slate-400' : 'text-gray-500'
                  }`}
                >
                  {op.sharp?.map((s) => (
                    <span key={s.bookKey} className="inline-flex items-center gap-1.5">
                      <BookmakerLogo bookKey={s.bookKey} className="h-3.5 w-3.5 shrink-0 rounded object-contain" />
                      <span>
                        {s.book} {s.odds.toFixed(2)}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function BonusFlipper({
  isDark,
  card,
  muted,
  pillIdle,
  amount,
  setAmount,
  bonusBook,
  setBonusBook,
  heldBooks,
  toggleHeld,
  flips,
  loading,
  scanned,
  onScan,
}: {
  isDark: boolean;
  card: string;
  muted: string;
  pillIdle: string;
  amount: string;
  setAmount: (v: string) => void;
  bonusBook: string;
  setBonusBook: (v: string) => void;
  heldBooks: string[];
  toggleHeld: (book: string) => void;
  flips: ToolsBonusFlip[];
  loading: boolean;
  scanned: boolean;
  onScan: () => void;
}) {
  const field = isDark
    ? 'border-white/15 bg-black/25 text-white focus:border-white/35'
    : 'border-gray-200 bg-white text-gray-900 focus:border-gray-400';
  const canScan = Number(amount) > 0 && heldBooks.some((b) => b !== bonusBook);

  return (
    <div className="space-y-4">
      <section className={`rounded-xl border p-4 sm:p-5 ${card}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={`text-base font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Bonus setup</h2>
            <p className={`mt-0.5 text-sm ${muted}`}>Amount, bonus book, then hedge books.</p>
          </div>
          <button
            type="button"
            disabled={loading || !canScan}
            onClick={onScan}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              isDark ? 'bg-white text-gray-900 hover:bg-slate-100' : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {loading ? 'Finding…' : 'Find flips'}
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className={`text-[10px] font-medium uppercase tracking-wide ${muted}`}>Bonus $</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm outline-none ${field}`}
            />
          </label>
          <label className="block sm:col-span-1">
            <span className={`text-[10px] font-medium uppercase tracking-wide ${muted}`}>Bonus book</span>
            <select
              value={bonusBook}
              onChange={(e) => setBonusBook(e.target.value)}
              className={`mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm outline-none ${field}`}
            >
              {TOOLS_SOFT_BOOKS.map((b) => (
                <option key={b} value={b} className={isDark ? 'bg-slate-900' : undefined}>
                  {displayBook(b)}
                </option>
              ))}
            </select>
          </label>
          <div className="block sm:col-span-1">
            <span className={`text-[10px] font-medium uppercase tracking-wide ${muted}`}>
              Hedge books · {heldBooks.filter((b) => b !== bonusBook).length} selected
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TOOLS_SOFT_BOOKS.filter((b) => b !== bonusBook).map((book) => {
                const on = heldBooks.includes(book);
                return (
                  <button
                    key={book}
                    type="button"
                    onClick={() => toggleHeld(book)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? isDark
                          ? 'bg-white/15 text-white'
                          : 'bg-gray-900 text-white'
                        : pillIdle
                    }`}
                  >
                    {displayBook(book)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {loading && !flips.length ? (
        <div className={`rounded-xl border border-dashed px-6 py-12 text-center text-sm ${muted}`}>Finding flips…</div>
      ) : flips.length === 0 ? (
        <div className={`rounded-xl border border-dashed px-6 py-12 text-center text-sm ${muted}`}>
          {scanned ? 'No flips with those hedge books right now.' : 'Set your bonus and tap Find flips.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3">
          {flips.map((flip) => {
            const hedgeStake = flip.hedgeLeg.stake ?? 0;
            const bonusStake = flip.bonusLeg.stake ?? (Number(amount) || 0);
            return (
              <article key={flip.id} className={`rounded-xl border p-4 sm:p-5 ${card}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                        isDark ? 'bg-violet-500/15 text-violet-300' : 'bg-violet-50 text-violet-900'
                      }`}
                    >
                      BF
                    </span>
                    <span className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                      {sportLabel(flip.league || flip.sport)}
                    </span>
                  </div>
                  <div className={`text-sm font-semibold tabular-nums ${isDark ? 'text-slate-200' : 'text-gray-800'}`}>
                    {(flip.retention * 100).toFixed(1)}% convert
                  </div>
                </div>

                <MatchHeader
                  home={flip.home}
                  away={flip.away}
                  homeImageUrl={flip.homeImageUrl}
                  awayImageUrl={flip.awayImageUrl}
                  subjectName={flip.subjectName}
                  subjectImageUrl={flip.subjectImageUrl}
                  match={flip.match}
                  market={flip.market}
                  sport={flip.sport}
                  isDark={isDark}
                />

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Lock', value: `$${flip.cashOut.toFixed(0)}` },
                    { label: 'Keep', value: `${(flip.retention * 100).toFixed(0)}%` },
                    { label: 'Hedge $', value: `$${Number(hedgeStake).toFixed(0)}` },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className={`rounded-lg border px-3 py-2 ${isDark ? STAT_TILE.borderDark : STAT_TILE.borderLight}`}
                    >
                      <div
                        className={`text-[10px] font-medium uppercase tracking-wide ${
                          isDark ? STAT_TILE.labelDark : STAT_TILE.labelLight
                        }`}
                      >
                        {stat.label}
                      </div>
                      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-1.5">
                  <div className={`rounded-lg border px-3 py-2.5 ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <BookmakerLogo
                          bookKey={flip.bonusLeg.bookKey || flip.bonusLeg.book}
                          className="h-5 w-5 shrink-0 rounded object-contain"
                        />
                        <span className={`truncate text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {flip.bonusLeg.book} {flip.bonusLeg.selection}
                        </span>
                      </span>
                      <span className={`shrink-0 text-base font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {flip.bonusLeg.odds.toFixed(2)}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs tabular-nums ${muted}`}>
                      Bonus stake ${Number(bonusStake).toFixed(0)}
                    </div>
                  </div>

                  <div className={`rounded-lg border px-3 py-2.5 ${isDark ? 'border-white/10 bg-black/25' : 'border-gray-100 bg-white'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <BookmakerLogo
                          bookKey={flip.hedgeLeg.bookKey || flip.hedgeLeg.book}
                          className="h-5 w-5 shrink-0 rounded object-contain"
                        />
                        <span className={`truncate text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {flip.hedgeLeg.book} {flip.hedgeLeg.selection}
                        </span>
                      </span>
                      <span className={`shrink-0 text-base font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {flip.hedgeLeg.odds.toFixed(2)}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs tabular-nums ${muted}`}>
                      Cash hedge ${Number(hedgeStake).toFixed(0)}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
