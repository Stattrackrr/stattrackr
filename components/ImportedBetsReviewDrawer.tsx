'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Download, RefreshCw, Trash2, X } from 'lucide-react';
import { sourceBookLabel } from '@/lib/journalImport';
import { supabase } from '@/lib/supabaseClient';

type ImportedBetRow = {
  id: string;
  source_book: string;
  source_page_url: string | null;
  parse_notes: string | null;
  error_message: string | null;
  review_status: string;
  raw_payload?: {
    placed_date?: string | null;
    placed_date_raw?: string | null;
    placed_date_source?: string | null;
    placed_date_inferred?: boolean | null;
    fixture?: string | null;
    multi_label?: string | null;
    display_title?: string | null;
  } | null;
  normalized_bet: {
    date: string;
    selection: string;
    market?: string | null;
    stake: number;
    currency: string;
    odds: number;
    bookmaker?: string | null;
    team?: string | null;
    opponent?: string | null;
  };
  created_at: string;
};

function formatBetDate(isoDate: string) {
  if (!isoDate) return 'Unknown date';
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function getScrapedDateMeta(item: ImportedBetRow) {
  const raw = item.raw_payload;
  const inferred = raw?.placed_date_inferred === true;
  const scrapedRaw = raw?.placed_date_raw || null;
  const source = raw?.placed_date_source || null;
  return { inferred, scrapedRaw, source };
}

function isValidFixtureDisplay(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (/same game multi\s+v\s+[\d.]+/i.test(text)) return false;
  if (/\bv\s+[\d.]{1,4}$/i.test(text)) return false;
  if (/^\d+\s+leg\s+multi$/i.test(text) && !/\s+v\s+[A-Za-z]{4,}/i.test(text)) return false;
  return /[A-Za-z]{3,}\s+(?:v|vs)\s+[A-Za-z]{3,}/i.test(text);
}

function sanitizeFixtureDisplay(value: string) {
  return value
    .trim()
    .replace(/^(?:AUD|\$)?\s*[\d.,]+\s+/, '')
    .replace(/\s+(sun|mon|tue|wed|thu|fri|sat)$/i, '');
}

function inferMultiLabelFromText(value: string) {
  const text = value.trim();
  const legCount = text.match(/(\d+)\s+legs?\b/i)?.[1];
  const typeMatch = text.match(/(same game multi|standard multi|multi bet|bet builder)/i);
  if (!legCount && !typeMatch) return null;
  const type = typeMatch
    ? typeMatch[1].replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Multi';
  return legCount ? `${legCount} Leg ${type}` : type;
}

function resolveLegacyHeadline(item: ImportedBetRow, bet: ImportedBetRow['normalized_bet']) {
  const raw = item.raw_payload;
  const candidates = [
    raw?.display_title ? String(raw.display_title) : null,
    bet.selection,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const fixtureMatch = candidate.match(
      /([A-Za-z][A-Za-z0-9 .'-]{2,}\s+(?:v|vs)\s+[A-Za-z][A-Za-z0-9 .'-]{2,})/i
    );
    if (fixtureMatch?.[1] && isValidFixtureDisplay(fixtureMatch[1])) {
      return sanitizeFixtureDisplay(fixtureMatch[1]);
    }
  }

  const multiLabel =
    (raw?.multi_label ? String(raw.multi_label) : null) ||
    candidates.map(inferMultiLabelFromText).find(Boolean);
  if (multiLabel) return multiLabel;

  for (const candidate of candidates) {
    const withoutOdds = candidate
      .replace(/^same game multi\s+v\s+[\d.]+\s*/i, '')
      .replace(/\s+\d+\s+leg(?:s)?\s*$/i, '')
      .trim();
    const legOnly = withoutOdds.match(/^(\d+\s+leg(?:s)?\s+multi)\b/i);
    if (legOnly) return legOnly[1];
    if (/^\d+\s+leg(?:s)?\s+multi$/i.test(withoutOdds)) return withoutOdds;
  }

  return candidates[0] || bet.selection;
}

function getCardHeadline(item: ImportedBetRow, bet: ImportedBetRow['normalized_bet']) {
  const raw = item.raw_payload;
  if (raw?.fixture && isValidFixtureDisplay(String(raw.fixture))) {
    return sanitizeFixtureDisplay(String(raw.fixture));
  }

  if (bet.team && bet.opponent) {
    return `${bet.team} v ${bet.opponent}`;
  }

  const title = getCardTitle(item, bet);
  const fixtureFromTitle = title.match(
    /([A-Za-z][A-Za-z0-9 .'-]{2,}\s+(?:v|vs)\s+[A-Za-z][A-Za-z0-9 .'-]{2,})/i
  );
  if (fixtureFromTitle?.[1] && isValidFixtureDisplay(fixtureFromTitle[1])) {
    return sanitizeFixtureDisplay(fixtureFromTitle[1]);
  }

  if (isValidFixtureDisplay(title)) {
    return sanitizeFixtureDisplay(title);
  }

  return resolveLegacyHeadline(item, bet);
}

function getCardSubtitle(item: ImportedBetRow, bet: ImportedBetRow['normalized_bet'], headline: string) {
  const raw = item.raw_payload;
  const label =
    (raw?.multi_label ? String(raw.multi_label) : null) ||
    inferMultiLabelFromText(bet.selection) ||
    inferMultiLabelFromText(raw?.display_title || '');

  if (!label) return null;
  if (label.toLowerCase() === headline.toLowerCase()) return null;
  if (isValidFixtureDisplay(headline)) return label;
  return label;
}

function getCardTitle(item: ImportedBetRow, bet: ImportedBetRow['normalized_bet']) {
  const raw = item.raw_payload;
  if (raw?.display_title) return String(raw.display_title);

  const fixture = getFixtureDisplay(item, bet);
  const multiLabel = raw?.multi_label ? String(raw.multi_label) : null;

  if (multiLabel && fixture) return `${multiLabel} — ${fixture}`;
  if (fixture) return fixture;
  if (multiLabel) return multiLabel;

  if (bet.team && bet.opponent) {
    return `${bet.team} v ${bet.opponent}`;
  }

  const head = bet.selection.split('—')[0]?.trim();
  if (head && head.length <= 80 && !/same game multi\s+v\s+[\d.]/i.test(head)) {
    return head;
  }

  return bet.selection;
}

function getFixtureDisplay(item: ImportedBetRow, bet: ImportedBetRow['normalized_bet']) {
  const raw = item.raw_payload;
  const title = getCardTitle(item, bet);

  if (raw?.fixture && isValidFixtureDisplay(String(raw.fixture))) {
    return sanitizeFixtureDisplay(String(raw.fixture));
  }

  if (bet.team && bet.opponent) {
    return `${bet.team} v ${bet.opponent}`;
  }

  const fixtureFromTitle = title.match(/([A-Za-z][^—]*?\s+(?:v|vs)\s+[A-Za-z][^—]*)/i);
  if (fixtureFromTitle?.[1] && isValidFixtureDisplay(fixtureFromTitle[1])) {
    return sanitizeFixtureDisplay(fixtureFromTitle[1]);
  }

  const fixtureFromSelection = bet.selection.match(
    /([A-Za-z][A-Za-z0-9 .'-]{2,}\s+(?:v|vs)\s+[A-Za-z][A-Za-z0-9 .'-]{2,})/i
  );
  if (fixtureFromSelection?.[1] && isValidFixtureDisplay(fixtureFromSelection[1])) {
    return sanitizeFixtureDisplay(fixtureFromSelection[1]);
  }

  if (raw?.multi_label && !isValidFixtureDisplay(title)) {
    return title;
  }

  return title;
}

function getBetDetailLine(item: ImportedBetRow, bet: ImportedBetRow['normalized_bet'], title: string) {
  const raw = item.raw_payload;
  if (raw?.display_title || raw?.multi_label) return null;

  const parts = bet.selection.split('—').map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const detail = parts.slice(1).join(' — ');
  if (!detail || detail === title) return null;
  if (/same game multi\s+v\s+[\d.]/i.test(detail)) return null;

  return detail;
}

async function readJson(response: Response) {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(body?.error || 'Request failed');
  }
  return body;
}

async function getDrawerSession() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      return session;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  return null;
}

export default function ImportedBetsReviewDrawer() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<ImportedBetRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pendingItems = useMemo(
    () => items.filter((item) => item.review_status === 'pending_review' || item.review_status === 'failed'),
    [items]
  );

  const approvedItems = useMemo(
    () => items.filter((item) => item.review_status === 'approved' || item.review_status === 'duplicate'),
    [items]
  );

  const loadImports = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getDrawerSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/journal/import?status=all&limit=200', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const body = await readJson(response);
      setItems(Array.isArray(body.imports) ? body.imports : []);
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load imported bets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImports();
  }, []);

  useEffect(() => {
    if (!open) return;
    loadImports();
  }, [open]);

  const handleAction = async (action: 'approve' | 'reject' | 'undo', ids: string[]) => {
    if (ids.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await getDrawerSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/journal/import/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, ids }),
      });
      const body = await readJson(response);

      await loadImports();

      if (
        (action === 'approve' && (body.promoted?.length || 0) > 0) ||
        (action === 'undo' && (body.undone?.length || 0) > 0)
      ) {
        window.location.reload();
      }
    } catch (actionError: any) {
      setError(actionError?.message || `Failed to ${action} imported bets`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-[70] inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-900/30 transition hover:bg-purple-500"
      >
        <Download className="h-4 w-4" />
        <span>Imports</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{pendingItems.length}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] bg-slate-950/60 backdrop-blur-sm">
          <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-[#081220] dark:text-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-700">
              <div>
                <div className="text-lg font-semibold">Imported bets</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Review sportsbook captures before they hit the journal.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <button
                type="button"
                onClick={() => loadImports()}
                disabled={loading || submitting}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => handleAction('approve', pendingItems.map((item) => item.id))}
                disabled={pendingItems.length === 0 || loading || submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                Approve all
              </button>
              <button
                type="button"
                onClick={() => handleAction('reject', pendingItems.map((item) => item.id))}
                disabled={pendingItems.length === 0 || loading || submitting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700/60 dark:text-red-300 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-4 w-4" />
                Reject all
              </button>
              {approvedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleAction('undo', approvedItems.map((item) => item.id))}
                  disabled={loading || submitting}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/60 dark:text-amber-200 dark:hover:bg-amber-950/30"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove approved ({approvedItems.length})
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {error && (
                <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-200">
                  {error}
                </div>
              )}

              {!loading && items.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No imported bets yet. Use the Chrome extension on a supported sportsbook page to queue bets here.
                </div>
              )}

              <div className="space-y-3">
                {items.map((item) => {
                  const bet = item.normalized_bet;
                  const dateMeta = getScrapedDateMeta(item);
                  const headline = getCardHeadline(item, bet);
                  const subtitle = getCardSubtitle(item, bet, headline);
                  const detailLine = getBetDetailLine(item, bet, headline);
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#0d1a2b]"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {headline}
                          </div>
                          {subtitle && (
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span>{formatBetDate(bet.date)}</span>
                            {dateMeta.inferred && (
                              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                                Date guessed
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                            {bet.currency} {Number(bet.stake).toFixed(2)} @ {Number(bet.odds).toFixed(2)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {sourceBookLabel(item.source_book)}
                            {bet.market ? ` · ${bet.market}` : ''}
                          </div>
                          {detailLine && (
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              {detailLine}
                            </div>
                          )}
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                            item.review_status === 'approved'
                              ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                              : item.review_status === 'rejected'
                                ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : item.review_status === 'duplicate'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                  : item.review_status === 'failed'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                    : 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
                          }`}
                        >
                          {item.review_status.replace('_', ' ')}
                        </span>
                      </div>

                      {item.parse_notes && (
                        <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                          {item.parse_notes}
                        </div>
                      )}
                      {item.error_message && (
                        <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-200">
                          {item.error_message}
                        </div>
                      )}

                      {(item.review_status === 'pending_review' || item.review_status === 'failed') && (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleAction('approve', [item.id])}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Check className="h-4 w-4" />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAction('reject', [item.id])}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <Trash2 className="h-4 w-4" />
                            Reject
                          </button>
                        </div>
                      )}

                      {(item.review_status === 'approved' || item.review_status === 'duplicate') && (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => handleAction('undo', [item.id])}
                            disabled={submitting}
                            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700/60 dark:text-amber-200 dark:hover:bg-amber-950/30"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove from journal
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
