'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ProfileDropdown, SettingsDropdown, ProfileAvatar } from './index';

interface MobileBottomNavigationProps {
  hasPremium: boolean;
  username: string | null;
  userEmail: string | null;
  avatarUrl: string | null;
  showJournalDropdown: boolean;
  showProfileDropdown: boolean;
  showSettingsDropdown: boolean;
  setShowJournalDropdown: (show: boolean) => void;
  setShowProfileDropdown: (show: boolean) => void;
  setShowSettingsDropdown: (show: boolean) => void;
  profileDropdownRef: React.RefObject<HTMLDivElement | null>;
  journalDropdownRef: React.RefObject<HTMLDivElement | null>;
  settingsDropdownRef: React.RefObject<HTMLDivElement | null>;
  onProfileClick?: () => void;
  showViewTrackingButton?: boolean;
  onViewTrackingClick?: () => void;
  onSubscription: () => void;
  onLogout: () => void;
  theme: 'Light' | 'Dark';
  oddsFormat: 'american' | 'decimal';
  setTheme: (theme: 'Light' | 'Dark') => void;
  setOddsFormat: (format: 'american' | 'decimal') => void;
}

export function MobileBottomNavigation({
  hasPremium,
  username,
  userEmail,
  avatarUrl,
  showJournalDropdown,
  showProfileDropdown,
  showSettingsDropdown,
  setShowJournalDropdown,
  setShowProfileDropdown,
  setShowSettingsDropdown,
  profileDropdownRef,
  journalDropdownRef,
  settingsDropdownRef,
  onProfileClick,
  showViewTrackingButton,
  onViewTrackingClick,
  onSubscription,
  onLogout,
  theme,
  oddsFormat,
  setTheme,
  setOddsFormat,
}: MobileBottomNavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const prefetchProps = () => {
    router.prefetch('/props');
    void fetch('/api/nba/player-props', { cache: 'force-cache' }).catch(() => {});
    void fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
  };

  const isPropsActive = pathname?.startsWith('/props');
  const isJournalActive = pathname?.startsWith('/journal');
  const isProfileActive = showProfileDropdown;
  const isSettingsActive = showSettingsDropdown;

  const navButtonClass = (active: boolean, disabled = false) =>
    `group flex flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200 ${
      disabled
        ? 'text-purple-400/45 dark:text-purple-400/40 cursor-not-allowed'
        : active
          ? 'text-purple-600 dark:text-purple-200 bg-purple-500/15 dark:bg-purple-500/20 shadow-[0_0_0_1px_rgba(168,85,247,0.45)]'
          : 'text-purple-600/85 dark:text-purple-300/85 hover:bg-purple-500/8 dark:hover:bg-purple-500/12'
    }`;

  const iconChipClass = (active: boolean, disabled = false) =>
    `w-[30px] h-[30px] rounded-full flex items-center justify-center transition-all duration-200 ${
      disabled
        ? 'opacity-70'
        : active
          ? 'scale-105'
          : 'scale-100'
    }`;

  return (
    <div className="lg:hidden fixed bottom-2 left-0 right-0 z-50 pb-safe flex justify-center px-3 pointer-events-none">
      <div className="relative w-full max-w-[460px] pointer-events-auto">
      {/* Profile Dropdown Menu - Shows above bottom nav */}
      {showProfileDropdown && (
        <ProfileDropdown
          dropdownRef={profileDropdownRef}
          onProfileClick={onProfileClick}
          showViewTrackingButton={showViewTrackingButton}
          onViewTrackingClick={onViewTrackingClick}
          onSubscription={onSubscription}
          onLogout={onLogout}
          onClose={() => setShowProfileDropdown(false)}
        />
      )}
      
      {/* Settings Dropdown Menu - Shows above bottom nav */}
      {showSettingsDropdown && (
        <SettingsDropdown
          dropdownRef={settingsDropdownRef}
          theme={theme}
          oddsFormat={oddsFormat}
          setTheme={setTheme}
          setOddsFormat={setOddsFormat}
        />
      )}
      
      {/* Mobile Navigation */}
      <div className="relative grid grid-cols-4 h-14 lg:hidden rounded-full border border-white/40 dark:border-white/25 bg-white/20 dark:bg-white/10 shadow-[0_10px_28px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-hidden px-1">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/20" />
        {/* Props */}
        <button
          onTouchStart={prefetchProps}
          onClick={() => {
            prefetchProps();
            router.push('/props');
          }}
          className={navButtonClass(!!isPropsActive)}
        >
          <span className={iconChipClass(!!isPropsActive)}>
            <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 19h16" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V10" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16v-4" />
            </svg>
          </span>
          <span className="text-[10px] font-semibold tracking-[0.01em]">Props</span>
        </button>
        
        {/* Journal */}
        <button
          data-journal-button
          onClick={() => {
            if (!hasPremium) {
              router.push('/subscription');
              return;
            }
            // Set flag to show loading bar on journal page
            if (typeof window !== 'undefined') {
              sessionStorage.setItem('navigating-to-journal', 'true');
            }
            router.push('/journal');
          }}
          className={navButtonClass(!!isJournalActive, !hasPremium)}
        >
          <span className={iconChipClass(!!isJournalActive, !hasPremium)}>
            {!hasPremium ? (
              <svg className="w-[20px] h-[20px]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4.5h8a2 2 0 012 2V19l-6-3-6 3V6.5a2 2 0 012-2z" />
              </svg>
            )}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.01em]">Journal</span>
        </button>
        
        {/* Profile */}
        <button
          data-profile-button
          onClick={() => setShowProfileDropdown(!showProfileDropdown)}
          className={navButtonClass(isProfileActive)}
        >
          <span className={iconChipClass(isProfileActive)}>
            <span className="scale-100">
              <ProfileAvatar username={username} userEmail={userEmail} avatarUrl={avatarUrl} />
            </span>
          </span>
          <span className="text-[10px] font-semibold tracking-[0.01em]">Profile</span>
        </button>
        
        {/* Settings */}
        <button
          data-settings-button
          onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
          className={navButtonClass(isSettingsActive)}
        >
          <span className={iconChipClass(isSettingsActive)}>
            <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
          <span className="text-[10px] font-semibold tracking-[0.01em]">Settings</span>
        </button>
      </div>
      </div>
    </div>
  );
}

