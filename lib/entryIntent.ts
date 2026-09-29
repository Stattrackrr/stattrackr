const INTENT_KEY = 'stattrackr_entry_intent';
const CYCLE_KEY = 'stattrackr_entry_cycle';

const PRO_PRICE_IDS = {
  monthly: 'price_1TlWpPF0aO6V0EHjEZcvzlEE',
  semiannual: 'price_1TlWpoF0aO6V0EHjO81pOBgV',
  annual: 'price_1TlWq3F0aO6V0EHji75auKmP',
} as const;

export type EntryIntent = 'pro' | 'free';
export type EntryBillingCycle = keyof typeof PRO_PRICE_IDS;

const PROPS_HREF = '/props?sport=all';

let entryRedirectStarted = false;

export function readEntryIntent(): EntryIntent | null {
  if (typeof window === 'undefined') return null;
  const intent = sessionStorage.getItem(INTENT_KEY);
  return intent === 'pro' || intent === 'free' ? intent : null;
}

export function readEntryBillingCycle(): EntryBillingCycle {
  if (typeof window === 'undefined') return 'monthly';
  const cycle = sessionStorage.getItem(CYCLE_KEY);
  if (cycle === 'semiannual' || cycle === 'annual') return cycle;
  return 'monthly';
}

export function clearEntryIntent() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(INTENT_KEY);
  sessionStorage.removeItem(CYCLE_KEY);
}

export async function startProCheckout(accessToken: string, billingCycle: EntryBillingCycle) {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      priceId: PRO_PRICE_IDS[billingCycle],
      billingCycle,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 409 && data.alreadySubscribed) {
    window.location.replace(PROPS_HREF);
    return;
  }

  if (!response.ok || typeof data.url !== 'string' || !data.url) {
    throw new Error(data.error || 'Failed to start checkout. Please try again.');
  }

  window.location.href = data.url;
}

/**
 * After an account exists, honor the plan picked on the home survey.
 * Pro goes to Stripe. Free goes into the app. Returns true when that
 * redirect has started so callers do not also send the user to /home.
 */
export async function redirectForEntryIntent(accessToken: string): Promise<boolean> {
  if (entryRedirectStarted) return true;
  const intent = readEntryIntent();
  if (!intent) return false;

  entryRedirectStarted = true;
  try {
    if (intent === 'free') {
      clearEntryIntent();
      window.location.replace(PROPS_HREF);
      return true;
    }

    const billingCycle = readEntryBillingCycle();
    await startProCheckout(accessToken, billingCycle);
    clearEntryIntent();
    return true;
  } catch (error) {
    entryRedirectStarted = false;
    throw error;
  }
}
