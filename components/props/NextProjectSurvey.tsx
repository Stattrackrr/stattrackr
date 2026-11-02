'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import { useTheme } from '@/contexts/ThemeContext';
import { NEXT_PROJECT_OPTIONS, type NextProjectOption } from '@/lib/nextProjectSurvey';
import { supabase } from '@/lib/supabaseClient';

const STORAGE_PREFIX = 'next-project-survey-v1';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const OPEN_DELAY_MS = 1200;

/** "We want your say" popup on the props page: asks signed-in users what to build next, once. */
export function NextProjectSurvey() {
  const { isDark: themeDark } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [choices, setChoices] = useState<NextProjectOption[]>([]);
  const [sportRequest, setSportRequest] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const isDark = mounted && themeDark;

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const id = session?.user?.id;
      if (!id || !session?.access_token || cancelled) return;
      try {
        if (localStorage.getItem(`${STORAGE_PREFIX}:${id}:answered`)) return;
        if (Number(localStorage.getItem(`${STORAGE_PREFIX}:${id}:snoozed`) || 0) > Date.now()) return;
      } catch {
        // Storage unavailable: fall through to the server check.
      }
      const res = await fetch('/api/next-project-survey?view=status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      }).catch(() => null);
      const status = res?.ok ? await res.json().catch(() => null) : null;
      if (cancelled || !status?.success) return;
      if (status.hasAnswered) {
        try {
          localStorage.setItem(`${STORAGE_PREFIX}:${id}:answered`, '1');
        } catch {}
        return;
      }
      setUserId(id);
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const snooze = useCallback(() => {
    if (userId) {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}:${userId}:snoozed`, String(Date.now() + SNOOZE_MS));
      } catch {}
    }
    setOpen(false);
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') snooze();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, snooze]);

  const toggle = (id: NextProjectOption) => {
    setError(null);
    setChoices((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const wantsSport = choices.includes('another_sport');
  const canSubmit = choices.length > 0 && (!wantsSport || sportRequest.trim().length >= 2) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please sign in again and try once more.');
      const res = await fetch('/api/next-project-survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ choices, sportRequest, comment, sourcePage: 'props' }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || 'Could not save your answer. Please try again.');
      try {
        localStorage.setItem(`${STORAGE_PREFIX}:${session.user.id}:answered`, '1');
      } catch {}
      setThanks(true);
      window.setTimeout(() => setOpen(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your answer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const muted = isDark ? 'text-slate-300' : 'text-gray-600';
  const field = `w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-purple-400 ${
    isDark ? 'border-slate-700 bg-slate-900/70 text-white placeholder:text-slate-500' : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400'
  }`;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={snooze}>
      <div
        className={`flex max-h-[min(90dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-3xl border shadow-2xl ${
          isDark ? 'border-slate-700/80 bg-[#081525]/95' : 'border-gray-200 bg-white/95'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="next-project-survey-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${isDark ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'}`}>
              <StatTrackrLogo className="h-8 w-8" />
            </div>
            <div>
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-purple-300/80' : 'text-purple-600'}`}>Quick poll</div>
              <h2 id="next-project-survey-title" className={`mt-1 text-[26px] font-semibold leading-none ${isDark ? 'text-white' : 'text-gray-900'}`}>
                We want your say
              </h2>
            </div>
          </div>

          {thanks ? (
            <p className={`mt-6 text-sm sm:text-[15px] ${muted}`}>Thanks, your vote is in. We&apos;ll share what&apos;s coming soon.</p>
          ) : (
            <>
              <p className={`mt-4 text-sm leading-6 sm:text-[15px] ${muted}`}>
                Our betting AI is collecting data every day. While it learns, we&apos;re starting our next project, and you get to help pick it.
              </p>
              <p className={`mt-2 text-xs sm:text-[13px] ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Choose as many as you like.</p>

              <div className="mt-4 grid grid-cols-1 gap-2.5">
                {NEXT_PROJECT_OPTIONS.map((option) => {
                  const selected = choices.includes(option.id);
                  return (
                    <div key={option.id}>
                      <button
                        type="button"
                        onClick={() => toggle(option.id)}
                        aria-pressed={selected}
                        className={`group w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                          selected
                            ? isDark
                              ? 'border-purple-400/80 bg-purple-500/12 shadow-[0_0_0_1px_rgba(168,85,247,0.18)]'
                              : 'border-purple-400 bg-purple-50 shadow-[0_0_0_1px_rgba(168,85,247,0.12)]'
                            : isDark
                              ? 'border-slate-700 bg-slate-900/55 hover:border-slate-500 hover:bg-slate-900/80'
                              : 'border-gray-200 bg-gray-50/90 hover:border-purple-200 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{option.label}</div>
                            <div className={`mt-0.5 text-xs leading-5 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{option.detail}</div>
                          </div>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                              selected
                                ? 'border-purple-400 bg-purple-500 text-white'
                                : isDark
                                  ? 'border-slate-500 text-transparent group-hover:border-slate-400'
                                  : 'border-gray-300 text-transparent group-hover:border-purple-300'
                            }`}
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                              <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.2 7.2a1 1 0 01-1.415 0l-3.2-3.2a1 1 0 111.414-1.42l2.493 2.494 6.493-6.494a1 1 0 011.415 0z" clipRule="evenodd" />
                            </svg>
                          </span>
                        </div>
                      </button>
                      {option.id === 'another_sport' && selected ? (
                        <input
                          type="text"
                          value={sportRequest}
                          onChange={(e) => setSportRequest(e.target.value)}
                          maxLength={80}
                          placeholder="Which sport? e.g. NFL, soccer, horse racing"
                          className={`${field} mt-2`}
                          autoFocus
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Anything else you'd like to see? (optional)"
                className={`${field} mt-3 resize-none`}
              />

              {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}

              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className={`mt-4 inline-flex w-full items-center justify-center rounded-2xl px-4 py-3.5 text-sm font-semibold transition ${
                  canSubmit
                    ? 'bg-gradient-to-r from-purple-600 to-violet-500 text-white hover:from-purple-500 hover:to-violet-400'
                    : 'cursor-not-allowed bg-slate-400/60 text-white'
                }`}
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
              <button
                type="button"
                onClick={snooze}
                className={`mt-2 w-full rounded-2xl px-4 py-2 text-xs font-medium transition ${isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Maybe later
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
