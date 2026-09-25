"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { signOutFully, supabase } from '@/lib/supabaseClient';
import { authErrorMessage, emailAccountExists, signInWithEmailPassword } from '@/lib/auth/emailAccount';
import {
  invalidateViewerProfileCache,
  peekViewerProfileCache,
  readViewerProfileCache,
  resolveViewerProfile,
} from '@/lib/profileSubscriptionGate';
import type { User } from '@supabase/supabase-js';
import { StatTrackrSplash } from '@/components/StatTrackrSplash';
import { NBA_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import { 
  CheckCircle2,
  Check,
  ArrowRight,
  Quote, 
  Star,
  User as UserIcon,
  X,
  LayoutGrid,
  LineChart,
  Trophy,
  Megaphone,
  MessageCircle,
  Medal,
  DollarSign,
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

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function TryFreeMenu({
  align = 'left',
  buttonClassName,
  iconClassName = 'w-5 h-5',
  label = 'Try StatTrackr Free',
}: {
  align?: 'left' | 'center';
  buttonClassName: string;
  iconClassName?: string;
  label?: string;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setVisible(true));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const close = () => {
    if (googleLoading) return;
    setVisible(false);
    window.setTimeout(() => setOpen(false), 220);
  };

  const continueWithGoogle = async () => {
    setGoogleLoading(true);
    setGoogleError('');
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${baseUrl}/home` },
      });
      if (error) throw error;
      localStorage.setItem('stattrackr_google_login', 'true');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Google sign up failed';
      setGoogleError(
        message.includes('provider is not enabled')
          ? 'Google sign-up is not available right now. Use email instead.'
          : message
      );
      setGoogleLoading(false);
    }
  };

  return (
    <div className={align === 'center' ? 'w-full sm:w-auto' : ''}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName}
        aria-haspopup="dialog"
      >
        {label}
        <ArrowRight className={iconClassName} />
      </button>
      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
              <button
                type="button"
                aria-label="Close"
                className={`absolute inset-0 bg-black/70 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
                onClick={close}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="try-stattrackr-title"
                className={`relative w-full max-w-[400px] overflow-hidden rounded-3xl border border-white/10 bg-[#07111f] shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)] transition-all duration-200 ease-out ${
                  visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.98] opacity-0'
                }`}
              >
                <button
                  type="button"
                  onClick={close}
                  className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="px-6 pb-2 pt-8 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#121c33] ring-1 ring-white/10">
                    <Image
                      src="/images/stattrackr-logo-512.webp"
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7"
                    />
                  </div>
                  <h2 id="try-stattrackr-title" className="mt-4 text-xl font-semibold tracking-tight text-white">
                    {mode === 'signin' ? 'Sign in to StatTrackr' : 'Sign up for StatTrackr'}
                  </h2>
                  <p className="mt-1.5 text-sm text-gray-400">
                    {mode === 'signin'
                      ? 'Welcome back. Please sign in to continue.'
                      : 'Create a free account and start researching.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void continueWithGoogle()}
                    disabled={googleLoading}
                    className="relative mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-[#1c2740] text-sm font-medium text-gray-100 transition-colors hover:bg-[#243250] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {googleLoading ? 'Connecting…' : 'Continue with Google'}
                  </button>
                  {googleError ? (
                    <p className="mt-2 text-center text-xs text-red-400">{googleError}</p>
                  ) : null}
                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs text-gray-500">or</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                  <form
                    className="text-left"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const next = email.trim();
                      if (!next || !next.includes('@')) {
                        setGoogleError('Enter a valid email address.');
                        return;
                      }
                      if (!needsPassword) {
                        setChecking(true);
                        setGoogleError('');
                        void emailAccountExists(next)
                          .then((exists) => {
                            if (exists) {
                              setMode('signin');
                              setNeedsPassword(true);
                              return;
                            }
                            router.push(`/login?signup=1&email=${encodeURIComponent(next)}`);
                          })
                          .catch((error: unknown) => {
                            setGoogleError(error instanceof Error ? error.message : 'Could not check that email.');
                          })
                          .finally(() => setChecking(false));
                        return;
                      }
                      if (!password) {
                        setGoogleError('Enter your password.');
                        return;
                      }
                      setChecking(true);
                      setGoogleError('');
                      void signInWithEmailPassword(next, password, true)
                        .then(() => router.replace('/home'))
                        .catch((error: unknown) => {
                          setGoogleError(authErrorMessage(error instanceof Error ? error : { message: String(error) }));
                        })
                        .finally(() => setChecking(false));
                    }}
                  >
                    <label htmlFor="try-stattrackr-email" className="text-sm font-medium text-gray-200">
                      Email address
                    </label>
                    <input
                      id="try-stattrackr-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setNeedsPassword(false);
                        setPassword('');
                        if (googleError) setGoogleError('');
                      }}
                      placeholder="Enter your email address"
                      className="mt-2 h-11 w-full rounded-lg border border-transparent bg-[#1c2740] px-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-purple-500/70"
                    />
                    {needsPassword ? (
                      <div className="mt-3">
                        <label htmlFor="try-stattrackr-password" className="text-sm font-medium text-gray-200">
                          Password
                        </label>
                        <input
                          id="try-stattrackr-password"
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="Enter your password"
                          className="mt-2 h-11 w-full rounded-lg border border-transparent bg-[#1c2740] px-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-purple-500/70"
                        />
                      </div>
                    ) : null}
                    <button
                      type="submit"
                      disabled={checking || googleLoading}
                      className="mt-4 flex h-11 w-full items-center justify-center gap-1 rounded-lg bg-purple-600 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
                    >
                      {checking ? 'Continuing…' : needsPassword ? 'Sign in' : 'Continue'}
                      {checking ? null : <ArrowRight className="h-4 w-4" />}
                    </button>
                  </form>
                </div>
                <div className="mt-5 border-t border-white/10 bg-black/20 px-6 py-4 text-center text-sm text-gray-400">
                  {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode((current) => (current === 'signin' ? 'signup' : 'signin'));
                      setGoogleError('');
                    }}
                    className="font-semibold text-purple-400 hover:text-purple-300"
                  >
                    {mode === 'signin' ? 'Sign up' : 'Sign in'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function buildPropsHref(): string {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(search);
  if (!params.has('sport')) params.set('sport', 'all');
  const qs = params.toString();
  return qs ? `/props?${qs}` : '/props';
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
  };

  const goToProps = () => {
    prefetchPropsResources();
    router.push('/props?sport=all');
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Keep the hash in the URL without a hard navigation / flash
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}#${id}`);
    }
  };
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'semiannual' | 'annual'>('monthly');
  const [user, setUser] = useState<User | null>(null);
  const [hasPremium, setHasPremium] = useState(false);
  // Always show logo splash until auth resolves, then marketing or /props.
  const [bootReady, setBootReady] = useState(false);
  const [isRedirectingPro, setIsRedirectingPro] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [openFAQ, setOpenFAQ] = useState<number | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const authCheckIdRef = useRef(0);
  const redirectingRef = useRef(false);
  const bootReadyRef = useRef(false);

  const finishBootToMarketing = () => {
    if (redirectingRef.current) return;
    setIsRedirectingPro(false);
    setHasPremium(false);
    bootReadyRef.current = true;
    setBootReady(true);
  };

  const goProToProps = () => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    setHasPremium(true);
    setIsRedirectingPro(true);
    bootReadyRef.current = false;
    setBootReady(false);
    prefetchPropsResources();
    // Soft navigate while keeping the dark splash mounted — avoids a full-document white flash.
    router.replace(buildPropsHref());
  };

  const handleLogout = async () => {
    authCheckIdRef.current += 1;
    redirectingRef.current = false;
    setUser(null);
    setHasPremium(false);
    setIsRedirectingPro(false);
    setBootReady(true);
    setShowProfileMenu(false);
    invalidateViewerProfileCache();
    await signOutFully({ scope: 'local' });
    router.replace('/');
  };

  // User reviews / testimonials (2 price, 1 journal, 7 varied personal)
  const reviews = [
    { quote: "I expected something fairly basic at this price point, but the depth of the statistics across every sport genuinely surprised me. It's become a core part of my routine.", name: 'marct_22', tag: 'Pro user' },
    { quote: "The dashboard is comprehensive across every sport, and noticeably deeper than the free tools I was using before. Excellent value for the cost.", name: 'jreed9', tag: 'Pro user' },
    { quote: "The matchup stats make it easy to see exactly where the edge is. I used to rely on guesswork; now I have the data to back my decisions.", name: 'jake_m82', tag: 'Pro user' },
    { quote: "This is the first platform of its kind I've stuck with. Most tools I sign up for and abandon within a week. I'm in this one every day.", name: 'alexk9', tag: 'Pro user' },
    { quote: "I previously juggled spreadsheets, a free site, and notes on my phone. Having everything consolidated in one place has saved me a significant amount of time.", name: 'samr91', tag: 'Pro user' },
    { quote: "It strikes the right balance. A lot of these tools overwhelm you with information; this one surfaces what actually matters without the clutter.", name: 'cjlew', tag: 'Pro user' },
    { quote: "I use it on my phone during the day and my laptop in the evening. The experience is identical across both, with no sync issues. That alone made it worthwhile.", name: 'drew_07', tag: 'Pro user' },
    { quote: "I'd tried a few alternatives that were either overly complicated or too limited. This one sits right in the middle and does exactly what I need.", name: 'tayw23', tag: 'Pro user' },
    { quote: "I'd been searching for something like this for a while. Most options are either low quality or overpriced. This delivers exactly what I need, without the extras.", name: 'mok7', tag: 'Pro user' },
    { quote: "It saves me a considerable amount of time. Instead of digging through multiple tabs and apps, everything I need is in one place.", name: 'riley_n24', tag: 'Pro user' },
  ];

  useEffect(() => {
    let cancelled = false;
    const checkId = ++authCheckIdRef.current;

    const run = async () => {
      // Fast path: known Pro from cache — stay on splash and hard-redirect.
      const cachedPro = peekViewerProfileCache();
      if (cachedPro?.isPro) {
        goProToProps();
        return;
      }

      // If Supabase redirected here with tokens in the hash (e.g. /home#access_token=...), set the session
      if (typeof window !== "undefined" && window.location.hash) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const at = params.get("access_token");
        const rt = params.get("refresh_token");
        const type = params.get("type");
        if (at && rt) {
          try {
            await withTimeout(
              supabase.auth.setSession({ access_token: at, refresh_token: rt }),
              4000,
            );
          } catch {
            // Fall through — don't block boot forever on auth recovery.
          }
          window.history.replaceState(null, "", window.location.pathname + window.location.search || "/home");
          if (type === "recovery") {
            router.replace("/auth/update-password");
            return;
          }
        }
      }

      try {
        const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2500);
        if (cancelled || checkId !== authCheckIdRef.current) return;
        setUser(session?.user ?? null);
        if (session?.user) {
          await checkPremiumStatus(session.user.id, checkId);
        } else {
          finishBootToMarketing();
        }
      } catch {
        // Supabase slow/blocked — show marketing rather than hang on splash.
        if (!cancelled && checkId === authCheckIdRef.current) {
          setUser(null);
          finishBootToMarketing();
        }
      }
    };
    void run();

    // Listen for auth changes after boot (initial session is handled by run() above)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        authCheckIdRef.current += 1;
        redirectingRef.current = false;
        setUser(null);
        setHasPremium(false);
        setIsRedirectingPro(false);
        bootReadyRef.current = true;
        setBootReady(true);
        return;
      }
      if (!bootReadyRef.current || redirectingRef.current) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        void checkPremiumStatus(session.user.id, authCheckIdRef.current);
      } else {
        finishBootToMarketing();
      }
    });

    // Handle scroll for navbar
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

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

  // If we land with a hash (e.g. /#pricing), smooth-scroll once marketing is ready
  useEffect(() => {
    if (!bootReady || isRedirectingPro) return;
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const t = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [bootReady, isRedirectingPro]);

  const checkPremiumStatus = async (userId: string, checkId: number) => {
    const cached = readViewerProfileCache(userId);
    if (cached?.isPro && checkId === authCheckIdRef.current) {
      goProToProps();
      return;
    }
    if (cached && checkId === authCheckIdRef.current) {
      setHasPremium(false);
    }

    try {
      const { data: { session } } = await withTimeout(supabase.auth.getSession(), 2500);
      if (checkId !== authCheckIdRef.current) return;
      if (!session?.user) {
        finishBootToMarketing();
        return;
      }

      const profile = await withTimeout(
        resolveViewerProfile(supabase, session.user, {
          forceRefresh: !cached,
        }),
        4000,
      );
      if (checkId !== authCheckIdRef.current) return;
      if (profile.isPro) {
        goProToProps();
        return;
      }
      setHasPremium(false);
      setBootReady(true);
    } catch (error) {
      console.error('Error checking subscription:', error);
      if (checkId === authCheckIdRef.current) {
        // Cached free, or unknown — don't trap users on splash.
        finishBootToMarketing();
      }
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

      const data = await response.json().catch(() => ({}));

      if (response.status === 409 && data.alreadySubscribed) {
        window.location.href = '/props';
        return;
      }
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Response is not JSON');
      }
      
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
        'All statistics - NBL',
        'All statistics - ATP',
        'All statistics - WTA',
        'AFL premium prediction model',
        'Admin picks',
        'All device compatibility',
        'Priority support',
      ],
      limitations: [],
      cta: 'Start Free Trial',
      highlighted: true,
    },
  ];

  // Logged-in Pro: redirect to /props; show loading only once confirmed
  // Splash until auth finishes — then marketing, or redirect to props for Pro.
  if (!bootReady || isRedirectingPro) {
    return <StatTrackrSplash />;
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
                src="/images/stattrackr-logo-512.webp" 
                alt="StatTrackr" 
                width={32} 
                height={32}
                className="w-7 h-7 sm:w-8 sm:h-8"
                priority
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
                              onClick={() => { void handleLogout(); }}
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
                        onMouseEnter={prefetchPropsResources}
                        onFocus={prefetchPropsResources}
                        onClick={goToProps}
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        Go to App
                      </button>
                      <button
                        onClick={() => scrollToSection('pricing')}
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
                              onClick={() => { void handleLogout(); }}
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
                  <TryFreeMenu
                    label="Try Free"
                    iconClassName="w-3 h-3 sm:w-3.5 sm:h-3.5"
                    buttonClassName="whitespace-nowrap px-2 py-1 sm:px-4 sm:py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-[11px] sm:text-sm font-medium transition-colors inline-flex items-center gap-1"
                  />
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
        {/* Decorative background glow — lighter on mobile to avoid GPU jank */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -left-32 w-[40rem] h-[40rem] rounded-full bg-purple-600/15 md:bg-purple-600/20 blur-3xl md:blur-[120px]" />
          <div className="absolute top-0 -right-40 w-[38rem] h-[38rem] rounded-full bg-blue-600/15 md:bg-blue-600/20 blur-3xl md:blur-[120px]" />
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
                <TryFreeMenu
                  align="center"
                  buttonClassName="w-full sm:w-auto px-8 py-4 bg-purple-600 hover:bg-purple-700 rounded-lg text-lg font-semibold transition-all hover:scale-[1.02] shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
                />
                <button
                  onClick={() => scrollToSection('pricing')}
                  className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-lg font-semibold transition-colors"
                >
                  View Premium Plan
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
                <div aria-hidden className="absolute -inset-4 hidden md:block bg-gradient-to-tr from-purple-600/30 via-fuchsia-500/20 to-blue-600/30 rounded-[2rem] blur-2xl" />
                <div className="relative rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-purple-900/50">
                  <Image
                    src="/images/hero-app-in-use.webp"
                    alt="A StatTrackr user checking live player stats on their phone"
                    width={900}
                    height={900}
                    priority
                    sizes="(max-width: 1024px) 90vw, 450px"
                    className="w-full h-auto object-cover"
                  />
                  <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#050d1a]/50 via-transparent to-transparent" />
                </div>
              </div>
            </div>
          </div>

          {/* Product showcase — 3-device render */}
          <div className="mt-8 sm:mt-10 lg:mt-14 pt-6 border-t border-white/5">
            <div className="grid lg:grid-cols-[auto_1fr_1fr] gap-10 lg:gap-12 items-center">
              {/* Image — left */}
              <div className="relative order-2 flex justify-center lg:order-1 lg:justify-start">
                <div aria-hidden className="absolute inset-0 hidden md:block bg-gradient-to-tr from-purple-600/15 via-fuchsia-500/10 to-blue-600/15 blur-3xl rounded-full pointer-events-none" />
                <Image
                  src="/images/hero-devices.webp"
                  alt="StatTrackr running across laptop, tablet, and phone"
                  width={760}
                  height={760}
                  sizes="(max-width: 1024px) 320px, 380px"
                  className="relative w-full max-w-[320px] lg:max-w-[380px] h-auto drop-shadow-2xl"
                  style={{
                    maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
                  }}
                />
              </div>

              {/* Copy — middle */}
              <div className="order-1 text-center lg:order-2 lg:text-left">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Available on every device</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 leading-tight">
                  Compatible on all devices,<br />anytime, anywhere.
                </h2>
                <p className="text-gray-400 leading-relaxed text-base">
                  Whether you are at home on your desktop, on the go with your phone, or sitting back with a tablet, StatTrackr moves with you. Every feature, every data point, and every tool is fully accessible no matter what screen you are on. Your research never stops just because your device changes.
                </p>
              </div>

              {/* Bookmakers — right */}
              <div className="order-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Bookmakers covered</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { name: 'Sportsbet',  color: '#0b61ff', logo: 'sportsbet' },
                    { name: 'PointsBet',  color: '#EE3124', logo: 'pointsbet' },
                    { name: 'Bet365',     color: '#1C6E38', logo: 'bet365' },
                    { name: 'Ladbrokes',  color: '#006B3F', logo: 'ladbrokes' },
                    { name: 'TAB',        color: '#00843D', logo: 'tab' },
                    { name: 'Neds',       color: '#E31837', logo: 'neds' },
                    { name: 'Betr',       color: '#9333ea', logo: 'betr' },
                    { name: 'Betfair',    color: '#FFB81C', logo: 'betfair' },
                    { name: 'Unibet',     color: '#43B649', logo: 'unibet' },
                    { name: 'DraftKings', color: '#53D337', logo: 'draftkings' },
                    { name: 'FanDuel',    color: '#0070EB', logo: 'fanduel' },
                    { name: 'BetMGM',     color: '#C5A572', logo: 'betmgm' },
                    { name: 'Fanatics',   color: '#011E41', logo: 'fanatics' },
                    { name: 'Caesars',    color: '#002855', logo: 'caesars' },
                    { name: 'Dabble',     color: '#7C3AED', logo: 'dabble' },
                  ].map((bk) => (
                    <div
                      key={bk.name}
                      className="flex flex-col items-center gap-2 rounded-2xl p-3 border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent hover:border-purple-500/40 hover:from-white/[0.08] transition-all"
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm bg-white/95 overflow-hidden"
                        style={{ boxShadow: `0 0 0 1px ${bk.color}33` }}
                      >
                        <Image
                          src={`/images/bookmakers/${bk.logo}.png?v=20260802b`}
                          alt={`${bk.name} logo`}
                          width={28}
                          height={28}
                          className="w-7 h-7 object-contain"
                          unoptimized
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
            <div aria-hidden className="absolute -inset-10 hidden md:block bg-gradient-to-tr from-purple-600/20 via-fuchsia-500/10 to-blue-600/20 blur-3xl pointer-events-none" />

            {/* Laptop image — full width */}
            <div className="relative rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-purple-900/40">
              <Image
                src="/images/hero-picks.webp"
                alt="StatTrackr Top Picks model"
                width={1400}
                height={900}
                sizes="(max-width: 1280px) 100vw, 1280px"
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
                onClick={() => scrollToSection('pricing')}
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

      {/* Free vs Pro */}
      <section id="features" className="scroll-mt-20 py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl sm:text-5xl font-bold mb-4">Free vs Pro</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              What each plan includes that the other does not.
            </p>
          </div>
          <div className="md:hidden space-y-3">
            {[
              { icon: Medal, feature: 'Sports', pro: 'NBA, AFL, NBL, ATP, WTA', free: 'NBA, AFL, NBL, ATP, WTA', freeOk: true },
              { icon: LayoutGrid, feature: 'Props board', pro: 'Full board', free: '1 prop per sport' },
              { icon: LineChart, feature: 'Advanced stats for every sport', pro: 'Included', free: 'Locked' },
              { icon: Trophy, feature: 'AFL prediction model', pro: 'Included', free: 'Locked' },
              { icon: Megaphone, feature: 'Admin picks', pro: 'Included', free: 'Locked' },
              { icon: MessageCircle, feature: 'Chat', pro: 'Included', free: 'Locked' },
              { icon: DollarSign, feature: 'Price', pro: 'From $20/month', free: 'Free', freeOk: true },
            ].map((row) => (
              <div key={row.feature} className="overflow-hidden rounded-2xl border border-gray-800 bg-[#071422]">
                <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3 text-sm text-gray-200">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-white/[0.03] text-gray-400">
                    <row.icon className="h-4 w-4" />
                  </span>
                  {row.feature}
                </div>
                <div className="grid grid-cols-2 text-sm">
                  <div className="bg-[#0c1c33] px-3 py-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-purple-300">StatTrackr</p>
                    <p className="flex items-start gap-1.5 font-medium leading-snug text-emerald-400">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      {row.pro}
                    </p>
                  </div>
                  <div className="px-3 py-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Free</p>
                    <p className={`flex items-start gap-1.5 font-medium leading-snug ${row.freeOk ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.freeOk ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}
                      {row.free}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <div className="overflow-hidden rounded-2xl border border-gray-800 bg-[#071422]">
              <div className="grid grid-cols-[1.15fr_1fr_1fr] text-sm">
                <div className="px-5 py-5 text-xs font-semibold uppercase tracking-widest text-gray-500">Feature</div>
                <div className="flex items-center justify-center gap-2 border-x border-purple-500/30 bg-[#0c1c33] px-4 py-4">
                  <Image src="/images/stattrackr-logo-512.webp" alt="" width={22} height={22} className="h-5 w-5" />
                  <span className="font-semibold text-white">StatTrackr</span>
                  <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Best</span>
                </div>
                <div className="px-5 py-5 text-center text-sm font-medium text-gray-400">Free</div>
                {[
                  { icon: Medal, feature: 'Sports', pro: 'NBA, AFL, NBL, ATP, WTA', free: 'NBA, AFL, NBL, ATP, WTA', freeOk: true },
                  { icon: LayoutGrid, feature: 'Props board', pro: 'Full board', free: '1 prop per sport' },
                  { icon: LineChart, feature: 'Advanced stats for every sport', pro: 'Included', free: 'Locked' },
                  { icon: Trophy, feature: 'AFL prediction model', pro: 'Included', free: 'Locked' },
                  { icon: Megaphone, feature: 'Admin picks', pro: 'Included', free: 'Locked' },
                  { icon: MessageCircle, feature: 'Chat', pro: 'Included', free: 'Locked' },
                  { icon: DollarSign, feature: 'Price', pro: 'From $20/month', free: 'Free', freeOk: true },
                ].map((row) => (
                  <React.Fragment key={row.feature}>
                    <div className="flex items-center gap-3 border-t border-gray-800 px-5 py-4 text-gray-200">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-white/[0.03] text-gray-400">
                        <row.icon className="h-4 w-4" />
                      </span>
                      {row.feature}
                    </div>
                    <div className="flex items-center justify-center gap-2 border-x border-t border-purple-500/30 bg-[#0c1c33] px-4 py-4 font-medium text-emerald-400">
                      <Check className="h-4 w-4" />
                      {row.pro}
                    </div>
                    <div className={`flex items-center justify-center gap-2 border-t border-gray-800 px-4 py-4 font-medium ${row.freeOk ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.freeOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      {row.free}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
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
      <section id="pricing" className="scroll-mt-20 py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
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
                    className="w-full py-3 rounded-lg font-semibold transition-all bg-purple-600 hover:bg-purple-700 text-white"
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
      <section id="faq" className="scroll-mt-20 py-20 px-4 sm:px-6 lg:px-8 bg-[#050d1a]">
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
              { q: 'What sports are available?', a: 'We cover NBA, AFL, NBL, ATP, and WTA, with full stats, props, and research tools. We\'re always adding more and will announce new sports when they\'re ready.' },
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
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-5 sm:gap-x-8">
              <Image
                src="/images/nba-logo.png"
                alt="NBA"
                width={80}
                height={160}
                className="h-16 w-7 sm:h-24 sm:w-11 object-cover object-center mix-blend-screen"
              />
              {[
                { src: '/images/afl-logo.png', alt: 'AFL', className: 'h-24 sm:h-36 w-auto' },
                { src: '/images/nbl-logo.png', alt: 'NBL', className: 'h-14 sm:h-20 w-auto mix-blend-screen' },
              ].map((sport) => (
                <Image
                  key={sport.alt}
                  src={sport.src}
                  alt={sport.alt}
                  width={160}
                  height={160}
                  className={`object-contain ${sport.className}`}
                />
              ))}
              <span className="inline-flex h-10 w-24 sm:h-14 sm:w-32 items-center justify-center overflow-hidden">
                <Image
                  src="/images/atp-logo.webp"
                  alt="ATP"
                  width={200}
                  height={80}
                  className="h-[220%] w-auto max-w-none object-cover"
                />
              </span>
              <Image
                src="/images/wta-logo.png"
                alt="WTA"
                width={160}
                height={160}
                className="object-contain h-16 sm:h-24 w-auto mix-blend-screen"
              />
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
              else if (user) scrollToSection('pricing');
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
                  src="/images/stattrackr-logo-512.webp" 
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
                <li><button type="button" onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">Features</button></li>
                <li><button type="button" onClick={() => scrollToSection('pricing')} className="hover:text-white transition-colors">Pricing</button></li>
                <li><button type="button" onClick={() => scrollToSection('faq')} className="hover:text-white transition-colors">FAQ</button></li>
                <li><button onMouseEnter={prefetchPropsResources} onFocus={prefetchPropsResources} onClick={goToProps} className="hover:text-white transition-colors">Player Props</button></li>
                <li>
                  {NBA_PUBLIC_ENABLED ? (
                    <button onClick={() => router.push('/nba/research/dashboard')} className="hover:text-white transition-colors">NBA Dashboard</button>
                  ) : (
                    <span className="text-gray-500">NBA Dashboard (off-season)</span>
                  )}
                </li>
                <li><button onClick={() => router.push('/afl')} className="hover:text-white transition-colors">AFL Research</button></li>
                <li><button onClick={() => router.push('/nbl')} className="hover:text-white transition-colors">NBL Research</button></li>
                <li><button onClick={() => router.push('/tennis')} className="hover:text-white transition-colors">ATP & WTA</button></li>
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
