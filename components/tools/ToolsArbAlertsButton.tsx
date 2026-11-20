'use client';

import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  TOOLS_ARB_DEFAULT_MIN_PCT,
  TOOLS_ARB_MAX_PCT,
  TOOLS_ARB_MIN_PCT,
  clampToolsArbMinPct,
  disableToolsArbAlerts,
  enableToolsArbAlerts,
  readToolsArbAlertsState,
  sendTestToolsArbAlert,
  updateToolsArbMinPct,
  type ToolsArbAlertsState,
} from '@/lib/push/client';

const pill =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors';

const menuShell =
  'z-[80] w-[min(15rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg dark:border-gray-700 dark:bg-[#0f1a2b]';

/** Fixed, horizontally centered under the trigger so mobile never clips the panel. */
function ArbAlertsMenu({
  anchorRef,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      setPos({ top: Math.min(box.bottom + 6, window.innerHeight - 12) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef]);

  if (typeof document === 'undefined' || !pos) return null;

  return createPortal(
    <div className={`fixed left-1/2 -translate-x-1/2 ${menuShell}`} style={{ top: pos.top }}>
      {children}
    </div>,
    document.body
  );
}

export function ToolsArbAlertsButton() {
  const [state, setState] = useState<ToolsArbAlertsState>('loading');
  const [minPct, setMinPct] = useState(TOOLS_ARB_DEFAULT_MIN_PCT);
  const [draftPct, setDraftPct] = useState(String(TOOLS_ARB_DEFAULT_MIN_PCT));
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** After they set a %, nudge them to preview the real notification. */
  const [readyToTest, setReadyToTest] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readToolsArbAlertsState()
      .then((next) => {
        if (cancelled) return;
        setState(next.state);
        setMinPct(next.minPct);
        setDraftPct(String(next.minPct));
      })
      .catch(() => {
        if (!cancelled) setState('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      // Portal menu lives on document.body — ignore clicks inside it.
      const portal = document.querySelector('[data-arb-alerts-menu="1"]');
      if (portal?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const applyResult = (next: { state: ToolsArbAlertsState; minPct: number }) => {
    setState(next.state);
    setMinPct(next.minPct);
    setDraftPct(String(next.minPct));
  };

  const runTest = async () => {
    setBusy(true);
    setNote(null);
    const ok = await sendTestToolsArbAlert().catch(() => false);
    setBusy(false);
    if (ok) {
      setReadyToTest(false);
      setNote('Test sent — check your notifications.');
    } else {
      setNote('Test failed. Try turning alerts off and on.');
    }
  };

  if (state === 'loading' || state === 'unsupported') return null;

  if (state === 'needs-home-screen') {
    return (
      <span
        className={`${pill} border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300`}
        title="On iPhone, tap Share, then Add to Home Screen, and open StatTrackr from the icon."
      >
        <Bell className="h-3.5 w-3.5" />
        Add to Home Screen for alerts
      </span>
    );
  }

  if (state === 'denied') {
    return (
      <span
        className={`${pill} border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400`}
        title="Notifications are blocked. Allow them for StatTrackr in your phone or browser settings."
      >
        <BellOff className="h-3.5 w-3.5" />
        Alerts blocked
      </span>
    );
  }

  if (state === 'off') {
    return (
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={busy}
          onClick={() => setMenuOpen((open) => !open)}
          className={`${pill} border-amber-400/50 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          Arb alerts
        </button>
        {menuOpen ? (
          <ArbAlertsMenu anchorRef={triggerRef}>
            <div data-arb-alerts-menu="1" className="px-3 py-2.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Min arb ROI %
              </label>
              <input
                type="number"
                inputMode="decimal"
                min={TOOLS_ARB_MIN_PCT}
                max={TOOLS_ARB_MAX_PCT}
                step={0.1}
                value={draftPct}
                onChange={(e) => setDraftPct(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-amber-400 dark:border-gray-600 dark:bg-[#0a1422] dark:text-white"
              />
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Get a push when an arb hits this % or higher. You can send a test right after.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setNote(null);
                  void enableToolsArbAlerts(clampToolsArbMinPct(Number(draftPct) || TOOLS_ARB_DEFAULT_MIN_PCT))
                    .then((result) => {
                      applyResult(result);
                      setReadyToTest(true);
                      setNote('Alerts on — send a test to preview.');
                    })
                    .catch(() => setNote('Could not enable alerts. Try again.'))
                    .finally(() => setBusy(false));
                }}
                className="mt-2.5 w-full rounded-lg bg-amber-500/20 px-2.5 py-2 text-xs font-semibold text-amber-900 dark:text-amber-100"
              >
                Turn on arb alerts
              </button>
            </div>
          </ArbAlertsMenu>
        ) : null}
        {note ? (
          <p className="absolute left-1/2 top-full z-10 mt-1.5 w-max max-w-[14rem] -translate-x-1/2 text-center text-[11px] text-gray-500 dark:text-gray-400">
            {note}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={busy}
        onClick={() => setMenuOpen((open) => !open)}
        className={`${pill} border-amber-400/50 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
        Arb ≥{minPct}%
      </button>
      {menuOpen ? (
        <ArbAlertsMenu anchorRef={triggerRef}>
          <div data-arb-alerts-menu="1">
            <div className="border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Min arb ROI %
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={TOOLS_ARB_MIN_PCT}
                  max={TOOLS_ARB_MAX_PCT}
                  step={0.1}
                  value={draftPct}
                  onChange={(e) => setDraftPct(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-amber-400 dark:border-gray-600 dark:bg-[#0a1422] dark:text-white"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const next = clampToolsArbMinPct(Number(draftPct));
                    setBusy(true);
                    setNote(null);
                    void updateToolsArbMinPct(next)
                      .then((result) => {
                        applyResult(result);
                        setReadyToTest(true);
                        setNote('Saved — send a test to preview.');
                      })
                      .catch(() => setNote('Could not update threshold.'))
                      .finally(() => setBusy(false));
                  }}
                  className="shrink-0 rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-100"
                >
                  Save
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Notify when an arb hits this % or higher ({TOOLS_ARB_MIN_PCT}–{TOOLS_ARB_MAX_PCT}).
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runTest()}
                className={`mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                  readyToTest
                    ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
                    : 'bg-amber-500/20 text-amber-900 dark:text-amber-100'
                }`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                Send test notification
              </button>
              <p className="mt-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                Sends a sample <span className="font-medium text-gray-700 dark:text-gray-200">Arb +{minPct.toFixed(1)}%</span>{' '}
                alert so you can see how it looks.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setBusy(true);
                setNote(null);
                setReadyToTest(false);
                void disableToolsArbAlerts()
                  .then(applyResult)
                  .catch(() => setNote('Could not turn off alerts.'))
                  .finally(() => setBusy(false));
              }}
              className="block w-full px-3 py-2 text-left text-rose-600 hover:bg-gray-100 dark:text-rose-400 dark:hover:bg-gray-800"
            >
              Turn off arb alerts
            </button>
          </div>
        </ArbAlertsMenu>
      ) : null}
      {note ? (
        <p className="absolute left-1/2 top-full z-10 mt-1.5 w-max max-w-[14rem] -translate-x-1/2 text-center text-[11px] text-gray-500 dark:text-gray-400">
          {note}
        </p>
      ) : null}
    </div>
  );
}
