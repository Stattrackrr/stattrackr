'use client';

import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  disablePickAlerts,
  enablePickAlerts,
  readPickAlertsState,
  sendTestPickAlert,
  type PickAlertsState,
} from '@/lib/push/client';

const pill =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors';

export function PickAlertsButton() {
  const [state, setState] = useState<PickAlertsState>('loading');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readPickAlertsState()
      .then((next) => {
        if (!cancelled) setState(next);
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
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const run = async (action: () => Promise<PickAlertsState>) => {
    setBusy(true);
    setNote(null);
    try {
      setState(await action());
    } catch {
      setNote('Could not update alerts. Try again.');
    } finally {
      setBusy(false);
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
      <div className="relative">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(enablePickAlerts)}
          className={`${pill} border-purple-400/50 bg-purple-500/15 text-purple-700 hover:bg-purple-500/25 dark:text-purple-200`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          Turn on pick alerts
        </button>
        {note ? (
          <p className="absolute right-0 mt-1.5 whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400">{note}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setMenuOpen((open) => !open)}
        className={`${pill} border-purple-400/50 bg-purple-500/15 text-purple-700 hover:bg-purple-500/25 dark:text-purple-200`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
        Alerts on
      </button>
      {menuOpen ? (
        <div className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-lg dark:border-gray-700 dark:bg-[#0f1a2b]">
          <button
            type="button"
            onClick={async () => {
              setMenuOpen(false);
              setBusy(true);
              const ok = await sendTestPickAlert().catch(() => false);
              setBusy(false);
              setNote(ok ? 'Test alert sent.' : 'Test alert failed. Try turning alerts off and on.');
            }}
            className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Send test alert
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void run(disablePickAlerts);
            }}
            className="block w-full px-3 py-2 text-left text-rose-600 hover:bg-gray-100 dark:text-rose-400 dark:hover:bg-gray-800"
          >
            Turn off alerts
          </button>
        </div>
      ) : null}
      {note ? (
        <p className="absolute right-0 mt-1.5 whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400">{note}</p>
      ) : null}
    </div>
  );
}
