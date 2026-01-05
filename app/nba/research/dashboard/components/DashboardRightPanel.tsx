'use client';

import { Suspense, lazy } from 'react';
import { useRouter } from 'next/navigation';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import NotificationSystem from '@/components/NotificationSystem';
import { PositionDefenseCard, OpponentAnalysisCard } from './dvp';
import { ProjectedStatsCard } from './odds';
import InjuryContainer from '@/components/InjuryContainer';
import { createTeamComparisonPieData } from '../utils/teamAnalysisUtils';
import { getUnifiedTooltipStyle } from '../utils/chartUtils';
import { currentNbaSeason } from '../utils/playerUtils';
import { NBAPlayer } from '../types';
import { BallDontLieStats } from '../types';

const ShotChart = lazy(() => import('../ShotChart').then(mod => ({ default: mod.default })));
const PlayTypeAnalysis = lazy(() => import('@/components/PlayTypeAnalysis').then(mod => ({ default: mod.PlayTypeAnalysis })));

interface DashboardRightPanelProps {
  sidebarOpen: boolean;
  isDark: boolean;
  hasPremium: boolean;
  propsMode: 'player' | 'team';
  setPropsMode: (mode: 'player' | 'team') => void;
  setSearchQuery: (query: string) => void;
  setSelectedStat: (stat: string) => void;
  gamePropsTeam: string;
  setSelectedTeam: (team: string) => void;
  setOriginalPlayerTeam: (team: string) => void;
  setDepthChartTeam: (team: string) => void;
  selectedTeam: string;
  setGamePropsTeam: (team: string) => void;
  selectedStat: string;
  selectedTimeframe: string;
  dvpProjectedTab: 'dvp' | 'projected' | 'opponent' | 'injuries';
  setDvpProjectedTab: (tab: 'dvp' | 'projected' | 'opponent' | 'injuries') => void;
  opponentTeam: string | null;
  selectedPosition: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  selectedPlayer: NBAPlayer | null;
  projectedMinutes: number | null;
  projectedMinutesLoading: boolean;
  predictedPace: number | null;
  seasonFgPct: number | null;
  averageUsageRate: number | null;
  averageMinutes: number | null;
  averageGamePace: number | null;
  resolvedPlayerId: string | null;
  playerStats: BallDontLieStats[];
  teammateFilterId: number | null;
  setTeammateFilterId: (id: number | null) => void;
  setTeammateFilterName: (name: string | null) => void;
  withWithoutMode: 'with' | 'without';
  setWithWithoutMode: (mode: 'with' | 'without') => void;
  clearTeammateFilter: () => void;
  selectedComparison: 'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct';
  setSelectedComparison: (comparison: 'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct') => void;
  teamMatchupLoading: boolean;
  teamMatchupStats: {
    currentTeam: any;
    opponent: any;
  };
  realOddsData: any[];
  shotDistanceData: any;
}

export function DashboardRightPanel(props: DashboardRightPanelProps) {
  const router = useRouter();
  const {
    sidebarOpen,
    isDark,
    hasPremium,
    propsMode,
    setPropsMode,
    setSearchQuery,
    setSelectedStat,
    gamePropsTeam,
    setSelectedTeam,
    setOriginalPlayerTeam,
    setDepthChartTeam,
    selectedTeam,
    setGamePropsTeam,
    selectedStat,
    selectedTimeframe,
    dvpProjectedTab,
    setDvpProjectedTab,
    opponentTeam,
    selectedPosition,
    selectedPlayer,
    projectedMinutes,
    projectedMinutesLoading,
    predictedPace,
    seasonFgPct,
    averageUsageRate,
    averageMinutes,
    averageGamePace,
    resolvedPlayerId,
    playerStats,
    teammateFilterId,
    setTeammateFilterId,
    setTeammateFilterName,
    withWithoutMode,
    setWithWithoutMode,
    clearTeammateFilter,
    selectedComparison,
    setSelectedComparison,
    teamMatchupLoading,
    teamMatchupStats,
    realOddsData,
    shotDistanceData,
  } = props;

  const selectedTimeFilter = 'last10'; // Constant value

  return (
    <div 
      className={`relative z-0 flex-1 flex flex-col gap-2 sm:gap-3 md:gap-4 lg:gap-2 lg:h-screen lg:max-h-screen lg:overflow-y-auto lg:overflow-x-hidden px-2 sm:px-2 md:px-0 fade-scrollbar custom-scrollbar ${
        sidebarOpen ? 'lg:flex-[3] xl:flex-[3.3]' : 'lg:flex-[4] xl:flex-[4]'
      }`}
    >

  {/* Filter By Container (Desktop - in right panel) */}
  <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-3 pt-3 pb-4 border border-gray-200 dark:border-gray-700 relative overflow-visible">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">Filter By</h3>
      <NotificationSystem isDark={isDark} />
    </div>
    <div className="flex gap-2 md:gap-3 flex-wrap mb-3">
      <button
        onClick={() => {
          if (!hasPremium) {
            router.push('/subscription');
            return;
          }
          setPropsMode('player');
          setSearchQuery(''); // Clear search when switching
          // Always set PTS as default for Player Props
          setSelectedStat('pts');
          
          // If we have a gamePropsTeam selected, use it as the player's team
          if (gamePropsTeam && gamePropsTeam !== 'N/A') {
            setSelectedTeam(gamePropsTeam);
            setOriginalPlayerTeam(gamePropsTeam);
            setDepthChartTeam(gamePropsTeam);
          }
          
          // Clear the playerCleared flag when switching back to Player Props
          if (typeof window !== 'undefined') {
            try {
              const raw = sessionStorage.getItem('nba-dashboard-session');
              if (raw) {
                const saved = JSON.parse(raw);
                delete saved.playerCleared; // Remove the flag
                sessionStorage.setItem('nba-dashboard-session', JSON.stringify(saved));
              }
            } catch {}
          }
        }}
        disabled={!hasPremium}
        className={`relative px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors ${
          propsMode === 'player'
            ? "bg-purple-600 text-white"
            : !hasPremium
            ? "bg-gray-200 dark:bg-[#0a1929] text-gray-400 dark:text-gray-500 cursor-not-allowed"
            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
      >
        <span className="flex items-center gap-2">
          Player Props
          {!hasPremium && (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          )}
        </span>
      </button>
      <button
        onClick={() => {
          setPropsMode('team');
          setSearchQuery(''); // Clear search when switching
          
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
            // Save minimal session with cleared player flag
            const clearedSession = {
              propsMode: 'team' as const,
              selectedStat,
              selectedTimeframe,
              playerCleared: true // Flag to indicate user deliberately cleared player data
            };
            sessionStorage.setItem('nba-dashboard-session', JSON.stringify(clearedSession));
            
            // Clear URL parameters
            const url = new URL(window.location.href);
            url.searchParams.delete('pid');
            url.searchParams.delete('name');
            url.searchParams.delete('team');
            // Keep stat and tf parameters as they're relevant to Game Props
            window.history.replaceState({}, '', url.toString());
          }
          
          // Always set TOTAL_PTS as default for Game Props
          setSelectedStat('total_pts');
        }}
        className={`px-3 sm:px-4 md:px-6 py-2 rounded-lg text-xs sm:text-sm md:text-base font-medium transition-colors ${
          propsMode === 'team'
            ? "bg-purple-600 text-white"
            : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        }`}
      >
        Game Props
      </button>
    </div>
    <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
      {propsMode === 'player' ? 'Analyze individual player statistics and props' : 'Analyze game totals, spreads, and game-based props'}
    </p>
  </div>
{/* Combined Opponent Analysis & Team Matchup (Desktop) - always visible in both modes */}
  <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0">
      {/* Section 0: Defense vs Position / Projected / Opponent Breakdown Tabs - only show in Player Props mode */}
      {propsMode === 'player' && (
        <>
          {/* Tab Selector */}
          <div className="flex gap-1.5 xl:gap-2 mb-2 xl:mb-3">
            <button
              onClick={() => setDvpProjectedTab('dvp')}
              className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'dvp'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              <span className="hidden 2xl:inline">Defense vs Position</span>
              <span className="2xl:hidden">DvP</span>
            </button>
            <button
              onClick={() => setDvpProjectedTab('projected')}
              className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'projected'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              Projected
            </button>
            <button
              onClick={() => setDvpProjectedTab('opponent')}
              className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'opponent'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              <span className="hidden 2xl:inline">Opponent Breakdown</span>
              <span className="2xl:hidden">Opponent</span>
            </button>
            <button
              onClick={() => setDvpProjectedTab('injuries')}
              className={`flex-1 px-2 xl:px-3 py-1.5 xl:py-2 text-xs xl:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'injuries'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              Injuries
            </button>
          </div>
          
          {/* Content based on selected tab - always render container, just show/hide content */}
          <div className="relative min-h-[180px] xl:min-h-[200px] w-full min-w-0">
            <div className={dvpProjectedTab === 'dvp' ? 'block' : 'hidden'}>
              <PositionDefenseCard isDark={isDark} opponentTeam={opponentTeam} selectedPosition={selectedPosition} currentTeam={selectedTeam} />
            </div>
            <div className={dvpProjectedTab === 'projected' ? 'block' : 'hidden'}>
              <ProjectedStatsCard
                isDark={isDark}
                selectedPlayer={selectedPlayer}
                opponentTeam={opponentTeam}
                currentTeam={selectedTeam}
                projectedMinutes={projectedMinutes}
                loading={projectedMinutesLoading}
                predictedPace={predictedPace}
                seasonFgPct={seasonFgPct}
                averageUsageRate={averageUsageRate}
                averageMinutes={averageMinutes}
                averageGamePace={averageGamePace}
                selectedTimeframe={selectedTimeframe}
              />
            </div>
            <div className={dvpProjectedTab === 'opponent' ? 'block' : 'hidden'}>
              <OpponentAnalysisCard 
                isDark={isDark} 
                opponentTeam={opponentTeam} 
                selectedTimeFilter={selectedTimeFilter}
                propsMode={propsMode}
                playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                selectedStat={selectedStat}
              />
            </div>
            <div className={dvpProjectedTab === 'injuries' ? 'block' : 'hidden'}>
              <InjuryContainer
                selectedTeam={selectedTeam}
                opponentTeam={opponentTeam}
                isDark={isDark}
                selectedPlayer={selectedPlayer}
                playerStats={playerStats}
                teammateFilterId={teammateFilterId}
                setTeammateFilterId={setTeammateFilterId}
                setTeammateFilterName={setTeammateFilterName}
                withWithoutMode={withWithoutMode}
                setWithWithoutMode={setWithWithoutMode}
                clearTeammateFilter={clearTeammateFilter}
              />
            </div>
          </div>
        </>
      )}

      {/* Section 2: Team Matchup with Pie Chart - only show in Game Props mode */}
      {propsMode === 'team' && (
      <div className="pt-3 md:pt-4 border-t border-gray-200 dark:border-gray-600">
        <div className="flex items-center justify-between mb-3 md:mb-4">
          <h4 className="text-sm md:text-base font-medium text-gray-900 dark:text-white">Team Matchup</h4>
        </div>
        
        {/* Comparison Metric Selector */}
        <div className="mb-3 md:mb-4">
          <div className="grid grid-cols-2 gap-1 md:gap-1.5">
            <button
              onClick={() => setSelectedComparison('points')}
              className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                selectedComparison === 'points'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              POINTS
            </button>
            <button
              onClick={() => setSelectedComparison('rebounds')}
              className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                selectedComparison === 'rebounds'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              REBOUNDS
            </button>
            <button
              onClick={() => setSelectedComparison('assists')}
              className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                selectedComparison === 'assists'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              ASSISTS
            </button>
            <button
              onClick={() => setSelectedComparison('fg_pct')}
              className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                selectedComparison === 'fg_pct'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              FG%
            </button>
            <div className="col-span-2 flex justify-center">
              <button
                onClick={() => setSelectedComparison('three_pct')}
                className={`px-2 md:px-2.5 py-1.5 text-xs font-medium rounded transition-colors w-[calc(50%-0.375rem)] ${
                  selectedComparison === 'three_pct'
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                3P%
              </button>
            </div>
          </div>
        </div>

        {/* Stats Preview Box - appears right after selector buttons */}
        {(() => {
          const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
          const currentOpponent = opponentTeam;
          
          if (!currentTeam || currentTeam === 'N/A' || teamMatchupLoading) return null;
          
          const currentStats = teamMatchupStats.currentTeam;
          const opponentStats = teamMatchupStats.opponent;
          
          if (!currentStats || !opponentStats) return null;
          
          let teamValue: number = 0;
          let opponentValue: number = 0;
          let isPercentage = false;
          let isDefensiveStat = false; // Track if this is a defensive stat (lower is better)
          
          switch (selectedComparison) {
            case 'points':
              teamValue = currentStats.pts || 0;
              opponentValue = opponentStats.pts || 0;
              isDefensiveStat = true;
              break;
            case 'rebounds':
              teamValue = currentStats.reb || 0;
              opponentValue = opponentStats.reb || 0;
              isDefensiveStat = true;
              break;
            case 'assists':
              teamValue = currentStats.ast || 0;
              opponentValue = opponentStats.ast || 0;
              isDefensiveStat = true;
              break;
            case 'fg_pct':
              teamValue = currentStats.fg_pct || 0;
              opponentValue = opponentStats.fg_pct || 0;
              isPercentage = true;
              break;
            case 'three_pct':
              teamValue = currentStats.fg3_pct || 0;
              opponentValue = opponentStats.fg3_pct || 0;
              isPercentage = true;
              break;
          }
          
          const teamDisplay = isPercentage ? `${teamValue.toFixed(1)}%` : teamValue.toFixed(1);
          const oppDisplay = isPercentage ? `${opponentValue.toFixed(1)}%` : opponentValue.toFixed(1);
          
          // Calculate pie data to get consistent colors
          const tempPieData = createTeamComparisonPieData(
            teamValue,
            opponentValue,
            currentTeam,
            currentOpponent || 'TBD',
            false,
            /* amplify */ true,
            /* useAbs */ false,
            /* clampNegatives */ false,
            /* baseline */ 0,
            /* invertOppForShare */ false,
            /* invertMax */ 130,
            /* ampBoost */ isPercentage ? 3.0 : 1.0
          );
          
          // Use pie chart colors for consistency (green = better, red = worse)
          // pieData[0] is currentTeam, pieData[1] is opponent
          const teamColorClass = tempPieData[0]?.fill === '#16a34a' || tempPieData[0]?.fill === '#22c55e'
            ? 'text-green-600 dark:text-green-400'
            : 'text-red-500 dark:text-red-400';
          const oppColorClass = tempPieData[1]?.fill === '#16a34a' || tempPieData[1]?.fill === '#22c55e'
            ? 'text-green-600 dark:text-green-400'
            : 'text-red-500 dark:text-red-400';
          
          return (
            <div className="bg-gray-100 dark:bg-[#0a1929] rounded px-2 py-1 mb-2">
              <div className="flex items-center justify-between gap-1 text-xs">
                <div className={`flex-1 text-center ${teamColorClass}`}>
                  <span className="font-bold">{currentTeam}</span>
                  <span className="font-bold ml-1">{teamDisplay}</span>
                </div>
                
                <div className="text-gray-400 font-bold px-1">VS</div>
                
                <div className={`flex-1 text-center ${oppColorClass}`}>
                  <span className="font-bold">{currentOpponent || 'TBD'}</span>
                  <span className="font-bold ml-1">{oppDisplay}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Pie Chart Visualization */}
        <div className="space-y-4">
            <div className="flex items-center justify-between h-48 w-full gap-10">
              {(() => {
                // Get the correct team references based on mode
                const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
                const currentOpponent = opponentTeam; // Use opponent team in both modes
                
                // If no team is selected, show neutral 50/50 grey pie
                if (!currentTeam || currentTeam === 'N/A') {
                  const neutralPieData = [
                    { name: 'N/A', value: 50, fill: '#9ca3af', displayValue: 'N/A' },
                    { name: 'N/A', value: 50, fill: '#9ca3af', displayValue: 'N/A' }
                  ];
                  
                  return (
                    <div className="w-full">
                      <div className="flex items-center justify-between h-48 w-full gap-6 md:gap-8">
                        {/* Left N/A */}
                        <div className="w-32 text-right text-sm font-semibold pr-2 md:pr-4 text-gray-400">
                          <div>N/A</div>
                          <div>N/A</div>
                          <div className="text-xs opacity-85">Rank: </div>
                        </div>
                        
                        {/* Neutral Pie */}
                        <div className="h-44 w-44 md:w-56 md:h-56 flex-shrink-0 select-none" style={{ minHeight: '176px', minWidth: '176px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={neutralPieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={80}
                                paddingAngle={0}
                                dataKey="value"
                                startAngle={90}
                                endAngle={-270}
                              >
                                {neutralPieData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        
                        {/* Right N/A */}
                        <div className="w-28 md:w-32 text-left text-sm font-semibold pl-2 md:pl-4 text-gray-400">
                          <div>N/A</div>
                          <div>N/A</div>
                          <div className="text-xs opacity-85">Rank: </div>
                        </div>
                      </div>
                      
                      {/* Neutral Legend */}
                      <div className="flex items-center justify-center gap-4 text-xs mt-3">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                          <span className="text-gray-500 dark:text-gray-400">No Team Selected</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                
                if (teamMatchupLoading) {
                  return <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">Loading matchup data...</div>;
                }
                
                const currentStats = teamMatchupStats.currentTeam;
                const opponentStats = teamMatchupStats.opponent;
                
                if (!currentStats || !opponentStats) {
                  return <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-4">No matchup data available</div>;
                }
                
                let teamValue: number = 0;
                let opponentValue: number = 0;
                let isPercentage = false;
                
                switch (selectedComparison) {
                  case 'points':
                    teamValue = currentStats.pts || 0;
                    opponentValue = opponentStats.pts || 0;
                    break;
                  case 'rebounds':
                    teamValue = currentStats.reb || 0;
                    opponentValue = opponentStats.reb || 0;
                    break;
                  case 'assists':
                    teamValue = currentStats.ast || 0;
                    opponentValue = opponentStats.ast || 0;
                    break;
                  case 'fg_pct':
                    teamValue = currentStats.fg_pct || 0;
                    opponentValue = opponentStats.fg_pct || 0;
                    isPercentage = true;
                    break;
                  case 'three_pct':
                    teamValue = currentStats.fg3_pct || 0;
                    opponentValue = opponentStats.fg3_pct || 0;
                    isPercentage = true;
                    break;
                }
                
                // Use values directly for display (offensive stats - higher is better)
                const originalTeamValue = teamValue;
                const originalOpponentValue = opponentValue;

                const pieData = createTeamComparisonPieData(
                  teamValue,
                  opponentValue,
                  currentTeam,
                  currentOpponent || 'TBD',
                  false,
                  /* amplify */ true,
                  /* useAbs */ false,
                  /* clampNegatives */ false,
                  /* baseline */ 0,
                  /* invertOppForShare */ false,
                  /* invertMax */ 130,
                  /* ampBoost */ isPercentage ? 3.0 : 1.0
                );
                
                // Update display values to show original (non-inverted) values
                pieData[0].displayValue = originalTeamValue.toFixed(1);
                pieData[1].displayValue = originalOpponentValue.toFixed(1);

                // Keep pie chart data in same order as pieData (currentTeam first, then opponent)
                const pieDrawData = [pieData?.[0], pieData?.[1]];

                const teamDisplayRaw = pieData?.[0]?.displayValue ?? '';
                const oppDisplayRaw = pieData?.[1]?.displayValue ?? '';
                const teamDisplay = isPercentage ? `${teamDisplayRaw}%` : teamDisplayRaw;
                const oppDisplay = isPercentage ? `${oppDisplayRaw}%` : oppDisplayRaw;
                const teamColor = pieData?.[0]?.fill || '#22c55e';
                const oppColor = pieData?.[1]?.fill || '#ef4444';

                // Display values (ranks can be added later if needed from DVP API)
                const leftTeam = currentTeam;
                const leftDisplay = teamDisplay;
                const leftColor = teamColor;
                
                const rightTeam = currentOpponent;
                const rightDisplay = oppDisplay;
                const rightColor = oppColor
                
                return (
                  <div className="w-full">
                    {/* Centered Pie Chart */}
                    <div className="flex justify-center">
                      <div className="flex-shrink-0 select-none"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onMouseUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onFocus={(e) => { e.preventDefault(); e.target.blur(); }}
                        style={{ 
                          width: 'min(20vw, 150px)',
                          height: 'min(20vw, 150px)',
                          minWidth: '100px',
                          minHeight: '100px',
                          maxWidth: '150px',
                          maxHeight: '150px',
                          userSelect: 'none', 
                          outline: 'none',
                          border: 'none',
                          boxShadow: 'none'
                        }}
                      >
                        <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                          <PieChart style={{ outline: 'none', border: 'none' }}>
                            <Pie
                              data={pieDrawData}
                              cx="50%"
                              cy="50%"
                              innerRadius={"30%"}
                              outerRadius={"85%"}
                              paddingAngle={5}
                              dataKey="value"
                              startAngle={90}
                              endAngle={-270}
                            >
                              {pieDrawData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={getUnifiedTooltipStyle(isDark)}
                              wrapperStyle={{ outline: 'none', zIndex: 9999 }}
                              labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                              itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                              formatter={(value: any, name: string, props: any) => [
                                isPercentage ? `${props.payload.displayValue}%` : `${props.payload.displayValue}`,
                                name
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Mobile Layout - stats below pie */}
                    <div className="sm:hidden space-y-4">
                      {/* Centered Pie */}
                      <div className="flex justify-center">
                        <div className="h-32 w-32 md:h-40 md:w-40 flex-shrink-0 select-none"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onMouseUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onFocus={(e) => { e.preventDefault(); e.target.blur(); }}
                          style={{ 
                            minHeight: '128px',
                            minWidth: '128px',
                            userSelect: 'none', 
                            outline: 'none',
                            border: 'none',
                            boxShadow: 'none'
                          }}
                        >
                          <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                            <PieChart style={{ outline: 'none', border: 'none' }}>
                              <Pie
                                data={pieDrawData}
                                cx="50%"
                                cy="50%"
                                innerRadius={35}
                                outerRadius={75}
                                paddingAngle={5}
                                dataKey="value"
                                startAngle={90}
                                endAngle={-270}
                              >
                                {pieDrawData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={getUnifiedTooltipStyle(isDark)}
                                wrapperStyle={{ outline: 'none', zIndex: 9999 }}
                                labelStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                                itemStyle={{ color: isDark ? '#FFFFFF' : '#000000' }}
                                formatter={(value: any, name: string, props: any) => [
                                  isPercentage ? `${props.payload.displayValue}%` : `${props.payload.displayValue}`,
                                  name
                                ]}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Stats Row Below */}
                      <div className="flex items-center justify-between gap-4">
                        {/* Left value - Selected Team */}
                        <div className="flex-1 text-center text-sm font-semibold" style={{ color: leftColor }}>
                          <div className="truncate text-base font-bold">{leftTeam}</div>
                          <div className="text-xl font-bold">{leftDisplay}</div>
                        </div>

                        {/* VS Separator */}
                        <div className="text-gray-400 text-sm font-bold px-2">VS</div>

                        {/* Right value - Opponent */}
                        <div className="flex-1 text-center text-sm font-semibold" style={{ color: rightColor }}>
                          <div className="truncate text-base font-bold">{rightTeam || 'TBD'}</div>
                          <div className="text-xl font-bold">{rightDisplay}</div>
                        </div>
                      </div>
                    </div>

                    {/* Dynamic Legend matching slice colors */}
                    <div className="flex items-center justify-center gap-4 text-xs mt-3">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: leftColor }}></div>
                        <span className="text-gray-600 dark:text-gray-300">{leftTeam}</span>
                      </div>
                      <div className="text-gray-400">vs</div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: rightColor }}></div>
                        <span className="text-gray-600 dark:text-gray-300">{rightTeam || 'TBD'}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            
            
            {/* Metric Description */}
            <div className="text-center text-xs text-gray-500 dark:text-gray-400">
              {selectedComparison === 'points' && 'Total Points Per Game Comparison'}
              {selectedComparison === 'rebounds' && 'Total Rebounds Per Game Comparison'}
              {selectedComparison === 'assists' && 'Total Assists Per Game Comparison'}
              {selectedComparison === 'fg_pct' && 'Field Goal Shooting Percentage Comparison'}
              {selectedComparison === 'three_pct' && '3-Point Shooting Percentage Comparison'}
            </div>
            
            {/* Matchup Odds Section */}
            {(() => {
              const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
              const currentOpponent = opponentTeam;
              
              // Only show odds if both teams are available and we have odds data
              if (!currentTeam || currentTeam === 'N/A' || !currentOpponent || !currentOpponent || realOddsData.length === 0) return null;
              
              // Get best odds from all books for H2H, Spread, and Total
              let bestMoneylineHome = 'N/A';
              let bestMoneylineAway = 'N/A';
              let bestTotalLine = 'N/A';
              let bestTotalOverOdds = 'N/A';
              let bestTotalUnderOdds = 'N/A';
              
              // Spread: track positive and negative separately
              let bestPositiveSpread: { line: number; odds: string } | null = null;
              let bestNegativeSpread: { line: number; odds: string } | null = null;
              
              const toNum = (s: string) => {
                const n = parseInt(String(s).replace(/[^+\\-\\d]/g, ''), 10);
                return Number.isFinite(n) ? n : -Infinity;
              };
              
              const parseSpreadLine = (s: string): number => {
                const n = parseFloat(String(s));
                return Number.isFinite(n) ? n : 0;
              };
              
              // Find best odds across all books
              for (const book of realOddsData) {
                if (book.H2H) {
                  if (book.H2H.home && toNum(book.H2H.home) > toNum(bestMoneylineHome)) bestMoneylineHome = book.H2H.home;
                  if (book.H2H.away && toNum(book.H2H.away) > toNum(bestMoneylineAway)) bestMoneylineAway = book.H2H.away;
                }
                if (book.Spread && book.Spread.line && book.Spread.line !== 'N/A') {
                  const line = parseSpreadLine(book.Spread.line);
                  const odds = book.Spread.over;
                  
                  if (line > 0) {
                    // Positive spread: highest line wins, if tied best odds
                    if (!bestPositiveSpread || line > bestPositiveSpread.line || 
                        (line === bestPositiveSpread.line && toNum(odds) > toNum(bestPositiveSpread.odds))) {
                      bestPositiveSpread = { line, odds };
                    }
                  } else if (line < 0) {
                    // Negative spread: lowest line wins (closest to 0), if tied best odds
                    if (!bestNegativeSpread || line > bestNegativeSpread.line || 
                        (line === bestNegativeSpread.line && toNum(odds) > toNum(bestNegativeSpread.odds))) {
                      bestNegativeSpread = { line, odds };
                    }
                  }
                }
                if (book.Total) {
                  if (book.Total.line && bestTotalLine === 'N/A') bestTotalLine = book.Total.line;
                  if (book.Total.over && toNum(book.Total.over) > toNum(bestTotalOverOdds)) bestTotalOverOdds = book.Total.over;
                  if (book.Total.under && toNum(book.Total.under) > toNum(bestTotalUnderOdds)) bestTotalUnderOdds = book.Total.under;
                }
              }
              
              return null;
            })()}
        </div>
      </div>
      )}
    </div>

  {/* Shot Chart (Desktop) - only in Player Props mode - Always visible with skeleton when loading */}
  {propsMode === 'player' && (
    <div className="hidden lg:block w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-4 border border-gray-200 dark:border-gray-700">
      <Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-500">Loading shot chart...</div>}>
        <ShotChart 
          isDark={isDark} 
          shotData={shotDistanceData}
          playerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
          opponentTeam={opponentTeam}
        />
      </Suspense>
      {/* Play Type Analysis */}
      <Suspense fallback={<div className="h-32 flex items-center justify-center text-gray-500">Loading analysis...</div>}>
        <PlayTypeAnalysis
          playerId={selectedPlayer?.id ? String(selectedPlayer.id) : ''}
          opponentTeam={opponentTeam}
          season={currentNbaSeason()}
          isDark={isDark}
        />
      </Suspense>
    </div>
  )}


  </div>
  );
}
