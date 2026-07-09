"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { readViewerProfileCache, resolveViewerProfile } from '@/lib/profileSubscriptionGate';
import type { User } from '@supabase/supabase-js';
import { StatTrackrLogo } from '@/components/StatTrackrLogo';
import { NBA_PUBLIC_ENABLED, WORLD_CUP_PUBLIC_ENABLED } from '@/lib/nbaConstants';
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
    router.prefetch('/props?sport=all');
    void fetch('/api/props/combined', { cache: 'force-cache' }).catch(() => {});
    if (NBA_PUBLIC_ENABLED) {
      void fetch('/api/nba/player-props', { cache: 'force-cache' }).catch(() => {});
    }
    void fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
    if (WORLD_CUP_PUBLIC_ENABLED) {
      void fetch('/api/world-cup/dashboard?playerPropsList=1', { cache: 'force-cache' }).catch(() => {});
    }
  };

  const goToProps = () => {
    prefetchPropsResources();
    router.push('/props?sport=all');
  };
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [user, setUser] = useState<User | null>(null);
  const [hasPremium, setHasPremium] = useState(false);
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [loadingBrandReady, setLoadingBrandReady] = useState(false);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadingBrandReady) return;
    const t = setTimeout(() => setLoadingBrandReady(true), 700);
    return () => clearTimeout(t);
  }, [loadingBrandReady]);

  // User reviews / testimonials (2 price, 1 journal, 7 varied personal)
  const reviews = [
    { quote: "I expected something fairly basic at this price point, but the depth of the statistics across every sport genuinely surprised me. It's become a core part of my routine.", name: 'marct_22', tag: 'Pro user' },
    { quote: "The dashboard is comprehensive across every sport, and noticeably deeper than the free tools I was using before. Excellent value for the cost.", name: 'jreed9', tag: 'Pro user' },
    { quote: "The journal makes it easy to identify exactly where my approach is falling short. I used to rely on guesswork; now I have the data to back my decisions.", name: 'jake_m82', tag: 'Pro user' },
    { quote: "This is the first platform of its kind I've stuck with. Most tools I sign up for and abandon within a week. I'm in this one every day.", name: 'alexk9', tag: 'Pro user' },
    { quote: "I previously juggled spreadsheets, a free site, and notes on my phone. Having everything consolidated in one place has saved me a significant amount of time.", name: 'samr91', tag: 'Pro user' },
    { quote: "It strikes the right balance. A lot of these tools overwhelm you with information; this one surfaces what actually matters without the clutter.", name: 'cjlew', tag: 'Pro user' },
    { quote: "I use it on my phone during the day and my laptop in the evening. The experience is identical across both, with no sync issues. That alone made it worthwhile.", name: 'drew_07', tag: 'Pro user' },
    { quote: "I'd tried a few alternatives that were either overly complicated or too limited. This one sits right in the middle and does exactly what I need.", name: 'tayw23', tag: 'Pro user' },
    { quote: "I'd been searching for something like this for a while. Most options are either low quality or overpriced. This delivers exactly what I need, without the extras.", name: 'mok7', tag: 'Pro user' },
    { quote: "It saves me a considerable amount of time. Instead of digging through multiple tabs and apps, everything I need is in one place.", name: 'riley_n24', tag: 'Pro user' },
  ];

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
      prefetchPropsResources();
      const search = typeof window !== "undefined" ? window.location.search : "";
      const params = new URLSearchParams(search);
      if (!params.has('sport')) {
        params.set('sport', 'all');
      }
      const qs = params.toString();
      router.replace(qs ? `/props?${qs}` : '/props');
    }
  }, [isCheckingSubscription, user, hasPremium, router]);

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
    const cached = readViewerProfileCache(userId);
    if (cached) {
      setHasPremium(cached.isPro);
      setIsCheckingSubscription(false);
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setHasPremium(false);
        return;
      }

      const profile = await resolveViewerProfile(supabase, session.user, {
        forceRefresh: !cached,
      });
      setHasPremium(profile.isPro);
    } catch (error) {
      console.error('Error checking subscription:', error);
      if (!cached) {
        setHasPremium(false);
      }
    } finally {
      setIsCheckingSubscription(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login?redirect=/home');
        return;
      }

      setBillingPortalLoading(true);
      const response = await fetch('/api/portal-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        alert(data.error || 'Unable to open Stripe billing right now.');
        return;
      }

      window.location.href = data.url;
    } catch (error) {
      console.error('Error opening Stripe portal:', error);
      alert('Unable to open Stripe billing right now.');
    } finally {
      setBillingPortalLoading(false);
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
        monthly: 'price_1TlWpPF0aO6V0EHjEZcvzlEE',
        semiannual: 'price_1TlWpoF0aO6V0EHjO81pOBgV',
        annual: 'price_1TlWq3F0aO6V0EHji75auKmP',
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
      price: { monthly: 20.00, semiannual: 100.00, annual: 180.00 },
      features: [
        'All statistics - NBA',
        'All statistics - AFL',
        'All statistics - 10+ Football Competitions',
        'AFL premium prediction model',
        'Admin picks',
        'Advanced journaling',
        'All device compatibility',
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
                              onClick={() => {
                                setShowProfileMenu(false);
                                void handleManageSubscription();
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                            >
                              Manage subscription
                            </button>
                            <button
                              onClick={async () => {
                                await supabase.auth.signOut({ scope: 'local' });
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
                              onClick={() => {
                                setShowProfileMenu(false);
                                void handleManageSubscription();
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                            >
                              Manage subscription
                            </button>
                            <button
                              onClick={async () => {
                                await supabase.auth.signOut({ scope: 'local' });
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
      <section ref={heroRef} className="relative pt-28 sm:pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Decorative background glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -left-32 w-[40rem] h-[40rem] rounded-full bg-purple-600/20 blur-[120px]" />
          <div className="absolute top-0 -right-40 w-[38rem] h-[38rem] rounded-full bg-blue-600/20 blur-[120px]" />
        </div>

        <div className="max-w-7xl mx-auto relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center mb-4 lg:mb-8">
            {/* Left: copy */}
            <div className="text-center lg:text-left">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-sm font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                Multi-Sport Research Platform
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-[1.1] tracking-tight">
                {"Australia's most advanced"}
                <span className="block bg-gradient-to-r from-purple-400 via-blue-400 to-purple-600 bg-clip-text text-transparent">
                  sports research platform.
                </span>
              </h1>
              <p className="text-lg sm:text-xl text-gray-300 max-w-xl mx-auto lg:mx-0 mb-4">
                The most in-depth sports statistics platform in Australia, built for serious researchers who want every edge the data can give them.
              </p>
              <p className="text-base text-gray-400 max-w-xl mx-auto lg:mx-0 mb-8">
                <span className="font-semibold text-white">Not a betting platform.</span> Simply the data and tools for serious, informed analysis.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <button
                  onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                  className="px-8 py-4 bg-purple-600 hover:bg-purple-700 rounded-lg text-lg font-semibold transition-all hover:scale-[1.02] shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
                >
                  Get Started
                  <ArrowRight className="w-5 h-5" />
                </button>
                <button
                  onClick={() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' })}
                  className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-lg font-semibold transition-colors"
                >
                  Learn More
                </button>
              </div>
              <div className="mt-8 flex items-center gap-3 justify-center lg:justify-start text-sm text-gray-400">
                <span className="flex gap-0.5" aria-label="5 out of 5 stars">
                  {[1, 2, 3, 4, 5].map((j) => <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />)}
                </span>
                <span>Trusted by data-driven researchers</span>
              </div>
            </div>

            {/* Right: hero photo */}
            <div className="relative pb-10">
              <div className="relative mx-auto w-full max-w-md lg:max-w-none">
                <div aria-hidden className="absolute -inset-4 bg-gradient-to-tr from-purple-600/30 via-fuchsia-500/20 to-blue-600/30 rounded-[2rem] blur-2xl" />
                <div className="relative rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-purple-900/50">
                  <Image
                    src="/images/hero-app-in-use.png"
                    alt="A StatTrackr user checking live player stats on their phone"
                    width={900}
                    height={900}
                    priority
                    className="w-full h-auto object-cover"
                  />
                  <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#050d1a]/50 via-transparent to-transparent" />
                </div>
              </div>
            </div>
          </div>

          {/* Product showcase — 3-device render */}
          <div className="mt-32 sm:mt-40 lg:mt-52 pt-8 border-t border-white/5">
            <div className="grid lg:grid-cols-[auto_1fr_1fr] gap-10 lg:gap-12 items-center">
              {/* Image — left */}
              <div className="relative flex justify-center lg:justify-start">
                <div aria-hidden className="absolute inset-0 bg-gradient-to-tr from-purple-600/15 via-fuchsia-500/10 to-blue-600/15 blur-3xl rounded-full pointer-events-none" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/hero-devices.png"
                  alt="StatTrackr running across laptop, tablet, and phone"
                  className="relative w-full max-w-[320px] lg:max-w-[380px] h-auto drop-shadow-2xl"
                  style={{
                    maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
                  }}
                />
              </div>

              {/* Copy — middle */}
              <div className="text-center lg:text-left">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Available on every device</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 leading-tight">
                  Compatible on all devices,<br />anytime, anywhere.
                </h2>
                <p className="text-gray-400 leading-relaxed text-base">
                  Whether you are at home on your desktop, on the go with your phone, or sitting back with a tablet, StatTrackr moves with you. Every feature, every data point, and every tool is fully accessible no matter what screen you are on. Your research never stops just because your device changes.
                </p>
              </div>

              {/* Bookmakers — right */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Bookmakers covered</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { domain: 'sportsbet.com.au', name: 'Sportsbet',  color: '#0b61ff' },
                    { domain: 'pointsbet.com.au', name: 'PointsBet',  color: '#EE3124' },
                    { domain: 'bet365.com',       name: 'Bet365',     color: '#1C6E38' },
                    { domain: 'ladbrokes.com.au', name: 'Ladbrokes',  color: '#006B3F' },
                    { domain: 'tab.com.au',       name: 'TAB',        color: '#00843D' },
                    { domain: 'neds.com.au',      name: 'Neds',       color: '#E31837' },
                    { domain: 'betr.com.au',      name: 'Betr',       color: '#9333ea' },
                    { domain: 'betfair.com.au',   name: 'Betfair',    color: '#FFB81C' },
                    { domain: 'unibet.com.au',    name: 'Unibet',     color: '#43B649' },
                    { domain: 'draftkings.com',   name: 'DraftKings', color: '#53D337' },
                    { domain: 'fanduel.com',      name: 'FanDuel',    color: '#0070EB' },
                    { domain: 'betmgm.com',       name: 'BetMGM',     color: '#C5A572' },
                    { domain: 'fanatics.com',     name: 'Fanatics',   color: '#011E41' },
                    { domain: 'caesars.com',      name: 'Caesars',    color: '#002855' },
                    { domain: 'dabble.com.au',    name: 'Dabble',     color: '#7C3AED' },
                  ].map((bk) => (
                    <div
                      key={bk.name}
                      className="flex flex-col items-center gap-2 rounded-2xl p-3 border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent hover:border-purple-500/40 hover:from-white/[0.08] transition-all"
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
                        style={{ background: `linear-gradient(135deg, ${bk.color}40, ${bk.color}15)` }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${bk.domain}&sz=32`}
                          alt={bk.name}
                          className="w-6 h-6"
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-gray-300 text-center leading-tight">{bk.name}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-3">Lines ranked by value across every major book.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Prediction analytics spotlight */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-[#0a1929]">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="mb-12 lg:mb-16 max-w-2xl">
            <h2 className="text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight">
              Advanced prediction model,
              <span className="block bg-gradient-to-r from-purple-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">
                built to perform.
              </span>
            </h2>
          </div>

          {/* Image + floating stats */}
          <div className="relative">
            <div aria-hidden className="absolute -inset-10 bg-gradient-to-tr from-purple-600/20 via-fuchsia-500/10 to-blue-600/20 blur-3xl pointer-events-none" />

            {/* Laptop image — full width */}
            <div className="relative rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-purple-900/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-picks.png"
                alt="StatTrackr Top Picks model"
                className="w-full h-auto"
                style={{
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                }}
              />
            </div>

            {/* Floating info card — bottom right */}
            <div className="hidden sm:block absolute bottom-6 right-4 sm:bottom-10 sm:right-10 bg-[#050d1a]/90 backdrop-blur-lg border border-gray-700/80 rounded-2xl p-5 sm:p-6 shadow-2xl max-w-[260px] sm:max-w-xs">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">AFL Season 2026</p>
              </div>
              <p className="text-white font-bold text-lg leading-snug mb-4">
                Profitable every round this AFL season.
              </p>
              <button
                onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                Get Access <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Description beneath image */}
          <p className="text-gray-400 mt-8 max-w-2xl text-base leading-relaxed">
            StatTrackr&apos;s Top Picks model analyses player history, matchup trends, and line movement — surfacing the highest-confidence plays each round, ranked and ready.
          </p>

        </div>
      </section>

      {/* Key Features Grid */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Everything you need, nothing you don&apos;t</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              StatTrackr delivers the statistics and tools that matter — without the clutter. Here&apos;s what&apos;s included.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: 'Multi-sport coverage', desc: 'Full statistics and research tools across NBA, AFL, soccer and more. One platform, every sport you follow.' },
              { icon: TrendingUp, title: "Australia's best AFL prediction model", desc: 'Our AFL model crunches player history, matchup trends, and line movement across thousands of data points to surface the highest-confidence plays each round.' },
              { icon: Zap, title: 'Admin free picks', desc: 'Hand-selected picks published directly by our team. No noise, no filler. Just clear calls with the reasoning behind them.' },
              { icon: Lightbulb, title: 'Built for everyone', desc: 'Whether you are brand new to sports research or a seasoned analyst, StatTrackr is designed to be intuitive from the moment you sign in.' },
              { icon: Smartphone, title: 'Cross-device access', desc: 'The same tools and data on phone, tablet, and desktop, so you can research wherever you are.' },
              { icon: DollarSign, title: 'Locked-in pricing', desc: "Subscribe at today's rate and keep it forever. If we add more sports or adjust pricing for new members, your rate never changes." },
            ].map((f, i) => (
              <div
                key={i}
                className="group relative bg-white/[0.03] hover:bg-white/[0.05] p-6 rounded-2xl border border-gray-800 hover:border-purple-500/40 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600/30 to-blue-600/20 border border-purple-500/20 flex items-center justify-center mb-5">
                  <f.icon className="w-6 h-6 text-purple-300" />
                </div>
                <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Reviews / Testimonials — infinite scroll to the right */}
      <section id="reviews" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#0a1929]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">What our users say</h2>
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
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Competitive pricing</h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">Pick the billing cycle that suits you. Every plan includes a 7-day free trial.</p>
          </div>

          {/* Mobile toggle */}
          <div className="flex md:hidden justify-center mb-8">
            <div className="flex bg-white/[0.05] border border-gray-800 rounded-xl p-1 gap-1">
              {(['monthly', 'semiannual', 'annual'] as const).map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setBillingCycle(cycle)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    billingCycle === cycle ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {cycle === 'monthly' ? 'Monthly' : cycle === 'semiannual' ? '6 Months' : 'Annual'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {plans.map((plan) => (
              <React.Fragment key={plan.name}>
                {/* Monthly */}
                <div
                  key={`${plan.name}-monthly`}
                  className={`bg-[#050d1a] rounded-xl border-2 p-8 ${billingCycle === 'monthly' ? 'border-purple-600 shadow-2xl shadow-purple-600/20' : 'border-gray-800'} ${billingCycle !== 'monthly' ? 'hidden md:block' : ''}`}
                >
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    {plan.description ? <p className="text-gray-400 mb-4 text-sm">{plan.description}</p> : null}
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">${plan.price.monthly.toFixed(2)}</span>
                      <span className="text-sm font-medium text-gray-400">AUD</span>
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
                    className="w-full py-3 rounded-lg font-semibold transition-all bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {plan.cta}
                  </button>
                </div>

                {/* 6 Months */}
                <div
                  key={`${plan.name}-semiannual`}
                  className={`bg-[#050d1a] rounded-xl border-2 p-8 ${billingCycle === 'semiannual' ? 'border-purple-600 shadow-2xl shadow-purple-600/20' : 'border-gray-800'} ${billingCycle !== 'semiannual' ? 'hidden md:block' : ''}`}
                >
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    {plan.description ? <p className="text-gray-400 mb-4 text-sm">{plan.description}</p> : null}
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">${plan.price.semiannual.toFixed(2)}</span>
                      <span className="text-sm font-medium text-gray-400">AUD</span>
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
                    className="w-full py-3 rounded-lg font-semibold transition-all bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {plan.cta}
                  </button>
                </div>

                {/* Annual */}
                <div
                  key={`${plan.name}-annual`}
                  className={`bg-[#050d1a] rounded-xl border-2 p-8 ${billingCycle === 'annual' ? 'border-purple-600 shadow-2xl shadow-purple-600/20' : 'border-gray-800'} ${billingCycle !== 'annual' ? 'hidden md:block' : ''}`}
                >
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    {plan.description ? <p className="text-gray-400 mb-4 text-sm">{plan.description}</p> : null}
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">${plan.price.annual.toFixed(2)}</span>
                      <span className="text-sm font-medium text-gray-400">AUD</span>
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
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">Questions, answered</h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'How has the AFL prediction model performed?', a: 'Profitable every week of the AFL season. The model has consistently identified value across rounds, giving subscribers an edge week after week.' },
              { q: 'How have the admin picks performed?', a: '40+ units made across the season. Our team\'s hand-selected picks have delivered strong, consistent returns for subscribers.' },
              { q: 'Is there a free trial?', a: 'Yes. All plans include a 7-day free trial. A payment method is required to begin, but you won\'t be charged until the trial ends. If you cancel before it concludes, you won\'t be charged at all.' },
              { q: 'Can I cancel anytime?', a: 'Yes. You can cancel your subscription at any time. There are no cancellation fees and no unnecessary hurdles.' },
              { q: 'Is mobile supported?', a: 'Yes. StatTrackr works across phone, tablet, and desktop. The full feature set and data are available on mobile, so you can research on the go.' },
              { q: 'How do I contact support?', a: <>Email us at <a href="mailto:Support@Stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">Support@Stattrackr.co</a>. We typically respond within 24 hours.</> },
              { q: 'Does the journal use real money?', a: 'No. The journal is for tracking purposes only. You enter your own data; we don\'t handle real money or connect to any sportsbooks. It is simply a tool for logging your research and reviewing your performance over time.' },
              { q: 'What sports are available?', a: 'We cover multiple sports — NBA, AFL, and more — with full stats, props, and research tools. We\'re always adding more and will announce new sports when they\'re ready.' },
              { q: 'Are the top-ranked props the best picks?', a: 'No. The ranking is based on line value and odds sourced from bookmakers, not our recommendations. We provide the data and tools; how you interpret them is entirely up to you. Use the filters and dashboard to draw your own conclusions.' },
            ].map((faq, i) => (
              <div
                key={i}
                onClick={() => setOpenFAQ(openFAQ === i ? null : i)}
                className="bg-white/[0.03] rounded-xl p-4 border border-gray-800 cursor-pointer hover:border-purple-500/50 transition-colors"
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
            <div className="grid grid-cols-3 items-center justify-items-center gap-4">
              <Image src="/images/nba-logo.png" alt="NBA" width={200} height={200} className="object-contain opacity-90 w-20 h-20 sm:w-44 sm:h-44 md:w-52 md:h-52" />
              <Image src="/images/afl-logo.png" alt="AFL" width={200} height={200} className="object-contain opacity-90 w-20 h-20 sm:w-44 sm:h-44 md:w-52 md:h-52" />
              <div className="flex flex-col items-center justify-center w-20 h-20 sm:w-44 sm:h-44 md:w-52 md:h-52">
                <span className="text-2xl sm:text-5xl md:text-6xl font-black text-white">10+</span>
                <span className="text-gray-300 text-xs sm:text-lg font-semibold mt-1 text-center leading-tight">Football Leagues</span>
              </div>
            </div>
          </div>
          <p className="text-center text-gray-400 mt-10">
            <a href="mailto:Support@Stattrackr.co" className="text-purple-400 hover:text-purple-300 underline">Support@Stattrackr.co</a>
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative overflow-hidden bg-gradient-to-r from-purple-600 to-blue-600 py-20 px-4 sm:px-6 lg:px-8 text-center">
        <div aria-hidden className="absolute -top-20 -right-16 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
        <div aria-hidden className="absolute -bottom-24 -left-16 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-5xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-lg text-white/80 max-w-xl mx-auto mb-8">
            Start your 7-day free trial. Cancel anytime, you won&apos;t be charged until the trial ends.
          </p>
          <button
            onClick={() => {
              if (user && hasPremium) goToProps();
              else if (user) router.push('/home#pricing');
              else router.push('/login');
            }}
            className="px-8 py-4 bg-white text-purple-600 rounded-lg text-lg font-semibold hover:bg-gray-100 transition-all hover:scale-[1.02] shadow-lg"
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
                Multi-sport research and analytics platform for serious analysts and researchers.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
                <li><button onMouseEnter={prefetchPropsResources} onFocus={prefetchPropsResources} onClick={goToProps} className="hover:text-white transition-colors">Player Props</button></li>
                <li>
                  {NBA_PUBLIC_ENABLED ? (
                    <button onClick={() => router.push('/nba/research/dashboard')} className="hover:text-white transition-colors">NBA Dashboard</button>
                  ) : (
                    <span className="text-gray-500">NBA Dashboard (off-season)</span>
                  )}
                </li>
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
