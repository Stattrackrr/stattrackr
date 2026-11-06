'use client';

/**
 * Tools board preview — same shell as /props (sidebar + mobile nav).
 * Fake data only until look/feel is signed off.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeftSidebar from '@/components/LeftSidebar';
import { MobileBottomNavigation } from '@/app/nba/research/dashboard/components/header';
import { ProUpgradeHost } from '@/components/ProFeatureLock';
import { useTheme } from '@/contexts/ThemeContext';
import { useViewerProfile } from '@/hooks/useViewerProfile';
import { DEFAULT_ODDS_FORMAT, readOddsFormatPreference } from '@/lib/currencyUtils';
import { isToolsAdminEmail } from '@/lib/adminEmail';
import { supabase } from '@/lib/supabaseClient';
import { ToolsBoard } from './ToolsBoard';

export default function ToolsPage() {
  const router = useRouter();
  const { isDark, theme, setTheme } = useTheme();
  const { username, avatarUrl, userEmail, isPro, subscriptionChecked } = useViewerProfile();
  const isAdmin = isToolsAdminEmail(userEmail);
  const [mounted, setMounted] = useState(false);
  const [oddsFormat, setOddsFormat] = useState<'american' | 'decimal'>(DEFAULT_ODDS_FORMAT);
  const [showJournalDropdown, setShowJournalDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const journalDropdownRef = useRef<HTMLDivElement | null>(null);
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setOddsFormat(readOddsFormatPreference());
  }, []);

  const shellDark = !mounted || isDark;

  return (
    <div className={`min-h-screen lg:h-screen ${shellDark ? 'bg-[#050d1a]' : 'bg-gray-50'} lg:overflow-x-auto lg:overflow-y-hidden`}>
      <style jsx global>{`
        .dashboard-container {
          --sidebar-margin: 0px;
          --sidebar-width: 0px;
          --gap: 2px;
          --inner-max: 1550px;
          --app-max: calc(var(--sidebar-width) + var(--gap) + var(--inner-max));
          --content-margin-right: 0px;
          --content-padding-left: 0px;
          --content-padding-right: 0px;
        }
        @media (min-width: 1024px) {
          .dashboard-container {
            --sidebar-width: 340px;
            --right-panel-width: 340px;
          }
        }
        @media (min-width: 1500px) {
          .dashboard-container {
            --sidebar-width: 400px;
            --right-panel-width: 400px;
          }
        }
        @media (min-width: 2200px) {
          .dashboard-container {
            --sidebar-width: 460px;
            --right-panel-width: 460px;
          }
        }
      `}</style>

      <div
        className={`px-0 dashboard-container ${shellDark ? 'bg-[#050d1a]' : ''}`}
        style={{
          marginLeft: 'calc(var(--sidebar-width, 0px) + var(--gap, 2px))',
          width: 'calc(100% - (var(--sidebar-width, 0px) + var(--gap, 2px)))',
          paddingLeft: 0,
        }}
      >
        <div className={`mx-auto w-full max-w-[1550px] ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0, paddingRight: '0px' }}>
          <div className={`pt-4 min-h-0 lg:h-full dashboard-container ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingLeft: 0 }}>
            <LeftSidebar
              oddsFormat={oddsFormat}
              setOddsFormat={(format) => {
                const formatValue = typeof format === 'function' ? format(oddsFormat) : format;
                setOddsFormat(formatValue);
                try {
                  localStorage.setItem('oddsFormat', formatValue);
                } catch {
                  /* ignore */
                }
              }}
              hasPremium={isPro}
              avatarUrl={avatarUrl}
              username={username}
              userEmail={userEmail}
              isPro={isPro}
              onSubscriptionClick={() => router.push('/subscription')}
              onSignOutClick={async () => {
                await supabase.auth.signOut({ scope: 'local' });
                router.push('/');
              }}
            />

            <div
              className={`relative z-50 flex-1 min-w-0 min-h-0 flex flex-col gap-2 pt-1 lg:pt-0 overflow-y-auto lg:overflow-x-hidden lg:h-screen lg:max-h-screen fade-scrollbar custom-scrollbar ${
                shellDark ? 'bg-[#050d1a]' : ''
              }`}
              style={{ scrollbarGutter: 'stable', paddingLeft: 0, paddingRight: 0 }}
            >
              <div className={`h-full px-2 lg:px-1 ${shellDark ? 'bg-[#050d1a]' : ''}`} style={{ paddingTop: 0, boxSizing: 'border-box' }}>
                <ToolsBoard
                  isDark={shellDark}
                  isPro={isPro || isAdmin}
                  authReady={subscriptionChecked}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ProUpgradeHost />

      <MobileBottomNavigation
        hasPremium={isPro}
        username={username}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        showJournalDropdown={showJournalDropdown}
        showProfileDropdown={showProfileDropdown}
        showSettingsDropdown={showSettingsDropdown}
        setShowJournalDropdown={setShowJournalDropdown}
        setShowProfileDropdown={setShowProfileDropdown}
        setShowSettingsDropdown={setShowSettingsDropdown}
        profileDropdownRef={profileDropdownRef}
        journalDropdownRef={journalDropdownRef}
        settingsDropdownRef={settingsDropdownRef}
        onProfileClick={() => window.dispatchEvent(new CustomEvent('open-profile-modal'))}
        onSubscription={() => router.push('/subscription')}
        onLogout={async () => {
          await supabase.auth.signOut({ scope: 'local' });
          router.push('/');
        }}
        theme={theme}
        oddsFormat={oddsFormat}
        setTheme={setTheme}
        setOddsFormat={(fmt) => {
          setOddsFormat(fmt);
          try {
            localStorage.setItem('oddsFormat', fmt);
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}
