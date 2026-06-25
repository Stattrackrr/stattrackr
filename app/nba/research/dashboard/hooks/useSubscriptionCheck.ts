'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import {
  displayNameFromProfile,
  avatarFromProfile,
  resolveViewerProfile,
  readViewerProfileCache,
} from '@/lib/profileSubscriptionGate';

export interface UseSubscriptionCheckParams {
  setUserEmail: (email: string | null) => void;
  setUsername: (username: string | null) => void;
  setAvatarUrl: (avatarUrl: string | null) => void;
  setIsPro: (isPro: boolean) => void;
}

export function useSubscriptionCheck({
  setUserEmail,
  setUsername,
  setAvatarUrl,
  setIsPro,
}: UseSubscriptionCheckParams) {
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;
    let subscriptionCheckInterval: NodeJS.Timeout | null = null;
    let lastSubscriptionStatus: { isActive: boolean; isPro: boolean } | null = null;
    
    const checkSubscription = async (skipCache = false) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        if (isMounted) {
          setTimeout(() => {
            router.push('/login?redirect=/nba/research/dashboard');
          }, 0);
        }
        return;
      }

      if (!isMounted) return;

      const user = session.user;

      if (!skipCache) {
        const cached = readViewerProfileCache(user.id);
        if (cached) {
          setUserEmail(cached.userEmail);
          setUsername(cached.username);
          setAvatarUrl(cached.avatarUrl);
          setIsPro(cached.isPro);
          if (!cached.isPro) {
            router.replace('/home#pricing');
          }
        }
      }

      try {
        const profile = await resolveViewerProfile(supabase, user, { forceRefresh: skipCache });
        if (!isMounted) return;

        setUserEmail(profile.userEmail);
        setUsername(profile.username);
        setAvatarUrl(profile.avatarUrl);

        const proStatus = profile.isPro;
        
        if (proStatus) {
          lastSubscriptionStatus = { isActive: true, isPro: true };
        } else {
          lastSubscriptionStatus = null;
        }
        
        if (!lastSubscriptionStatus || lastSubscriptionStatus.isPro !== proStatus || skipCache) {
          if (isMounted) {
            setIsPro(proStatus);
            if (!proStatus) {
              router.replace('/home#pricing');
              return;
            }
          }
          
          if (proStatus) {
            lastSubscriptionStatus = { isActive: true, isPro: true };
          }
        }
      } catch (error) {
        console.error('Error checking subscription:', error);
        if (lastSubscriptionStatus?.isActive && isMounted) {
          setIsPro(lastSubscriptionStatus.isPro);
        } else if (isMounted) {
          const cached = readViewerProfileCache(user.id);
          if (cached) {
            setUserEmail(cached.userEmail);
            setUsername(cached.username);
            setAvatarUrl(cached.avatarUrl);
            setIsPro(cached.isPro);
          } else {
            setUserEmail(user.email || null);
            setUsername(displayNameFromProfile(null, user));
            setAvatarUrl(avatarFromProfile(null, user));
          }
        }
      }
    };
    
    // Initial check
    checkSubscription(true);
    
    // Periodic check every 5 minutes (instead of on every token refresh)
    subscriptionCheckInterval = setInterval(() => {
      if (isMounted) {
        checkSubscription();
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Set up listener only for SIGNED_OUT and SIGNED_IN (not TOKEN_REFRESHED)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          lastSubscriptionStatus = null;
          setIsPro(false);
          router.push('/login?redirect=/nba/research/dashboard');
        }
      }
      // Only check on SIGNED_IN (not TOKEN_REFRESHED to avoid frequent checks)
      else if (event === 'SIGNED_IN' && isMounted && session?.user) {
        checkSubscription(true);
      }
    });
    
    return () => {
      isMounted = false;
      if (subscriptionCheckInterval) {
        clearInterval(subscriptionCheckInterval);
      }
      subscription?.unsubscribe();
    };
  }, [router, setUserEmail, setUsername, setAvatarUrl, setIsPro]);
}

