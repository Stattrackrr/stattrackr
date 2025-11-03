"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import Navigation from "@/components/navigation";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { PRICE_IDS } from "@/lib/stripe";
import type { BillingCycle } from "@/lib/stripe";

export default function SubscriptionPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<BillingCycle>('monthly');

  useEffect(() => {
    loadUserData();
    
    // Check for success/cancel params
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('success') === 'true') {
      alert('✅ Subscription successful! Welcome to Pro!');
      router.replace('/subscription');
    }
    if (searchParams.get('canceled') === 'true') {
      alert('Checkout canceled. You can try again anytime.');
      router.replace('/subscription');
    }
  }, []);

  async function loadUserData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleStartCheckout = async () => {
    setCheckoutLoading(true);
    
    try {
      const priceId = PRICE_IDS.pro[selectedBillingCycle];
      
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId,
          billingCycle: selectedBillingCycle,
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
      setCheckoutLoading(false);
    }
  };

  const handleUpdateSubscription = () => {
    // TODO: Implement subscription update logic via Stripe Customer Portal
    console.log("Update subscription clicked");
  };

  const handleCancelSubscription = () => {
    if (confirm("Are you sure you want to cancel your subscription?")) {
      // TODO: Implement subscription cancellation logic
      console.log("Cancel subscription clicked");
    }
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

  const subscriptionStatus = user?.user_metadata?.subscription_status;
  const subscriptionPlan = user?.user_metadata?.subscription_plan || "StatTrackr";
  const nextBillingDate = user?.user_metadata?.next_billing_date;
  const billingEmail = user?.email || "";
  const billingName = [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ') || user?.user_metadata?.username || "";

  // Get pricing based on plan
  const getPlanPricing = () => {
    const plan = subscriptionPlan?.toLowerCase() || '';
    if (plan.includes('annual') || plan.includes('year')) {
      return { price: '7.99', period: 'month', billedAs: '$95.88 billed annually' };
    } else if (plan.includes('6 month') || plan.includes('semi')) {
      return { price: '8.99', period: 'month', billedAs: '$53.94 billed every 6 months' };
    } else {
      return { price: '9.99', period: 'month', billedAs: '$9.99 billed monthly' };
    }
  };

  const pricing = getPlanPricing();

  // TODO: Replace with actual invoice data from your backend
  const invoices = user?.user_metadata?.invoices || [];

  return (
    <div className="min-h-screen bg-[#0a0e27] text-white">
      <Navigation />
      
      <div className="flex min-h-screen">
        {/* Left Sidebar - 1/5 */}
        <div className="w-1/5 bg-[#0a0e27] p-8 flex flex-col">
          <div className="mb-12">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mb-6">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 9a1 1 0 112 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"/>
              </svg>
            </div>
            <h1 className="text-3xl font-bold mb-2">StatTrackr LLC partners with Stripe for simplified billing.</h1>
          </div>
          
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-white text-sm flex items-center gap-2 transition-colors mt-auto"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Return to StatTrackr LLC
          </button>
        </div>

        {/* Right Content - 4/5 */}
        <div className="w-4/5 bg-white overflow-auto">
          <div className="max-w-5xl mx-auto px-12 py-12">

          {/* Current Subscription Card */}
          <div className="bg-white border border-gray-200 rounded-lg mb-6 text-gray-900">
            <div className="p-8 border-b border-gray-200">
            <div className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-6">
              Current Subscription
            </div>
            
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-normal mb-2">{subscriptionPlan}</h2>
                <div className="text-3xl font-bold mb-4">
                  US${pricing.price} <span className="text-lg font-normal text-gray-600">per {pricing.period}</span>
                </div>
                <p className="text-sm text-gray-500 mb-2">{pricing.billedAs}</p>
                {nextBillingDate && (
                  <p className="text-sm text-gray-600">
                    Your next billing date is {nextBillingDate}.
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleUpdateSubscription}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
                >
                  Update subscription
                </button>
                <button
                  onClick={handleCancelSubscription}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel subscription
                </button>
              </div>
            </div>

            {user?.user_metadata?.payment_method && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-md">
                  <svg className="w-8 h-5" viewBox="0 0 32 20" fill="none">
                    <rect width="32" height="20" rx="3" fill="#1434CB"/>
                    <path d="M11.5 10c0-2.485 2.015-4.5 4.5-4.5s4.5 2.015 4.5 4.5-2.015 4.5-4.5 4.5-4.5-2.015-4.5-4.5z" fill="#EB001B"/>
                    <path d="M16 5.5c1.173 0 2.24.45 3.04 1.185A4.485 4.485 0 0 0 16 14.5c-1.173 0-2.24-.45-3.04-1.185A4.485 4.485 0 0 1 16 5.5z" fill="#F79E1B"/>
                  </svg>
                  <span className="text-sm font-medium">{user.user_metadata.payment_method}</span>
                  <button className="text-blue-600 hover:text-blue-700">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>

          {/* Payment Method Card */}
          <div className="bg-white border border-gray-200 rounded-lg mb-6 text-gray-900">
            {user?.user_metadata?.payment_method ? (
            <div className="p-8 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-6">
                Payment Method
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-4">
                    <svg className="w-10 h-7" viewBox="0 0 40 28" fill="none">
                      <rect width="40" height="28" rx="4" fill="#1434CB"/>
                      <path d="M14.375 14c0-3.106 2.519-5.625 5.625-5.625s5.625 2.519 5.625 5.625-2.519 5.625-5.625 5.625-5.625-2.519-5.625-5.625z" fill="#EB001B"/>
                      <path d="M20 8.375c1.466 0 2.8.562 3.8 1.481A5.606 5.606 0 0 0 20 19.625c-1.466 0-2.8-.562-3.8-1.481A5.606 5.606 0 0 1 20 8.375z" fill="#F79E1B"/>
                    </svg>
                    <div>
                      <div className="font-medium">{user.user_metadata.payment_method}</div>
                      {user.user_metadata.payment_expiry && (
                        <div className="text-sm text-gray-600">Expires {user.user_metadata.payment_expiry}</div>
                      )}
                    </div>
                  </div>
                  <button className="text-gray-400 hover:text-gray-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                </div>
                
                <button
                  onClick={handleAddPaymentMethod}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add payment method
                </button>
              </div>
            </div>
            ) : (
            <div className="p-8 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-6">
                Payment Method
              </div>
              <button
                onClick={handleAddPaymentMethod}
                className="w-full py-4 px-4 border-2 border-dashed border-gray-300 rounded-lg text-blue-600 hover:text-blue-700 hover:border-blue-600 font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add payment method
              </button>
            </div>
            )}
          </div>

          {/* Billing Information Card */}
          <div className="bg-white border border-gray-200 rounded-lg mb-6 text-gray-900">
            <div className="p-8">
            <div className="text-xs font-semibold text-gray-500 tracking-wider uppercase mb-6">
              Billing Information
            </div>
            
            {!isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Name</div>
                    <div className="font-medium">{billingName || "Not set"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Email</div>
                    <div className="font-medium">{billingEmail}</div>
                  </div>
                </div>
                
                <div>
                  <div className="text-sm text-gray-600 mb-1">Billing address</div>
                  <div className="font-medium">{user?.user_metadata?.billing_address || "Not set"}</div>
                </div>
                
                <button 
                  onClick={() => setIsEditing(true)}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Update information
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Name</div>
                    <div className="font-medium text-gray-900">{billingName}</div>
                    <div className="text-xs text-gray-500 mt-1">From your account</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-1">Email</div>
                    <div className="font-medium text-gray-900">{billingEmail}</div>
                    <div className="text-xs text-gray-500 mt-1">From your account</div>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Billing Address *
                  </label>
                  <input
                    type="text"
                    value={billingAddress}
                    onChange={(e) => setBillingAddress(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="123 Main St, City, State, Country"
                  />
                </div>

                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">Payment Information</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Card Number *
                      </label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value.replace(/\s/g, ''))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="1234 5678 9012 3456"
                        maxLength={16}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Expiry Date *
                        </label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="MM/YY"
                          maxLength={5}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          CVC *
                        </label>
                        <input
                          type="text"
                          value={cardCvc}
                          onChange={(e) => setCardCvc(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="123"
                          maxLength={4}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSavePaymentInfo}
                    disabled={saving}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving..." : "Save Payment Information"}
                  </button>
                  {user?.user_metadata?.payment_method && (
                    <button
                      onClick={handleCancelEdit}
                      className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                
                <p className="text-xs text-gray-500">
                  🔒 Your payment information is securely encrypted. In production, card details would be processed by Stripe.
                </p>
              </div>
            )}
            </div>
          </div>

          {/* Invoice History Card */}
          <div className="bg-white border border-gray-200 rounded-lg mb-6 text-gray-900">
            <div className="p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="text-xs font-semibold text-gray-500 tracking-wider uppercase">
                Invoice History
              </div>
              {invoices.length > 0 && (
                <button className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              )}
            </div>
            
            {invoices.length > 0 ? (
              <div className="space-y-1">
                {invoices.map((invoice: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-4 px-4 rounded transition-colors"
                  >
                    <div className="flex items-center gap-8">
                      <div className="text-sm text-gray-600 w-24">{invoice.date}</div>
                      <div className="text-sm font-medium w-24">{invoice.amount}</div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {invoice.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">{invoice.plan}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm">No invoices yet</p>
              </div>
            )}
            </div>
          </div>

            {/* Footer */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-4">
                <span>Powered by</span>
                <svg className="h-5" viewBox="0 0 60 25" fill="currentColor">
                  <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.08 1.02a4.7 4.7 0 0 1 3.23-1.29c2.9 0 5.62 2.6 5.62 7.4 0 5.23-2.7 7.6-5.65 7.6zM40 8.95c-.95 0-1.54.34-1.97.81l.02 6.12c.4.44.98.78 1.95.78 1.52 0 2.54-1.65 2.54-3.87 0-2.15-1.04-3.84-2.54-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.32.86zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.13v5.85zm-4.91.7c0 2.97-2.31 4.66-5.73 4.66a11.2 11.2 0 0 1-4.46-.93v-3.93c1.38.75 3.1 1.31 4.46 1.31.92 0 1.53-.24 1.53-1C6.26 13.77 0 14.51 0 9.95 0 7.04 2.28 5.3 5.62 5.3c1.36 0 2.72.2 4.09.75v3.88a9.23 9.23 0 0 0-4.1-1.06c-.86 0-1.44.25-1.44.9 0 1.85 6.29.97 6.29 5.88z"/>
                </svg>
              </div>
              <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
                <a href="#" className="hover:text-gray-700">Learn more about Stripe Billing</a>
                <a href="#" className="hover:text-gray-700">Terms</a>
                <a href="#" className="hover:text-gray-700">Privacy</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
