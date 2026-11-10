import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_SEC } from './constants';

type StoredReferral = {
  code: string;
  savedAt: number;
};

function isExpired(savedAt: number): boolean {
  return Date.now() - savedAt > REFERRAL_COOKIE_MAX_AGE_SEC * 1000;
}

/** Persist a referral code for the attribution window (clears itself when expired). */
export function saveReferralCode(code: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = String(code || '').trim().toUpperCase();
  if (!cleaned) return;
  const payload: StoredReferral = { code: cleaned, savedAt: Date.now() };
  try {
    localStorage.setItem(REFERRAL_COOKIE, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Read a still-valid referral code, or null if missing/expired. */
export function readReferralCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REFERRAL_COOKIE);
    if (!raw) return null;

    // Legacy bare-string value from before expiry tracking — treat as expired.
    if (!raw.startsWith('{')) {
      localStorage.removeItem(REFERRAL_COOKIE);
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    const code = typeof parsed.code === 'string' ? parsed.code.trim().toUpperCase() : '';
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (!code || !savedAt || isExpired(savedAt)) {
      localStorage.removeItem(REFERRAL_COOKIE);
      return null;
    }
    return code;
  } catch {
    try {
      localStorage.removeItem(REFERRAL_COOKIE);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function clearReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REFERRAL_COOKIE);
  } catch {
    /* ignore */
  }
}
