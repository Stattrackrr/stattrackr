'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatUnread } from '@/lib/chatUnread';
import { usePicksUnread } from '@/lib/aiPicks/unread';
import { usePathname, useRouter } from 'next/navigation';
import { CHAT_UNDER_MAINTENANCE } from '@/lib/nbaConstants';
import { openProUpgrade } from '@/components/ProFeatureLock';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';
import { kickToolsEarlyFetch } from '@/lib/tools/prefetch';
import { pushBoardRoute } from '@/lib/boardNavTransition';
import { getLocalStorage } from '../../utils/storageUtils';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileDropdown } from './ProfileDropdown';
import { SettingsDropdown } from './SettingsDropdown';

/** Matches Tailwind `bottom-2` — gap above the visual viewport bottom edge. */
const NAV_VIEWPORT_GAP_PX = 8;

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
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const boardMenuRef = useRef<HTMLDivElement>(null);
  const unreadChatCount = useChatUnread();
  const unreadChatLabel = unreadChatCount > 9 ? '9+' : unreadChatCount.toString();
  const unreadPicksCount = usePicksUnread(hasPremium);
  const unreadPicksLabel = unreadPicksCount > 9 ? '9+' : unreadPicksCount.toString();
  useEffect(() => {
    if (!showBoardMenu) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = boardMenuRef.current;
      if (el && !el.contains(e.target as Node)) setShowBoardMenu(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [showBoardMenu]);

  useEffect(() => {
    setShowBoardMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = getLocalStorage('readMeNotificationDismissed') === 'true';
    setShowReadMeBadge(!dismissed);
  }, []);

  // iOS Safari / PWA resolves `position: fixed; bottom: …` against a stale layout viewport after
  // client-side Tools↔Props navigations, keyboard dismiss, and app resume — leaving this bar
  // mid-screen. Pin against visualViewport (which stays accurate) and portal to <body> so no
  // page transform/filter can form a containing block.
  const barRef = useRef<HTMLDivElement>(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    // Closed-keyboard visual height only — never seed from innerHeight. After a long
    // background, iOS often leaves innerHeight >> visualViewport.height (browser chrome),
    // which used to look like a soft keyboard and hide this bar permanently.
    let baselineHeight = window.visualViewport?.height ?? window.innerHeight;

    const clearKeyboardHide = (bar: HTMLDivElement) => {
      bar.style.opacity = '';
      bar.style.visibility = '';
      bar.style.pointerEvents = '';
      bar.removeAttribute('aria-hidden');
    };

    const isTextFieldFocused = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      const tag = active.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
    };

    const pinToVisualViewport = () => {
      const bar = barRef.current;
      if (!bar) return;
      // lg:hidden — skip work while the desktop shell is showing.
      if (window.matchMedia('(min-width: 1024px)').matches) {
        bar.style.top = '';
        bar.style.bottom = '';
        bar.style.transform = '';
        bar.style.position = '';
        clearKeyboardHide(bar);
        return;
      }
      const vv = window.visualViewport;
      const layoutH = window.innerHeight;
      const visualH = vv?.height ?? layoutH;
      // Soft keyboard shrinks the visual viewport. Require a focused text field too —
      // resume/chrome gaps alone must not hide the nav.
      const shrink = baselineHeight - visualH > 140;
      const keyboardOpen = shrink && isTextFieldFocused();
      if (!keyboardOpen) {
        baselineHeight = Math.max(baselineHeight, visualH);
      }
      if (keyboardOpen) {
        bar.style.top = 'auto';
        bar.style.bottom = `${NAV_VIEWPORT_GAP_PX}px`;
        bar.style.transform = 'translateZ(0)';
        bar.style.opacity = '0';
        bar.style.visibility = 'hidden';
        bar.style.pointerEvents = 'none';
        bar.setAttribute('aria-hidden', 'true');
        return;
      }
      clearKeyboardHide(bar);
      // How far the visual viewport bottom sits above the layout viewport bottom.
      // When Safari leaves a stale fixed bottom mid-screen, this inset is non-zero and
      // re-homes the bar to the visible edge without waiting for a reload.
      const inset = vv
        ? Math.max(0, Math.round(layoutH - (vv.offsetTop + vv.height)))
        : 0;
      bar.style.top = 'auto';
      bar.style.bottom = `${inset + NAV_VIEWPORT_GAP_PX}px`;
      bar.style.transform = 'translateZ(0)';
    };

    const nudgeWebKitViewport = () => {
      const bar = barRef.current;
      const x = window.scrollX;
      const y = window.scrollY;
      window.scrollTo(x, y + 1);
      window.scrollTo(x, y);
      // Dropping fixed→absolute→fixed forces WebKit to re-resolve the containing block
      // after CSR / resume when translateZ alone is not enough.
      if (bar) {
        bar.style.position = 'absolute';
        void bar.offsetHeight;
        bar.style.position = 'fixed';
      }
    };

    const schedulePin = (hard: boolean) => {
      cancelAnimationFrame(frame);
      while (retryTimers.length) {
        const t = retryTimers.pop();
        if (t != null) clearTimeout(t);
      }
      frame = requestAnimationFrame(() => {
        if (hard) nudgeWebKitViewport();
        pinToVisualViewport();
        // iOS often reports stale metrics for a few hundred ms after CSR / resume.
        for (const ms of hard ? [50, 150, 400, 900] : [120]) {
          retryTimers.push(setTimeout(pinToVisualViewport, ms));
        }
      });
    };

    const onReturn = () => {
      baselineHeight = window.visualViewport?.height ?? window.innerHeight;
      schedulePin(true);
    };
    const onViewportChange = () => schedulePin(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') onReturn();
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) {
        // Hide immediately on text focus — covers Android cases where vv metrics lag.
        const bar = barRef.current;
        if (bar && !window.matchMedia('(min-width: 1024px)').matches) {
          bar.style.opacity = '0';
          bar.style.visibility = 'hidden';
          bar.style.pointerEvents = 'none';
          bar.setAttribute('aria-hidden', 'true');
        }
        schedulePin(false);
      }
    };
    const onFocusOut = () => {
      // Re-pin after blur; keyboard dismiss can lag a beat behind focusout.
      schedulePin(false);
      retryTimers.push(setTimeout(pinToVisualViewport, 280));
    };

    // Hard pin on mount / route change / portal attach — covers Tools↔Props CSR.
    schedulePin(true);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('orientationchange', onReturn);
    window.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('resize', onViewportChange);
    window.visualViewport?.addEventListener('scroll', onViewportChange);
    return () => {
      cancelAnimationFrame(frame);
      while (retryTimers.length) {
        const t = retryTimers.pop();
        if (t != null) clearTimeout(t);
      }
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('pageshow', onReturn);
      window.removeEventListener('orientationchange', onReturn);
      window.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('scroll', onViewportChange);
    };
  }, [pathname, portalReady]);
  const prefetchProps = () => {
    router.prefetch('/props');
    void fetch('/api/nba/player-props', { cache: 'force-cache' }).catch(() => {});
    void fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
  };

  const isPropsActive = pathname?.startsWith('/props');
  const isToolsActive = Boolean(pathname?.startsWith('/tools'));
  const isBoardActive = isPropsActive || isToolsActive || showBoardMenu;
  const boardLabel = isToolsActive ? 'Tools' : 'Props';
  const boardAltLabel = isToolsActive ? 'Props' : 'Tools';
  const isChatActive = pathname?.startsWith('/chat');
  const isPicksActive = pathname?.startsWith('/picks');
  const isProfileActive = showProfileDropdown;
  const isSettingsActive = showSettingsDropdown;

  const goProps = () => {
    setShowBoardMenu(false);
    setShowProfileDropdown(false);
    setShowSettingsDropdown(false);
    if (pathname?.startsWith('/props')) return;
    prefetchProps();
    void pushBoardRoute(router.push.bind(router), consumePropsReturnPath('combined'), 'to-props');
  };

  const goTools = () => {
    setShowBoardMenu(false);
    setShowProfileDropdown(false);
    setShowSettingsDropdown(false);
    if (!hasPremium) {
      openProUpgrade();
      return;
    }
    if (pathname?.startsWith('/tools')) return;
    kickToolsEarlyFetch();
    router.prefetch('/tools');
    void pushBoardRoute(router.push.bind(router), '/tools', 'to-tools');
  };

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

  const nav = (
    <div
      ref={barRef}
      data-mobile-bottom-nav
      className="lg:hidden fixed left-0 right-0 z-50 pb-safe flex justify-center px-3 pointer-events-none"
      style={{ bottom: NAV_VIEWPORT_GAP_PX }}
    >
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
      
      {/* Props / Tools switcher */}
      {showBoardMenu ? (
        <div
          ref={boardMenuRef}
          className="absolute bottom-[calc(100%+10px)] left-3 z-50 w-[168px] overflow-hidden rounded-2xl border border-white/30 bg-white/95 shadow-xl backdrop-blur-md dark:border-white/15 dark:bg-[#0a1929]/95"
        >
          <button
            type="button"
            onClick={goProps}
            className={`flex w-full items-center justify-between px-4 py-3 text-sm font-semibold transition ${
              isPropsActive
                ? 'bg-purple-500/15 text-purple-700 dark:text-purple-200'
                : 'text-gray-800 hover:bg-purple-500/8 dark:text-white dark:hover:bg-white/5'
            }`}
          >
            Props
            {isPropsActive ? <span className="text-[10px] uppercase tracking-wide opacity-70">Now</span> : null}
          </button>
          <div className="h-px bg-black/5 dark:bg-white/10" />
          <button
            type="button"
            onClick={goTools}
            className={`flex w-full items-center justify-between px-4 py-3 text-sm font-semibold transition ${
              isToolsActive
                ? 'bg-purple-500/15 text-purple-700 dark:text-purple-200'
                : 'text-gray-800 hover:bg-purple-500/8 dark:text-white dark:hover:bg-white/5'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              Tools
              {!hasPremium ? (
                <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                  Pro
                </span>
              ) : null}
            </span>
            {isToolsActive ? <span className="text-[10px] uppercase tracking-wide opacity-70">Now</span> : null}
          </button>
        </div>
      ) : null}

      {/* Mobile Navigation */}
      <div className="relative grid grid-cols-5 h-14 lg:hidden rounded-full border border-white/40 dark:border-white/25 bg-white/20 dark:bg-white/10 shadow-[0_10px_28px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible px-1">
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/20" />
        {/* Props / Tools (shared slot) — centered; alt name hints the switcher */}
        <button
          type="button"
          data-board-button
          onTouchStart={prefetchProps}
          onClick={() => {
            setShowProfileDropdown(false);
            setShowSettingsDropdown(false);
            setShowBoardMenu((open) => !open);
          }}
          className={navButtonClass(!!isBoardActive)}
          aria-expanded={showBoardMenu}
          aria-haspopup="menu"
          aria-label={`${boardLabel}, switch to ${boardAltLabel}`}
          title={`${boardLabel} · tap for ${boardAltLabel}`}
        >
          <span className={iconChipClass(!!isBoardActive)}>
            {isToolsActive ? (
              <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            ) : (
              <svg className="w-[20px] h-[20px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 19h16" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V10" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V6" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16v-4" />
              </svg>
            )}
          </span>
          <span className="flex flex-col items-center leading-none">
            <span className="text-[10px] font-semibold tracking-[0.01em]">{boardLabel}</span>
            <span className="mt-[2px] text-[8px] font-medium tracking-wide opacity-50">{boardAltLabel}</span>
          </span>
        </button>
        
        <button
          type="button"
          disabled={CHAT_UNDER_MAINTENANCE}
          title={CHAT_UNDER_MAINTENANCE ? 'Chat is under maintenance' : undefined}
          onClick={() => {
            if (CHAT_UNDER_MAINTENANCE) return;
            setShowBoardMenu(false);
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
            setShowBoardMenu(false);
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
          onClick={() => {
            setShowBoardMenu(false);
            setShowProfileDropdown(!showProfileDropdown);
          }}
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
          onClick={() => {
            setShowBoardMenu(false);
            setShowSettingsDropdown(!showSettingsDropdown);
          }}
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

  if (!portalReady || typeof document === 'undefined') return nav;
  return createPortal(nav, document.body);
}

