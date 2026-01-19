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
  PlayCircle
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [user, setUser] = useState<User | null>(null);
  const [hasPremium, setHasPremium] = useState(false);
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(true);
  const [activeFeature, setActiveFeature] = useState<'props' | 'dashboard' | 'journal'>('props');
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileSlide, setMobileSlide] = useState(0);
  const [desktopSlide, setDesktopSlide] = useState(0);
  const [mobileImageErrors, setMobileImageErrors] = useState<Record<number, boolean>>({});
  const [desktopImageErrors, setDesktopImageErrors] = useState<Record<number, boolean>>({});
  const heroRef = useRef<HTMLDivElement>(null);

  // Screenshot paths - desktop screenshots (in order: Player Detail, Player Props, Dashboard)
  const desktopSlides = [
    { 
      name: 'Player Detail Page', 
      description: 'Deep dive into player statistics and matchup data',
      image: '/screenshots/desktop/player-detail.png',
      objectPosition: 'center center' // Adjust: 'top', 'center', 'bottom', or 'left center', 'right center', etc.
    },
    { 
      name: 'Player Props Research', 
      description: 'Advanced player prop analysis with DvP rankings and trends',
      image: '/screenshots/desktop/props.png',
      objectPosition: 'center center' // Shows center portion, including both left and right sides
    },
    { 
      name: 'Analytics Dashboard', 
      description: 'Comprehensive betting analytics and performance tracking',
      image: '/screenshots/desktop/dashboard.png',
      objectPosition: 'center center' // Centered but will stretch to fill
    },
  ];

  // Screenshot paths - mobile screenshots (4 slides; add mobile-1.png … mobile-4.png to public/screenshots/mobile/)
  const mobileSlides = [
    { name: 'Player Props', description: 'Research player props and lines on mobile', image: '/screenshots/mobile/mobile-1.png', objectPosition: 'top center' },
    { name: 'Research Dashboard', description: 'Analytics and performance on the go', image: '/screenshots/mobile/mobile-2.png', objectPosition: 'top center' },
    { name: 'Performance Journal', description: 'Track and analyze your research', image: '/screenshots/mobile/mobile-3.png', objectPosition: 'top center' },
    { name: 'Analytics & Insights', description: 'Insights and trends at a glance', image: '/screenshots/mobile/mobile-4.png', objectPosition: 'top center' },
  ];

  useEffect(() => {
    const mobileInterval = setInterval(() => {
      setMobileSlide((prev) => (prev + 1) % mobileSlides.length);
    }, 4000);
    const desktopInterval = setInterval(() => {
      setDesktopSlide((prev) => (prev + 1) % desktopSlides.length);
    }, 4500);
    return () => {
      clearInterval(mobileInterval);
      clearInterval(desktopInterval);
    };
  }, []);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        checkPremiumStatus(session.user.id);
      } else {
        setIsCheckingSubscription(false);
      }
    });

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
      description: 'Complete NBA research and analytics platform',
      price: { monthly: 9.99, semiannual: 49.99, annual: 89.99 },
      features: [
        'Player props research & analysis',
        'Advanced stats (PER, TS%, USG%)',
        'Shot charts & visualizations',
        'Unlimited player research',
        'Full historical data (3 seasons)',
        'Real-time odds & lines',
        'DVP rankings & matchup data',
        'Injury reports & depth charts',
        'Performance journal & tracking',
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

  if (isCheckingSubscription) {
    return (
      <div className="min-h-screen bg-[#050d1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <StatTrackrLogo className="w-20 h-20" />
          <span className="font-bold text-4xl text-white">StatTrackr</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050d1a] text-white">
      {/* Navigation Bar */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'bg-[#050d1a]/95 backdrop-blur-sm border-b border-gray-800' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Image 
                src="/images/stattrackr-icon.png" 
                alt="StatTrackr" 
                width={32} 
                height={32}
                className="w-8 h-8"
              />
              <span className="text-xl font-bold">StatTrackr</span>
            </div>
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  {hasPremium ? (
                    <span className="text-sm text-gray-400">Pro Member</span>
                  ) : (
                    <button
                      onClick={() => router.push('/home#pricing')}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
                    >
                      Upgrade to Pro
                    </button>
                  )}
                  <button
                    onClick={() => router.push('/nba')}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Go to App
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => router.push('/login')}
                    className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => router.push('/home#pricing')}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Get Started
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
              Advanced NBA Research Platform
            </h1>
            <p className="text-xl sm:text-2xl text-gray-300 max-w-3xl mx-auto mb-4">
              Professional sports analytics and data research tools for serious analysts
            </p>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
              StatTrackr is a comprehensive research platform designed for sports analysts, researchers, and data enthusiasts. 
              <span className="font-semibold text-white"> Not a betting platform</span> — a powerful tool for understanding player performance, 
              team dynamics, and statistical patterns through advanced analytics.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => router.push(user ? '/nba' : '/login')}
                className="px-8 py-4 bg-purple-600 hover:bg-purple-700 rounded-lg text-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                Start Researching
                <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => {
                  document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-8 py-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <PlayCircle className="w-5 h-5" />
                See Features
              </button>
            </div>
          </div>

          {/* Mock Device Preview */}
          <div className="relative mt-20">
            <div className="flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-12 px-4 sm:px-0">
              {/* Mobile Mock - iPhone 17 Style */}
              <div className="relative w-full sm:w-auto flex justify-center">
                {/* iPhone 17 Frame */}
                <div className="w-[340px] sm:w-[360px] h-[740px] sm:h-[800px] bg-[#050d1a] rounded-[3.5rem] shadow-2xl relative overflow-hidden">
                  {/* Screen Bezel */}
                  <div className="w-full h-full bg-[#050d1a] rounded-[3.5rem] overflow-hidden relative">
                    {/* Dynamic Island */}
                    <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-20">
                      <div className="w-32 h-8 bg-black rounded-full flex items-center justify-center">
                        <div className="w-24 h-6 bg-gray-900 rounded-full"></div>
                      </div>
                    </div>
                    
                    {/* Screen Content */}
                    <div className="pt-4 h-full overflow-hidden relative">
                      <div className="h-full transition-all duration-500 ease-in-out">
                        {mobileSlides.map((slide, idx) => (
                          <div
                            key={idx}
                            className={`absolute inset-0 transition-opacity duration-500 ${
                              idx === mobileSlide ? 'opacity-100' : 'opacity-0'
                            }`}
                          >
                            {/* Try to load screenshot, fallback to placeholder */}
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
                      {/* Slide Indicators */}
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

              {/* Desktop Mock */}
              <div className="relative">
                <div className="w-[1110px] h-[670px] bg-gray-800 rounded-lg shadow-2xl border-2 border-gray-700 relative overflow-hidden">
                  {/* MacBook-style Bezel */}
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
                  
                  {/* Screen Content */}
                  <div className="pt-8 h-full bg-[#050d1a] overflow-hidden relative">
                    <div className="h-full transition-all duration-500 ease-in-out">
                        {desktopSlides.map((slide, idx) => (
                        <div
                          key={idx}
                          className={`absolute inset-0 transition-opacity duration-500 ${
                            idx === desktopSlide ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          {/* Try to load screenshot, fallback to placeholder */}
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
                    {/* Slide Indicators */}
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
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#0a1929]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Powerful Research Tools</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Everything you need for comprehensive NBA analysis and research
            </p>
          </div>

          {/* Feature Tabs */}
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            <button
              onClick={() => setActiveFeature('props')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeFeature === 'props'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Player Props Research
            </button>
            <button
              onClick={() => setActiveFeature('dashboard')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeFeature === 'dashboard'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Advanced Dashboard
            </button>
            <button
              onClick={() => setActiveFeature('journal')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeFeature === 'journal'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Performance Journal
            </button>
          </div>

          {/* Feature Content */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              {activeFeature === 'props' && (
                <>
                  <h3 className="text-3xl font-bold mb-4">Comprehensive Player Props Research</h3>
                  <p className="text-gray-300 mb-6">
                    Access real-time player prop lines from multiple sportsbooks. Research player performance 
                    across various statistical categories including points, rebounds, assists, and more. 
                    Analyze historical performance, head-to-head matchups, and recent trends to make informed research decisions.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Real-time odds from 13+ sportsbooks</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Historical performance analysis</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Head-to-head matchup data</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Advanced filtering and search</span>
                    </li>
                  </ul>
                </>
              )}
              {activeFeature === 'dashboard' && (
                <>
                  <h3 className="text-3xl font-bold mb-4">Advanced Analytics Dashboard</h3>
                  <p className="text-gray-300 mb-6">
                    Dive deep into player statistics with our comprehensive dashboard. Visualize performance 
                    trends, analyze defensive matchups, and explore advanced metrics. Perfect for researchers 
                    who need detailed insights into player and team performance patterns.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Interactive performance charts</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Defense vs Position (DvP) rankings</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Advanced statistical metrics</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Shot charts and visualizations</span>
                    </li>
                  </ul>
                </>
              )}
              {activeFeature === 'journal' && (
                <>
                  <h3 className="text-3xl font-bold mb-4">Performance Tracking Journal</h3>
                  <p className="text-gray-300 mb-6">
                    Track and analyze your research patterns with our comprehensive journal system. 
                    Monitor performance trends, identify strengths and weaknesses, and gain insights 
                    into your analytical approach. All data is for research purposes only.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Track research performance over time</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Profit & loss analytics</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Automated insights and recommendations</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-300">Export data for further analysis</span>
                    </li>
                  </ul>
                </>
              )}
            </div>
            <div className="relative">
              <div className="aspect-video bg-gray-900 rounded-lg border border-gray-800 overflow-hidden relative">
                {activeFeature === 'props' && (
                  <div className="w-full h-full bg-gradient-to-br from-purple-900/30 to-blue-900/30 flex items-center justify-center">
                    <div className="text-center p-8">
                      <Search className="w-16 h-16 text-purple-400 mx-auto mb-4" />
                      <p className="text-lg text-gray-300 font-semibold mb-2">Player Props Research</p>
                      <p className="text-sm text-gray-400">Real-time odds • Historical analysis • Matchup data</p>
                    </div>
                  </div>
                )}
                {activeFeature === 'dashboard' && (
                  <div className="w-full h-full bg-gradient-to-br from-blue-900/30 to-purple-900/30 flex items-center justify-center">
                    <div className="text-center p-8">
                      <BarChart3 className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                      <p className="text-lg text-gray-300 font-semibold mb-2">Advanced Analytics Dashboard</p>
                      <p className="text-sm text-gray-400">Performance charts • DvP rankings • Shot visualizations</p>
                    </div>
                  </div>
                )}
                {activeFeature === 'journal' && (
                  <div className="w-full h-full bg-gradient-to-br from-emerald-900/30 to-blue-900/30 flex items-center justify-center">
                    <div className="text-center p-8">
                      <BookOpen className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                      <p className="text-lg text-gray-300 font-semibold mb-2">Performance Journal</p>
                      <p className="text-sm text-gray-400">Track patterns • Analyze trends • Export data</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What is StatTrackr Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl font-bold mb-6">What is StatTrackr?</h2>
          <div className="bg-[#0a1929] rounded-xl p-8 border border-gray-800">
            <p className="text-lg text-gray-300 mb-4 leading-relaxed">
              StatTrackr is an <span className="font-semibold text-white">advanced NBA research and analytics platform</span> designed 
              for sports analysts, researchers, and data enthusiasts. We provide comprehensive tools for analyzing player performance, 
              team dynamics, and statistical patterns.
            </p>
            <div className="bg-purple-600/10 border border-purple-600/30 rounded-lg p-6 mt-6">
              <p className="text-base text-gray-200 font-medium mb-2">
                ⚠️ Important: StatTrackr is a Research Tool
              </p>
              <p className="text-sm text-gray-400">
                StatTrackr is <span className="font-semibold text-white">not a betting platform</span>. We do not facilitate, 
                process, or manage any betting or gambling activities. Our platform is designed exclusively for research, 
                statistical analysis, and data exploration purposes. All odds and lines displayed are for informational and 
                research purposes only.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6 mt-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Database className="w-8 h-8 text-purple-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">Data Research</h3>
                <p className="text-sm text-gray-400">Comprehensive statistical databases and historical analysis</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <BarChart3 className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">Analytics Tools</h3>
                <p className="text-sm text-gray-400">Advanced visualization and pattern recognition</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-600/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <TrendingUp className="w-8 h-8 text-emerald-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">Performance Insights</h3>
                <p className="text-sm text-gray-400">Automated insights and trend analysis</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Key Features Grid */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-[#0a1929]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Why Choose StatTrackr?</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Built for researchers, analysts, and data enthusiasts
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Database className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Comprehensive Data</h3>
              <p className="text-gray-400">
                Access to 3+ seasons of historical data, real-time statistics, and advanced metrics 
                for thorough research and analysis.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Zap className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Real-Time Updates</h3>
              <p className="text-gray-400">
                Get instant updates on odds, line movements, injuries, and lineup changes to stay 
                current with the latest information.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Shield className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Research-Focused</h3>
              <p className="text-gray-400">
                StatTrackr is a research and analytics platform, not a betting service. 
                Designed for serious data analysis and statistical research.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <BarChart3 className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Advanced Analytics</h3>
              <p className="text-gray-400">
                Powerful visualization tools, DvP rankings, shot charts, and custom metrics 
                for deep statistical analysis.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <TrendingUp className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Performance Insights</h3>
              <p className="text-gray-400">
                Automated insights and recommendations based on your research patterns to help 
                identify trends and opportunities.
              </p>
            </div>
            <div className="bg-[#0a1929] p-6 rounded-lg border border-gray-800">
              <Smartphone className="w-12 h-12 text-purple-400 mb-4" />
              <h3 className="text-xl font-bold mb-2">Cross-Platform</h3>
              <p className="text-gray-400">
                Access your research tools anywhere with our responsive design. Optimized for 
                desktop, tablet, and mobile devices.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-[#0a1929]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
              Choose the plan that fits your research needs
            </p>
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
                    <p className="text-gray-400 mb-4 text-sm">{plan.description}</p>
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
                        <span className="text-gray-300 text-sm">{feature}</span>
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
                    <p className="text-gray-400 mb-4 text-sm">{plan.description}</p>
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
                        <span className="text-gray-300 text-sm">{feature}</span>
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
                    <p className="text-gray-400 mb-4 text-sm">{plan.description}</p>
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
                        <span className="text-gray-300 text-sm">{feature}</span>
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

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-purple-600 to-blue-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl font-bold mb-4">Ready to Start Researching?</h2>
          <p className="text-xl text-white/90 mb-8">
            Join thousands of analysts using StatTrackr for advanced NBA research and analytics
          </p>
          <button
            onClick={() => router.push(user ? '/nba' : '/login')}
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
                Advanced NBA research and analytics platform for serious analysts and researchers.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><button onClick={() => router.push('/nba')} className="hover:text-white transition-colors">Player Props</button></li>
                <li><button onClick={() => router.push('/nba/research/dashboard')} className="hover:text-white transition-colors">Dashboard</button></li>
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
