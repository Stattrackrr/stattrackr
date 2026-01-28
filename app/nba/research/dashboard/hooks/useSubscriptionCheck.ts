'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

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
      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        if (isMounted) {
          // No session - redirect to login with return path (non-blocking)
          setTimeout(() => {
            router.push('/login?redirect=/nba/research/dashboard');
          }, 0);
        }
        return;
      }

      if (!isMounted) return;

      // Don't set email/username/avatar until we have profile — set all together below to avoid flash of email before name

      try {
        // Load profile first: name and avatar are single source of truth
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('subscription_status, subscription_tier, avatar_url, full_name, username')
          .eq('id', session.user.id)
          .single();

        if (!isMounted) return;
        const profileData = profile as { subscription_status?: string; subscription_tier?: string; avatar_url?: string | null; full_name?: string | null; username?: string | null } | null;
        const displayName = profileData?.full_name || profileData?.username || session.user.user_metadata?.username || session.user.user_metadata?.full_name || null;
        const avatarFromProfile = profileData?.avatar_url ?? session.user.user_metadata?.avatar_url ?? session.user.user_metadata?.picture ?? null;
        setUserEmail(session.user.email || null);
        setUsername(displayName);
        setAvatarUrl(avatarFromProfile);
        
        let isActive = false;
        let isProTier = false;
        
        if (profileData) {
          // Use profiles table if available
          isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
          isProTier = profileData.subscription_tier === 'pro';
        } else {
          // Fallback to user_metadata for dev testing
          const metadata = session.user.user_metadata || {};
          isActive = metadata.subscription_status === 'active';
          isProTier = metadata.subscription_plan === 'pro';
        }
        
        const proStatus = isActive && isProTier;
        
        // Cache active subscription status (to prevent logouts on errors)
        // But always update if subscription expires (isActive becomes false)
        if (isActive) {
          lastSubscriptionStatus = { isActive: true, isPro: proStatus };
        } else {
          // Subscription expired - clear cache and update immediately
          lastSubscriptionStatus = null;
        }
        
        // Always update if status changed, subscription expired, or if this is the first check
        if (!lastSubscriptionStatus || lastSubscriptionStatus.isPro !== proStatus || !isActive || skipCache) {
          // Debug logging removed('🔐 Dashboard Pro Status Check:', { isActive, isProTier, proStatus, profile, metadata: session.user.user_metadata });
          
          if (isMounted) {
            setIsPro(proStatus);
            if (!proStatus) {
              router.replace('/home#pricing');
              return;
            }
          }
          
          if (isActive) {
            lastSubscriptionStatus = { isActive, isPro: proStatus };
          }
        }
      } catch (error) {
        console.error('Error checking subscription:', error);
        // If we have a cached active subscription, keep it (never log out active subscribers)
        if (lastSubscriptionStatus?.isActive && isMounted) {
          // Debug logging removed('🔐 Using cached active subscription status due to error');
          setIsPro(lastSubscriptionStatus.isPro);
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

