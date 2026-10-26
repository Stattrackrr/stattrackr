'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatUnread } from '@/lib/chatUnread';
import { usePicksUnread } from '@/lib/aiPicks/unread';
import { usePathname, useRouter } from 'next/navigation';
import { CHAT_UNDER_MAINTENANCE } from '@/lib/nbaConstants';
import { openProUpgrade } from '@/components/ProFeatureLock';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';
import { getLocalStorage, setSessionStorage } from '../../utils/storageUtils';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileDropdown } from './ProfileDropdown';
import { SettingsDropdown } from './SettingsDropdown';

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
  const [showReadMeBadge, setShowReadMeBadge] = useState(false);
  const unreadChatCount = useChatUnread();
  const unreadChatLabel = unreadChatCount > 9 ? '9+' : unreadChatCount.toString();
  const unreadPicksCount = usePicksUnread(hasPremium);
  const unreadPicksLabel = unreadPicksCount > 9 ? '9+' : unreadPicksCount.toString();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = getLocalStorage('readMeNotificationDismissed') === 'true';
    setShowReadMeBadge(!dismissed);
  }, []);

  // iOS (Safari and home-screen app) can leave fixed elements at a stale height after the app comes
  // back from the background or the keyboard closes, floating this bar mid-screen until a reload.
  // Re-laying out the page and re-compositing the bar puts it back on the bottom edge.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Scrolling in place stops a flick mid-scroll, so it only runs on coming back to the app or rotating.
    const reanchor = (relayout: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (relayout) window.scrollTo(window.scrollX, window.scrollY);
        const bar = barRef.current;
        if (!bar) return;
        bar.style.transform = 'translateZ(0)';
        frame = requestAnimationFrame(() => {
          bar.style.transform = '';
        });
      });
    };
    const soon = (relayout: boolean) => {
      clearTimeout(timer);
      timer = setTimeout(() => reanchor(relayout), 150);
    };
    const onReturn = () => soon(true);
    const onResize = () => soon(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') onReturn();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('orientationchange', onReturn);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onReturn);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('orientationchange', onReturn);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);
  const prefetchProps = () => {
    router.prefetch('/props');
    void fetch('/api/nba/player-props', { cache: 'force-cache' }).catch(() => {});
    void fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
  };

  const isPropsActive = pathname?.startsWith('/props');
  const isChatActive = pathname?.startsWith('/chat');
  const isPicksActive = pathname?.startsWith('/picks');
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
    <div ref={barRef} className="lg:hidden fixed bottom-2 left-0 right-0 z-50 pb-safe flex justify-center px-3 pointer-events-none">
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
          onReadMeOpened={() => setShowReadMeBadge(false)}
          showReadMeBadge={showReadMeBadge}
        />
      )}
      
      {/* Mobile Navigation */}
      <div className="relative grid grid-cols-5 h-14 lg:hidden rounded-full border border-white/40 dark:border-white/25 bg-white/20 dark:bg-white/10 shadow-[0_10px_28px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible px-1">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/20" />
        {/* Props */}
        <button
          onTouchStart={prefetchProps}
          onClick={() => {
            if (pathname?.startsWith('/props')) return;
            prefetchProps();
            router.push(consumePropsReturnPath('combined'));
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
        
        <button
          type="button"
          disabled={CHAT_UNDER_MAINTENANCE}
          title={CHAT_UNDER_MAINTENANCE ? 'Chat is under maintenance' : undefined}
          onClick={() => {
            if (CHAT_UNDER_MAINTENANCE) return;
            router.push('/chat');
          }}
          className={`relative ${navButtonClass(!!isChatActive, CHAT_UNDER_MAINTENANCE)}`}
        >
          <span className={`${iconChipClass(!!isChatActive, CHAT_UNDER_MAINTENANCE)} relative`}>
            {CHAT_UNDER_MAINTENANCE ? (
              <span className="absolute -right-3 -top-1 z-10 rounded-md bg-amber-600 px-1 py-0.5 text-[6px] font-bold leading-none tracking-wide text-white">
                MAINT
              </span>
            ) : unreadChatCount > 0 ? (
              <span className="absolute -right-3 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-2 ring-white/90 dark:ring-[#111827]">
                {unreadChatLabel}
              </span>
            ) : null}
            <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8M8 14h5m-9 6l2.2-3.3A2 2 0 013 15V6a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H7.8a2 2 0 00-1.664.89L4 20z" />
            </svg>
          </span>
          <span className="text-[10px] font-semibold tracking-[0.01em]">Chat</span>
        </button>

        {/* Picks */}
        <button
          type="button"
          onClick={() => {
            if (!hasPremium) {
              openProUpgrade();
              return;
            }
            router.push('/picks');
          }}
          className={`relative ${navButtonClass(!!isPicksActive, !hasPremium)}`}
        >
          <span className={`${iconChipClass(!!isPicksActive, !hasPremium)} relative`}>
            {unreadPicksCount > 0 ? (
              <span className="absolute -right-3 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-2 ring-white/90 dark:ring-[#111827]">
                {unreadPicksLabel}
              </span>
            ) : null}
            {!hasPremium ? (
              <svg className="w-[20px] h-[20px]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
              </svg>
            )}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.01em]">Picks</span>
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
          <span className={`${iconChipClass(isSettingsActive)} relative`}>
            {showReadMeBadge && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 font-bold text-center shadow-sm">
                1
              </span>
            )}
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

