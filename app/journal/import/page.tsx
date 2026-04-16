'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

function decodePayload(encoded: string) {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const json = atob(padded);
  return JSON.parse(json);
}

function JournalImportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const payloadParam = searchParams.get('payload');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Preparing sportsbook import...');

  const decodedPayload = useMemo(() => {
    if (!payloadParam) return null;
    try {
      return decodePayload(payloadParam);
    } catch {
      return null;
    }
  }, [payloadParam]);

  useEffect(() => {
    let cancelled = false;

    const runImport = async () => {
      if (!decodedPayload) {
        setStatus('error');
        setMessage('The import link is invalid or incomplete.');
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error('Not authenticated');
        }

        const response = await fetch('/api/journal/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(decodedPayload),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error || 'Failed to import sportsbook bet');
        }

        if (cancelled) return;
        const promoted = Number(body?.promoted_count || 0);
        const inserted = Number(body?.inserted_count || 0);
        setStatus('success');
        setMessage(
          promoted > 0
            ? `Imported ${promoted} bet${promoted === 1 ? '' : 's'} into your journal.`
            : inserted > 0
              ? `Queued ${inserted} bet${inserted === 1 ? '' : 's'} for review in Imported bets.`
              : 'This bet was already in your import queue.'
        );

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
  }, [decodedPayload, router]);

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
