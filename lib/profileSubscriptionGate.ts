import type { SupabaseClient, User } from '@supabase/supabase-js';

/** PostgREST: `.single()` when zero rows (or multiple) — a real "no profile row" case. */
export const PROFILE_ROW_MISSING_CODE = 'PGRST116';

export type ProfileSubscriptionRow = {
  subscription_status?: string | null;
  subscription_tier?: string | null;
  avatar_url?: string | null;
  full_name?: string | null;
  username?: string | null;
};

const PROFILE_SUBSCRIPTION_SELECT = 'subscription_status, subscription_tier, avatar_url, full_name, username';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProFromProfileRow(profile: ProfileSubscriptionRow | null): boolean {
  if (!profile) return false;
  const active =
    profile.subscription_status === 'active' || profile.subscription_status === 'trialing';
  const proTier = profile.subscription_tier === 'pro';
  return Boolean(active && proTier);
}

/** Fallback when `profiles` cannot be read (network / transient DB). Mirrors `lib/subscription.ts`. */
export function isProFromUserMetadata(user: User): boolean {
  const metadata = user.user_metadata || {};
  const subscriptionStatus = metadata.subscription_status as string | undefined;
  const subscriptionPlan = String(metadata.subscription_plan || '').toLowerCase();
  const trialEndsAt = metadata.trial_ends_at as string | undefined;

  const isActive = subscriptionStatus === 'active';
  const isTrialActive = trialEndsAt && new Date(trialEndsAt) > new Date();

  if (!isActive && !isTrialActive) return false;
  return subscriptionPlan.includes('pro');
}

/**
 * Load subscription tier from `profiles` with retries. Distinguishes "no row" from transient errors.
 * On repeated failure, falls back to JWT user_metadata so paying users are not sent home on a flaky read.
 */
export async function fetchProfileProStatusWithRetries(
  supabase: SupabaseClient,
  user: User,
  options?: { attempts?: number; initialDelayMs?: number }
): Promise<{ profile: ProfileSubscriptionRow | null; isPro: boolean; usedMetadataFallback: boolean }> {
  const attempts = Math.max(1, options?.attempts ?? 4);
  const initialDelayMs = options?.initialDelayMs ?? 200;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(PROFILE_SUBSCRIPTION_SELECT)
      .eq('id', user.id)
      .single();

    if (!error) {
      const row = profile as ProfileSubscriptionRow | null;
      return { profile: row, isPro: isProFromProfileRow(row), usedMetadataFallback: false };
    }

    if (error.code === PROFILE_ROW_MISSING_CODE) {
      return { profile: null, isPro: false, usedMetadataFallback: false };
    }

    if (attempt < attempts - 1) {
      await sleep(initialDelayMs * (attempt + 1));
    }
  }

  return {
    profile: null,
    isPro: isProFromUserMetadata(user),
    usedMetadataFallback: true,
  };
}
