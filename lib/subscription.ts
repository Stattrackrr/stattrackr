import { supabase } from './supabaseClient';

export type SubscriptionTier = 'free' | 'premium' | 'pro';

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  isActive: boolean;
  planName?: string;
  nextBillingDate?: string;
  trialEndsAt?: string;
}

/**
 * Check if user has an active subscription
 */
export async function checkSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      return {
        tier: 'free',
        isActive: false,
      };
    }

    // Check profiles table first (source of truth)
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, subscription_tier, subscription_billing_cycle, subscription_current_period_end')
      .eq('id', user.id)
      .single();

    if (profile) {
      // Use profiles table data
      const isActive = profile.subscription_status === 'active' || profile.subscription_status === 'trialing';
      const tier: SubscriptionTier = profile.subscription_tier === 'pro' ? 'pro' : 'free';
      
      return {
        tier,
        isActive,
        planName: profile.subscription_billing_cycle,
        nextBillingDate: profile.subscription_current_period_end,
      };
    }

    // Fallback to user_metadata (for dev/testing)
    const metadata = user.user_metadata || {};
    const subscriptionStatus = metadata.subscription_status;
    const subscriptionPlan = metadata.subscription_plan;
    const nextBillingDate = metadata.next_billing_date;
    const trialEndsAt = metadata.trial_ends_at;

    // Check if subscription is active
    const isActive = subscriptionStatus === 'active';
    
    // Check if trial is active
    const isTrialActive = trialEndsAt && new Date(trialEndsAt) > new Date();
    
    // Determine tier based on plan name
    let tier: SubscriptionTier = 'free';
    if (isActive || isTrialActive) {
      const planLower = (subscriptionPlan || '').toLowerCase();
      if (planLower.includes('pro')) {
        tier = 'pro';
      } else if (planLower.includes('premium')) {
        tier = 'premium';
      }
    }

    return {
      tier,
      isActive: isActive || !!isTrialActive,
      planName: subscriptionPlan,
      nextBillingDate,
      trialEndsAt,
    };
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return {
      tier: 'free',
      isActive: false,
    };
  }
}

/**
 * Check if user has access to premium features
 */
export async function hasPremiumAccess(): Promise<boolean> {
  const status = await checkSubscriptionStatus();
  return status.isActive && (status.tier === 'premium' || status.tier === 'pro');
}

/**
 * Check if user has access to pro features
 */
export async function hasProAccess(): Promise<boolean> {
  const status = await checkSubscriptionStatus();
  return status.isActive && status.tier === 'pro';
}

/**
 * Feature gate: Check if user can access a specific feature
 */
export async function canAccessFeature(feature: 'advanced_stats' | 'shot_charts' | 'export_data' | 'api_access'): Promise<boolean> {
  const status = await checkSubscriptionStatus();
  
  // Feature access matrix
  const featureAccess: Record<string, SubscriptionTier[]> = {
    'advanced_stats': ['premium', 'pro'],
    'shot_charts': ['premium', 'pro'],
    'export_data': ['pro'],
    'api_access': ['pro'],
  };
  
  const requiredTiers = featureAccess[feature] || [];
  return status.isActive && requiredTiers.includes(status.tier);
}
