'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Activity, ArrowDown, ArrowUp } from 'lucide-react';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { getBookmakerInfo } from '@/lib/bookmakers';
import { fetchJsonDeduped } from '@/lib/clientFetchDedupe';
import type { NblBookLineMovement, NblLineMovement } from '@/lib/nbl/lineMovement';

const STAT_LABELS: Record<string, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  threeMade: '3PT Made',
  pra: 'Pts + Reb + Ast',
  pr: 'Pts + Reb',
  pa: 'Pts + Ast',
  ra: 'Reb + Ast',
};

type LineChange = { book: string; from: number; to: number; at: string; fromOpen: boolean };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Each line change from the opening line on (price-only changes dropped). */
function lineChanges(book: NblBookLineMovement): LineChange[] {
  const changes: LineChange[] = [];
  let current = book.opening.line;
  for (const p of book.points) {
    if (p.line !== current) {
      changes.push({ book: book.book, from: current, to: p.line, at: p.at, fromOpen: changes.length === 0 });
      current = p.line;
    }
  }
  return changes;
}

export function NblLineMovementCard({
  isDark = false,
  playerName,
  playerTeam,
  opponentName,
  stat,
}: {
  isDark?: boolean;
  playerName: string | null;
  playerTeam: string | null;
  opponentName: string | null;
  stat: string;
}) {
  const [movement, setMovement] = useState<NblLineMovement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playerName || !playerTeam) {
      setMovement(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ player: playerName, team: playerTeam });
    if (opponentName) params.set('opponent', opponentName);
    fetchJsonDeduped<{ movement?: NblLineMovement | null; error?: string }>(`/api/nbl/line-movement?${params}`)
      .then((json) => {
        if (!cancelled) setMovement(json.movement ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setMovement(null);
          setError('Failed to load line movement');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerName, playerTeam, opponentName]);

  const posted = movement?.stats ?? [];
  const statLabel = STAT_LABELS[stat] ?? null;
  const selected = posted.find((s) => s.stat === stat);
  const changes = (selected?.books ?? [])
    .flatMap(lineChanges)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.book.localeCompare(b.book));

  let body: ReactNode;
  if (!playerName) {
    body = <Empty text="Select a player to see line movement" />;
  } else if (loading && !movement) {
    body = <Empty text="Loading line movement…" />;
  } else if (error) {
    body = <Empty text={error} tone="warn" />;
  } else if (!statLabel) {
    body = <Empty text="Line movement is available for points, rebounds, assists, threes and combos" />;
  } else if (!selected) {
    body = <Empty text={`No ${statLabel.toLowerCase()} over/under posted for ${playerName} yet`} />;
  } else if (!changes.length) {
    body = <Empty text={`No ${statLabel.toLowerCase()} line moves yet for ${playerName}`} />;
  } else {
    const movedBooks = selected.books
      .filter((b) => b.points.some((p) => p.line !== b.opening.line))
      .map((b) => ({ book: b.book, open: b.opening.line, now: b.current.line, net: b.current.line - b.opening.line }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.book.localeCompare(b.book));
    body = (
      <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 mb-4">
          {movedBooks.map((b) => (
            <div
              key={b.book}
              className={`relative overflow-hidden rounded-xl border p-2.5 ${
                isDark ? 'border-gray-700/70 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-[3px] ${
                  b.net > 0 ? 'bg-emerald-500' : b.net < 0 ? 'bg-rose-500' : 'bg-gray-500/50'
                }`}
              />
              <div className="flex items-center gap-2 min-w-0">
                <BookmakerLogo bookKey={b.book} className="w-6 h-6 rounded-md object-contain flex-shrink-0" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                  {getBookmakerInfo(b.book).name}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div className="flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{b.open}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">→</span>
                  <span className="text-lg font-bold leading-none text-gray-900 dark:text-white">{b.now}</span>
                </div>
                <NetMove net={b.net} isDark={isDark} />
              </div>
            </div>
          ))}
        </div>

        <div className="max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
          <ol className="relative">
            {changes.map((change, i) => {
              const up = change.to > change.from;
              const last = i === changes.length - 1;
              return (
                <li key={`${change.book}|${change.at}`} className="relative flex items-center gap-3 py-2 pl-5">
                  {!last && (
                    <span
                      aria-hidden
                      className={`absolute left-[5px] top-1/2 h-full w-px ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
                    />
                  )}
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1/2 -translate-y-1/2 w-[11px] h-[11px] rounded-full ring-2 ${
                      isDark ? 'ring-[#0f1e2e]' : 'ring-white'
                    } ${up ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                      <span className="text-gray-500 dark:text-gray-400 font-medium">{change.from}</span>
                      <MoveArrow up={up} />
                      <span>{change.to}</span>
                      {change.fromOpen && (
                        <span
                          className={`ml-1 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${
                            isDark ? 'bg-purple-500/15 text-purple-300' : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          From open
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{fmtTime(change.at)}</div>
                  </div>
                  <BookmakerLogo bookKey={change.book} className="w-7 h-7 rounded-md object-contain flex-shrink-0" />
                </li>
              );
            })}
          </ol>
        </div>
      </>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${
              isDark ? 'bg-purple-500/15 text-purple-300' : 'bg-purple-100 text-purple-700'
            }`}
          >
            <Activity className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">Line Movement</h3>
            {movement && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {movement.awayTeam} @ {movement.homeTeam}
              </div>
            )}
          </div>
        </div>
        {statLabel && (
          <span
            className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
              isDark ? 'border-purple-500/40 text-purple-300' : 'border-purple-300 text-purple-700'
            }`}
          >
            {statLabel} O/U
          </span>
        )}
      </div>
      {body}
    </div>
  );
}

/** A book's own net move from its opening line; ±0 means it moved and came back. */
function NetMove({ net, isDark }: { net: number; isDark: boolean }) {
  const tone =
    net > 0
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : net < 0
        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
        : isDark
          ? 'bg-gray-700/60 text-gray-300'
          : 'bg-gray-200 text-gray-600';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${tone}`}>
      {net === 0 ? '±0' : `${net > 0 ? '+' : ''}${net.toFixed(1)}`}
    </span>
  );
}

function MoveArrow({ up }: { up: boolean }) {
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      aria-label={up ? 'up' : 'down'}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${
        up
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
      }`}
    >
      <Icon className="w-3 h-3" strokeWidth={3} />
    </span>
  );
}

function Empty({ text, tone }: { text: string; tone?: 'warn' }) {
  return (
    <div
      className={`flex items-center justify-center min-h-[96px] text-center text-xs px-2 ${
        tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'
      }`}
    >
      {text}
    </div>
  );
}

export default NblLineMovementCard;
