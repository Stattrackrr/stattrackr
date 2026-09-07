'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  avatarFromProfile,
  displayNameFromProfile,
  invalidateViewerProfileCache,
  isProFromUserMetadata,
  peekViewerProfileCache,
  readViewerProfileCache,
  resolveViewerProfile,
} from '@/lib/profileSubscriptionGate';

export type UseViewerProfileOptions = {
  /** Base login path when signed out (redirect query is appended). */
  loginRedirect?: string;
  /** When false, stay on the page if there is no session. Default true. */
  requireAuth?: boolean;
};

async function resolveAuthUser(): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export function useViewerProfile(options?: UseViewerProfileOptions) {
  const router = useRouter();
  const loginRedirect = options?.loginRedirect ?? '/login';
  const requireAuth = options?.requireAuth !== false;

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);

  const applyFromUserMetadata = useCallback((user: User) => {
    setViewerId(user.id);
    setUserEmail(user.email ?? null);
    setUsername(displayNameFromProfile(null, user));
    setAvatarUrl(avatarFromProfile(null, user));
    setIsPro(isProFromUserMetadata(user));
    setSubscriptionChecked(true);
  }, []);

  const refresh = useCallback(async () => {
    const user = await resolveAuthUser();
    if (!user) return;
    const profile = await resolveViewerProfile(supabase, user, { forceRefresh: true });
    setViewerId(profile.userId);
    setUserEmail(profile.userEmail);
    setUsername(profile.username);
    setAvatarUrl(profile.avatarUrl);
    setIsPro(profile.isPro);
    setSubscriptionChecked(true);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const cached = peekViewerProfileCache();
    if (cached) {
      setViewerId(cached.userId);
      setUserEmail(cached.userEmail);
      setUsername(cached.username);
      setAvatarUrl(cached.avatarUrl);
      setIsPro(cached.isPro);
      setSubscriptionChecked(true);
    }

    const load = async (forceRefresh = false) => {
      const user = await resolveAuthUser();

      if (!user) {
        if (isMounted) {
          // Don't wipe a cached identity just because the session isn't ready yet;
          // INITIAL_SESSION / SIGNED_IN will confirm or SIGNED_OUT will clear it.
          if (!peekViewerProfileCache()) {
            setViewerId(null);
            setUserEmail(null);
            setUsername(null);
            setAvatarUrl(null);
            setIsPro(false);
          }
          setSubscriptionChecked(true);
          if (requireAuth) {
            setTimeout(() => {
              const returnTo =
                typeof window !== 'undefined'
                  ? `${window.location.pathname}${window.location.search}`
                  : '/props';
              router.push(`${loginRedirect}?redirect=${encodeURIComponent(returnTo)}`);
            }, 0);
          }
        }
        return;
      }

      if (!forceRefresh) {
        const cached = readViewerProfileCache(user.id);
        if (cached && isMounted) {
          setViewerId(cached.userId);
          setUserEmail(cached.userEmail);
          setUsername(cached.username);
          setAvatarUrl(cached.avatarUrl);
          setIsPro(cached.isPro);
          setSubscriptionChecked(true);
        }
      }

      try {
        const profile = await resolveViewerProfile(supabase, user, { forceRefresh });
        if (!isMounted) return;
        setViewerId(profile.userId);
        setUserEmail(profile.userEmail);
        setUsername(profile.username);
        setAvatarUrl(profile.avatarUrl);
        setIsPro(profile.isPro);
        setSubscriptionChecked(true);
      } catch (error) {
        console.error('Error resolving viewer profile:', error);
        if (!isMounted) return;
        const cached = readViewerProfileCache(user.id);
        if (cached) {
          setViewerId(cached.userId);
          setUserEmail(cached.userEmail);
          setUsername(cached.username);
          setAvatarUrl(cached.avatarUrl);
          setIsPro(cached.isPro);
          setSubscriptionChecked(true);
          return;
        }
        applyFromUserMetadata(user);
      }
    };

    void load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session?.user)) {
        if (isMounted) {
          invalidateViewerProfileCache();
          setViewerId(null);
          setUserEmail(null);
          setUsername(null);
          setAvatarUrl(null);
          setIsPro(false);
          setSubscriptionChecked(true);
          if (requireAuth && event === 'SIGNED_OUT') {
            router.push(loginRedirect);
          }
        }
        return;
      }
      if (
        isMounted &&
        session?.user &&
        (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')
      ) {
        void load(event === 'SIGNED_IN' || event === 'USER_UPDATED');
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applyFromUserMetadata, loginRedirect, requireAuth, router]);

  return {
    viewerId,
    userEmail,
    username,
    avatarUrl,
    isPro,
    subscriptionChecked,
    setUsername,
    setAvatarUrl,
    refresh,
    invalidateViewerProfileCache,
  };
}
