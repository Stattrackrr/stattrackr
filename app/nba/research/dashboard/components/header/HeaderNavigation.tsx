'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useChatUnread } from '@/lib/chatUnread';
import { CHAT_UNDER_MAINTENANCE, JOURNAL_UNDER_MAINTENANCE } from '@/lib/nbaConstants';
import { consumePropsReturnPath } from '@/lib/propsPageSessionCache';
import { ProfileAvatar } from './ProfileAvatar';

interface HeaderNavigationProps {
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
  variant?: 'mobile' | 'desktop';
}

export function HeaderNavigation({
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
  variant = 'mobile',
}: HeaderNavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isDesktop = variant === 'desktop';
  const unreadChatCount = useChatUnread(hasPremium);
  const unreadChatLabel = unreadChatCount > 9 ? '9+' : unreadChatCount.toString();
  const prefetchProps = () => {
    router.prefetch('/props');
    void fetch('/api/nba/player-props', { cache: 'force-cache' }).catch(() => {});
    void fetch('/api/afl/player-props/list', { cache: 'force-cache' }).catch(() => {});
  };
  const isPropsActive = pathname?.startsWith('/props');
  const isJournalActive = pathname?.startsWith('/journal');
  const isChatActive = pathname?.startsWith('/chat');

  const navButtonClass = (active: boolean, disabled = false) =>
    `flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 transition-colors ${
      disabled
        ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
        : active
          ? 'text-purple-600 dark:text-purple-300 bg-purple-100/80 dark:bg-purple-900/35'
          : 'text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
    }`;

  return (
    <div className={isDesktop ? 'hidden lg:grid grid-cols-5 items-center h-16 px-4 gap-2' : 'grid grid-cols-5 items-center h-16 px-4 gap-2'}>
      {/* Props */}
      <button
        onMouseEnter={prefetchProps}
        onFocus={prefetchProps}
        onTouchStart={prefetchProps}
        onClick={() => {
          if (pathname?.startsWith('/props')) return;
          prefetchProps();
          router.push(consumePropsReturnPath('combined'));
        }}
        className={navButtonClass(!!isPropsActive)}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth={2} />
          <circle cx="12" cy="12" r="6" strokeWidth={2} />
          <circle cx="12" cy="12" r="2" strokeWidth={2} />
        </svg>
        <span className="text-xs font-medium">Props</span>
      </button>
      
      <button
        data-journal-button
        type="button"
        disabled={JOURNAL_UNDER_MAINTENANCE}
        title={JOURNAL_UNDER_MAINTENANCE ? 'Journal is under maintenance' : undefined}
        onClick={() => {
          if (JOURNAL_UNDER_MAINTENANCE) return;
          if (!hasPremium) {
            router.push('/subscription');
            return;
          }
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('navigating-to-journal', 'true');
          }
          router.push('/journal');
        }}
        className={`relative ${navButtonClass(!!isJournalActive, JOURNAL_UNDER_MAINTENANCE || !hasPremium)}`}
      >
        {JOURNAL_UNDER_MAINTENANCE ? (
          <span className="absolute -top-1.5 right-0.5 rounded-md bg-amber-600 px-1 py-0.5 text-[7px] font-bold leading-none tracking-wide text-white">
            MAINT
          </span>
        ) : null}
        {!hasPremium && !JOURNAL_UNDER_MAINTENANCE ? (
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

      <button
        type="button"
        disabled={CHAT_UNDER_MAINTENANCE}
        title={CHAT_UNDER_MAINTENANCE ? 'Chat is under maintenance' : undefined}
        onClick={() => {
          if (CHAT_UNDER_MAINTENANCE) return;
          if (!hasPremium) {
            router.push('/subscription');
            return;
          }
          router.push('/chat');
        }}
        className={`relative ${navButtonClass(!!isChatActive, CHAT_UNDER_MAINTENANCE || !hasPremium)}`}
      >
        {CHAT_UNDER_MAINTENANCE ? (
          <span className="absolute -top-1.5 right-0.5 rounded-md bg-amber-600 px-1 py-0.5 text-[7px] font-bold leading-none tracking-wide text-white">
            MAINT
          </span>
        ) : unreadChatCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white">
            {unreadChatLabel}
          </span>
        ) : null}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h8M8 14h5m-9 6l2.2-3.3A2 2 0 013 15V6a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H7.8a2 2 0 00-1.664.89L4 20z" />
        </svg>
        <span className="text-xs font-medium">Chat</span>
      </button>
      
      {/* Profile */}
      <button
        data-profile-button
        onClick={() => setShowProfileDropdown(!showProfileDropdown)}
        className={navButtonClass(showProfileDropdown)}
      >
        <ProfileAvatar username={username} userEmail={userEmail} avatarUrl={avatarUrl} />
        <span className="text-xs font-medium">Profile</span>
      </button>
      
      {/* Settings */}
      <button
        data-settings-button
        onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
        className={navButtonClass(showSettingsDropdown)}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-xs font-medium">Settings</span>
      </button>
    </div>
  );
}

