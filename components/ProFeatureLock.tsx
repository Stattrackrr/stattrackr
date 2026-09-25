'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Check, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { PRICE_IDS, type BillingCycle } from '@/lib/stripe';

const PLANS: { cycle: BillingCycle; label: string; price: string; cadence: string; note: string }[] = [
  { cycle: 'monthly', label: 'Monthly', price: '$20', cadence: '/month', note: '7-day free trial' },
  { cycle: 'semiannual', label: '6 Months', price: '$100', cadence: '/6 months', note: 'Save 17% · 7-day free trial' },
  { cycle: 'annual', label: 'Annual', price: '$180', cadence: '/year', note: 'Save 25% · 7-day free trial' },
];

const INCLUDED = [
  'Full props board for every sport',
  'Shot charts, advanced averages, and play types',
  'Prediction model, DVP, and similar players',
];

const upgradeListeners = new Set<() => void>();

/** Opens the shared upgrade prompt. Used by locked tabs and greyed panels. */
export function openProUpgrade() {
  const open = upgradeListeners.values().next().value;
  open?.();
}

/** Small lock chip used on locked tabs. */
export function ProLockMark() {
  return (
    <span className="ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-purple-400 to-indigo-600 text-white shadow-sm shadow-purple-900/40 ring-1 ring-white/25">
      <Lock className="h-3 w-3" strokeWidth={2.4} aria-hidden />
    </span>
  );
}

/** Mount once per dashboard so every lock can open the same prompt. */
export function ProUpgradeHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const open = () => setOpen(true);
    upgradeListeners.add(open);
    return () => {
      upgradeListeners.delete(open);
    };
  }, []);
  if (!open) return null;
  return <UpgradePrompt onClose={() => setOpen(false)} />;
}

/** Greyed preview. Figures inside should already read TBD for free accounts. */
export function ProFeatureLock({
  locked,
  children,
}: {
  locked: boolean;
  children: React.ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return <LockedFeature>{children}</LockedFeature>;
}

function LockedFeature({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="pointer-events-none select-none grayscale opacity-80">{children}</div>
      <button
        type="button"
        onClick={openProUpgrade}
        aria-label="Upgrade to Pro"
        className="absolute inset-0 flex cursor-pointer items-center justify-center"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-[#0c1730]/90 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          <Lock className="h-4 w-4" strokeWidth={2.4} aria-hidden />
          Pro
        </span>
      </button>
    </div>
  );
}

function UpgradePrompt({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = PLANS.find((plan) => plan.cycle === cycle) ?? PLANS[0];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startTrial = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const next = `${window.location.pathname}${window.location.search}`;
        router.push(`/login?redirect=${encodeURIComponent(next)}`);
        return;
      }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ priceId: PRICE_IDS.pro[cycle], billingCycle: cycle }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 409 && data.alreadySubscribed) {
        window.location.href = '/props';
        return;
      }
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to start checkout');
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout. Please try again.');
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-pro-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c1730] p-5 text-white shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-300">Pro feature</p>
            <h2 id="upgrade-pro-title" className="mt-1 text-xl font-bold">
              This is a Pro feature
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">
          Upgrade to Pro completely free with a 7-day free trial. You won&apos;t be charged until the trial ends.
        </p>
        <ul className="mt-4 space-y-2">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-gray-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" strokeWidth={2.4} aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {PLANS.map((plan) => {
            const active = plan.cycle === cycle;
            return (
              <button
                key={plan.cycle}
                type="button"
                onClick={() => setCycle(plan.cycle)}
                className={`rounded-xl border px-2 py-2.5 text-center transition-colors ${
                  active
                    ? 'border-purple-500 bg-purple-600/20 text-white'
                    : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/25'
                }`}
              >
                <span className="block text-[11px] font-medium text-gray-400">{plan.label}</span>
                <span className="mt-0.5 block text-sm font-bold">{plan.price}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-center text-xs text-gray-400">
          {selected.price} AUD {selected.cadence} · {selected.note}
        </p>
        {error ? <p className="mt-3 text-center text-sm text-rose-300">{error}</p> : null}
        <button
          type="button"
          onClick={() => void startTrial()}
          disabled={loading}
          className="mt-4 w-full rounded-lg bg-purple-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-700 disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? 'Starting checkout…' : 'Start Free Trial'}
        </button>
        <p className="mt-3 text-center text-xs text-gray-500">Only 1 free trial per account.</p>
      </div>
    </div>,
    document.body,
  );
}
