# Paywall Integration Guide

This guide shows you how to integrate the paywall system into your StatTrackr application.

## Overview

The paywall system consists of:
1. **Subscription utilities** (`lib/subscription.ts`) - Check user subscription status
2. **PaywallModal component** (`components/PaywallModal.tsx`) - Display upgrade prompts
3. **useSubscription hook** (`hooks/useSubscription.ts`) - Easy React integration
4. **Pricing page** (`app/pricing/page.tsx`) - Display subscription plans

## Quick Start

### 1. Add Paywall to Research Dashboard

Edit `app/nba/research/dashboard/page.tsx`:

```tsx
// Add imports at the top
import { useSubscription } from '@/hooks/useSubscription';
import PaywallModal from '@/components/PaywallModal';

// Inside your component, add the hook
function ResearchDashboard() {
  const { hasPremium, checkFeatureAccess, showPaywall, closePaywall } = useSubscription();
  
  // ... rest of your component

  // Add the modal before the closing tag
  return (
    <div>
      {/* Your existing content */}
      
      {/* Add this at the end, before closing div */}
      <PaywallModal
        isOpen={showPaywall}
        onClose={closePaywall}
        title="Upgrade to Premium"
        description="Access advanced stats and unlimited player research with a premium subscription."
      />
    </div>
  );
}
```

### 2. Gate Features Behind Paywall

#### Example: Protect Advanced Stats

Find where you fetch advanced stats (around line 4851):

```tsx
// OLD CODE:
const fetchAdvancedStats = async (playerId: string) => {
  setAdvancedStatsLoading(true);
  setAdvancedStatsError(null);
  try {
    const stats = await fetchAdvancedStatsCore(playerId);
    // ... rest of code
  }
};

// NEW CODE WITH PAYWALL:
const fetchAdvancedStats = async (playerId: string) => {
  // Check if user has premium access
  if (!checkFeatureAccess('premium')) {
    return; // Paywall will be shown automatically
  }
  
  setAdvancedStatsLoading(true);
  setAdvancedStatsError(null);
  try {
    const stats = await fetchAdvancedStatsCore(playerId);
    // ... rest of code
  }
};
```

#### Example: Protect Shot Charts

```tsx
const fetchShotDistanceStats = async (playerId: string) => {
  // Gate behind paywall
  if (!checkFeatureAccess('premium')) {
    return;
  }
  
  setShotDistanceLoading(true);
  try {
    // ... existing code
  }
};
```

### 3. Add Visual Indicators for Locked Features

Add "Premium" badges to locked features:

```tsx
// Example: Advanced Stats Section Header
<div className="flex items-center justify-between mb-4">
  <h3 className="text-lg font-semibold">Advanced Stats</h3>
  {!hasPremium && (
    <button
      onClick={() => triggerPaywall()}
      className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-lg"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Upgrade
    </button>
  )}
</div>
```

### 4. Blur/Lock Content for Free Users

```tsx
// Example: Blur advanced stats for free users
<div className={`relative ${!hasPremium ? 'filter blur-sm pointer-events-none' : ''}`}>
  {/* Advanced stats content */}
  <AdvancedStatsComponent />
  
  {!hasPremium && (
    <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      <button
        onClick={() => triggerPaywall()}
        className="px-6 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 shadow-xl"
      >
        🔓 Unlock Premium Features
      </button>
    </div>
  )}
</div>
```

## Testing

### Test Free User Experience

1. Make sure your user's `subscription_status` is NOT set to "active"
2. Try to access advanced stats - should show paywall
3. Try to access shot charts - should show paywall

### Test Premium User Experience  

To test as a premium user, update user metadata in Supabase:

```sql
-- In Supabase SQL Editor
UPDATE auth.users 
SET raw_user_meta_data = raw_user_meta_data || 
  '{
    "subscription_status": "active",
    "subscription_plan": "Premium",
    "next_billing_date": "2025-12-01"
  }'::jsonb
WHERE email = 'your-test-email@example.com';
```

## Customization

### Change Pricing

Edit `app/pricing/page.tsx`:

```tsx
const plans = [
  {
    name: 'Premium',
    price: { monthly: 29, annual: 290 }, // Change these values
    // ...
  }
];
```

### Modify Feature Gates

Edit `lib/subscription.ts`:

```tsx
const featureAccess: Record<string, SubscriptionTier[]> = {
  'advanced_stats': ['premium', 'pro'], // Requires premium or pro
  'shot_charts': ['premium', 'pro'],     // Requires premium or pro  
  'export_data': ['pro'],                 // Pro only
  'api_access': ['pro'],                  // Pro only
};
```

### Customize Paywall Message

```tsx
<PaywallModal
  isOpen={showPaywall}
  onClose={closePaywall}
  title="Unlock Advanced Analytics" // Custom title
  description="Get access to PER, TS%, and more advanced metrics" // Custom description
/>
```

## Stripe Integration (Next Steps)

To actually collect payments, you'll need to:

1. Set up Stripe account
2. Install Stripe SDK: `npm install stripe @stripe/stripe-js`
3. Create Stripe checkout session API route
4. Update user metadata after successful payment
5. Set up webhooks to handle subscription events

Example API route (`app/api/stripe/checkout/route.ts`):

```tsx
import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export async function POST(req: NextRequest) {
  const { priceId, userId } = await req.json();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_URL}/account?tab=subscription&success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_URL}/pricing`,
    client_reference_id: userId,
  });

  return NextResponse.json({ sessionId: session.id });
}
```

## Summary

Your paywall system is now ready! The key integration points are:

1. **Add the hook**: `const { hasPremium, checkFeatureAccess, showPaywall, closePaywall } = useSubscription();`
2. **Add the modal**: `<PaywallModal isOpen={showPaywall} onClose={closePaywall} />`
3. **Gate features**: Check access with `if (!checkFeatureAccess('premium')) return;`
4. **Show indicators**: Display "Premium" badges on locked features

Need help? The system is flexible and can be customized to fit your exact needs!
