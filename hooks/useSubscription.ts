import { useState, useEffect, useCallback } from 'react';
import { checkSubscriptionStatus, SubscriptionStatus } from '@/lib/subscription';

export function useSubscription() {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>({
    tier: 'free',
    isActive: false,
  });
  const [loading, setLoading] = useState(true);
  const [showPaywall, setShowPaywall] = useState(false);

  // Load subscription status on mount
  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    setLoading(true);
    try {
      const status = await checkSubscriptionStatus();
      setSubscriptionStatus(status);
    } catch (error) {
      console.error('Error loading subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  // Check if user has premium access
  const hasPremium = subscriptionStatus.isActive && 
    (subscriptionStatus.tier === 'premium' || subscriptionStatus.tier === 'pro');

  // Check if user has pro access
  const hasPro = subscriptionStatus.isActive && subscriptionStatus.tier === 'pro';

  // Check feature access - don't redirect while loading
  const checkFeatureAccess = useCallback((requiredTier: 'premium' | 'pro' = 'premium'): boolean => {
    // If still loading subscription, assume access is OK (UI will gate properly after load)
    if (loading) {
      return true;
    }
    
    if (requiredTier === 'premium' && hasPremium) {
      return true;
    }
    if (requiredTier === 'pro' && hasPro) {
      return true;
    }
    
    // Only redirect to pricing page if we've finished loading and access is actually denied
    if (typeof window !== 'undefined') {
      window.location.href = '/pricing';
    }
    return false;
  }, [hasPremium, hasPro, loading]);

  // Manually trigger paywall
  const triggerPaywall = useCallback(() => {
    setShowPaywall(true);
  }, []);

  // Close paywall
  const closePaywall = useCallback(() => {
    setShowPaywall(false);
  }, []);

  // Refresh subscription status (call after upgrade/downgrade)
  const refresh = useCallback(async () => {
    await loadSubscription();
  }, []);

  return {
    subscription: subscriptionStatus,
    loading,
    hasPremium,
    hasPro,
    showPaywall,
    checkFeatureAccess,
    triggerPaywall,
    closePaywall,
    refresh,
  };
}
