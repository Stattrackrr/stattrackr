'use client';

/**
 * Betting Tools board — arb / middles / EV / bonus flipper from Redis odds boards.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { AflPropsPlayerAvatar } from '@/components/AflPropsPlayerAvatar';
import { TOOLS_SOFT_BOOKS, displayBook } from '@/lib/tools/books';
import { clientNbaLogo, clientNblLogo } from '@/lib/tools/mediaClient';
import type { ToolsBonusFlip, ToolsOpportunity, ToolsSport } from '@/lib/tools/types';
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

/** Per-tool palette so ALL / ARB / EV / MID / BF read as different products. */
const TOOL_THEME: Record<
  ToolCardId,
  {
    activeLight: string;
    idleHoverLight: string;
    glow: { bg: string; border: string; shadow: string };
    subtitleActive: string;
  }
> = {
  all: {
    activeLight: 'bg-slate-200 text-slate-900 border-slate-400 ring-2 ring-slate-300',
    idleHoverLight: 'hover:bg-slate-100 hover:border-slate-300',
    glow: {
      bg: '#1e293b',
      border: '#94a3b8',
      shadow: '0 0 0 2px #94a3b8, 0 0 22px rgba(148,163,184,0.9), 0 0 48px rgba(100,116,139,0.65)',
    },
    subtitleActive: 'text-slate-200',
  },
  arb: {
    activeLight: 'bg-emerald-100 text-emerald-900 border-emerald-400 ring-2 ring-emerald-300',
    idleHoverLight: 'hover:bg-emerald-50 hover:border-emerald-300',
    glow: {
      bg: '#064e3b',
      border: '#6ee7b7',
      shadow: '0 0 0 2px #6ee7b7, 0 0 22px rgba(52,211,153,0.95), 0 0 48px rgba(16,185,129,0.7)',
    },
    subtitleActive: 'text-emerald-100',
  },
  ev: {
    activeLight: 'bg-amber-100 text-amber-950 border-amber-400 ring-2 ring-amber-300',
    idleHoverLight: 'hover:bg-amber-50 hover:border-amber-300',
    glow: {
      bg: '#78350f',
      border: '#fcd34d',
      shadow: '0 0 0 2px #fcd34d, 0 0 22px rgba(251,191,36,0.95), 0 0 48px rgba(245,158,11,0.7)',
    },
    subtitleActive: 'text-amber-100',
  },
  middles: {
    activeLight: 'bg-sky-100 text-sky-950 border-sky-400 ring-2 ring-sky-300',
    idleHoverLight: 'hover:bg-sky-50 hover:border-sky-300',
    glow: {
      bg: '#0c4a6e',
      border: '#7dd3fc',
      shadow: '0 0 0 2px #7dd3fc, 0 0 22px rgba(56,189,248,0.95), 0 0 48px rgba(14,165,233,0.7)',
    },
    subtitleActive: 'text-sky-100',
  },
  bonus: {
    activeLight: 'bg-fuchsia-100 text-fuchsia-950 border-fuchsia-400 ring-2 ring-fuchsia-300',
    idleHoverLight: 'hover:bg-fuchsia-50 hover:border-fuchsia-300',
    glow: {
      bg: '#701a75',
      border: '#f0abfc',
      shadow: '0 0 0 2px #f0abfc, 0 0 22px rgba(232,121,249,0.95), 0 0 48px rgba(217,70,239,0.7)',
    },
    subtitleActive: 'text-fuchsia-100',
  },
};

function toolCardClass(id: ToolCardId, active: boolean, isDark: boolean): string {
  const theme = TOOL_THEME[id];
  const base =
    'flex-1 min-w-0 px-3 py-2.5 lg:min-w-[140px] lg:px-6 lg:py-3 rounded-xl lg:rounded-lg text-sm font-semibold border transition-all duration-200 flex flex-col items-center justify-center gap-0.5';
  if (active) {
    return isDark
      ? `${base} text-white border-transparent scale-[1.04] z-[1]`
      : `${base} ${theme.activeLight}`;
  }
  return isDark
    ? `${base} bg-[#152238] text-gray-300 border-white/15 opacity-90 hover:opacity-100 hover:border-white/30 hover:bg-[#1a2c44]`
    : `${base} bg-white text-gray-600 border-gray-300 ${theme.idleHoverLight}`;
}

function toolCardGlow(id: ToolCardId, active: boolean): CSSProperties | undefined {
  if (!active) return undefined;
  const g = TOOL_THEME[id].glow;
  return {
    backgroundColor: g.bg,
    borderColor: g.border,
    boxShadow: g.shadow,
  };
}

const KIND_META = {
  arb: {
    label: 'ARB',
    chip: 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/45',
    chipLight: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
    edge: 'text-emerald-300',
    edgeLight: 'text-emerald-700',
    card: 'border-emerald-500/25 bg-gradient-to-b from-emerald-500/12 to-white/[0.03]',
    cardLight: 'border-emerald-200 bg-gradient-to-b from-emerald-50 to-white shadow-sm',
    leg: 'border-emerald-400/20 bg-emerald-950/30',
    legLight: 'border-emerald-100 bg-emerald-50/70',
  },
  ev: {
    label: 'EV',
    chip: 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/45',
    chipLight: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
    edge: 'text-amber-300',
    edgeLight: 'text-amber-700',
    card: 'border-amber-500/25 bg-gradient-to-b from-amber-500/12 to-white/[0.03]',
    cardLight: 'border-amber-200 bg-gradient-to-b from-amber-50 to-white shadow-sm',
    leg: 'border-amber-400/20 bg-amber-950/25',
    legLight: 'border-amber-100 bg-amber-50/70',
  },
  middles: {
    label: 'MID',
    chip: 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/45',
    chipLight: 'bg-sky-50 text-sky-900 ring-1 ring-sky-200',
    edge: 'text-sky-300',
    edgeLight: 'text-sky-700',
    card: 'border-sky-500/25 bg-gradient-to-b from-sky-500/12 to-white/[0.03]',
    cardLight: 'border-sky-200 bg-gradient-to-b from-sky-50 to-white shadow-sm',
    leg: 'border-sky-400/20 bg-sky-950/30',
    legLight: 'border-sky-100 bg-sky-50/70',
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
      <div className="mt-4 flex items-center gap-3">
        <ToolsSideAvatarRetry
          sport={sport}
          name={subjectName}
          provided={subjectImageUrl}
          isDark={isDark}
        />
        <div className="min-w-0 flex-1">
          <h2 className={`truncate text-lg font-semibold tracking-tight sm:text-xl ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {market}
          </h2>
          <p className={`mt-0.5 truncate text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{match}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-center gap-3">
      <ToolsSideAvatarRetry sport={sport} name={homeName} provided={homeImageUrl} isDark={isDark} />
      <div className="min-w-0 flex-1">
        <h2 className={`truncate text-lg font-semibold tracking-tight sm:text-xl ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {match}
        </h2>
        <p className={`mt-0.5 text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{market}</p>
      </div>
      <ToolsSideAvatarRetry sport={sport} name={awayName} provided={awayImageUrl} isDark={isDark} />
    </div>
  );
}

export function ToolsBoard({ isDark, isAdmin }: { isDark: boolean; isAdmin: boolean }) {
  const [tab, setTab] = useState<BoardTab>('all');
  const [middleSort, setMiddleSort] = useState<MiddleSort>('best');
  const [ops, setOps] = useState<ToolsOpportunity[]>([]);
  const [flips, setFlips] = useState<ToolsBonusFlip[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminRequired, setAdminRequired] = useState(false);

  const [bonusAmount, setBonusAmount] = useState('50');
  const [bonusBook, setBonusBook] = useState<string>('sportsbet');
  const [heldBooks, setHeldBooks] = useState<string[]>(['sportsbet', 'pointsbet', 'tab', 'unibet']);
  const [bonusScanned, setBonusScanned] = useState(false);

  const muted = isDark ? 'text-slate-400' : 'text-gray-500';
  const card = isDark
    ? 'border-fuchsia-500/25 bg-gradient-to-b from-fuchsia-500/12 to-white/[0.03]'
    : 'border-fuchsia-200 bg-gradient-to-b from-fuchsia-50 to-white shadow-sm';
  const pillIdle = isDark
    ? 'bg-fuchsia-500/10 text-fuchsia-100 ring-1 ring-fuchsia-400/25 hover:bg-fuchsia-500/20'
    : 'bg-fuchsia-50 text-fuchsia-900 ring-1 ring-fuchsia-200 hover:bg-fuchsia-100';

  // Always pull the full board once; tabs only filter client-side so switches stay instant.
  const loadOpportunities = useCallback(async () => {
    setBoardLoading(true);
    setError(null);
    setAdminRequired(false);
    try {
      const qs = new URLSearchParams({ sport: 'all', kind: 'all' });
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
      setOps(Array.isArray(json.opportunities) ? json.opportunities : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tools.');
      setOps([]);
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
    if (!isAdmin) {
      setAdminRequired(true);
      return;
    }
    void loadOpportunities();
  }, [isAdmin, loadOpportunities]);

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

  if (!isAdmin || adminRequired) {
    return (
      <div className={`rounded-3xl border px-6 py-16 text-center ${card}`}>
        <p className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Admin only</p>
        <p className={`mx-auto mt-2 max-w-md text-sm ${muted}`}>
          Betting tools are limited to StatTrackr admin accounts for now.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-24 lg:pb-8">
      {/* Header selectors — same single-row layout as sport cards on /props */}
      <div
        className={`mb-4 flex gap-2 lg:gap-3 py-3 px-1 rounded-2xl lg:rounded-none border lg:border-0 overflow-visible ${
          isDark ? 'bg-[#050d1a] border-white/10 lg:border-transparent' : 'bg-gray-50 border-gray-200'
        }`}
      >
        {TOOL_CARDS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleToolCard(t.id)}
              className={toolCardClass(t.id, active, isDark)}
              style={toolCardGlow(t.id, active)}
              aria-label={t.title}
              aria-pressed={active}
              title={t.title}
            >
              <span className="text-base font-bold tracking-[0.1em] lg:text-lg">{t.short}</span>
              <span
                className={`text-[10px] font-medium tracking-wide ${
                  active ? TOOL_THEME[t.id].subtitleActive : 'opacity-70'
                }`}
              >
                {t.title}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          disabled={loading}
          onClick={() => (tab === 'bonus' ? void loadBonus() : void loadOpportunities())}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${pillIdle} disabled:opacity-50`}
        >
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {tab === 'middles' ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {MIDDLE_SORTS.map((s) => {
            const active = middleSort === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setMiddleSort(s.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? isDark
                      ? 'bg-sky-400/20 text-sky-100 ring-1 ring-sky-300/50'
                      : 'bg-sky-100 text-sky-900 ring-1 ring-sky-300'
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
        <div
          className={`rounded-3xl border border-dashed px-6 py-16 text-center text-sm ${
            isDark ? 'border-purple-500/20 text-slate-500' : 'border-purple-200 text-gray-500'
          }`}
        >
          Loading opportunities from the odds board…
        </div>
      ) : boardOps.length === 0 ? (
        <div
          className={`rounded-3xl border border-dashed px-6 py-16 text-center text-sm ${
            isDark ? 'border-purple-500/20 text-slate-500' : 'border-purple-200 text-gray-500'
          }`}
        >
          No opportunities right now. Try Refresh.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {boardOps.map((op) => (
            <OpportunityCard key={op.id} op={op} isDark={isDark} />
          ))}
        </div>
      )}
    </div>
  );
}

const STAT_TILE: Record<
  ToolsOpportunity['kind'],
  { borderDark: string; borderLight: string; labelDark: string; labelLight: string }
> = {
  arb: {
    borderDark: 'border-emerald-400/15 bg-emerald-400/[0.06]',
    borderLight: 'border-emerald-200 bg-emerald-50',
    labelDark: 'text-emerald-200/70',
    labelLight: 'text-emerald-700/70',
  },
  ev: {
    borderDark: 'border-amber-400/15 bg-amber-400/[0.06]',
    borderLight: 'border-amber-200 bg-amber-50',
    labelDark: 'text-amber-200/70',
    labelLight: 'text-amber-800/70',
  },
  middles: {
    borderDark: 'border-sky-400/15 bg-sky-400/[0.06]',
    borderLight: 'border-sky-200 bg-sky-50',
    labelDark: 'text-sky-200/70',
    labelLight: 'text-sky-700/70',
  },
};

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
  const tile = STAT_TILE[op.kind];
  const stats = cardStats(op);
  return (
    <article className={`rounded-3xl border p-5 sm:p-6 ${isDark ? meta.card : meta.cardLight}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.12em] ${isDark ? meta.chip : meta.chipLight}`}>
            {meta.label}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ${
              isDark ? 'bg-white/5 text-slate-300 ring-white/10' : 'bg-gray-50 text-gray-600 ring-gray-200'
            }`}
          >
            {sportLabel(op.sport)}
          </span>
        </div>
        <div className={`text-sm font-semibold ${isDark ? meta.edge : meta.edgeLight}`}>{op.edgeLabel}</div>
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
              className={`rounded-2xl border px-3 py-2.5 ${isDark ? tile.borderDark : tile.borderLight}`}
            >
              <div
                className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  isDark ? tile.labelDark : tile.labelLight
                }`}
              >
                {stat.label}
              </div>
              <div className={`mt-1 text-base font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2">
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
              className={`rounded-2xl border px-4 py-3 ${isDark ? meta.leg : meta.legLight}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <BookmakerLogo bookKey={leg.bookKey || leg.book} className="h-5 w-5 shrink-0 rounded object-contain" />
                  <span className={`truncate text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {leg.book} {leg.selection || op.market}
                  </span>
                </span>
                <span className={`shrink-0 text-lg font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
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
    ? 'border-fuchsia-400/25 bg-black/25 text-white focus:border-fuchsia-400/60'
    : 'border-fuchsia-200 bg-white text-gray-900 focus:border-fuchsia-400';
  const tileDark = 'border-fuchsia-400/15 bg-fuchsia-400/[0.06]';
  const tileLight = 'border-fuchsia-200 bg-fuchsia-50';
  const canScan = Number(amount) > 0 && heldBooks.some((b) => b !== bonusBook);

  return (
    <div className="space-y-5">
      <section className={`rounded-3xl border p-5 sm:p-6 ${card}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Bonus setup</h2>
            <p className={`mt-1 text-sm ${muted}`}>Amount, bonus book, then hedge books.</p>
          </div>
          <button
            type="button"
            disabled={loading || !canScan}
            onClick={onScan}
            className="rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-500 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Finding…' : 'Find flips'}
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${muted}`}>Bonus $</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none ${field}`}
            />
          </label>
          <label className="block sm:col-span-1">
            <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${muted}`}>Bonus book</span>
            <select
              value={bonusBook}
              onChange={(e) => setBonusBook(e.target.value)}
              className={`mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none ${field}`}
            >
              {TOOLS_SOFT_BOOKS.map((b) => (
                <option key={b} value={b} className={isDark ? 'bg-slate-900' : undefined}>
                  {displayBook(b)}
                </option>
              ))}
            </select>
          </label>
          <div className="block sm:col-span-1">
            <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${muted}`}>
              Hedge books · {heldBooks.filter((b) => b !== bonusBook).length} selected
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TOOLS_SOFT_BOOKS.filter((b) => b !== bonusBook).map((book) => {
                const on = heldBooks.includes(book);
                return (
                  <button
                    key={book}
                    type="button"
                    onClick={() => toggleHeld(book)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? isDark
                          ? 'bg-fuchsia-500/25 text-fuchsia-100 ring-1 ring-fuchsia-400/50'
                          : 'bg-fuchsia-100 text-fuchsia-900 ring-1 ring-fuchsia-300'
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
        <div className={`rounded-3xl border border-dashed px-6 py-12 text-center text-sm ${muted}`}>Finding flips…</div>
      ) : flips.length === 0 ? (
        <div className={`rounded-3xl border border-dashed px-6 py-12 text-center text-sm ${muted}`}>
          {scanned ? 'No flips with those hedge books right now.' : 'Set your bonus and tap Find flips.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {flips.map((flip) => {
            const hedgeStake = flip.hedgeLeg.stake ?? 0;
            const bonusStake = flip.bonusLeg.stake ?? (Number(amount) || 0);
            return (
              <article key={flip.id} className={`rounded-3xl border p-5 sm:p-6 ${card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.12em] ${
                        isDark
                          ? 'bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/40'
                          : 'bg-fuchsia-50 text-fuchsia-900 ring-1 ring-fuchsia-200'
                      }`}
                    >
                      BF
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ${
                        isDark ? 'bg-white/5 text-slate-300 ring-white/10' : 'bg-gray-50 text-gray-600 ring-gray-200'
                      }`}
                    >
                      {sportLabel(flip.league || flip.sport)}
                    </span>
                  </div>
                  <div className={`text-sm font-semibold ${isDark ? 'text-fuchsia-300' : 'text-fuchsia-800'}`}>
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
                      className={`rounded-2xl border px-3 py-2.5 ${isDark ? tileDark : tileLight}`}
                    >
                      <div
                        className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          isDark ? 'text-fuchsia-200/70' : 'text-fuchsia-800/70'
                        }`}
                      >
                        {stat.label}
                      </div>
                      <div className={`mt-1 text-base font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-2">
                  <div
                    className={`rounded-2xl border px-4 py-3 ${
                      isDark ? 'border-fuchsia-400/25 bg-fuchsia-500/15' : 'border-fuchsia-200 bg-fuchsia-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <BookmakerLogo
                          bookKey={flip.bonusLeg.bookKey || flip.bonusLeg.book}
                          className="h-5 w-5 shrink-0 rounded object-contain"
                        />
                        <span className={`truncate text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {flip.bonusLeg.book} {flip.bonusLeg.selection}
                        </span>
                      </span>
                      <span className={`shrink-0 text-lg font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {flip.bonusLeg.odds.toFixed(2)}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs tabular-nums ${isDark ? 'text-fuchsia-100/70' : 'text-fuchsia-800/80'}`}>
                      Bonus stake ${Number(bonusStake).toFixed(0)}
                    </div>
                  </div>

                  <div
                    className={`rounded-2xl border px-4 py-3 ${
                      isDark ? 'border-fuchsia-400/15 bg-black/25' : 'border-fuchsia-100 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <BookmakerLogo
                          bookKey={flip.hedgeLeg.bookKey || flip.hedgeLeg.book}
                          className="h-5 w-5 shrink-0 rounded object-contain"
                        />
                        <span className={`truncate text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {flip.hedgeLeg.book} {flip.hedgeLeg.selection}
                        </span>
                      </span>
                      <span className={`shrink-0 text-lg font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>
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
