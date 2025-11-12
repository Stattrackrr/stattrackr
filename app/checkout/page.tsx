"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Image from 'next/image';

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Billing form state
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  useEffect(() => {
    loadUser();
    // Get plan from URL params if provided
    const plan = searchParams?.get('plan');
    if (plan === 'semiannual' || plan === 'annual') {
      setSelectedPlan(plan);
    }
  }, [searchParams]);

  async function loadUser() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setEmail(user.email || '');
        setFirstName(user.user_metadata?.first_name || '');
        setLastName(user.user_metadata?.last_name || '');
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  }

  const plans = {
    monthly: {
      name: 'Monthly',
      price: 9.99,
      billingAmount: 9.99,
      billingPeriod: 'month',
      savings: null,
    },
    semiannual: {
      name: '6 Months',
      price: 8.99,
      billingAmount: 49.99,
      billingPeriod: '6 months',
      savings: '10%',
    },
    annual: {
      name: 'Annual',
      price: 7.99,
      billingAmount: 94.99,
      billingPeriod: 'year',
      savings: '20%',
    },
  };

  const currentPlan = plans[selectedPlan];

  const handleCheckout = async () => {
    if (!email || !firstName || !lastName) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      // Here you would integrate with PayPal or your payment processor
      // For now, this is a placeholder
      console.log('Processing payment for:', {
        plan: selectedPlan,
        email,
        firstName,
        lastName,
        amount: currentPlan.billingAmount,
      });

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // After successful payment, redirect to success page
      router.push('/checkout/success');
    } catch (error) {
      console.error('Payment error:', error);
      alert('Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-600 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-blue-700 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      {/* Brand Logo */}
      <div className="absolute top-6 left-6 z-10">
        <div className="flex items-center gap-3">
          <Image 
            src="/images/stattrackr-icon.png" 
            alt="StatTrackr Logo" 
            width={80} 
            height={80}
            className="w-12 h-12 sm:w-16 sm:h-16"
          />
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white">
              StatTrackr
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wide">
              Analytics & Betting Insights
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-12 sm:py-16 relative z-10">
        <div className="mt-16 mb-8">
          <button
            onClick={() => router.push('/home')}
            className="text-gray-300 hover:text-white flex items-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Pricing
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Plan Selection & Order Summary */}
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Complete Your Purchase</h1>
              <p className="text-gray-300">Start your 7-day free trial today</p>
            </div>

            {/* Plan Selection */}
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6">
              <h2 className="text-xl font-bold text-white mb-4">Select Your Plan</h2>
              <div className="space-y-3">
                {/* Monthly */}
                <button
                  onClick={() => setSelectedPlan('monthly')}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                    selectedPlan === 'monthly'
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-white/10 bg-slate-800/40 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPlan === 'monthly' ? 'border-purple-500' : 'border-gray-400'
                        }`}>
                          {selectedPlan === 'monthly' && (
                            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                          )}
                        </div>
                        <div>
                          <p className="text-white font-semibold">Monthly</p>
                          <p className="text-gray-400 text-sm">Most flexible</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold text-lg">$9.99</p>
                      <p className="text-gray-400 text-sm">/month</p>
                    </div>
                  </div>
                </button>

                {/* 6-Month */}
                <button
                  onClick={() => setSelectedPlan('semiannual')}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                    selectedPlan === 'semiannual'
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-white/10 bg-slate-800/40 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPlan === 'semiannual' ? 'border-purple-500' : 'border-gray-400'
                        }`}>
                          {selectedPlan === 'semiannual' && (
                            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                          )}
                        </div>
                        <div>
                          <p className="text-white font-semibold">6 Months</p>
                          <p className="text-emerald-400 text-sm font-medium">Save 10%</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold text-lg">$8.99</p>
                      <p className="text-gray-400 text-sm">/month</p>
                      <p className="text-gray-500 text-xs">$49.99 billed every 6 months</p>
                    </div>
                  </div>
                </button>

                {/* Annual */}
                <button
                  onClick={() => setSelectedPlan('annual')}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left relative ${
                    selectedPlan === 'annual'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-white/10 bg-slate-800/40 hover:border-white/20'
                  }`}
                >
                  <div className="absolute -top-3 right-4">
                    <span className="bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                      MOST POPULAR
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPlan === 'annual' ? 'border-emerald-500' : 'border-gray-400'
                        }`}>
                          {selectedPlan === 'annual' && (
                            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                          )}
                        </div>
                        <div>
                          <p className="text-white font-semibold">Annual</p>
                          <p className="text-emerald-400 text-sm font-medium">Save 20%</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold text-lg">$7.99</p>
                      <p className="text-gray-400 text-sm">/month</p>
                      <p className="text-gray-500 text-xs">$94.99 billed annually</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Order Summary */}
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6">
              <h2 className="text-xl font-bold text-white mb-4">Order Summary</h2>
              <div className="space-y-3">
                <div className="flex justify-between text-gray-300">
                  <span>{currentPlan.name} Plan</span>
                  <span>${currentPlan.billingAmount}</span>
                </div>
                <div className="flex justify-between text-emerald-400 font-medium">
                  <span>7-Day Free Trial</span>
                  <span>-${currentPlan.billingAmount}</span>
                </div>
                <div className="border-t border-white/10 pt-3 mt-3">
                  <div className="flex justify-between text-white font-bold text-lg">
                    <span>Due Today</span>
                    <span>$0.00</span>
                  </div>
                  <p className="text-gray-400 text-sm mt-2">
                    You'll be charged ${currentPlan.billingAmount} after your 7-day free trial ends
                  </p>
                </div>
              </div>
            </div>

            {/* Features Included */}
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">What's Included</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300 text-sm">Advanced player stats & analytics</span>
                </div>
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300 text-sm">Real-time odds & injury reports</span>
                </div>
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300 text-sm">DvP rankings & matchup analysis</span>
                </div>
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300 text-sm">Bet tracking & journal analytics</span>
                </div>
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300 text-sm">Admin picks & expert insights</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Billing Information & Payment */}
          <div className="space-y-6">
            {/* Billing Information */}
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6">
              <h2 className="text-xl font-bold text-white mb-4">Billing Information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="John"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Doe"
                      required
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6">
              <h2 className="text-xl font-bold text-white mb-4">Payment Method</h2>
              
              {/* PayPal Button Placeholder */}
              <div className="mb-4">
                <div className="bg-[#0070ba] hover:bg-[#005ea6] text-white font-bold py-4 px-6 rounded-lg cursor-pointer transition-colors text-center">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.067 8.478c.492.88.556 2.014.3 3.327-.74 3.806-3.276 5.12-6.514 5.12h-.5a.805.805 0 0 0-.794.68l-.04.22-.63 3.993-.03.14a.8.8 0 0 1-.79.68H7.76a.483.483 0 0 1-.477-.558L8.98 11.8h.004c.04-.23.25-.4.486-.4h2.946c4.193 0 7.452-1.7 8.405-6.616.334-1.72.058-3.16-.754-4.306z"/>
                      <path d="M7.42 0h6.327c1.18 0 2.14.096 2.913.315C18.208.777 19.22 1.85 19.628 3.56c.184.77.253 1.62.214 2.533-.746 4.836-3.997 7.32-9.146 7.32H8.751a.69.69 0 0 0-.682.582l-.015.076-.93 5.894a.424.424 0 0 1-.418.357h-3.13a.279.279 0 0 1-.276-.323l2.096-13.29c.048-.3.3-.523.606-.523h4.418z"/>
                    </svg>
                    <span>Pay with PayPal</span>
                  </div>
                </div>
                <p className="text-gray-400 text-xs mt-2 text-center">
                  You'll be redirected to PayPal to complete your purchase
                </p>
              </div>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-slate-900 text-gray-400">or pay with card</span>
                </div>
              </div>

              {/* Card Payment Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Card Number
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="1234 5678 9012 3456"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Expiry Date
                    </label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="MM/YY"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      CVC
                    </label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="123"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Complete Purchase Button */}
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold text-lg rounded-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                `Start 7-Day Free Trial`
              )}
            </button>

            <div className="text-center space-y-2">
              <p className="text-gray-400 text-sm">
                🔒 Secure checkout powered by industry-leading encryption
              </p>
              <p className="text-gray-400 text-xs">
                By continuing, you agree to our Terms of Service and Privacy Policy
              </p>
              <p className="text-gray-400 text-xs">
                Cancel anytime during your trial • No charges until trial ends
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading checkout...</div>
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  );
}
