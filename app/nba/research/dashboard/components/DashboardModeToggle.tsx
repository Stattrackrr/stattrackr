'use client';

import { useRouter } from 'next/navigation';
import NotificationSystem from '@/components/NotificationSystem';

interface DashboardModeToggleProps {
  propsMode: 'player' | 'team';
  isPro: boolean;
  isDark: boolean;
  gamePropsTeam: string;
  selectedTeam: string;
  selectedStat: string;
  selectedTimeframe: string;
  setPropsMode: (mode: 'player' | 'team') => void;
  setSelectedStat: (stat: string) => void;
  setSelectedTeam: (team: string) => void;
  setOriginalPlayerTeam: (team: string) => void;
  setDepthChartTeam: (team: string) => void;
  setGamePropsTeam: (team: string) => void;
}

export function DashboardModeToggle({
  propsMode,
  isPro,
  isDark,
  gamePropsTeam,
  selectedTeam,
  selectedStat,
  selectedTimeframe,
  setPropsMode,
  setSelectedStat,
  setSelectedTeam,
  setOriginalPlayerTeam,
  setDepthChartTeam,
  setGamePropsTeam,
}: DashboardModeToggleProps) {
  const router = useRouter();

  return (
    <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 md:px-4 lg:px-6 pt-3 md:pt-4 pb-4 md:pb-5 border border-gray-200 dark:border-gray-700 relative overflow-visible">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
        <NotificationSystem isDark={isDark} />
      </div>
      <div className="flex gap-3 md:gap-4 flex-wrap mb-3">
        <button
          disabled={!isPro}
          onClick={(e) => {
            // Prevent click if not Pro
            if (!isPro) {
              e.preventDefault();
              e.stopPropagation();
              if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                router.push('/subscription');
              }
              return;
            }
            
            setPropsMode('player');
            // Always set PTS (points) as default for Player Props
            setSelectedStat('pts');
            
            // If we have a gamePropsTeam selected, use it as the player's team
            if (gamePropsTeam && gamePropsTeam !== 'N/A') {
              setSelectedTeam(gamePropsTeam);
              setOriginalPlayerTeam(gamePropsTeam);
              setDepthChartTeam(gamePropsTeam);
            }
            
            // Clear the playerCleared flag and set stat=pts so useStatUrlSync/effects don't override
            if (typeof window !== 'undefined') {
              try {
                const raw = sessionStorage.getItem('nba-dashboard-session');
                if (raw) {
                  const saved = JSON.parse(raw);
                  delete saved.playerCleared; // Remove the flag
                  saved.selectedStat = 'pts';
                  sessionStorage.setItem('nba-dashboard-session', JSON.stringify(saved));
                }
              } catch {}
              const url = new URL(window.location.href);
              url.searchParams.set('stat', 'pts');
              router.replace(url.pathname + url.search, { scroll: false });
            }
          }}
          className={`relative px-6 sm:px-8 md:px-10 py-3 sm:py-3 md:py-2 rounded-lg text-base sm:text-base md:text-base font-semibold transition-all border ${
            !isPro
              ? "bg-gray-300 dark:bg-[#0a1929] text-gray-500 dark:text-gray-500 cursor-not-allowed opacity-60 border-gray-200 dark:border-gray-600"
              : propsMode === 'player'
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600"
          }`}
        >
          <span className="flex items-center gap-1 sm:gap-2">
            Player Props
            {!isPro && (
              <svg className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            )}
          </span>
        </button>
        <button
          onClick={() => {
            setPropsMode('team');
            // Set total_pts first so it isn't overwritten by URL/session or useStatUrlSync
            setSelectedStat('total_pts');
            
            // If we have a selectedTeam from Player Props, use it as the gamePropsTeam
            if (selectedTeam && selectedTeam !== 'N/A') {
              setGamePropsTeam(selectedTeam);
            } else {
              setGamePropsTeam('N/A'); // Reset team selection only if no team was selected
            }
            
            // Keep player data but don't display it in Game Props mode
            // DON'T clear: setSelectedPlayer, setSelectedTeam, setOriginalPlayerTeam, etc.
            // This preserves the data for when user switches back to Player Props
            
            // Clear URL parameters and update session storage
            if (typeof window !== 'undefined') {
              // Save minimal session with cleared player flag; use total_pts as default for Game Props
              const clearedSession = {
                propsMode: 'team' as const,
                selectedStat: 'total_pts',
                selectedTimeframe,
                playerCleared: true // Flag to indicate user deliberately cleared player data
              };
              sessionStorage.setItem('nba-dashboard-session', JSON.stringify(clearedSession));
              
              // Update URL: remove player params and set stat=total_pts so useStatUrlSync/effects don't override
              const url = new URL(window.location.href);
              url.searchParams.delete('pid');
              url.searchParams.delete('name');
              url.searchParams.delete('team');
              url.searchParams.set('stat', 'total_pts');
              router.replace(url.pathname + url.search, { scroll: false });
            }
          }}
          className={`px-6 sm:px-8 md:px-10 py-3 sm:py-3 md:py-2 rounded-lg text-base sm:text-base md:text-base font-semibold transition-colors border ${
            propsMode === 'team'
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600"
          }`}
        >
          Game Props
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
        {propsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
      </p>
    </div>
  );
}

