"use client";

import { useState, useEffect, useRef } from 'react';
import Navigation from '@/components/navigation';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import type { User } from '@supabase/supabase-js';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';

export default function PricingPage() {
  const router = useRouter();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [activeTab, setActiveTab] = useState<'charts' | 'dvp' | 'journal' | 'calendar'>('charts');
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [hasPremium, setHasPremium] = useState(false);
  const [showDashboardDropdown, setShowDashboardDropdown] = useState(false);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(true);
  const isLoggedIn = Boolean(user);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setUserEmail(session.user.email || null);
        setUsername(session.user.user_metadata?.username || session.user.user_metadata?.full_name || null);
        setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null);
        checkPremiumStatus(session.user.id);
      } else {
        setIsCheckingSubscription(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setUserEmail(session.user.email || null);
        setUsername(session.user.user_metadata?.username || session.user.user_metadata?.full_name || null);
        setAvatarUrl(session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || null);
        checkPremiumStatus(session.user.id);
      } else {
        setHasPremium(false);
        setAvatarUrl(null);
        setUsername(null);
        setUserEmail(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Close dashboard dropdown if clicking outside
      if (!target.closest('[data-dashboard-button]') && 
          !target.closest('.absolute.bottom-full')) {
        setShowDashboardDropdown(false);
      }
      
      // Close journal dropdown if clicking outside
      if (!target.closest('[data-journal-button]') && 
          !target.closest('.absolute.bottom-full')) {
        setShowJournalDropdown(false);
      }
      
      // Close profile dropdown if clicking outside
      if (!target.closest('[data-profile-button]') && 
          !target.closest('.absolute.bottom-full')) {
        setShowProfileDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const checkPremiumStatus = async (userId: string) => {
    try {
      // Check Pro access - try profiles table first, fallback to subscriptions table
      const { data: profile } = await (supabase
        .from('profiles') as any)
        .select('subscription_status, subscription_tier')
        .eq('id', userId)
        .single();
      
      let isActive = false;
      let isProTier = false;
      
      if (profile) {
        // Use profiles table if available
        const profileData = profile as any;
        isActive = profileData.subscription_status === 'active' || profileData.subscription_status === 'trialing';
        isProTier = profileData.subscription_tier === 'pro';
      } else {
        // Fallback to subscriptions table
        const { data: subscription } = await (supabase
          .from('subscriptions') as any)
          .select('status')
          .eq('user_id', userId)
          .single();
        
        if (subscription) {
          const subscriptionData = subscription as any;
          isActive = subscriptionData.status === 'active' || subscriptionData.status === 'trialing';
          isProTier = true; // Assume pro if in subscriptions table
        }
      }
      
      const premiumStatus = isActive && isProTier;
      console.log('🔐 Premium Status Check (Pricing):', { isActive, isProTier, premiumStatus, profile });
      setHasPremium(premiumStatus);
      
      // Redirect pro users to props page immediately after checking
      if (premiumStatus) {
        router.replace('/nba');
        return; // Don't set isCheckingSubscription to false, let redirect happen
      }
      
      setIsCheckingSubscription(false);
    } catch (error) {
      console.error('Error in checkPremiumStatus:', error);
      setHasPremium(false);
      setIsCheckingSubscription(false);
    }
  };

  const plans = [
    {
      name: 'Free',
      description: 'Perfect for getting started',
      price: { monthly: 0, annual: 0 },
      features: [
        'Basic player stats',
        'Last 10 games only',
        'Limited team data',
        'Community support',
      ],
      limitations: [
        'No advanced stats',
        'No shot charts',
        'No export capabilities',
        'No API access',
      ],
      cta: 'Current Plan',
      highlighted: false,
    },
    {
      name: 'Pro',
      description: 'For serious sports analysts and researchers',
      price: { monthly: 9.99, semiannual: 50.94, annual: 95.88 },
      features: [
        'Everything in Free',
        'Advanced stats (PER, TS%, USG%)',
        'Shot charts & visualizations',
        'Unlimited player research',
        'Full historical data (3 seasons)',
        'Real-time odds & lines',
        'DVP rankings & matchup data',
        'Injury reports & depth charts',
        'Export to CSV/Excel',
        'API access',
        'Custom alerts & notifications',
        'Priority support',
      ],
      limitations: [],
      cta: 'Start Free Trial',
      highlighted: true,
    },
  ];

  const handleSelectPlan = async (planName: string, billingCycle: 'monthly' | 'semiannual' | 'annual') => {
    if (planName === 'Free') {
      return; // Already on free plan
    }
    
    // Start checkout directly
    try {
      // Check if user is logged in
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Redirect to login with return path
        router.push('/login?redirect=/home');
        return;
      }
      
      const priceIds = {
        monthly: 'price_1SPPbkF0aO6V0EHjOXoydTwT',
        semiannual: 'price_1SPPdVF0aO6V0EHj3DM4hFqS',
        annual: 'price_1SPPdvF0aO6V0EHjJAj8l0nO',
      };
      
      const priceId = priceIds[billingCycle];
      
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ priceId, billingCycle }),
      });
      
      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Failed to create checkout session');
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert(error.message || 'Failed to start checkout. Please try again.');
    }
  };

  // Don't render page content while checking subscription status
  if (isCheckingSubscription) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <StatTrackrLogo className="w-20 h-20" />
          <span className="font-bold text-4xl text-white">
            StatTrackr
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 relative overflow-hidden">
      {/* Top fade overlay */}
      <div className="fixed top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900/60 via-slate-900/30 to-transparent z-50 pointer-events-none"></div>
      {/* Bottom fade overlay */}
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900/60 via-slate-900/30 to-transparent z-50 pointer-events-none"></div>
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-600 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-blue-700 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>
      
      {/* Brand Logo - Fixed Top Left */}
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
              Advanced Sports Analytics & Insights
            </p>
          </div>
        </div>
      </div>

      {/* Auth Section - Fixed Top Right */}
      <div className="absolute top-6 right-6 z-[60]">
        {user ? (
          <div>
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-semibold hover:bg-purple-700 transition-colors"
            >
              {user.email?.[0].toUpperCase() || 'U'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => router.push('/login')}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Log In
          </button>
        )}
      </div>

      {/* Profile Dropdown Menu - Desktop & Mobile */}
      {user && showProfileMenu && (
        <div className="absolute top-16 right-6 z-[60] w-56 mb-2">
          <div className="bg-slate-800 rounded-lg shadow-xl border border-white/10 overflow-hidden">
            {/* User info with subscription status */}
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs text-gray-400">Logged in as</p>
              <p className="text-sm font-medium text-white truncate">{user.email}</p>
              <div className="mt-2 pt-2 border-t border-white/10">
                <p className="text-xs text-gray-400">Plan</p>
                <p className="text-sm font-semibold text-purple-400">{hasPremium ? 'Pro' : 'Free'}</p>
              </div>
            </div>
            
            {/* Subscription button */}
            <div className="py-2">
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  router.push('/subscription');
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                Subscription
              </button>
            </div>
            
            {/* Sign out button */}
            <div className="border-t border-white/10 py-2">
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  setShowProfileMenu(false);
                  router.push('/login');
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 hover:text-red-300 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Navigation - Below Auth Button and Dropdown */}
      <div className="hidden md:block fixed right-6 z-[70]" style={{ top: user && showProfileMenu ? 'calc(5rem + 13rem)' : '5rem' }}>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={() => {
              if (!isLoggedIn) {
                router.push('/login?redirect=/nba');
                return;
              }
              router.push('/nba');
            }}
            className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Dashboard
          </button>
          <button
            onClick={() => {
              if (!hasPremium) {
                const element = document.getElementById('pricing-cards');
                element?.scrollIntoView({ behavior: 'smooth' });
                return;
              }
              router.push('/journal');
            }}
            className={`text-sm font-medium transition-colors ${
              !hasPremium
                ? 'text-gray-500 cursor-not-allowed'
                : 'text-gray-300 hover:text-white'
            }`}
          >
            Journal {!hasPremium && '🔒'}
          </button>
          <button
            onClick={() => {
              const element = document.getElementById('pricing-cards');
              element?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Pricing
          </button>
          <button
            onClick={() => {
              const element = document.getElementById('contact-support-faq');
              element?.scrollIntoView({ behavior: 'smooth' });
              setTimeout(() => setOpenFAQ(4), 500);
            }}
            className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Support
          </button>
        </div>
      </div>

      {/* Mobile Bottom Navigation - Only visible on mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
        {/* Profile Dropdown Menu - Shows above bottom nav */}
        {showProfileDropdown && isLoggedIn && (
          <div ref={profileDropdownRef} className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowProfileDropdown(false);
                  const element = document.getElementById('pricing-cards');
                  element?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Subscription
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={async () => {
                  setShowProfileDropdown(false);
                  await supabase.auth.signOut();
                  router.push('/');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
        
        {/* Dashboard Dropdown Menu - Shows above bottom nav */}
        {showDashboardDropdown && (
          <div className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowDashboardDropdown(false);
                  if (!isLoggedIn) {
                    router.push('/login?redirect=/nba');
                    return;
                  }
                  if (!hasPremium) {
                    const element = document.getElementById('pricing-cards');
                    element?.scrollIntoView({ behavior: 'smooth' });
                    return;
                  }
                  router.push('/nba');
                }}
                className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center gap-2 ${
                  !hasPremium
                    ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span>Player Props</span>
                {!hasPremium && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={() => {
                  setShowDashboardDropdown(false);
                  if (!isLoggedIn) {
                    router.push('/login?redirect=/nba');
                    return;
                  }
                  router.push('/nba');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Game Props
              </button>
            </div>
          </div>
        )}
        
        {/* Journal Dropdown Menu - Shows above bottom nav */}
        {showJournalDropdown && hasPremium && (
          <div className="absolute bottom-full left-0 right-0 mb-1 mx-3">
            <div className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowJournalDropdown(false);
                  router.push('/journal');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                View Journal
              </button>
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={() => {
                  setShowJournalDropdown(false);
                  router.push('/journal?tab=tracking');
                }}
                className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                View Tracking
              </button>
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-3 h-16">
          {/* Dashboard */}
          <button
            data-dashboard-button
            onClick={() => {
              if (!isLoggedIn) {
                router.push('/login?redirect=/nba');
                return;
              }
              setShowDashboardDropdown(!showDashboardDropdown);
            }}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="6" strokeWidth={2} />
              <circle cx="12" cy="12" r="2" strokeWidth={2} />
            </svg>
            <span className="text-xs font-medium">Dashboard</span>
          </button>
          
          {/* Journal */}
          <button
            data-journal-button
            onClick={() => {
              if (!hasPremium) {
                const element = document.getElementById('pricing-cards');
                element?.scrollIntoView({ behavior: 'smooth' });
                return;
              }
              setShowJournalDropdown(!showJournalDropdown);
            }}
            className={`flex flex-col items-center justify-center gap-1 transition-colors relative ${
              !hasPremium
                ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                : 'text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
            }`}
          >
            {!hasPremium ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            )}
            <span className="text-xs font-medium">Journal</span>
          </button>
          
          {/* Profile */}
          <button
            data-profile-button
            onClick={() => {
              if (!isLoggedIn) {
                router.push('/login?redirect=/account');
                return;
              }
              setShowProfileDropdown(!showProfileDropdown);
            }}
            className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          >
            {(() => {
              const displayName = username || userEmail || 'Profile';
              const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'P';
              const getAvatarColor = (name: string): string => {
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                  hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                const hue = Math.abs(hash) % 360;
                const saturation = 65 + (Math.abs(hash) % 20);
                const lightness = 45 + (Math.abs(hash) % 15);
                return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
              };
              const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
              return (
                <div 
                  className="w-6 h-6 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs font-semibold text-white"
                  style={avatarColor ? { backgroundColor: avatarColor } : { backgroundColor: 'rgb(243, 244, 246)' }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl ?? undefined} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full">{fallbackInitial}</span>
                  )}
                </div>
              );
            })()}
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 py-12 sm:py-16 relative z-10">
        
        {/* Header */}
        <div className="text-center mb-12 mt-12 lg:mt-8">
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Advanced Sports Analytics & Data Analysis
          </h2>
          <p className="text-lg text-gray-300 max-w-2xl mx-auto">
            Transform raw statistics into actionable insights with our comprehensive NBA analytics platform. Data-driven research and analysis tools for sports statistics.
          </p>
          <div className="mt-6">
            <button
              onClick={() => {
                const element = document.getElementById('pricing-cards');
                element?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center px-8 py-3 rounded-full bg-emerald-600/20 border-2 border-emerald-500/50 text-emerald-400 font-bold text-base hover:bg-emerald-600/30 hover:border-emerald-400 transition-all hover:scale-105 cursor-pointer"
            >
              🎉 Start with a 7-day free trial
            </button>
          </div>
        </div>


        {/* Feature Highlights Section */}
        <div className="mb-16 mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-12">
            Comprehensive Sports Analytics Tools
          </h2>
          
          {/* Tab Switcher */}
          <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-4 mb-6 justify-center">
            <button
              onClick={() => setActiveTab('charts')}
              className={`px-3 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold text-xs sm:text-base transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-purple-500/20 ${
                activeTab === 'charts'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
              }`}
            >
              <span className="hidden sm:inline">Analytics Charts</span>
              <span className="sm:hidden">Analytics</span>
            </button>
            <button
              onClick={() => setActiveTab('dvp')}
              className={`px-3 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold text-xs sm:text-base transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-purple-500/20 ${
                activeTab === 'dvp'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
              }`}
            >
              <span className="hidden sm:inline">Defense vs Position</span>
              <span className="sm:hidden">DvP</span>
            </button>
            <button
              onClick={() => setActiveTab('journal')}
              className={`px-3 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold text-xs sm:text-base transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-purple-500/20 ${
                activeTab === 'journal'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
              }`}
            >
              <span className="hidden sm:inline">Journal Analytics</span>
              <span className="sm:hidden">Journal</span>
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-3 sm:px-6 py-2 sm:py-3 rounded-lg font-semibold text-xs sm:text-base transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-purple-500/20 ${
                activeTab === 'calendar'
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
              }`}
            >
              <span className="hidden sm:inline">Performance Calendar</span>
              <span className="sm:hidden">Calendar</span>
            </button>
          </div>

          {/* Dashboard Screenshot */}
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start justify-center">
            {/* Image container - all preloaded, toggle visibility */}
            <div className="w-full lg:w-auto flex justify-center lg:justify-start">
              <div className={activeTab === 'charts' ? '' : 'hidden'}>
                <Image 
                  src="/images/dashboard/new-chart-web-display.png" 
                  alt="Dashboard Charts" 
                  width={1800} 
                  height={0}
                  className="rounded-lg h-auto w-full"
                  priority
                />
              </div>
              <div className={activeTab === 'dvp' ? '' : 'hidden'}>
                <Image 
                  src="/images/dashboard/dashboard-dvp.png" 
                  alt="DvP Rankings" 
                  width={400} 
                  height={0}
                  className="rounded-lg w-full h-auto max-h-[450px] lg:max-h-none lg:max-w-[400px]"
                  priority
                />
              </div>
              <div className={activeTab === 'journal' ? '' : 'hidden'}>
                <Image 
                  src="/images/dashboard/dashboard-journal.png" 
                  alt="Journal Analytics" 
                  width={800} 
                  height={0}
                  className="rounded-lg w-full h-auto max-h-[450px] lg:max-h-none lg:max-w-[700px]"
                  priority
                />
              </div>
              <div className={activeTab === 'calendar' ? '' : 'hidden'}>
                <Image 
                  src="/images/dashboard/dashboard-calendar.png" 
                  alt="Betting Calendar" 
                  width={450} 
                  height={0}
                  className="rounded-lg w-full h-auto lg:max-w-[450px]"
                  priority
                />
              </div>
            </div>
            <div className="text-white w-full lg:w-[400px] lg:flex-shrink-0 lg:flex-grow-0">
              {activeTab === 'charts' && (
                <>
                  <h3 className="text-2xl font-bold mb-2">Visualize Every Data Point</h3>
                  <p className="text-gray-300 mb-3 leading-relaxed text-sm">
                    Our advanced charting system transforms complex player statistics into clear, actionable insights. Track performance trends over time with interactive visualizations that reveal patterns you'd never spot in raw data.
                  </p>
                  <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span><strong className="text-white">Multiple Timeframes:</strong> Analyze performance across different game samples to separate hot streaks from sustainable trends</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      <span><strong className="text-white">Trend Analysis:</strong> Identify hot and cold streaks instantly with color-coded bars showing hits vs. misses</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span><strong className="text-white">Historical Comparisons:</strong> Compare current stats against previous years to spot career trends</span>
                    </li>
                  </ul>
                  <p className="text-gray-400 mt-2 text-sm italic">
                    Stop squinting at spreadsheets. Our charts make data analysis effortless.
                  </p>
                </>
              )}
              {activeTab === 'dvp' && (
                <>
                  <h3 className="text-2xl font-bold mb-2">Exploit Matchup Advantages</h3>
                  <p className="text-gray-300 mb-3 leading-relaxed text-sm">
                    Our DvP rankings reveal which defenses are vulnerable to specific positions. Identify the easiest matchups and stack your lineups with players facing favorable opponents.
                  </p>
                  <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span><strong className="text-white">Position-Specific Rankings:</strong> Understand how each team performs defensively against different positions across all key statistical categories. An accurate DvP system is crucial because it reveals the true defensive weaknesses teams have against specific positions - helping you identify the most favorable matchups for statistical analysis</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      <span><strong className="text-white">Matchup Analysis:</strong> Filter by opponent to instantly find players with the best matchups each night</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span><strong className="text-white">Defensive Breakdowns:</strong> View detailed defensive stats to understand why certain matchups are favorable</span>
                    </li>
                  </ul>
                  <p className="text-gray-400 mt-2 text-sm italic">
                    Find the statistical advantages in NBA matchups through comprehensive defensive analytics.
                  </p>
                </>
              )}
              {activeTab === 'journal' && (
                <>
                  <h3 className="text-2xl font-bold mb-2">Track Your Performance Analytics</h3>
                  <p className="text-gray-300 mb-3 leading-relaxed text-sm">
                    Log and analyze your research results to identify patterns and trends. Our journal helps you become a more data-driven analyst with comprehensive performance tracking.
                  </p>
                  <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span><strong className="text-white">Performance Metrics:</strong> Track success rate, return on investment, and more to measure your analytical performance</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                      </svg>
                      <span><strong className="text-white">Analysis Categories:</strong> See which statistical categories and metrics provide the most valuable insights</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      <span><strong className="text-white">Trend Identification:</strong> Spot patterns in your research to identify the most effective analytical approaches</span>
                    </li>
                  </ul>
                  <p className="text-gray-400 mt-2 text-sm italic">
                    Data-driven analysis starts with tracking. Build your expertise through comprehensive performance analytics.
                  </p>
                  <div className="mt-4 p-3 bg-purple-900/30 border border-purple-500/30 rounded-lg">
                    <p className="text-xs text-purple-200 font-semibold mb-1">💡 Why StatTrackr beats spreadsheets:</p>
                    <p className="text-xs text-gray-300">
                      No more manual formulas, data entry errors, or time wasted formatting cells. Our journal automatically calculates performance metrics, success rates, and trends—giving you instant insights that would take hours to build on other platforms.
                    </p>
                  </div>
                </>
              )}
              {activeTab === 'calendar' && (
                <>
                  <h3 className="text-2xl font-bold mb-2">Never Miss a Winning Day</h3>
                  <p className="text-gray-300 mb-3 leading-relaxed text-sm">
                    Visualize your betting activity and profitability across days, weeks, and months. Our calendar view makes it easy to see your hot and cold streaks at a glance.
                  </p>
                  <ul className="space-y-2 text-gray-300 text-sm">
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span><strong className="text-white">Visual Calendar:</strong> Color-coded days show your profit/loss at a glance</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span><strong className="text-white">Daily Summaries:</strong> Click any day to see all bets placed and results</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <span><strong className="text-white">Streak Tracking:</strong> Identify your longest winning and losing streaks to manage bankroll</span>
                    </li>
                  </ul>
                  <p className="text-gray-400 mt-2 text-sm italic">
                    Stay organized and accountable with a visual overview of your betting journey.
                  </p>
                  <div className="mt-4 p-3 bg-purple-900/30 border border-purple-500/30 rounded-lg">
                    <p className="text-xs text-purple-200 font-semibold mb-1">💡 Why StatTrackr beats spreadsheets:</p>
                    <p className="text-xs text-gray-300">
                      Spreadsheets can't visualize your betting patterns like this. Our calendar instantly shows your profitable days, losing streaks, and betting frequency—all color-coded and interactive, without touching a single cell or formula.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8 lg:mt-24">
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Advanced Analytics</h3>
              <p className="text-gray-300 text-sm">Deep dive into player stats, trends, and historical data to make informed decisions on every prop.</p>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Real-Time Updates</h3>
              <p className="text-gray-300 text-sm">Get instant access to live odds, injury reports, and lineup changes as they happen.</p>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Expert Picks</h3>
              <p className="text-gray-300 text-sm">Access curated picks from our admin team with detailed breakdowns and reasoning.</p>
            </div>
          </div>

          {/* Section divider */}
          <div className="mt-8 mb-8 max-w-4xl mx-auto">
            <div className="h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent"></div>
          </div>
        </div>

        {/* Feature Comparison - Single Container */}
        <div className="mb-16 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-white mb-8">
            Compare Plans
          </h2>
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 shadow-2xl p-8">
            <div className="grid grid-cols-2 gap-0">
              {/* Free Plan Features */}
              <div className="flex flex-col md:pr-8">
                <div className="flex items-center gap-2 mb-6 h-[38px] ml-8">
                  <h3 className="text-2xl font-bold text-white">Free</h3>
                </div>
                <ul className="space-y-4">
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white">Advanced Game Props</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 opacity-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-400 line-through">Advanced Player Stats</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 opacity-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-400 line-through">DvP Rankings</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 opacity-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-400 line-through">Real-time Odds</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 opacity-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-400 line-through">Advanced Tracking</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 opacity-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-400 line-through">Advanced Journaling</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5 opacity-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-gray-400 line-through">Admin Picks</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white">Real-time Injuries/Depth Charts</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white">Community Support</span>
                  </li>
                </ul>
              </div>

              {/* Pro Plan Features */}
              <div className="flex flex-col md:pl-8">
                <div className="flex items-center gap-2 mb-6 h-[38px] ml-8">
                  <h3 className="text-2xl font-bold text-emerald-400">Pro</h3>
                </div>
                <ul className="space-y-4">
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Advanced Game Props</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Advanced Player Stats</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">DvP Rankings</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Real-time Odds</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Advanced Tracking</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Advanced Journaling</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Admin Picks</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Real-time Injuries/Depth Charts</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-white font-medium">Priority Support</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Pricing cards - 3 options */}
        <div id="pricing-cards" className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* Monthly Plan - First on mobile */}
          <div className="relative rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md p-6 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-500/20 hover:border-purple-500/50 md:order-1">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white mb-2">
                Monthly
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">$9.99</span>
                <span className="text-gray-300">/month</span>
              </div>
              <div className="text-sm text-gray-400 mt-1 opacity-0">Placeholder</div>
              <span className="inline-block mt-2 text-xs font-semibold text-gray-400">7-day free trial</span>
            </div>
            <button
              onClick={() => handleSelectPlan('Pro', 'monthly')}
              className="w-full py-3 px-4 rounded-lg font-medium transition-colors mb-6 bg-white/10 text-white hover:bg-white/20"
            >
              Start Free Trial
            </button>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Game Props</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Player Stats</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">DvP Rankings</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Real-time Odds</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Tracking</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Journaling</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Admin Picks</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Real-time Injuries/Depth Charts</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Priority Support</span>
              </div>
            </div>
          </div>

          {/* 6-Month Plan */}
          <div className="relative rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md p-6 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-purple-500/20 hover:border-purple-500/50 md:order-2">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white mb-2">
                6 Months
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">$49.99</span>
              </div>
              <div className="text-sm text-gray-400 mt-1">$8.33/month</div>
              <span className="inline-block mt-2 text-xs font-semibold text-emerald-400">Save 17% • 7-day free trial</span>
            </div>
            <button
              onClick={() => handleSelectPlan('Pro', 'semiannual')}
              className="w-full py-3 px-4 rounded-lg font-medium transition-colors mb-6 bg-white/10 text-white hover:bg-white/20"
            >
              Start Free Trial
            </button>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Game Props</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Player Stats</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">DvP Rankings</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Real-time Odds</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Tracking</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Journaling</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Admin Picks</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Real-time Injuries/Depth Charts</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Priority Support</span>
              </div>
            </div>
          </div>

          {/* Annual Plan - Highlighted */}
          <div className="relative rounded-2xl border border-emerald-500 shadow-xl shadow-emerald-500/20 bg-slate-900/60 backdrop-blur-md p-6 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-emerald-500/40 md:order-3">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-1 text-xs font-semibold text-white">
                MOST POPULAR
              </span>
            </div>
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white mb-2">
                Yearly
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">$89.99</span>
              </div>
              <div className="text-sm text-gray-400 mt-1">$7.50/month</div>
              <span className="inline-block mt-2 text-xs font-semibold text-emerald-400">Save 25% • 7-day free trial</span>
            </div>
            <button
              onClick={() => handleSelectPlan('Pro', 'annual')}
              className="w-full py-3 px-4 rounded-lg font-medium transition-colors mb-6 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Start Free Trial
            </button>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Game Props</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Player Stats</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">DvP Rankings</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Real-time Odds</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Tracking</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Advanced Journaling</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Admin Picks</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Real-time Injuries/Depth Charts</span>
              </div>
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm text-gray-200">Priority Support</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section divider */}
        <div className="mt-8 mb-8 max-w-4xl mx-auto">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent"></div>
        </div>

        {/* Testimonials Section */}
        <div className="mt-8 max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-white mb-12">
            Trusted by Winning Bettors
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" style={{gridAutoFlow: 'dense'}}>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;I used to be losing constantly on the bookie, always trusting my gut. With StatTrackr, I switched to data-driven picks and everything changed. Now I&apos;m actually profitable and making smarter bets every day.&quot;</p>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold mr-3">
                  <img src="https://i.pravatar.cc/150?img=12" alt="PropGod23" className="w-10 h-10 rounded-full" />
                </div>
                <div>
                  <p className="text-white font-semibold">PropGod23</p>
                  <p className="text-gray-400 text-sm">Pro Member • 3 Months</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;Best investment I&apos;ve made for sports betting. The admin picks are consistently solid and the advanced stats help me find my own edges. I used to spend hours jumping between sites for information. Now everything is in one place - player trends, injury reports, matchup data, and real-time odds. The DvP rankings alone have saved me from countless bad bets. The tracking features revealed patterns in my betting I never noticed before. My bankroll has never been healthier.&quot;</p>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold mr-3">
                </div>
                <div>
                  <p className="text-white font-semibold">Anonymous User</p>
                  <p className="text-gray-400 text-sm">Pro Member • 8 Months</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;Hit a 2-leg parlay thanks to the matchup insights and team analysis. No other research dashboard has this level of detail - absolute game changer!&quot;</p>
              <div className="mb-4">
                <img src="/images/testimonials/bet-slip-1.png" alt="6-Leg SGP Win" className="w-full max-h-52 object-contain rounded-lg border border-emerald-500/30" />
              </div>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold mr-3">
                  <img src="https://i.pravatar.cc/150?img=33" alt="BetKing_99" className="w-10 h-10 rounded-full" />
                </div>
                <div>
                  <p className="text-white font-semibold">BetKing_99</p>
                  <p className="text-gray-400 text-sm">Pro Member • 6 Months</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;Hit a massive Same Game Parlay at +33966 odds using player prop analysis and injury reports. One bet like this changes everything!&quot;</p>
              <div className="mb-4">
                <img src="/images/testimonials/bet-slip-2.png" alt="$900 Win" className="w-full max-h-52 object-contain rounded-lg border border-emerald-500/30" />
              </div>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold mr-3">
                  <img src="https://i.pravatar.cc/150?img=47" alt="angieCRC" className="w-10 h-10 rounded-full" />
                </div>
                <div>
                  <p className="text-white font-semibold">angieCRC</p>
                  <p className="text-gray-400 text-sm">Pro Member • 11 Months</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;I was skeptical at first but the data here is legit. Tracking my bets and seeing patterns has made me so much more disciplined. Highly recommend!&quot;</p>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold mr-3">
                  <img src="https://i.pravatar.cc/150?img=58" alt="diddy67" className="w-10 h-10 rounded-full" />
                </div>
                <div>
                  <p className="text-white font-semibold">diddy67</p>
                  <p className="text-gray-400 text-sm">Pro Member • 5 Months</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;As someone new to sports betting, I was losing constantly and had no clue where to even start with research. StatTrackr made it so easy for a beginner like me. The layout is clean and simple - I don&apos;t need to be a stats genius to figure out what I&apos;m looking at. Everything just makes sense. Within my first week, I stopped making those dumb impulsive bets that were killing my bankroll. The player data and trends helped me avoid the obvious traps I kept falling into. My losses dropped big time and I&apos;m finally seeing consistent wins.&quot;</p>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold mr-3">
                </div>
                <div>
                  <p className="text-white font-semibold">Anonymous User</p>
                  <p className="text-gray-400 text-sm">Pro Member • 1 Year</p>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-white/10 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-500/20 hover:border-purple-500/40">
              <div className="flex items-center mb-4">
                <div className="flex text-emerald-600">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </div>
              </div>
              <p className="text-gray-300 mb-4 italic">&quot;Finally, a betting tool that actually delivers. The journaling feature helps me track what works and what doesn&apos;t. Worth every penny!&quot;</p>
              <div className="flex items-center mt-auto">
                <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold mr-3">
                  <img src="https://i.pravatar.cc/150?img=68" alt="LockMaster41" className="w-10 h-10 rounded-full" />
                </div>
                <div>
                  <p className="text-white font-semibold">LockMaster41</p>
                  <p className="text-gray-400 text-sm">Pro Member • 4 Months</p>
                </div>
              </div>
          </div>
        </div>
        </div>

        {/* Final CTA Section */}
        <div className="mt-20 mb-20 max-w-3xl mx-auto text-center">
          <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl p-10 shadow-2xl">
            <h2 className="text-3xl font-bold text-white mb-3">
              Ready to Start Winning?
            </h2>
            <p className="text-lg text-purple-50 mb-6">
              Join thousands of smart bettors. Start your 7-day free trial today.
            </p>
            <button
              onClick={() => handleSelectPlan('Pro', 'monthly')}
              className="bg-white text-purple-600 px-8 py-4 rounded-lg font-bold text-lg hover:bg-gray-100 transition-colors shadow-lg"
            >
              Start Free Trial Now
            </button>
            <p className="text-purple-100 text-sm mt-4">7-day free trial • Cancel anytime</p>
          </div>
        </div>

        {/* Section divider */}
        <div className="mt-16 mb-8 max-w-4xl mx-auto">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-700/50 to-transparent"></div>
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            <div 
              onClick={() => setOpenFAQ(openFAQ === 0 ? null : 0)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Is there a free trial?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 0 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 0 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  Yes! All premium plans come with a 7-day free trial. A credit card is required, but you won't be charged until the trial ends. Cancel anytime during the trial period to avoid charges.
                </p>
              )}
            </div>
            <div 
              onClick={() => setOpenFAQ(openFAQ === 1 ? null : 1)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Can I cancel anytime?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 1 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 1 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  Yes! You can cancel your subscription at any time. No questions asked, no cancellation fees.
                </p>
              )}
            </div>
            <div 
              onClick={() => setOpenFAQ(openFAQ === 2 ? null : 2)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Is mobile supported?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 2 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 2 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  Yes! StatTrackr is fully optimized for mobile devices. Access all features, analytics, and your performance journal seamlessly from your smartphone or tablet.
                </p>
              )}
            </div>
            <div 
              onClick={() => setOpenFAQ(openFAQ === 3 ? null : 3)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Is there a Discord community?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 3 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 3 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  A Discord community is coming soon! We're building a space where users can share insights, discuss strategies, and connect with other analysts. Stay tuned for the announcement.
                </p>
              )}
            </div>
            <div 
              id="contact-support-faq"
              onClick={() => setOpenFAQ(openFAQ === 4 ? null : 4)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  How do I contact support?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 4 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 4 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  You can reach our support team at <a href="mailto:Support@Stattrackr.co" className="text-purple-500 hover:text-purple-600 underline">Support@Stattrackr.co</a>. We typically respond within 24 hours.
                </p>
              )}
            </div>
            <div 
              onClick={() => setOpenFAQ(openFAQ === 5 ? null : 5)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Does the journal use real money?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 5 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 5 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  No, the journal is a tracking tool only. It does not handle real money or connect to any external services. You manually enter your research data to track performance, analyze trends, and improve your analytical approach over time.
                </p>
              )}
            </div>
            <div 
              onClick={() => setOpenFAQ(openFAQ === 6 ? null : 6)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Can I expect a 100% win rate?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 6 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 6 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  No tool can guarantee perfect results in sports analytics. However, StatTrackr provides you with comprehensive data, advanced analytics, and insights to help you make more informed analytical decisions and identify high-value opportunities that can significantly improve your research quality.
                </p>
              )}
            </div>
            <div 
              onClick={() => setOpenFAQ(openFAQ === 7 ? null : 7)}
              className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-purple-500 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  What sports are available on StatTrackr?
                </h3>
                <svg 
                  className={`w-5 h-5 text-gray-500 transition-transform ${openFAQ === 7 ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {openFAQ === 7 && (
                <p className="text-gray-600 dark:text-gray-400 mt-3">
                  Currently, StatTrackr exclusively supports NBA basketball with comprehensive stats, analytics, and research insights. We're actively developing support for additional sports leagues and will announce them as they become available.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-24 border-t border-gray-700 pt-12 pb-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
              {/* Brand */}
              <div className="col-span-1">
                <div className="flex items-center gap-2 mb-2">
                  <Image 
                    src="/images/stattrackr-icon.png" 
                    alt="StatTrackr Logo" 
                    width={32} 
                    height={32}
                    className="w-8 h-8"
                  />
                  <h3 className="text-xl font-bold text-white">
                    StatTrackr
                  </h3>
                </div>
                <p className="text-gray-400 text-sm">
                  Advanced sports analytics and data insights for serious researchers and analysts.
                </p>
              </div>

              {/* Product */}
              <div>
                <h4 className="text-white font-semibold mb-3">Product</h4>
                <ul className="space-y-2">
                  <li>
                    <button onClick={() => document.getElementById('pricing-cards')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="text-gray-400 hover:text-white text-sm transition-colors">
                      Pricing
                    </button>
                  </li>
                  <li>
                    <button onClick={() => router.push('/nba')} className="text-gray-400 hover:text-white text-sm transition-colors">
                      Dashboard
                    </button>
                  </li>
                  <li>
                    <button onClick={() => router.push('/free-trial')} className="text-gray-400 hover:text-white text-sm transition-colors">
                      Free Trial
                    </button>
                  </li>
                </ul>
              </div>

              {/* Support */}
              <div>
                <h4 className="text-white font-semibold mb-3">Support</h4>
                <ul className="space-y-2">
                  <li>
                    <button 
                      onClick={() => {
                        setOpenFAQ(4);
                        setTimeout(() => {
                          document.getElementById('contact-support-faq')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                      }} 
                      className="text-gray-400 hover:text-white text-sm transition-colors"
                    >
                      Contact Us
                    </button>
                  </li>
                  <li>
                    <span className="text-gray-400 text-sm">Discord (Coming Soon)</span>
                  </li>
                </ul>
              </div>

              {/* Legal */}
              <div>
                <h4 className="text-white font-semibold mb-3">Legal</h4>
                <ul className="space-y-2">
                  <li>
                    <button onClick={() => router.push('/terms')} className="text-gray-400 hover:text-white text-sm transition-colors">
                      Terms of Service
                    </button>
                  </li>
                  <li>
                    <button onClick={() => router.push('/privacy')} className="text-gray-400 hover:text-white text-sm transition-colors">
                      Privacy Policy
                    </button>
                  </li>
                </ul>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="border-t border-gray-700 pt-8 flex flex-col md:flex-row justify-between items-center">
              <p className="text-gray-400 text-sm mb-4 md:mb-0">
                © {new Date().getFullYear()} StatTrackr. All rights reserved.
              </p>
              <div className="flex items-center gap-4">
                <span className="text-gray-400 text-xs">Secured by Stripe</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
