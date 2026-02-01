"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, Dispatch, SetStateAction, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { StatTrackrLogoWithText } from "./StatTrackrLogo";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "@/lib/supabaseClient";
import { DailyPickModal } from "./DailyPickModal";

type OddsFormat = 'american' | 'decimal';
interface LeftSidebarProps {
  oddsFormat: OddsFormat;
  setOddsFormat: Dispatch<SetStateAction<OddsFormat>>;
  hasPremium?: boolean;
  avatarUrl?: string | null;
  username?: string | null;
  userEmail?: string | null;
  isPro?: boolean;
  onSubscriptionClick?: () => void;
  onSignOutClick?: () => void;
  showViewTrackingButton?: boolean;
  onViewTrackingClick?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** Called after profile (name, username, phone) or avatar is saved so parent can update displayed name/avatar */
  onProfileUpdated?: (data: { username?: string | null; full_name?: string | null; avatar_url?: string | null }) => void;
}

export default function LeftSidebar({
  oddsFormat,
  setOddsFormat,
  hasPremium = true,
  avatarUrl = null,
  username = null,
  userEmail = null,
  isPro = false,
  onSubscriptionClick,
  onSignOutClick,
  showViewTrackingButton = false,
  onViewTrackingClick,
  sidebarOpen = true,
  onToggleSidebar,
  onProfileUpdated,
}: LeftSidebarProps) {
  const pathname = usePathname();
  const [showSettings, setShowSettings] = useState(false);
  const [showSportsDropdown, setShowSportsDropdown] = useState(false);
  // Dropdown below profile card (name click toggles this)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  // Profile modal (opened only when "Profile" is clicked in the dropdown)
  const [showProfileModal, setShowProfileModal] = useState(false);
  // Profile form (editable in modal)
  const [profileName, setProfileName] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreviewUrl, setProfileAvatarPreviewUrl] = useState<string | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);
  const [showUnitSettingsModal, setShowUnitSettingsModal] = useState(false);
  const [showDailyPickModal, setShowDailyPickModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [bankroll, setBankroll] = useState<string>('');
  const [bankrollCurrency, setBankrollCurrency] = useState<'USD' | 'AUD' | 'GBP' | 'EUR'>('USD');
  const [unitSize, setUnitSize] = useState<string>('');
  const [unitType, setUnitType] = useState<'value' | 'percent'>('value');
  const [savingUnitSize, setSavingUnitSize] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showMainSaveSuccess, setShowMainSaveSuccess] = useState(false);
  const [preferredJournalInput, setPreferredJournalInput] = useState<'money' | 'units'>('money');
  const [preferredCurrency, setPreferredCurrency] = useState<'USD' | 'AUD' | 'GBP' | 'EUR'>('USD');
  
  const currencySymbols: Record<'USD' | 'AUD' | 'GBP' | 'EUR', string> = {
    USD: '$',
    AUD: 'A$',
    GBP: '£',
    EUR: '€'
  };

  useEffect(() => {
    setMounted(true);
    // Load unit size from profile
    loadUnitSize();
  }, []);

  // When profile modal opens, load full_name, username, phone from profiles
  useEffect(() => {
    if (!showProfileModal) return;
    const loadProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('profiles')
          .select('full_name, username, phone, avatar_url')
          .eq('id', user.id)
          .single();
        const row = data as { full_name?: string | null; username?: string | null; phone?: string | null; avatar_url?: string | null } | null;
        setProfileName(row?.full_name ?? username ?? userEmail ?? '');
        setProfileUsername(row?.username ?? '');
        setProfilePhone(row?.phone ?? '');
        const avatarFromProfile = (row as { avatar_url?: string | null })?.avatar_url;
        setProfileAvatarUrl(avatarFromProfile ?? avatarUrl ?? null);
      } catch {
        setProfileName(username ?? userEmail ?? '');
        setProfileUsername(username ?? '');
        setProfilePhone('');
        setProfileAvatarUrl(avatarUrl ?? null);
      }
    };
    loadProfile();
  }, [showProfileModal, username, userEmail, avatarUrl]);

  // When profile modal closes, clear pending avatar selection and revoke preview URL
  useEffect(() => {
    if (!showProfileModal) {
      if (profileAvatarPreviewUrl) {
        URL.revokeObjectURL(profileAvatarPreviewUrl);
      }
      setProfileAvatarFile(null);
      setProfileAvatarPreviewUrl(null);
    }
  }, [showProfileModal]); // eslint-disable-line react-hooks/exhaustive-deps -- only run on modal close, intentionally omit profileAvatarPreviewUrl to avoid revoking while open
  const { theme, setTheme, isDark } = useTheme();
  
  const loadUnitSize = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('unit_size, bankroll, unit_type, bankroll_currency, preferred_journal_input, preferred_currency')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        const profileData = profile as {
          unit_size?: number | null;
          bankroll?: number | null;
          unit_type?: string | null;
          bankroll_currency?: string | null;
          preferred_journal_input?: string | null;
          preferred_currency?: string | null;
        };
        if (profileData.unit_size) {
          setUnitSize(profileData.unit_size.toString());
        }
        if (profileData.bankroll) {
          setBankroll(profileData.bankroll.toString());
        }
        if (profileData.unit_type) {
          setUnitType(profileData.unit_type as 'value' | 'percent');
        }
        if (profileData.bankroll_currency) {
          setBankrollCurrency(profileData.bankroll_currency as 'USD' | 'AUD' | 'GBP' | 'EUR');
        }
        if (profileData.preferred_journal_input) {
          setPreferredJournalInput(profileData.preferred_journal_input as 'money' | 'units');
        }
        if (profileData.preferred_currency) {
          setPreferredCurrency(profileData.preferred_currency as 'USD' | 'AUD' | 'GBP' | 'EUR');
        }
      }
    } catch (error) {
      console.error('Error loading unit size:', error);
    }
  };

  const displayName = username || userEmail || 'Profile';
  const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'P';
  const membershipLabel = isPro ? 'Pro Member' : 'Member';
  const showProfileCard = Boolean(avatarUrl || username || userEmail || onSubscriptionClick || onSignOutClick);
  
  // Generate a consistent random color based on user's name/email
  const getAvatarColor = (name: string): string => {
    // Use a hash of the name to generate a consistent color
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Generate a vibrant color (avoid too light or too dark)
    const hue = Math.abs(hash) % 360;
    const saturation = 65 + (Math.abs(hash) % 20); // 65-85% saturation
    const lightness = 45 + (Math.abs(hash) % 15); // 45-60% lightness
    
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };
  
  const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;

  const handleSaveSettings = async () => {
    try {
      // Save to localStorage for persistence
      localStorage.setItem('theme', theme);
      localStorage.setItem('oddsFormat', oddsFormat);
      
      // Save journal preferences to database
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Try UPDATE first
        const { error: updateError } = await (supabase
          .from('profiles') as any)
          .update({
            preferred_journal_input: preferredJournalInput,
            preferred_currency: preferredCurrency,
          })
          .eq('id', user.id);
        
        if (updateError) {
          // If UPDATE fails, try INSERT (in case profile row doesn't exist)
          const { error: insertError } = await (supabase
            .from('profiles') as any)
            .insert({
              id: user.id,
              preferred_journal_input: preferredJournalInput,
              preferred_currency: preferredCurrency,
            });
          
          if (insertError) {
            console.error('Error saving journal preferences:', {
              updateError: updateError.message || updateError,
              insertError: insertError.message || insertError,
              code: updateError.code || insertError.code,
              details: updateError.details || insertError.details,
              hint: updateError.hint || insertError.hint,
            });
          } else {
            // Show success message
            setShowMainSaveSuccess(true);
            setTimeout(() => {
              setShowMainSaveSuccess(false);
            }, 3000);
          }
        } else {
          // Show success message
          setShowMainSaveSuccess(true);
          setTimeout(() => {
            setShowMainSaveSuccess(false);
          }, 3000);
        }
      }
      
      // Close the settings modal
      setShowSettings(false);
      
      console.log('Settings saved:', { theme, oddsFormat, preferredJournalInput, preferredCurrency });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const sports = [
    { name: "NBA", href: "/nba" },
    { name: "Soccer", href: "#", comingSoon: true },
    // Other sports coming soon
    // { name: "NFL", href: "/nfl/research/dashboard" },
    // { name: "NBL", href: "/nbl/research/dashboard" },
    // { name: "TENNIS", href: "/tennis/research/dashboard" },
  ];

  return (
    <>
      {/* Success Toast Notification - Outside Settings Panel */}
      {showMainSaveSuccess && mounted && createPortal(
        <div className="fixed top-4 left-[calc(var(--sidebar-width,360px)+1rem)] z-[200] animate-in slide-in-from-top-2">
          <div className="bg-green-600 text-white px-4 py-3 rounded-lg flex items-center gap-2 shadow-lg shadow-green-500/30">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Settings saved successfully!</span>
          </div>
        </div>,
        document.body
      )}
    <div 
      className="hidden lg:flex fixed top-4 h-[calc(100vh-1rem)] bg-gray-300 dark:bg-[#0a1929] border-r border-gray-200 dark:border-gray-700 flex-col rounded-r-2xl shadow-xl"
      style={{
        marginLeft: '0px',
        width: 'var(--sidebar-width, 360px)',
        left: 'clamp(0px, calc((100vw - var(--app-max, 2000px)) / 2), 9999px)'
      }}
    >
      {/* Logo at top */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 text-black dark:text-white">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link href="/home" className="cursor-pointer hover:opacity-80 transition-opacity">
              <StatTrackrLogoWithText 
                logoSize="w-10 h-10" 
                textSize="text-2xl" 
                isDark={isDark}
              />
            </Link>
            {pathname === "/journal" && (
              <span className="text-2xl font-light opacity-50">Journal</span>
            )}
          </div>
          {/* Sidebar Toggle Button - inside sidebar */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="flex items-center justify-center w-8 h-8 bg-gray-200 dark:bg-slate-800 hover:bg-gray-300 dark:hover:bg-slate-700 border border-gray-200 dark:border-gray-700 rounded-full shadow-sm transition-all"
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              <svg 
                className="w-4 h-4 text-gray-700 dark:text-gray-300 transition-transform"
                style={{ transform: sidebarOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 p-3 text-black dark:text-white flex flex-col">
        {/* Sports Dropdown */}
        <div>
          <button
            onClick={() => setShowSportsDropdown(!showSportsDropdown)}
            className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-between text-black dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800"
          >
            <span>Sports</span>
            <svg className={`w-4 h-4 transition-transform ${showSportsDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
          
          {/* Sports Dropdown Menu - Inline */}
          {showSportsDropdown && (
            <ul className="mt-1 space-y-1 pl-2">
              {sports.map((sport) => (
                <li key={sport.name}>
                  {sport.comingSoon ? (
                    <div
                      className="block px-3 py-2 text-sm font-medium rounded transition-colors text-gray-400 dark:text-gray-500 cursor-not-allowed flex items-center justify-between"
                    >
                      <span>{sport.name}</span>
                      <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">
                        Coming Soon
                      </span>
                    </div>
                  ) : (
                    <Link
                      href={sport.href}
                      onClick={() => setShowSportsDropdown(false)}
                      className="block px-3 py-2 text-sm font-medium rounded transition-colors text-black dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800"
                    >
                      {sport.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        
        {/* Today's Best Pick - NBA pages only */}
        {pathname.startsWith('/nba') && (
          <div className="mt-6 pt-3 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowDailyPickModal(true)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>🏆</span>
                Today&apos;s Best Pick
              </span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Journal section - right under Sports */}
        <div className="mt-6 pt-3 border-t border-gray-200 dark:border-gray-700">
          <Link
            href={hasPremium ? "/journal" : "/subscription"}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname === "/journal"
                ? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                : !hasPremium
                ? "text-gray-400 dark:text-gray-500 cursor-not-allowed"
                : "text-black dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-black dark:hover:text-white"
            }`}
            onClick={(e) => {
              if (!hasPremium) {
                e.preventDefault();
                window.location.href = '/subscription';
              }
            }}
          >
            <span>Journal</span>
            {!hasPremium && (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            )}
          </Link>
        </div>
      </nav>
      
      {/* Profile Summary */}
      {showProfileCard && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => setShowProfileDropdown((prev) => !prev)}
            className="w-full bg-white/85 dark:bg-gray-800/85 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 flex items-center gap-3 shadow-sm hover:border-purple-400 dark:hover:border-purple-500 transition-colors"
            aria-expanded={showProfileDropdown}
          >
            <div 
              className="w-10 h-10 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex items-center justify-center text-sm font-semibold text-white"
              style={avatarColor ? { backgroundColor: avatarColor } : { backgroundColor: 'rgb(243, 244, 246)' }}
            >
              {avatarUrl ? (
                <img src={avatarUrl ?? undefined} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex items-center justify-center w-full h-full">{fallbackInitial}</span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-slate-700 dark:text-white truncate">{displayName}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{membershipLabel}</p>
            </div>
            <svg
              className={`w-4 h-4 text-slate-500 dark:text-slate-300 transition-transform ${showProfileDropdown ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {/* Dropdown: Profile opens modal; View Tracking, Subscription, Sign Out */}
          {showProfileDropdown && (
            <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(true);
                  setShowProfileDropdown(false);
                }}
                className="w-full px-3 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Profile
              </button>
              {showViewTrackingButton && onViewTrackingClick && (
                <button
                  type="button"
                  onClick={() => {
                    onViewTrackingClick();
                    setShowProfileDropdown(false);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Tracking
                </button>
              )}
              {onSubscriptionClick && (
                <button
                  type="button"
                  onClick={() => {
                    onSubscriptionClick();
                    setShowProfileDropdown(false);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Subscription
                </button>
              )}
              {onSignOutClick && (
                <button
                  type="button"
                  onClick={() => {
                    onSignOutClick();
                    setShowProfileDropdown(false);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1z" />
                  </svg>
                  Sign Out
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Coming Soon Section - Way further down */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-black dark:text-white mt-auto">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Coming Soon</p>
        <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <li className="flex items-center gap-2">
            <span className="text-lg">⚽</span>
            <span>More Sports</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">
              <svg className="w-5 h-5 fill-current text-[#5865F2]" viewBox="0 0 24 24">
                <path d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.078.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.249.077.077 0 00-.078-.037 19.736 19.736 0 00-4.885 1.515.07.07 0 00-.032.024C.533 9.045-.319 13.58.099 18.058a.082.082 0 00.031.057 19.9 19.9 0 005.99 3.034.077.077 0 00.084-.028c.461-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.105 12.267 12.267 0 01-1.753-.83.077.077 0 01-.008-.128c.118-.089.236-.18.349-.272a.074.074 0 01.077-.01c3.668 1.672 7.625 1.672 11.253 0a.074.074 0 01.078.009c.114.093.231.184.35.273a.077.077 0 01-.006.126 11.9 11.9 0 01-1.754.83.076.076 0 00-.04.105c.36.699.773 1.364 1.225 1.993a.076.076 0 00.084.029 19.876 19.876 0 005.993-3.033.079.079 0 00.031-.056c.5-5.177-.838-9.674-3.549-13.666a.061.061 0 00-.03-.025zM8.02 15.331c-1.183 0-2.157-1.097-2.157-2.445 0-1.348.955-2.445 2.157-2.445 1.211 0 2.175 1.106 2.158 2.445 0 1.348-.955 2.445-2.158 2.445zm7.974 0c-1.183 0-2.157-1.097-2.157-2.445 0-1.348.955-2.445 2.157-2.445 1.211 0 2.175 1.106 2.158 2.445 0 1.348-.947 2.445-2.158 2.445z" />
              </svg>
            </span>
            <span>Discord</span>
          </li>
        </ul>
      </div>

      {/* Daily Pick Modal */}
      {showDailyPickModal && mounted && createPortal(
        <DailyPickModal isOpen={showDailyPickModal} onClose={() => setShowDailyPickModal(false)} />,
        document.body
      )}

      {/* Profile Modal - opens only when "Profile" is clicked in the dropdown */}
      {showProfileModal && mounted && createPortal(
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[140] bg-black/50 backdrop-blur-sm"
            onClick={() => setShowProfileModal(false)}
          />
          
          {/* Modal */}
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-gray-700">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">View your account details</p>
                </div>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-4 space-y-4 text-sm">
                {/* Profile picture - editable; upload happens on Save */}
                <div className="flex flex-col items-center gap-3">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 w-full text-left">
                    Profile picture
                  </label>
                  <div className="flex items-center gap-4">
                    <div
                      className="w-20 h-20 rounded-full overflow-hidden border-2 border-gray-200 dark:border-gray-600 flex items-center justify-center text-2xl font-semibold text-white shrink-0"
                      style={!(profileAvatarPreviewUrl || profileAvatarUrl || avatarUrl) ? { backgroundColor: getAvatarColor(displayName) } : undefined}
                    >
                      {profileAvatarPreviewUrl || profileAvatarUrl || avatarUrl ? (
                        <img
                          src={profileAvatarPreviewUrl || profileAvatarUrl || avatarUrl || ''}
                          alt="Profile"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>{fallbackInitial}</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        disabled={savingProfile}
                        onClick={() => profileAvatarInputRef.current?.click()}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {profileAvatarFile ? 'Change photo (new one selected)' : 'Change photo'}
                      </button>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        JPG, PNG or WebP. Max 2MB. Saved when you click Save.
                      </p>
                    </div>
                    <input
                      ref={profileAvatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) {
                          alert('Image must be under 2MB.');
                          return;
                        }
                        if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
                        setProfileAvatarPreviewUrl(URL.createObjectURL(file));
                        setProfileAvatarFile(file);
                      }}
                    />
                  </div>
                </div>

                {/* Name - editable */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Name
                  </label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>

                {/* Username - editable */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={profileUsername}
                    onChange={(e) => setProfileUsername(e.target.value)}
                    placeholder="Username"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>

                {/* Email - read-only, grey, no "Locked" label */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Email
                  </label>
                  <div className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm cursor-not-allowed select-none">
                    {userEmail || 'Not set'}
                  </div>
                </div>

                {/* Phone - editable */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="Phone number"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={savingProfile}
                  onClick={async () => {
                    setSavingProfile(true);
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) return;
                      let newAvatarUrl: string | null = null;
                      const fileToUpload = profileAvatarFile; // capture before any state updates
                      if (fileToUpload) {
                        try {
                          // Remove any existing avatar files in this user's folder so we replace, not accumulate
                          try {
                            const { data: existingFiles } = await supabase.storage
                              .from('avatars')
                              .list(user.id, { limit: 10 });
                            const filesToRemove = (existingFiles || [])
                              .filter((item: { name?: string }) => item.name && !item.name.startsWith('.'))
                              .map((item: { name: string }) => `${user.id}/${item.name}`);
                            if (filesToRemove.length > 0) {
                              await supabase.storage.from('avatars').remove(filesToRemove);
                            }
                          } catch {
                            // No existing folder or list/remove failed; proceed with upload
                          }
                          // Unique filename per upload so the URL changes and browser/CDN won't serve cached old image
                          const ext = fileToUpload.name.split('.').pop()?.toLowerCase() || 'jpg';
                          const path = `${user.id}/avatar_${Date.now()}.${ext}`;
                          const { error: uploadError } = await supabase.storage
                            .from('avatars')
                            .upload(path, fileToUpload, { upsert: false });
                          if (uploadError) throw uploadError;
                          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
                          newAvatarUrl = urlData.publicUrl;
                          await supabase.auth.updateUser({ data: { avatar_url: newAvatarUrl } });
                        } catch (uploadErr) {
                          console.error('Error uploading avatar:', uploadErr);
                          alert('Failed to upload photo. Please try again.');
                          setSavingProfile(false);
                          return;
                        } finally {
                          if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
                          setProfileAvatarFile(null);
                          setProfileAvatarPreviewUrl(null);
                        }
                        // Update modal avatar so it shows the new photo before we close (cache-bust so img reloads)
                        setProfileAvatarUrl(newAvatarUrl ? `${newAvatarUrl}?t=${Date.now()}` : null);
                      }
                      // Persist to profiles (avatar_url when we uploaded; always name/username/phone)
                      const profileUpdates: { full_name: string | null; username: string | null; phone: string | null; avatar_url?: string } = {
                        full_name: profileName.trim() || null,
                        username: profileUsername.trim() || null,
                        phone: profilePhone.trim() || null,
                      };
                      if (newAvatarUrl !== null) {
                        profileUpdates.avatar_url = newAvatarUrl;
                      }
                      const { error } = await (supabase.from('profiles') as any)
                        .update(profileUpdates)
                        .eq('id', user.id);
                      if (error) throw error;
                      // Sync name to auth user metadata so Supabase auth shows the profile name (single source of truth)
                      await supabase.auth.updateUser({
                        data: {
                          full_name: profileName.trim() || null,
                          username: profileUsername.trim() || null,
                        },
                      });
                      // Pass cache-busted URL so the sidebar shows the new image (same path can be cached)
                      const displayAvatarUrl = newAvatarUrl ? `${newAvatarUrl}?t=${Date.now()}` : undefined;
                      onProfileUpdated?.({
                        username: profileUsername.trim() || null,
                        full_name: profileName.trim() || null,
                        ...(displayAvatarUrl ? { avatar_url: displayAvatarUrl } : {}),
                      });
                      // Brief delay so user sees the new avatar in the modal before it closes
                      await new Promise((r) => setTimeout(r, 350));
                      setShowProfileModal(false);
                    } catch (err) {
                      console.error('Error saving profile:', err);
                      alert('Failed to save profile. Please try again.');
                    } finally {
                      setSavingProfile(false);
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {savingProfile ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
 
      {/* Profile & Settings section at bottom */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-black dark:text-white pb-4">
        <button 
          onClick={() => setShowSettings(true)}
          className="w-full px-3 py-2 text-left rounded-lg text-sm font-medium text-black dark:text-white hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-black dark:hover:text-white transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>

      {/* Settings Modal */}
      {showSettings && mounted && createPortal(
        <>
          {/* Backdrop with blur - separate element */}
          <div 
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md"
            onClick={() => setShowSettings(false)}
          />
          
          {/* Modal content - positioned like sidebar */}
          <div 
            className="fixed left-0 top-4 h-[calc(100vh-1rem)] w-80 bg-gray-300 dark:bg-[#0a1929] border-r border-gray-200 dark:border-gray-700 rounded-r-2xl shadow-xl z-[110] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Theme</label>
                <select 
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as 'Light' | 'Dark')}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="Light">Light</option>
                  <option value="Dark">Dark</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Preferred Odds</label>
                <select 
                  value={oddsFormat}
                  onChange={(e) => {
                    const newFormat = e.target.value as 'american' | 'decimal';
                    setOddsFormat(newFormat);
                    localStorage.setItem('oddsFormat', newFormat);
                  }}
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                >
                  <option value="american">American</option>
                  <option value="decimal">Decimal</option>
                </select>
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 space-y-6">
              {/* Journal Settings Section */}
              <div>
                <h3 className="text-base font-semibold text-black dark:text-white mb-4">Journal Settings</h3>
                
                {/* Preferred Input Method */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Preferred Input</label>
                  <select 
                    value={preferredJournalInput}
                    onChange={(e) => setPreferredJournalInput(e.target.value as 'money' | 'units')}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="money">Money (Currency)</option>
                    <option value="units">Units</option>
                  </select>
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Choose how to input stakes when adding bets from dashboard</p>
                </div>
                
                {/* Preferred Currency */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Preferred Currency</label>
                  <select 
                    value={preferredCurrency}
                    onChange={(e) => setPreferredCurrency(e.target.value as 'USD' | 'AUD' | 'GBP' | 'EUR')}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="AUD">AUD (A$)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">Default currency for journal entries</p>
                </div>
                
                {/* Unit Settings Button - styled like other dropdowns */}
                <div>
                  <label className="block text-sm font-medium text-black dark:text-gray-300 mb-3">Unit Settings</label>
                  <button
                    onClick={() => setShowUnitSettingsModal(true)}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left flex items-center justify-between focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <span>Configure Unit Size</span>
                    <svg 
                      className="w-4 h-4" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              
              <button 
                onClick={handleSaveSettings}
                disabled={savingUnitSize}
                className="w-full bg-purple-600 text-white py-3 px-4 rounded-xl hover:bg-purple-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingUnitSize ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
      
      {/* Unit Settings Modal - Centered */}
      {showUnitSettingsModal && mounted && createPortal(
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm"
            onClick={() => setShowUnitSettingsModal(false)}
          />
          
          {/* Modal content - centered */}
          <div 
            className="fixed inset-0 z-[130] flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700">
              <div className="p-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Unit Settings</h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Configure your betting units</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUnitSettingsModal(false)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                {/* Content */}
                <div className="space-y-6">
                  {/* Bankroll Section */}
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Bankroll
                    </label>
                    <div className="flex gap-3">
                      <div className="relative flex-1">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">{currencySymbols[bankrollCurrency]}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={bankroll}
                          onChange={(e) => setBankroll(e.target.value)}
                          placeholder="10000.00"
                          className="w-full pl-8 pr-4 py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium"
                        />
                      </div>
                      <select
                        value={bankrollCurrency}
                        onChange={(e) => setBankrollCurrency(e.target.value as 'USD' | 'AUD' | 'GBP' | 'EUR')}
                        className="px-4 py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium cursor-pointer appearance-none bg-no-repeat bg-right pr-10"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundSize: '1.5em 1.5em' }}
                      >
                        <option value="USD">USD</option>
                        <option value="AUD">AUD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Your total betting bankroll</p>
                  </div>
                  
                  {/* Unit Size Section */}
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                      </svg>
                      Unit Size
                    </label>
                    <div className="flex gap-3">
                      <div className="relative flex-1">
                        {unitType === 'value' && (
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">{currencySymbols[bankrollCurrency]}</span>
                        )}
                        <input
                          type="number"
                          step={unitType === 'percent' ? '0.1' : '0.01'}
                          min="0"
                          max={unitType === 'percent' ? '100' : undefined}
                          value={unitSize}
                          onChange={(e) => setUnitSize(e.target.value)}
                          placeholder={unitType === 'percent' ? '1.0' : '100.00'}
                          className={`w-full ${unitType === 'value' ? 'pl-8' : 'pl-4'} pr-4 py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium`}
                        />
                        {unitType === 'percent' && (
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium">%</span>
                        )}
                      </div>
                      <select
                        value={unitType}
                        onChange={(e) => setUnitType(e.target.value as 'value' | 'percent')}
                        className="px-4 py-3.5 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium cursor-pointer appearance-none bg-no-repeat bg-right pr-10"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundSize: '1.5em 1.5em' }}
                      >
                        <option value="value">Unit Value</option>
                        <option value="percent">Unit %</option>
                      </select>
                    </div>
                    <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                        {unitType === 'percent' 
                          ? '💡 Set your unit size as a percentage of bankroll. For example, 1% means 1 unit equals 1% of your bankroll.'
                          : '💡 Set your unit size as a fixed dollar amount. For example, $100 means 1 unit equals $100.'}
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Footer */}
                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                  <button
                    onClick={() => setShowUnitSettingsModal(false)}
                    className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={async () => {
                      setSavingUnitSize(true);
                      try {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (user) {
                          const updates: any = {};
                          
                          if (bankroll) {
                            const bankrollValue = parseFloat(bankroll);
                            if (isNaN(bankrollValue) || bankrollValue < 0) {
                              alert('Bankroll must be a positive number');
                              setSavingUnitSize(false);
                              return;
                            }
                            updates.bankroll = bankrollValue;
                            updates.bankroll_currency = bankrollCurrency;
                          }
                          
                          if (unitSize) {
                            const unitSizeValue = parseFloat(unitSize);
                            if (isNaN(unitSizeValue) || unitSizeValue <= 0) {
                              alert('Unit size must be a positive number');
                              setSavingUnitSize(false);
                              return;
                            }
                            if (unitType === 'percent' && unitSizeValue > 100) {
                              alert('Unit percentage cannot exceed 100%');
                              setSavingUnitSize(false);
                              return;
                            }
                            updates.unit_size = unitSizeValue;
                            updates.unit_type = unitType;
                          }
                          
                          if (Object.keys(updates).length > 0) {
                            // Try to update first, if profile doesn't exist, insert it
                            const { error: updateError } = await (supabase
                              .from('profiles') as any)
                              .update(updates)
                              .eq('id', user.id);
                            
                            if (updateError) {
                              // If update fails because profile doesn't exist, try to insert
                              if (updateError.code === 'PGRST116' || updateError.message?.includes('No rows')) {
                                const { error: insertError } = await (supabase
                                  .from('profiles') as any)
                                  .insert({
                                    id: user.id,
                                    ...updates
                                  });
                                
                                if (insertError) throw insertError;
                              } else {
                                throw updateError;
                              }
                            }
                            
                            // Close unit settings modal and show success on main button
                            setSavingUnitSize(false);
                            setShowUnitSettingsModal(false);
                            setShowMainSaveSuccess(true);
                            setTimeout(() => {
                              setShowMainSaveSuccess(false);
                            }, 2000);
                          } else {
                            // No updates to save, just close
                            setShowUnitSettingsModal(false);
                          }
                        }
                      } catch (error: any) {
                        console.error('Error saving unit settings:', error);
                        const errorMessage = error?.message || error?.details || 'Unknown error';
                        alert(`Failed to save unit settings: ${errorMessage}. Please try again.`);
                        setSavingUnitSize(false);
                        setShowSuccessMessage(false);
                      }
                    }}
                    disabled={savingUnitSize}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all font-semibold shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-purple-600 disabled:hover:to-purple-700 flex items-center justify-center gap-2"
                  >
                    {savingUnitSize ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
    </>
  );
}
