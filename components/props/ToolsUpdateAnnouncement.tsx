'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import { openProUpgrade } from '@/components/ProFeatureLock';
import { useTheme } from '@/contexts/ThemeContext';
import { useViewerProfile } from '@/hooks/useViewerProfile';
import { isToolsAdminEmail } from '@/lib/adminEmail';
import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'tools-update-announcement-v1';
const OPEN_DELAY_MS = 1100;

const TOOL_BITS = [
  { short: 'ARB', label: 'Arbitrage' },
  { short: 'EV', label: 'Positive EV' },
  { short: 'MID', label: 'Middles' },
  { short: 'BF', label: 'Bonus Flipper' },
] as const;

/** One-shot "New Update" popup announcing the Tools page. */
export function ToolsUpdateAnnouncement() {
  const router = useRouter();
  const { isDark: themeDark } = useTheme();
  const { isPro, userEmail, subscriptionChecked } = useViewerProfile({ requireAuth: false });
  const canOpenTools = isPro || isToolsAdminEmail(userEmail);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const previewRef = useRef(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('update') === 'preview'
  );
  const isDark = mounted && themeDark;

  useEffect(() => {
    setMounted(true);
    if (previewRef.current) {
      setOpen(true);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (localStorage.getItem(STORAGE_KEY) === '1') return;
      } catch {
        // Storage unavailable — still show once this session.
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled || !session?.user) return;
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!previewRef.current) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // Ignore storage errors.
      }
    }
    setOpen(false);
  }, []);

  const openTools = useCallback(() => {
    dismiss();
    // Free / public users get the upgrade prompt — never drop them onto /tools.
    if (!subscriptionChecked || !canOpenTools) {
      openProUpgrade();
      return;
    }
    router.push('/tools');
  }, [canOpenTools, dismiss, router, subscriptionChecked]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  const muted = isDark ? 'text-slate-300' : 'text-gray-600';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className={`flex max-h-[min(92dvh,820px)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border shadow-2xl ${
          isDark ? 'border-slate-700/80 bg-[#081525]/95' : 'border-gray-200 bg-white/95'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-update-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
                isDark ? 'border-slate-700 bg-slate-900/80' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <StatTrackrLogo className="h-8 w-8" />
            </div>
            <div>
              <div
                className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                  isDark ? 'text-emerald-300/85' : 'text-emerald-700'
                }`}
              >
                New Update
              </div>
              <h2
                id="tools-update-title"
                className={`mt-1 text-[26px] font-semibold leading-none ${isDark ? 'text-white' : 'text-gray-900'}`}
              >
                Tools is live
              </h2>
            </div>
          </div>

          <p className={`mt-4 text-sm leading-6 sm:text-[15px] ${muted}`}>
            StatTrackr has added a Tools page covering arbitrage, positive EV, middles, and bonus flipper, all on one board.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {TOOL_BITS.map((bit) => (
              <span
                key={bit.short}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide ${
                  isDark ? 'bg-white/8 text-slate-200' : 'bg-gray-100 text-gray-700'
                }`}
                title={bit.label}
              >
                {bit.short}
                <span className={`ml-1.5 font-medium ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{bit.label}</span>
              </span>
            ))}
          </div>

          <div
            className={`mt-4 overflow-hidden rounded-2xl border ${
              isDark ? 'border-white/10 bg-black/30' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <Image
              src="/tools-update-preview.png"
              alt="Betting Tools board showing arbitrage, positive EV, and middles cards"
              width={1024}
              height={858}
              className="h-auto w-full"
              priority
            />
          </div>

          <p className={`mt-4 text-sm leading-6 sm:text-[15px] ${muted}`}>
            More is coming soon to StatTrackr. Keep an eye on the board.
          </p>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={openTools}
              className={`inline-flex w-full items-center justify-center rounded-2xl px-4 py-3.5 text-sm font-semibold transition ${
                isDark
                  ? 'bg-white text-gray-900 hover:bg-slate-100'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}
            >
              {canOpenTools ? 'Open Tools' : 'Unlock Tools with Pro'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className={`w-full rounded-2xl px-4 py-2 text-xs font-medium transition ${
                isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
