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
  normalized_bet: {
    date: string;
    selection: string;
    market?: string | null;
    stake: number;
    currency: string;
    odds: number;
    bookmaker?: string | null;
  };
  created_at: string;
};

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

  const loadImports = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getDrawerSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/journal/import?status=all&limit=40', {
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

  const handleAction = async (action: 'approve' | 'reject', ids: string[]) => {
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

      if (action === 'approve' && (body.promoted?.length || 0) > 0) {
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
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#0d1a2b]"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {bet.selection}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {sourceBookLabel(item.source_book)} · {bet.date} · {bet.currency} {Number(bet.stake).toFixed(2)} @ {Number(bet.odds).toFixed(2)}
                          </div>
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

                      {bet.market && (
                        <div className="mb-2 text-xs text-slate-600 dark:text-slate-300">{bet.market}</div>
                      )}
                      {item.parse_notes && (
                        <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">{item.parse_notes}</div>
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
