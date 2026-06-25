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
  readViewerProfileCache,
  resolveViewerProfile,
} from '@/lib/profileSubscriptionGate';

export type UseViewerProfileOptions = {
  /** Base login path when signed out (redirect query is appended). */
  loginRedirect?: string;
};

export function useViewerProfile(options?: UseViewerProfileOptions) {
  const router = useRouter();
  const loginRedirect = options?.loginRedirect ?? '/login';

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
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
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

    const load = async (forceRefresh = false) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        if (isMounted) {
          setViewerId(null);
          setSubscriptionChecked(true);
          setTimeout(() => {
            const returnTo =
              typeof window !== 'undefined'
                ? `${window.location.pathname}${window.location.search}`
                : '/props';
            router.push(`${loginRedirect}?redirect=${encodeURIComponent(returnTo)}`);
          }, 0);
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
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          invalidateViewerProfileCache();
          setViewerId(null);
          setIsPro(false);
          setSubscriptionChecked(true);
          router.push(loginRedirect);
        }
        return;
      }
      if (event === 'SIGNED_IN' && isMounted && session?.user) {
        void load(true);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applyFromUserMetadata, loginRedirect, router]);

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
