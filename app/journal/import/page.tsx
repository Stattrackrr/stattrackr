'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { normalizeImportBatchId } from '@/lib/journalImport';
import { supabase } from '@/lib/supabaseClient';

async function getImportSession() {
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

const EXTENSION_IMPORT_SESSION_KEY = 'stattrackr-extension-import';
const IMPORT_CHUNK_SIZE = 40;

function decodePayload(encoded: string) {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const json = atob(padded);
  return JSON.parse(json);
}

async function readBridgedImportPayload() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const raw = sessionStorage.getItem(EXTENSION_IMPORT_SESSION_KEY);
    if (raw) {
      sessionStorage.removeItem(EXTENSION_IMPORT_SESSION_KEY);
      return JSON.parse(raw);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
}

type ImportTotals = {
  inserted_count: number;
  promoted_count: number;
  duplicate_count: number;
  junk_skipped_count: number;
  message: string | null;
};

async function postImportEnvelope(
  accessToken: string,
  envelope: Record<string, unknown>
): Promise<ImportTotals> {
  const imports = Array.isArray(envelope.imports)
    ? envelope.imports
    : envelope.import
      ? [envelope.import]
      : [];

  if (imports.length === 0) {
    throw new Error('Missing import payload');
  }

  const batchId = normalizeImportBatchId(envelope.import_batch_id);
  const autoAdd = envelope.auto_add === true;

  const totals: ImportTotals = {
    inserted_count: 0,
    promoted_count: 0,
    duplicate_count: 0,
    junk_skipped_count: 0,
    message: null,
  };

  for (let offset = 0; offset < imports.length; offset += IMPORT_CHUNK_SIZE) {
    const chunk = imports.slice(offset, offset + IMPORT_CHUNK_SIZE);
    const response = await fetch('/api/journal/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        imports: chunk,
        import_batch_id: batchId,
        auto_add: autoAdd && offset === 0,
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error || 'Failed to import sportsbook bet');
    }

    totals.inserted_count += Number(body?.inserted_count || 0);
    totals.promoted_count += Number(body?.promoted_count || 0);
    totals.duplicate_count += Number(body?.duplicate_count || 0);
    totals.junk_skipped_count += Number(body?.junk_skipped_count || 0);
    if (typeof body?.message === 'string' && body.message) {
      totals.message = body.message;
    }
  }

  return totals;
}

function JournalImportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const payloadParam = searchParams.get('payload');
  const importKey = searchParams.get('importKey');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Preparing sportsbook import...');
  const [resolvedPayload, setResolvedPayload] = useState<Record<string, unknown> | null>(null);

  const urlDecodedPayload = useMemo(() => {
    if (!payloadParam) return null;
    try {
      return decodePayload(payloadParam) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [payloadParam]);

  useEffect(() => {
    let cancelled = false;

    const resolvePayload = async () => {
      if (urlDecodedPayload) {
        setResolvedPayload(urlDecodedPayload);
        return;
      }

      if (importKey) {
        setMessage('Loading import from extension...');
        const bridged = await readBridgedImportPayload();
        if (!cancelled) {
          setResolvedPayload(bridged);
        }
        return;
      }

      setResolvedPayload(null);
    };

    resolvePayload();

    return () => {
      cancelled = true;
    };
  }, [importKey, urlDecodedPayload]);

  useEffect(() => {
    let cancelled = false;

    const runImport = async () => {
      if (payloadParam === null && importKey === null) {
        return;
      }

      if (!resolvedPayload && (payloadParam || importKey)) {
        return;
      }

      if (!resolvedPayload) {
        setStatus('error');
        setMessage(
          importKey
            ? 'Import data from the extension did not arrive. Reload the extension (v0.2.2) and try again.'
            : 'The import link is invalid or incomplete.'
        );
        return;
      }

      try {
        const session = await getImportSession();
        if (!session?.access_token) {
          throw new Error('Not authenticated');
        }

        setMessage('Importing sportsbook bets...');
        const body = await postImportEnvelope(session.access_token, resolvedPayload);

        if (cancelled) return;
        const promoted = body.promoted_count;
        const inserted = body.inserted_count;
        const duplicates = body.duplicate_count;
        const junkSkipped = body.junk_skipped_count;
        const apiMessage = body.message;

        setStatus('success');
        if (apiMessage) {
          setMessage(apiMessage);
        } else if (promoted > 0) {
          setMessage(
            `Imported ${promoted} bet${promoted === 1 ? '' : 's'} into your journal.` +
              (junkSkipped > 0 ? ` (${junkSkipped} junk row${junkSkipped === 1 ? '' : 's'} skipped.)` : '')
          );
        } else if (inserted > 0) {
          setMessage(
            `Queued ${inserted} new bet${inserted === 1 ? '' : 's'} for review in Imported bets.` +
              (duplicates > 0 ? ` ${duplicates} already in the queue.` : '') +
              (junkSkipped > 0 ? ` (${junkSkipped} junk row${junkSkipped === 1 ? '' : 's'} skipped.)` : '')
          );
        } else if (duplicates > 0) {
          setMessage(
            `No new bets added — ${duplicates} already in your import queue. Reject old rows or reload the extension (v0.2) and try again.`
          );
        } else {
          setMessage('Nothing new to import from this capture.');
        }

        window.setTimeout(() => {
          router.replace('/journal');
        }, 1800);
      } catch (error: any) {
        if (cancelled) return;
        setStatus('error');
        setMessage(error?.message || 'Failed to import sportsbook bet');
      }
    };

    runImport();

    return () => {
      cancelled = true;
    };
  }, [importKey, payloadParam, resolvedPayload, router]);

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="text-sm font-semibold uppercase tracking-[0.24em] text-purple-300">
          Journal Import
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Sportsbook sync</h1>
        <p className="mt-3 text-sm text-slate-300">{message}</p>

        {status === 'loading' && (
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-purple-500" />
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={() => router.replace('/journal')}
            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-500"
          >
            Open journal
          </button>
          <button
            type="button"
            onClick={() => router.replace('/home')}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default function JournalImportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 px-6 py-12 text-white">
          <div className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-purple-300">
              Journal Import
            </div>
            <h1 className="mt-3 text-2xl font-semibold">Sportsbook sync</h1>
            <p className="mt-3 text-sm text-slate-300">Preparing sportsbook import...</p>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-purple-500" />
            </div>
          </div>
        </div>
      }
    >
      <JournalImportContent />
    </Suspense>
  );
}
