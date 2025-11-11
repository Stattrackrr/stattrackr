"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import Navigation from "@/components/navigation";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import type { BillingCycle } from "@/lib/stripe";
import Image from "next/image";

// Price IDs - imported directly to avoid server-side Stripe initialization on client
const PRICE_IDS = {
  pro: {
    monthly: 'price_1SPPbkF0aO6V0EHjOXoydTwT',
    semiannual: 'price_1SPPdVF0aO6V0EHj3DM4hFqS',
    annual: 'price_1SPPdvF0aO6V0EHjJAj8l0nO',
  },
} as const;

interface Profile {
  subscription_status?: string;
  subscription_tier?: string;
  subscription_billing_cycle?: string;
  subscription_current_period_end?: string;
  stripe_customer_id?: string;
}

interface PaymentMethod {
  brand?: string;
  last4?: string;
  exp_month?: number;
  exp_year?: number;
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<BillingCycle>('monthly');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [billingEmail, setBillingEmail] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [hasTriedAutoRedirect, setHasTriedAutoRedirect] = useState(false);

  useEffect(() => {
    loadUserData();
    
    // Check for success/cancel params
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('success') === 'true') {
      alert('✅ Subscription successful! Welcome to Pro!');
      router.replace('/subscription');
    }
    if (searchParams.get('canceled') === 'true') {
      // Silently clear the URL parameter without showing a message
      router.replace('/subscription');
    }
  }, []);

  // Auto-redirect to Stripe portal if user has active subscription (only once)
  useEffect(() => {
    const hasActiveSubscription = profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing';
    if (!loading && !hasTriedAutoRedirect && hasActiveSubscription && profile?.stripe_customer_id) {
      setHasTriedAutoRedirect(true);
      handleOpenPortal();
    }
  }, [loading, profile?.subscription_status, profile?.stripe_customer_id, hasTriedAutoRedirect]);

  async function loadUserData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setBillingEmail(user.email || '');
        
        // Set full name from user metadata
        const firstName = user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || '';
        const lastName = user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || '';
        setFullName(`${firstName} ${lastName}`.trim() || 'User');
        
        // Fetch profile data
        const { data: profileData } = await supabase
          .from('profiles')
          .select('subscription_status, subscription_tier, subscription_billing_cycle, subscription_current_period_end, stripe_customer_id')
          .eq('id', user.id)
          .single();
        
        if (profileData) {
          setProfile(profileData);
          
          // Fetch payment method if user has active subscription
          if (profileData.stripe_customer_id && (profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing')) {
            await fetchPaymentMethod();
          }
        }
      } else {
        // Redirect to login with return path
        router.push('/login?redirect=/subscription');
      }
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPaymentMethod() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/payment-method', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.paymentMethod) {
          setPaymentMethod(data.paymentMethod);
        }
      }
    } catch (error) {
      console.error('Error fetching payment method:', error);
    }
  }

  const handleOpenPortal = async () => {
    try {
      console.log('Opening portal...');
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        console.error('No session found');
        alert('Please log in again');
        return;
      }
      
      console.log('Session found, calling API...');
      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      
      const data = await response.json();
      console.log('API response:', data);
      
      if (data.url) {
        console.log('Redirecting to:', data.url);
        window.location.href = data.url;
      } else {
        console.error('No URL in response');
        alert('Error: ' + (data.error || 'Failed to open portal'));
      }
    } catch (error: any) {
      console.error('Portal error:', error);
      alert('Error: ' + error.message);
    }
  };

  const handleStartCheckout = async (billingCycleOverride?: BillingCycle) => {
    setCheckoutLoading(true);
    
    try {
      const cycle = billingCycleOverride ?? selectedBillingCycle;
      const priceId = PRICE_IDS.pro[cycle];
      
      // Get session token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Please log in to continue');
      }
      
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          priceId,
          billingCycle: cycle,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert(error.message || 'Failed to start checkout. Please try again.');
    }
    setCheckoutLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e27] text-white">
        <Navigation />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  const hasActiveSubscription = profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing';
  const subscriptionTier = profile?.subscription_tier || 'free';

  // Pricing options
  const pricingOptions = [
    { cycle: 'monthly' as BillingCycle, label: 'Monthly', price: '$9.99', perMonth: '$9.99/mo' },
    { cycle: 'semiannual' as BillingCycle, label: '6 Months', price: '$49.99', perMonth: '$8.33/mo', savings: 'Save 17%' },
    { cycle: 'annual' as BillingCycle, label: 'Annual', price: '$89.99', perMonth: '$7.50/mo', savings: 'Save 25%' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      
      <div className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-8 py-12">
          {/* Header with Back Button and Centered Logo */}
          <div className="relative flex items-center justify-center mb-8">
            {/* Back Button - Absolute positioned on left */}
            <button
              onClick={() => router.push('/pricing')}
              className="absolute left-0 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back</span>
            </button>
            
            {/* Logo - Centered */}
            <div className="flex items-center gap-3">
              <Image 
                src="/images/stattrackr-icon.png" 
                alt="StatTrackr Logo" 
                width={48} 
                height={48}
                className="w-12 h-12"
              />
              <div>
                <h1 className="text-2xl font-black text-gray-900">
                  StatTrackr
                </h1>
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  Subscription
                </p>
              </div>
            </div>
          </div>

            {/* Current Plan Status */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6 mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-blue-900 mb-1">Current Plan</p>
                  <h2 className="text-3xl font-bold text-blue-900">
                    {hasActiveSubscription ? 'Pro' : 'Free'}
                  </h2>
                  {hasActiveSubscription && profile?.subscription_billing_cycle && (
                    <p className="text-sm text-blue-700 mt-1 capitalize">
                      {profile.subscription_billing_cycle} billing
                    </p>
                  )}
                </div>
                {hasActiveSubscription && (
                  <div className="text-right">
                    <div className="inline-flex items-center px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm font-medium">
                      ✓ Active
                    </div>
                    {profile?.subscription_current_period_end && (
                      <p className="text-sm text-blue-700 mt-2">
                        Renews {new Date(profile.subscription_current_period_end).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Billing Information */}
            <div className="bg-white border border-gray-200 rounded-lg mb-6">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Billing Information</h3>
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-gray-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Name</p>
                        <p className="text-sm text-gray-600">{fullName || 'No name on file'}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-gray-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Email Address</p>
                        <p className="text-sm text-gray-600">{billingEmail || 'No email on file'}</p>
                      </div>
                    </div>
                  </div>
                  
                  {hasActiveSubscription && profile?.subscription_current_period_end && (
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-gray-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <div>
                          <p className="text-sm font-medium text-gray-900">Next Billing Date</p>
                          <p className="text-sm text-gray-600">
                            {new Date(profile.subscription_current_period_end).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'long', 
                              day: 'numeric' 
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Active Payment Method */}
            <div className="bg-white border border-gray-200 rounded-lg mb-6">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Method</h3>
                {hasActiveSubscription && paymentMethod ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-8 bg-gradient-to-br from-blue-600 to-blue-800 rounded flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 capitalize">
                          {paymentMethod.brand || 'Card'} ending in {paymentMethod.last4}
                        </p>
                        <p className="text-sm text-gray-600">
                          Expires {paymentMethod.exp_month}/{paymentMethod.exp_year}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => window.location.href = '/api/portal'}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Update
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-gray-500">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    <p className="text-sm">No payment method on file</p>
                  </div>
                )}
              </div>
            </div>

            {/* Subscription Management - Always show all options */}
            <div className="bg-white border border-gray-200 rounded-lg mb-6">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {hasActiveSubscription ? 'Manage Subscription' : 'Subscription Options'}
                </h3>
                
                {/* Always show all subscription options */}
                <div className="space-y-3">
                  {/* Upgrade to Pro - Only show for free accounts */}
                  {!hasActiveSubscription && (
                    <button
                      onClick={() => handleStartCheckout('monthly')}
                      disabled={checkoutLoading}
                      className={`w-full flex items-center justify-between px-4 py-3 border-2 border-blue-500 bg-blue-50 rounded-lg transition-colors mb-4 ${checkoutLoading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-100'}`}
                    >
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div className="text-left">
                          <p className="font-medium text-blue-900">Upgrade to Pro</p>
                          <p className="text-sm text-blue-700">Start 7-day free trial • Monthly plan</p>
                        </div>
                      </div>
                      <svg className={`w-5 h-5 text-blue-600 transition-transform ${checkoutLoading ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )}

                  {/* Update Payment Method */}
                  <button
                    onClick={() => hasActiveSubscription && handleOpenPortal()}
                    disabled={!hasActiveSubscription}
                    className={`w-full flex items-center justify-between px-4 py-3 border rounded-lg transition-colors ${
                      hasActiveSubscription
                        ? 'border-gray-200 hover:border-blue-500 hover:bg-blue-50 cursor-pointer'
                        : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      <div className="text-left">
                        <p className="font-medium text-gray-900">Update Payment Method</p>
                        <p className="text-sm text-gray-500">
                          {hasActiveSubscription ? 'Change your credit card' : 'Requires active subscription'}
                        </p>
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* View Invoices */}
                  <button
                    onClick={() => hasActiveSubscription && handleOpenPortal()}
                    disabled={!hasActiveSubscription}
                    className={`w-full flex items-center justify-between px-4 py-3 border rounded-lg transition-colors ${
                      hasActiveSubscription
                        ? 'border-gray-200 hover:border-blue-500 hover:bg-blue-50 cursor-pointer'
                        : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div className="text-left">
                        <p className="font-medium text-gray-900">View Invoices</p>
                        <p className="text-sm text-gray-500">
                          {hasActiveSubscription ? 'Download past receipts' : 'Requires active subscription'}
                        </p>
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Cancel Subscription */}
                  <button
                    onClick={() => {
                      if (hasActiveSubscription && window.confirm('Are you sure you want to cancel your subscription? You will lose access to Pro features at the end of your billing period.')) {
                        handleOpenPortal();
                      }
                    }}
                    disabled={!hasActiveSubscription}
                    className={`w-full flex items-center justify-between px-4 py-3 border rounded-lg transition-colors ${
                      hasActiveSubscription
                        ? 'border-red-200 hover:border-red-500 hover:bg-red-50 cursor-pointer'
                        : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <svg className={`w-5 h-5 ${hasActiveSubscription ? 'text-red-600' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <div className="text-left">
                        <p className={`font-medium ${hasActiveSubscription ? 'text-red-600' : 'text-gray-900'}`}>
                          Cancel Subscription
                        </p>
                        <p className={`text-sm ${hasActiveSubscription ? 'text-red-500' : 'text-gray-500'}`}>
                          {hasActiveSubscription ? 'Stop future payments' : 'Requires active subscription'}
                        </p>
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-4">
                <span>Powered by</span>
                <svg className="h-5" viewBox="0 0 60 25" fill="currentColor">
                  <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.08 1.02a4.7 4.7 0 0 1 3.23-1.29c2.9 0 5.62 2.6 5.62 7.4 0 5.23-2.7 7.6-5.65 7.6zM40 8.95c-.95 0-1.54.34-1.97.81l.02 6.12c.4.44.98.78 1.95.78 1.52 0 2.54-1.65 2.54-3.87 0-2.15-1.04-3.84-2.54-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.32.86zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.13v5.85zm-4.91.70c0 2.97-2.31 4.66-5.73 4.66a11.2 11.2 0 0 1-4.46-.93v-3.93c1.38.75 3.1 1.31 4.46 1.31.92 0 1.53-.24 1.53-1C6.26 13.77 0 14.51 0 9.95 0 7.04 2.28 5.3 5.62 5.3c1.36 0 2.72.2 4.09.75v3.88a9.23 9.23 0 0 0-4.1-1.06c-.86 0-1.44.25-1.44.9 0 1.85 6.29.97 6.29 5.88z"/>
                </svg>
              </div>
              <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
                <a href="/terms" className="hover:text-gray-700">Terms</a>
                <a href="/privacy" className="hover:text-gray-700">Privacy</a>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
