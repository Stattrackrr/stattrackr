"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import type { User } from '@supabase/supabase-js';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import { 
  BarChart3, 
  TrendingUp, 
  Database, 
  Search, 
  BookOpen, 
  Zap, 
  Shield, 
  CheckCircle2,
  Smartphone,
  Monitor,
  ArrowRight,
  Lightbulb,
  Quote,
  Star,
  User as UserIcon,
  DollarSign
} from 'lucide-react';

function getInitials(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '').slice(0, 2);
  return letters.toUpperCase() || '?';
}

const AVATAR_GRADIENTS = [
  'bg-gradient-to-br from-indigo-500 to-indigo-300/90',
  'bg-gradient-to-br from-violet-500 to-violet-300/90',
  'bg-gradient-to-br from-purple-500 to-purple-300/90',
  'bg-gradient-to-br from-fuchsia-500 to-fuchsia-300/90',
  'bg-gradient-to-br from-rose-500 to-rose-300/90',
  'bg-gradient-to-br from-amber-500 to-amber-300/90',
  'bg-gradient-to-br from-emerald-500 to-emerald-300/90',
  'bg-gradient-to-br from-cyan-500 to-cyan-300/90',
  'bg-gradient-to-br from-blue-500 to-blue-300/90',
  'bg-gradient-to-br from-orange-500 to-orange-300/90',
];

function getAvatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

export default function HomePage() {
  const router = useRouter();
  const prefetchPropsResources = () => {
    router.prefetch('/props');
    void fetch('/api/nba/player-props', { cache: 'force-cache' }).catch(() => {});
    void fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
  };

  const goToProps = () => {
    prefetchPropsResources();
    router.push('/props');
  };
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [user, setUser] = useState<User | null>(null);
  const [hasPremium, setHasPremium] = useState(false);
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileSlide, setMobileSlide] = useState(0);
  const [desktopSlide, setDesktopSlide] = useState(0);
  const [mobileImageErrors, setMobileImageErrors] = useState<Record<number, boolean>>({});
  const [desktopImageErrors, setDesktopImageErrors] = useState<Record<number, boolean>>({});
  const [deviceView, setDeviceView] = useState<'desktop' | 'mobile'>('desktop');
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loadingBrandReady, setLoadingBrandReady] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadingBrandReady) return;
    const t = setTimeout(() => setLoadingBrandReady(true), 700);
    return () => clearTimeout(t);
  }, [loadingBrandReady]);

  // On mobile viewport: hide Desktop/Mobile toggle and always show mobile mock (lg = 1024)
  const effectiveView = isMobileViewport ? 'mobile' : deviceView;
  // Desktop + phone mock: text on the side, static (all slides); else text above, cycling
  const isDesktopPhoneView = !isMobileViewport && effectiveView === 'mobile';

  // Screenshot paths - desktop screenshots (in order: Analytics Dashboard, Player Props, Journal)
  const desktopSlides = [
    { 
      name: 'Analytics Dashboard', 
      description: 'Every stat in one dashboard.',
      paragraph: 'Charts, trends, DvP, matchup data. Filter by stat, timeframe, bookmaker, game.',
      image: '/screenshots/desktop/player-detail.png',
      objectPosition: 'center center'
    },
    { 
      name: 'Player Props Research', 
      description: 'Lines from 10+ books, ranked.',
      paragraph: 'Filter by stat, DvP, bookmaker, game. Best lines surface first.',
      image: '/screenshots/desktop/props.png',
      objectPosition: 'center center'
    },
    { 
      name: 'Journal', 
      description: 'P&L, ROI, calendar, insights.',
      paragraph: 'Track stakes, wins, losses, bankroll. Filter by sport, bookmaker, date.',
      image: '/screenshots/desktop/dashboard.png',
      objectPosition: 'center center'
    },
  ];

  // Screenshot paths - mobile screenshots (4 slides; add mobile-1.png … mobile-4.png to public/screenshots/mobile/)
  const mobileSlides = [
    { name: 'Player Props', description: 'Lines from 10+ books, ranked.', paragraph: 'Filter by stat, DvP, bookmaker, game. Best lines surface first.', image: '/screenshots/mobile/mobile-1.png', objectPosition: 'top center' },
    { name: 'Analytics Dashboard', description: 'Every stat in one dashboard.', paragraph: 'Charts, trends, DvP, matchup data. Filter by stat, timeframe, bookmaker, game.', image: '/screenshots/mobile/mobile-2.png', objectPosition: 'top center' },
    { name: 'Performance Journal', description: 'P&L, ROI, calendar, insights.', paragraph: 'Track stakes, wins, losses, bankroll. Filter by sport, bookmaker, date.', image: '/screenshots/mobile/mobile-3.png', objectPosition: 'top center' },
    { name: 'Analytics & Insights', description: 'Insights and trends.', paragraph: 'Automated takeaways and pattern highlights.', image: '/screenshots/mobile/mobile-4.png', objectPosition: 'top center' },
  ];

  // User reviews / testimonials (2 price, 1 journal, 7 varied personal)
  const reviews = [
    { quote: "I was skeptical about the price. Figured it'd be bare bones. NBA and AFL with stats way more advanced than I expected. I've been winning more since I switched.", name: 'marct_22', tag: 'Pro user' },
    { quote: "For how cheap it is I wasn't sure it'd be any good. The dashboard is legit, NBA and AFL. Deeper than the free stuff I was using. Results don't lie.", name: 'jreed9', tag: 'Pro user' },
    { quote: "The journal makes it easy to see where I'm going wrong and what I need to fix. I was just guessing before. Now I actually know which spots are killing me.", name: 'jake_m82', tag: 'Pro user' },
    { quote: "This is the first one I've actually kept using. Most apps I sign up, use twice, and forget. I'm in here every day before the games.", name: 'alexk9', tag: 'Pro user' },
    { quote: "I was using like three different things before. Spreadsheets, a free site, notes on my phone. Now it's all in one place and I don't waste time switching.", name: 'samr91', tag: 'Pro user' },
    { quote: "It doesn't overwhelm you. A lot of these tools throw everything at you. This one gives you what matters without the noise. Fits how I actually work.", name: 'cjlew', tag: 'Pro user' },
    { quote: "I use it on my phone during the day and on my laptop at night. Same stuff, no weird sync. That alone was worth it for me.", name: 'drew_07', tag: 'Pro user' },
    { quote: "Tried a couple others and they were either too complicated or too basic. This one hit the middle. Does what I need without a learning curve.", name: 'tayw23', tag: 'Pro user' },
    { quote: "I've been looking for something like this for a while. Most stuff is either junk or way too expensive. This actually does the job without the extras I don't need.", name: 'mok7', tag: 'Pro user' },
    { quote: "Saves me a bunch of time. I used to dig through a bunch of tabs and apps. Now I just open this and it's right there. Simple as that.", name: 'riley_n24', tag: 'Pro user' },
  ];

  useEffect(() => {
    const interval = 7000; // 7 seconds for both
    const mobileInterval = setInterval(() => {
      setMobileSlide((prev) => (prev + 1) % mobileSlides.length);
    }, interval);
    const desktopInterval = setInterval(() => {
      setDesktopSlide((prev) => (prev + 1) % desktopSlides.length);
    }, interval);
    return () => {
      clearInterval(mobileInterval);
      clearInterval(desktopInterval);
    };
  }, []);

  useEffect(() => {
    const run = async () => {
      // If Supabase redirected here with tokens in the hash (e.g. /home#access_token=...), set the session
      if (typeof window !== "undefined" && window.location.hash) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const at = params.get("access_token");
        const rt = params.get("refresh_token");
        if (at && rt) {
          await supabase.auth.setSession({ access_token: at, refresh_token: rt });
          window.history.replaceState(null, "", window.location.pathname + window.location.search || "/home");
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      if (session?.user) {
        checkPremiumStatus(session.user.id);
      } else {
        setIsCheckingSubscription(false);
      }
    };
    run();
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkPremiumStatus(session.user.id);
      } else {
        setIsCheckingSubscription(false);
        setHasPremium(false);
      }
    });

    // Handle scroll for navbar
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Logged-in Pro users: redirect to props page, don't show home (preserve query e.g. test_event_code for Meta)
  useEffect(() => {
    if (!isCheckingSubscription && user && hasPremium) {
      const search = typeof window !== "undefined" ? window.location.search : "";
      router.replace("/props" + search);
    }
  }, [isCheckingSubscription, user, hasPremium, router]);

  // While showing StatTrackr loading (checking subscription or pro redirecting), prefetch props caches
  // so when user lands on /props they see data immediately from sessionStorage
  useEffect(() => {
    const showLoading = isCheckingSubscription || (user && hasPremium);
    if (!showLoading || typeof window === 'undefined') return;

    const CACHE_KEY = 'nba-player-props-cache';
    const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

    const prefetchNba = async () => {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        const ts = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
        if (cached && ts && Date.now() - parseInt(ts, 10) < CACHE_TTL_MS) return;
        const res = await fetch('/api/nba/player-props', { cache: 'force-cache' });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.data));
            sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
          }
        }
      } catch {
        // ignore
      }
    };

    const prefetchGames = async () => {
      try {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];
        const key = `dashboard-games-${start}-${end}`;
        const cached = sessionStorage.getItem(key);
        const ts = sessionStorage.getItem(`${key}-timestamp`);
        if (cached && ts && Date.now() - parseInt(ts, 10) < 30 * 60 * 1000) return;
        const res = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, { cache: 'default' });
        if (res.ok) {
          const data = await res.json();
          if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
            sessionStorage.setItem(key, JSON.stringify(data.data));
            sessionStorage.setItem(`${key}-timestamp`, Date.now().toString());
          }
        }
      } catch {
        // ignore
      }
    };

    // Warm AFL list API so props page AFL tab loads fast (sessionStorage filled by props page when they open AFL)
    const prefetchAfl = () => {
      fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
    };

    router.prefetch('/props');
    prefetchNba();
    prefetchGames();
    prefetchAfl();
  }, [isCheckingSubscription, user, hasPremium, router]);

  useEffect(() => {
    const lg = 1024;
    const update = () => setIsMobileViewport(typeof window !== 'undefined' && window.innerWidth < lg);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Close profile menu on click outside
  useEffect(() => {
    if (!showProfileMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showProfileMenu]);

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
      setHasPremium(premiumStatus);
    } catch (error) {
      console.error('Error checking subscription:', error);
      setHasPremium(false);
    } finally {
      setIsCheckingSubscription(false);
    }
  };

  const handleSelectPlan = async (planName: string, billingCycle: 'monthly' | 'semiannual' | 'annual') => {
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
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
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Response is not JSON');
      }
      
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

  const plans = [
    {
      name: 'Pro',
      description: '',
      price: { monthly: 9.99, semiannual: 49.99, annual: 89.99 },
      features: [
        'All statistics for NBA',
        'All statistics for AFL',
        '10+ bookmakers',
        'Advanced journaling',
        'Automatic insights',
        'Mobile/desktop compatibility',
        'Priority support',
      ],
      limitations: [],
      cta: 'Start Free Trial',
      highlighted: true,
    },
  ];

  if (isCheckingSubscription) {
    return (
      <div className="min-h-screen bg-[#050d1a] flex items-center justify-center">
        <div className={`flex flex-col items-center gap-3 transition-opacity duration-150 ${loadingBrandReady ? 'opacity-100' : 'opacity-0'}`}>
          <StatTrackrLogo className="w-20 h-20" onReady={() => setLoadingBrandReady(true)} />
          <span className="font-bold text-4xl text-white">StatTrackr</span>
        </div>
      </div>
    );
  }

  // Logged-in Pro: redirect to /props; show loading until redirect
  if (user && hasPremium) {
    return (
      <div className="min-h-screen bg-[#050d1a] flex items-center justify-center">
        <div className={`flex flex-col items-center gap-3 transition-opacity duration-150 ${loadingBrandReady ? 'opacity-100' : 'opacity-0'}`}>
          <StatTrackrLogo className="w-20 h-20" onReady={() => setLoadingBrandReady(true)} />
          <span className="font-bold text-4xl text-white">StatTrackr</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050d1a] text-white">
      {/* Navigation Bar */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 pt-[max(1rem,env(safe-area-inset-top))] ${
        isScrolled ? 'bg-[#050d1a]/95 backdrop-blur-sm border-b border-gray-800' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center gap-2 sm:gap-3">
              <Image 
                src="/images/transparent-photo.png" 
                alt="StatTrackr" 
                width={32} 
                height={32}
                className="w-7 h-7 sm:w-8 sm:h-8"
              />
              <span className="text-lg sm:text-xl font-bold">StatTrackr</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-4">
              {user ? (
                <>
                  {hasPremium ? (
                    <>
                      <span className="text-sm text-gray-400">Pro Member</span>
                      <button
                        onMouseEnter={prefetchPropsResources}
                        onFocus={prefetchPropsResources}
                        onClick={goToProps}
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        Go to App
                      </button>
                      <div className="relative" ref={profileMenuRef}>
                        <button
                          onClick={() => setShowProfileMenu((v) => !v)}
                          className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                          aria-label="Profile"
                        >
                          <UserIcon className="w-5 h-5" />
                        </button>
                        {showProfileMenu && (
                          <div className="absolute right-0 top-full mt-1 py-1 bg-[#0a1929] border border-gray-700 rounded-lg shadow-xl min-w-[200px] z-50">
                            <p className="px-4 pt-2 pb-1 text-xs text-gray-500">
                              You&apos;re logged in with
                            </p>
                            <p className="px-4 py-1.5 pb-2 text-sm text-gray-300 truncate border-b border-gray-700" title={user?.email ?? ''}>
                              {user?.email ?? '—'}
                            </p>
                            <button
                              onClick={async () => {
                                await supabase.auth.signOut();
                                setShowProfileMenu(false);
                                router.push('/home');
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                            >
                              Log out
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => router.push('/home#pricing')}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        Upgrade to Pro
                      </button>
                      <div className="relative" ref={profileMenuRef}>
                        <button
                          onClick={() => setShowProfileMenu((v) => !v)}
                          className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                          aria-label="Profile"
                        >
                          <UserIcon className="w-5 h-5" />
                        </button>
                        {showProfileMenu && (
                          <div className="absolute right-0 top-full mt-1 py-1 bg-[#0a1929] border border-gray-700 rounded-lg shadow-xl min-w-[200px] z-50">
                            <p className="px-4 pt-2 pb-1 text-xs text-gray-500">
                              You&apos;re logged in with
                            </p>
                            <p className="px-4 py-1.5 pb-2 text-sm text-gray-300 truncate border-b border-gray-700" title={user?.email ?? ''}>
                              {user?.email ?? '—'}
                            </p>
                            <button
                              onClick={async () => {
                                await supabase.auth.signOut();
                                setShowProfileMenu(false);
                                router.push('/home');
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                            >
                              Log out
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => router.push('/home#pricing')}
                    className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs sm:text-sm font-medium transition-colors"
                  >
                    Get Started
                  </button>
                  <button
                    onClick={() => router.push('/login')}
                    className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-gray-300 hover:text-white text-xs sm:text-sm transition-colors"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => router.push('/login?signup=1')}
                    className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-gray-300 hover:text-white text-xs sm:text-sm transition-colors"
                  >
                    Sign Up
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section ref={heroRef} className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 bg-gradient-to-r from-purple-400 via-blue-400 to-purple-600 bg-clip-text text-transparent">
              NBA &amp; AFL Research Platform
            </h1>
            <p className="text-xl sm:text-2xl text-gray-300 max-w-3xl mx-auto mb-4">
              Professional sports analytics and data research for NBA and AFL
            </p>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
              Research and analytics for NBA and AFL. <span className="font-semibold text-white">Not a betting platform.</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-4 bg-purple-600 hover:bg-purple-700 rounded-lg text-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                Get Started
                <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-lg font-semibold transition-colors"
              >
                Need help?
              </button>
            </div>
          </div>

          {/* Mock Device Preview */}
          <div className="relative mt-20 flex flex-col items-center">
            {/* Desktop / Mobile toggle — icons only; hidden on mobile, show only mobile mock there */}
            <div className="hidden lg:inline-flex rounded-lg bg-gray-800/90 p-1 border border-gray-700 mb-8">
              <button
                onClick={() => setDeviceView('desktop')}
                className={`flex items-center justify-center p-2 rounded-md transition-all ${
                  deviceView === 'desktop' ? 'bg-purple-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                }`}
                title="Desktop"
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDeviceView('mobile')}
                className={`flex items-center justify-center p-2 rounded-md transition-all ${
                  deviceView === 'mobile' ? 'bg-purple-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                }`}
                title="Mobile"
              >
                <Smartphone className="w-4 h-4" />
              </button>
            </div>

            {/* Desktop+phone: text on the side (all static). Else: text above, cycling with slide. */}
            {isDesktopPhoneView ? (
              <div className="flex flex-row items-start justify-center gap-8 lg:gap-12 w-full px-4">
                <div className="relative w-full sm:w-auto flex justify-center flex-shrink-0">
                  {/* iPhone frame: bezel, volume, power; photos flick through */}
                  <div className="w-[340px] sm:w-[360px] h-[740px] sm:h-[800px] rounded-[3.5rem] border-[6px] sm:border-[7px] border-gray-800 box-border bg-gray-800 shadow-2xl relative overflow-visible">
                    {/* Left: volume — protruding outward from the left edge */}
                    <div className="absolute -left-3 top-[22%] w-1.5 h-11 sm:h-12 rounded-full bg-gray-700 z-30" aria-hidden />
                    <div className="absolute -left-3 top-[31%] w-1.5 h-11 sm:h-12 rounded-full bg-gray-700 z-30" aria-hidden />
                    {/* Right: power — protruding outward from the right edge */}
                    <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-1.5 h-14 sm:h-16 rounded-full bg-gray-700 z-30" aria-hidden />
                    <div className="w-full h-full bg-[#050d1a] rounded-[3rem] overflow-hidden relative">
                      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-20">
                        <div className="w-32 h-8 bg-black rounded-full flex items-center justify-center">
                          <div className="w-24 h-6 bg-gray-900 rounded-full"></div>
                        </div>
                      </div>
                      <div className="pt-4 h-full overflow-hidden relative">
                        <div className="h-full transition-all duration-500 ease-in-out">
                          {mobileSlides.map((slide, idx) => (
                            <div
                              key={idx}
                              className={`absolute inset-0 transition-opacity duration-500 ${
                                idx === mobileSlide ? 'opacity-100' : 'opacity-0'
                              }`}
                            >
                              <div className="w-full h-full relative p-1">
                                {!mobileImageErrors[idx] ? (
                                  <Image
                                    src={slide.image}
                                    alt={slide.name}
                                    fill
                                    className="object-cover rounded-lg"
                                    style={{ objectPosition: slide.objectPosition || 'center center' }}
                                    onError={() => setMobileImageErrors(prev => ({ ...prev, [idx]: true }))}
                                    unoptimized
                                  />
                                ) : (
                                  <div className={`w-full h-full flex items-center justify-center bg-gradient-to-b ${
                                    idx === 0 ? 'from-purple-900/20 to-blue-900/20' :
                                    idx === 1 ? 'from-blue-900/20 to-purple-900/20' :
                                    idx === 2 ? 'from-emerald-900/20 to-blue-900/20' :
                                    'from-indigo-900/20 to-purple-900/20'
                                  }`}>
                                    <div className="text-center p-4">
                                      <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                                        idx === 0 ? 'bg-purple-600/20' : idx === 1 ? 'bg-blue-600/20' : idx === 2 ? 'bg-emerald-600/20' : 'bg-indigo-600/20'
                                      }`}>
                                        {idx === 0 && <Search className="w-8 h-8 text-purple-400" />}
                                        {idx === 1 && <BarChart3 className="w-8 h-8 text-blue-400" />}
                                        {idx === 2 && <BookOpen className="w-8 h-8 text-emerald-400" />}
                                        {idx === 3 && <TrendingUp className="w-8 h-8 text-indigo-400" />}
                                      </div>
                                      <p className="text-sm font-semibold text-gray-300 mb-1">{slide.name}</p>
                                      <p className="text-xs text-gray-500">{slide.description}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-2 z-10">
                          {mobileSlides.map((_, idx) => (
                            <div
                              key={idx}
                              className={`h-1.5 rounded-full transition-all ${
                                idx === mobileSlide ? 'bg-white w-8' : 'bg-white/30 w-1.5'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-purple-600 px-4 py-2 rounded-full text-sm font-medium shadow-lg">
                    Mobile Optimized
                  </div>
                </div>
                {/* Static block: all 4 mobile slides’ text, no cycling */}
                <div className="w-full lg:w-96 lg:max-w-md flex-shrink-0 text-center lg:text-left space-y-6 overflow-y-auto lg:max-h-[min(800px,85vh)] pr-2">
                  {mobileSlides.map((s, idx) => (
                    <div key={idx}>
                      <h3 className="text-lg font-bold text-white mb-1">{s.name}</h3>
                      <p className="text-gray-400 text-sm mb-2">{s.description}</p>
                      {s.paragraph && <p className="text-gray-500 text-sm leading-relaxed">{s.paragraph}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-8 lg:gap-10 w-full px-4">
                {/* Copy above: matches current slide, updates with the photo */}
                <div className="w-full max-w-2xl mx-auto text-center">
                  <h3 className="text-xl lg:text-2xl font-bold text-white mb-2 transition-opacity duration-300">
                    {(effectiveView === 'mobile' ? mobileSlides[mobileSlide] : desktopSlides[desktopSlide]).name}
                  </h3>
                  <p className="text-gray-400 text-sm lg:text-base mb-3">
                    {(effectiveView === 'mobile' ? mobileSlides[mobileSlide] : desktopSlides[desktopSlide]).description}
                  </p>
                  {(effectiveView === 'mobile' ? mobileSlides[mobileSlide] : desktopSlides[desktopSlide]).paragraph && (
                    <p className="text-gray-500 text-sm leading-relaxed">
                      {(effectiveView === 'mobile' ? mobileSlides[mobileSlide] : desktopSlides[desktopSlide]).paragraph}
                    </p>
                  )}
                </div>

                {effectiveView === 'mobile' && (
                  <div className="relative w-full sm:w-auto flex justify-center flex-shrink-0">
                  {/* iPhone frame: bezel, volume, power; photos flick through */}
                  <div className="w-[340px] sm:w-[360px] h-[740px] sm:h-[800px] rounded-[3.5rem] border-[6px] sm:border-[7px] border-gray-800 box-border bg-gray-800 shadow-2xl relative overflow-visible">
                    {/* Left: volume — protruding outward from the left edge */}
                    <div className="absolute -left-3 top-[22%] w-1.5 h-11 sm:h-12 rounded-full bg-gray-700 z-30" aria-hidden />
                    <div className="absolute -left-3 top-[31%] w-1.5 h-11 sm:h-12 rounded-full bg-gray-700 z-30" aria-hidden />
                    {/* Right: power — protruding outward from the right edge */}
                    <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-1.5 h-14 sm:h-16 rounded-full bg-gray-700 z-30" aria-hidden />
                    <div className="w-full h-full bg-[#050d1a] rounded-[3rem] overflow-hidden relative">
                      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-20">
                        <div className="w-32 h-8 bg-black rounded-full flex items-center justify-center">
                          <div className="w-24 h-6 bg-gray-900 rounded-full"></div>
                        </div>
                      </div>
                      <div className="pt-4 h-full overflow-hidden relative">
                        <div className="h-full transition-all duration-500 ease-in-out">
                          {mobileSlides.map((slide, idx) => (
                            <div
                              key={idx}
                              className={`absolute inset-0 transition-opacity duration-500 ${
                                idx === mobileSlide ? 'opacity-100' : 'opacity-0'
                              }`}
                            >
                              <div className="w-full h-full relative p-1">
                                {!mobileImageErrors[idx] ? (
                                  <Image
                                    src={slide.image}
                                    alt={slide.name}
                                    fill
                                    className="object-cover rounded-lg"
                                    style={{ objectPosition: slide.objectPosition || 'center center' }}
                                    onError={() => setMobileImageErrors(prev => ({ ...prev, [idx]: true }))}
                                    unoptimized
                                  />
                                ) : (
                                  <div className={`w-full h-full flex items-center justify-center bg-gradient-to-b ${
                                    idx === 0 ? 'from-purple-900/20 to-blue-900/20' : 
                                    idx === 1 ? 'from-blue-900/20 to-purple-900/20' : 
                                    idx === 2 ? 'from-emerald-900/20 to-blue-900/20' : 
                                    'from-indigo-900/20 to-purple-900/20'
                                  }`}>
                                    <div className="text-center p-4">
                                      <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                                        idx === 0 ? 'bg-purple-600/20' : idx === 1 ? 'bg-blue-600/20' : idx === 2 ? 'bg-emerald-600/20' : 'bg-indigo-600/20'
                                      }`}>
                                        {idx === 0 && <Search className="w-8 h-8 text-purple-400" />}
                                        {idx === 1 && <BarChart3 className="w-8 h-8 text-blue-400" />}
                                        {idx === 2 && <BookOpen className="w-8 h-8 text-emerald-400" />}
                                        {idx === 3 && <TrendingUp className="w-8 h-8 text-indigo-400" />}
                                      </div>
                                      <p className="text-sm font-semibold text-gray-300 mb-1">{slide.name}</p>
                                      <p className="text-xs text-gray-500">{slide.description}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-2 z-10">
                          {mobileSlides.map((_, idx) => (
                            <div
                              key={idx}
                              className={`h-1.5 rounded-full transition-all ${
                                idx === mobileSlide ? 'bg-white w-8' : 'bg-white/30 w-1.5'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-purple-600 px-4 py-2 rounded-full text-sm font-medium shadow-lg">
                    Mobile Optimized
                  </div>
                </div>
              )}

              {effectiveView === 'desktop' && (
                <div className="relative flex-shrink-0">
                  <div className="w-[min(1110px,95vw)] h-[670px] bg-gray-800 rounded-lg shadow-2xl border-2 border-gray-700 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-8 bg-gray-900 rounded-t-lg flex items-center gap-2 px-4 z-20">
                      <div className="flex gap-2">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                        <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      </div>
                      <div className="flex-1 flex justify-center">
                        <div className="w-32 h-1 bg-gray-700 rounded-full"></div>
                      </div>
                    </div>
                    <div className="pt-8 h-full bg-[#050d1a] overflow-hidden relative">
                      <div className="h-full transition-all duration-500 ease-in-out">
                        {desktopSlides.map((slide, idx) => (
                          <div
                            key={idx}
                            className={`absolute inset-0 transition-opacity duration-500 ${
                              idx === desktopSlide ? 'opacity-100' : 'opacity-0'
                            }`}
                          >
                            <div className="w-full h-full relative p-0 overflow-hidden">
                              {!desktopImageErrors[idx] ? (
                                <Image
                                  src={slide.image}
                                  alt={slide.name}
                                  fill
                                  className="object-cover rounded-lg"
                                  style={{ 
                                    objectPosition: slide.objectPosition || 'center center',
                                    transform: 'scale(1)',
                                    transformOrigin: 'center center'
                                  }}
                                  onError={() => setDesktopImageErrors(prev => ({ ...prev, [idx]: true }))}
                                  unoptimized
                                />
                              ) : (
                                <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${
                                  idx === 0 ? 'from-purple-900/30 to-blue-900/30' : 
                                  idx === 1 ? 'from-blue-900/30 to-purple-900/30' : 
                                  'from-emerald-900/30 to-blue-900/30'
                                }`}>
                                  <div className="text-center p-8">
                                    <div className={`w-24 h-24 mx-auto mb-6 rounded-2xl flex items-center justify-center ${
                                      idx === 0 ? 'bg-purple-600/20' : idx === 1 ? 'bg-blue-600/20' : 'bg-emerald-600/20'
                                    }`}>
                                      {idx === 0 && <Search className="w-12 h-12 text-purple-400" />}
                                      {idx === 1 && <BarChart3 className="w-12 h-12 text-blue-400" />}
                                      {idx === 2 && <BookOpen className="w-12 h-12 text-emerald-400" />}
                                    </div>
                                    <p className="text-xl font-bold text-gray-200 mb-2">{slide.name}</p>
                                    <p className="text-sm text-gray-400">{slide.description}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-2 z-10">
                        {desktopSlides.map((_, idx) => (
                          <div
                            key={idx}
                            className={`h-2 rounded-full transition-all ${
                              idx === desktopSlide ? 'bg-blue-400 w-8' : 'bg-gray-600 w-2'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-lg">
                    Desktop Experience
                  </div>
                </div>
              )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Key Features Grid */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#0a1929]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Why StatTrackr?</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              We built StatTrackr to give you the stats and tools you need without the fluff. Here&apos;s what you get.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <BarChart3 className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Advanced NBA &amp; AFL stats</h3>
              <p className="text-gray-400">
                StatTrackr provides a very advanced NBA dashboard and the most advanced AFL dashboard out there, built to help you find edges and make winners.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <DollarSign className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Rate locked in</h3>
              <p className="text-gray-400">
                Subscribe at today&apos;s rate and keep it. If we add more sports or change pricing for new members later, your rate stays the same.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <BookOpen className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Journal</h3>
              <p className="text-gray-400">
                Log your props and track how you go. P&L, ROI, calendar, profit by book and market, all in one place.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Lightbulb className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Auto insights</h3>
              <p className="text-gray-400">
                We surface patterns and takeaways from your journal data so you can see where you&apos;re strong and where to improve.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Zap className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Simple</h3>
              <p className="text-gray-400">
                Clear layout and workflows so you can focus on research instead of fighting the tool.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Smartphone className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Desktop and mobile</h3>
              <p className="text-gray-400">
                Same tools and data on phone, tablet, and desktop. Research wherever you are.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews / Testimonials — infinite scroll to the right */}
      <section id="reviews" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">What users say</h2>
          </div>
        </div>
        <div className="overflow-x-hidden w-full mt-8">
          <div className="flex gap-6 animate-scroll-reviews w-max">
            {[...reviews, ...reviews].map((r, i) => (
              <div key={i} className="flex-shrink-0 w-[min(320px,85vw)] sm:w-[340px] bg-[#0a1929] rounded-xl p-6 border border-gray-800 flex flex-col">
                <Quote className="w-10 h-10 text-purple-500/50 mb-4 flex-shrink-0" />
                <p className="text-gray-300 flex-1 mb-4">&ldquo;{r.quote}&rdquo;</p>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${getAvatarColor(r.name)}`}
                        aria-hidden
                      >
                        {getInitials(r.name)}
                      </div>
                      <p className="font-semibold text-white truncate">{r.name}</p>
                    </div>
                    <span className="flex gap-0.5 shrink-0" aria-label="5 out of 5 stars">
                      {[1, 2, 3, 4, 5].map((j) => <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{r.tag}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#0a1929]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Pricing</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {plans.map((plan) => (
              <React.Fragment key={plan.name}>
                {/* Monthly */}
                <div
                  key={`${plan.name}-monthly`}
                  className={`bg-[#050d1a] rounded-xl border-2 p-8 ${
                    billingCycle === 'monthly'
                      ? 'border-purple-600 shadow-2xl shadow-purple-600/20'
                      : 'border-gray-800'
                  }`}
                >
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    {plan.description ? <p className="text-gray-400 mb-4 text-sm">{plan.description}</p> : null}
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">
                        ${plan.price.monthly.toFixed(2)}
                      </span>
                      <span className="text-gray-400">/month</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">7-day free trial</p>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-300 text-sm whitespace-pre-line">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handleSelectPlan(plan.name, 'monthly')}
                    className={`w-full py-3 rounded-lg font-semibold transition-all ${
                      billingCycle === 'monthly'
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>

                {/* 6 Months */}
                <div
                  key={`${plan.name}-semiannual`}
                  className={`bg-[#050d1a] rounded-xl border-2 p-8 ${
                    billingCycle === 'semiannual'
                      ? 'border-purple-600 shadow-2xl shadow-purple-600/20'
                      : 'border-gray-800'
                  }`}
                >
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    {plan.description ? <p className="text-gray-400 mb-4 text-sm">{plan.description}</p> : null}
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">
                        ${plan.price.semiannual.toFixed(2)}
                      </span>
                      <span className="text-gray-400">/6 months</span>
                    </div>
                    <p className="text-xs text-emerald-400 mt-2">Save 17% • 7-day free trial</p>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-300 text-sm whitespace-pre-line">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handleSelectPlan(plan.name, 'semiannual')}
                    className={`w-full py-3 rounded-lg font-semibold transition-all ${
                      billingCycle === 'semiannual'
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>

                {/* Annual */}
                <div
                  key={`${plan.name}-annual`}
                  className={`bg-[#050d1a] rounded-xl border-2 p-8 ${
                    billingCycle === 'annual'
                      ? 'border-purple-600 shadow-2xl shadow-purple-600/20'
                      : 'border-gray-800'
                  }`}
                >
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    {plan.description ? <p className="text-gray-400 mb-4 text-sm">{plan.description}</p> : null}
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">
                        ${plan.price.annual.toFixed(2)}
                      </span>
                      <span className="text-gray-400">/year</span>
                    </div>
                    <p className="text-xs text-emerald-400 mt-2">Save 25% • 7-day free trial</p>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-300 text-sm whitespace-pre-line">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handleSelectPlan(plan.name, 'annual')}
                    className={`w-full py-3 rounded-lg font-semibold transition-all ${
                      billingCycle === 'annual'
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-10">
            FAQ
          </h2>
          <div className="space-y-3">
            {[
              { q: 'Is there a free trial?', a: 'Yes. All plans include a 7-day free trial. We need a card to start, but you won\'t be charged until the trial ends. If you cancel before the trial is over, you won\'t be charged at all.' },
              { q: 'Can I cancel anytime?', a: 'Yes. You can cancel your subscription at any time. There are no cancellation fees and we don\'t make you jump through hoops.' },
              { q: 'Is mobile supported?', a: 'Yes. StatTrackr works on phone, tablet, and desktop. You get the same features and data on mobile so you can research on the go.' },
              { q: 'How do I contact support?', a: <>Email us at <a href="mailto:Support@Stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">Support@Stattrackr.co</a>. We typically respond within 24 hours.</> },
              { q: 'Does the journal use real money?', a: 'No. The journal is for tracking only. You enter your own data; we don\'t handle real money or connect to any sportsbooks. It\'s just a tool to log your research and see how you\'re going over time.' },
              { q: 'What sports are available?', a: 'Right now we have NBA and AFL with full stats, props, and research tools. We will add more sports and will announce them when they\'re ready.' },
              { q: 'Are the top-ranked props the best picks?', a: 'No. The order is based on line value and odds we pull from books, not our recommendations. We give you the data and tools; you decide what to do with it. Use the filters and dashboard to build your own edges.' },
            ].map((faq, i) => (
              <div
                key={i}
                onClick={() => setOpenFAQ(openFAQ === i ? null : i)}
                className="bg-[#0a1929] rounded-xl p-4 border border-gray-800 cursor-pointer hover:border-purple-500/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-semibold text-white">{faq.q}</h3>
                  <svg
                    className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${openFAQ === i ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {openFAQ === i && (
                  <p className="text-gray-400 mt-3 text-sm leading-relaxed">
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <p className="text-gray-400 font-medium mb-6 text-lg">Sports coverage</p>
            <div className="flex items-center justify-center gap-16">
              <Image src="/images/nba-logo.png" alt="NBA" width={200} height={200} className="object-contain opacity-90 w-32 h-32 sm:w-44 sm:h-44 md:w-52 md:h-52" />
              <Image src="/images/afl-logo.png" alt="AFL" width={200} height={200} className="object-contain opacity-90 w-32 h-32 sm:w-44 sm:h-44 md:w-52 md:h-52" />
            </div>
          </div>
          <p className="text-center text-gray-400 mt-10">
            <a href="mailto:Support@Stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">Support@Stattrackr.co</a>
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-purple-600 to-blue-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl font-bold mb-8">Ready to start?</h2>
          <button
            onClick={() => {
              if (user && hasPremium) goToProps();
              else if (user) router.push('/home#pricing');
              else router.push('/login');
            }}
            className="px-8 py-4 bg-white text-purple-600 rounded-lg text-lg font-semibold hover:bg-gray-100 transition-colors"
          >
            Start Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#050d1a] border-t border-gray-800 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Image 
                  src="/images/stattrackr-icon.png" 
                  alt="StatTrackr" 
                  width={32} 
                  height={32}
                  className="w-8 h-8"
                />
                <span className="text-xl font-bold">StatTrackr</span>
              </div>
              <p className="text-gray-400 text-sm">
                NBA and AFL research and analytics platform for serious analysts and researchers.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
                <li><button onMouseEnter={prefetchPropsResources} onFocus={prefetchPropsResources} onClick={goToProps} className="hover:text-white transition-colors">Player Props</button></li>
                <li><button onClick={() => router.push('/nba/research/dashboard')} className="hover:text-white transition-colors">NBA Dashboard</button></li>
                <li><button onClick={() => router.push('/afl')} className="hover:text-white transition-colors">AFL Research</button></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="/terms" className="hover:text-white transition-colors">Terms</a></li>
                <li><a href="/privacy" className="hover:text-white transition-colors">Privacy</a></li>
                <li><button onClick={() => router.push('/login')} className="hover:text-white transition-colors">Sign In</button></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <p className="text-gray-400 text-sm mb-2">
                StatTrackr is a research and analytics platform. We do not facilitate betting or gambling activities.
              </p>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
            <p>© {new Date().getFullYear()} StatTrackr. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
