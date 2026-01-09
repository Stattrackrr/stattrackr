'use client';

import { useRouter } from 'next/navigation';
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
  onSubscription,
  onLogout,
  theme,
  oddsFormat,
  setTheme,
  setOddsFormat,
}: MobileBottomNavigationProps) {
  const router = useRouter();

  const journalButtonClasses = `flex flex-col items-center justify-center gap-1 transition-all duration-300 ${
    !hasPremium
      ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
      : 'text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
  }`;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0a1929] border-t border-gray-200 dark:border-gray-700 z-50 safe-bottom">
      {/* Profile Dropdown Menu - Shows above bottom nav */}
      {showProfileDropdown && (
        <ProfileDropdown
          dropdownRef={profileDropdownRef}
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
      <div className="grid grid-cols-4 h-16 lg:hidden">
        {/* Props */}
        <button
          onClick={() => router.push('/nba')}
          className="flex flex-col items-center justify-center gap-1 text-purple-600 dark:text-purple-400"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" strokeWidth={2} />
            <circle cx="12" cy="12" r="6" strokeWidth={2} />
            <circle cx="12" cy="12" r="2" strokeWidth={2} />
          </svg>
          <span className="text-xs font-medium">Props</span>
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
          className={journalButtonClasses}
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
          onClick={() => setShowProfileDropdown(!showProfileDropdown)}
          className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          <ProfileAvatar username={username} userEmail={userEmail} avatarUrl={avatarUrl} />
          <span className="text-xs font-medium">Profile</span>
        </button>
        
        {/* Settings */}
        <button
          data-settings-button
          onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
          className="flex flex-col items-center justify-center gap-1 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs font-medium">Settings</span>
        </button>
      </div>
    </div>
  );
}

