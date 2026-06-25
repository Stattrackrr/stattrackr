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

export type ViewerProfile = {
  userId: string;
  userEmail: string | null;
  username: string | null;
  avatarUrl: string | null;
  isPro: boolean;
  profile: ProfileSubscriptionRow | null;
  usedMetadataFallback: boolean;
  cached: boolean;
};

const PROFILE_SUBSCRIPTION_SELECT = 'subscription_status, subscription_tier, avatar_url, full_name, username';
const VIEWER_PROFILE_CACHE_KEY = 'st_viewer_profile_v1';
const VIEWER_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

type ViewerProfileCacheEntry = Omit<ViewerProfile, 'cached'> & { timestamp: number };

let memoryViewerProfile: ViewerProfileCacheEntry | null = null;
const viewerProfileInFlight = new Map<string, Promise<ViewerProfile>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProFromProfileRow(profile: ProfileSubscriptionRow | null): boolean {
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

export function displayNameFromProfile(
  profile: ProfileSubscriptionRow | null,
  user: User
): string | null {
  return (
    profile?.full_name ||
    profile?.username ||
    (user.user_metadata?.username as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    null
  );
}

export function avatarFromProfile(profile: ProfileSubscriptionRow | null, user: User): string | null {
  return (
    profile?.avatar_url ??
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null
  );
}

function buildViewerProfile(
  user: User,
  profile: ProfileSubscriptionRow | null,
  isPro: boolean,
  usedMetadataFallback: boolean,
  cached: boolean
): ViewerProfile {
  return {
    userId: user.id,
    userEmail: user.email ?? null,
    username: displayNameFromProfile(profile, user),
    avatarUrl: avatarFromProfile(profile, user),
    isPro,
    profile,
    usedMetadataFallback,
    cached,
  };
}

function readSessionViewerProfileCache(userId: string): ViewerProfileCacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(VIEWER_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ViewerProfileCacheEntry;
    if (parsed?.userId !== userId) return null;
    if (Date.now() - Number(parsed.timestamp) > VIEWER_PROFILE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeViewerProfileCache(entry: Omit<ViewerProfile, 'cached'>): void {
  const withTs: ViewerProfileCacheEntry = { ...entry, timestamp: Date.now() };
  memoryViewerProfile = withTs;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(VIEWER_PROFILE_CACHE_KEY, JSON.stringify(withTs));
  } catch {
    // Quota or private mode — memory cache still helps within the tab.
  }
}

export function readViewerProfileCache(userId: string): ViewerProfile | null {
  const fromMemory =
    memoryViewerProfile?.userId === userId &&
    Date.now() - memoryViewerProfile.timestamp < VIEWER_PROFILE_CACHE_TTL_MS
      ? memoryViewerProfile
      : null;
  const entry = fromMemory ?? readSessionViewerProfileCache(userId);
  if (!entry) return null;
  if (!fromMemory) memoryViewerProfile = entry;
  const { timestamp: _ts, ...rest } = entry;
  return { ...rest, cached: true };
}

export function invalidateViewerProfileCache(): void {
  memoryViewerProfile = null;
  viewerProfileInFlight.clear();
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(VIEWER_PROFILE_CACHE_KEY);
  } catch {
    // ignore
  }
}

async function fetchProfileRowOnce(
  supabase: SupabaseClient,
  user: User
): Promise<{ profile: ProfileSubscriptionRow | null; isPro: boolean; usedMetadataFallback: boolean }> {
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

  // One quick retry for transient PostgREST / network blips.
  await sleep(80);
  const retry = await supabase
    .from('profiles')
    .select(PROFILE_SUBSCRIPTION_SELECT)
    .eq('id', user.id)
    .single();

  if (!retry.error) {
    const row = retry.data as ProfileSubscriptionRow | null;
    return { profile: row, isPro: isProFromProfileRow(row), usedMetadataFallback: false };
  }

  if (retry.error.code === PROFILE_ROW_MISSING_CODE) {
    return { profile: null, isPro: false, usedMetadataFallback: false };
  }

  return {
    profile: null,
    isPro: isProFromUserMetadata(user),
    usedMetadataFallback: true,
  };
}

/**
 * Cached profile + pro gate. Reuses in-flight work and session cache so sidebars paint instantly.
 */
export async function resolveViewerProfile(
  supabase: SupabaseClient,
  user: User,
  options?: { forceRefresh?: boolean }
): Promise<ViewerProfile> {
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh) {
    const cached = readViewerProfileCache(user.id);
    if (cached) return cached;
  }

  const existing = viewerProfileInFlight.get(user.id);
  if (existing) return existing;

  const promise = (async () => {
    const result = await fetchProfileRowOnce(supabase, user);
    const viewer = buildViewerProfile(
      user,
      result.profile,
      result.isPro,
      result.usedMetadataFallback,
      false
    );
    writeViewerProfileCache({
      userId: viewer.userId,
      userEmail: viewer.userEmail,
      username: viewer.username,
      avatarUrl: viewer.avatarUrl,
      isPro: viewer.isPro,
      profile: viewer.profile,
      usedMetadataFallback: viewer.usedMetadataFallback,
    });
    return viewer;
  })().finally(() => {
    viewerProfileInFlight.delete(user.id);
  });

  viewerProfileInFlight.set(user.id, promise);
  return promise;
}

/**
 * Load subscription tier from `profiles` with retries. Distinguishes "no row" from transient errors.
 * On repeated failure, falls back to JWT user_metadata so paying users are not sent home on a flaky read.
 */
export async function fetchProfileProStatusWithRetries(
  supabase: SupabaseClient,
  user: User,
  options?: { attempts?: number; initialDelayMs?: number; forceRefresh?: boolean }
): Promise<{ profile: ProfileSubscriptionRow | null; isPro: boolean; usedMetadataFallback: boolean }> {
  if (!options?.attempts && !options?.initialDelayMs) {
    const viewer = await resolveViewerProfile(supabase, user, {
      forceRefresh: options?.forceRefresh,
    });
    return {
      profile: viewer.profile,
      isPro: viewer.isPro,
      usedMetadataFallback: viewer.usedMetadataFallback,
    };
  }

  const attempts = Math.max(1, options?.attempts ?? 2);
  const initialDelayMs = options?.initialDelayMs ?? 80;

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
