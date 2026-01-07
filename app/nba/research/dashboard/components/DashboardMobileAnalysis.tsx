'use client';

import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { PositionDefenseCard, OpponentAnalysisCard } from './dvp';
import InjuryContainer from '@/components/InjuryContainer';
import { createTeamComparisonPieData } from '../utils/teamAnalysisUtils';
import { NBAPlayer } from '../types';
import { BallDontLieStats } from '../types';

interface DashboardMobileAnalysisProps {
  propsMode: 'player' | 'team';
  dvpProjectedTab: 'dvp' | 'opponent' | 'injuries';
  setDvpProjectedTab: (tab: 'dvp' | 'opponent' | 'injuries') => void;
  isDark: boolean;
  opponentTeam: string | null;
  selectedPosition: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  selectedTeam: string;
  selectedPlayer: NBAPlayer | null;
  predictedPace: number | null;
  seasonFgPct: number | null;
  averageUsageRate: number | null;
  averageMinutes: number | null;
  averageGamePace: number | null;
  selectedTimeframe: string;
  resolvedPlayerId: string | null;
  selectedStat: string;
  playerStats: BallDontLieStats[];
  teammateFilterId: number | null;
  setTeammateFilterId: (id: number | null) => void;
  setTeammateFilterName: (name: string | null) => void;
  withWithoutMode: 'with' | 'without';
  setWithWithoutMode: (mode: 'with' | 'without') => void;
  clearTeammateFilter: () => void;
  gamePropsTeam: string;
  selectedComparison: 'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct';
  setSelectedComparison: (comparison: 'points' | 'rebounds' | 'assists' | 'fg_pct' | 'three_pct') => void;
  teamMatchupLoading: boolean;
  teamMatchupStats: {
    currentTeam: any;
    opponent: any;
  };
}

export function DashboardMobileAnalysis(props: DashboardMobileAnalysisProps) {
  const {
    propsMode,
    dvpProjectedTab,
    setDvpProjectedTab,
    isDark,
    opponentTeam,
    selectedPosition,
    selectedTeam,
    selectedPlayer,
    predictedPace,
    seasonFgPct,
    averageUsageRate,
    averageMinutes,
    averageGamePace,
    selectedTimeframe,
    resolvedPlayerId,
    selectedStat,
    playerStats,
    teammateFilterId,
    setTeammateFilterId,
    setTeammateFilterName,
    withWithoutMode,
    setWithWithoutMode,
    clearTeammateFilter,
    gamePropsTeam,
    selectedComparison,
    setSelectedComparison,
    teamMatchupLoading,
    teamMatchupStats,
  } = props;

  const selectedTimeFilter = 'last10'; // Constant value

  return (
    <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-2 md:p-3 border border-gray-200 dark:border-gray-700 w-full min-w-0">
      {/* Section 0: Defense vs Position / Projected / Opponent Breakdown Tabs - only show in Player Props mode */}
      {propsMode === 'player' && (
        <>
          {/* Tab Selector */}
          <div className="flex gap-2 sm:gap-2 mb-3 sm:mb-3">
            <button
              onClick={() => setDvpProjectedTab('dvp')}
              className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'dvp'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              <span className="hidden xs:inline">Defense vs Position</span>
              <span className="xs:hidden">DvP</span>
            </button>
            <button
              onClick={() => setDvpProjectedTab('opponent')}
              className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'opponent'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              <span className="hidden xs:inline">Opponent Breakdown</span>
              <span className="xs:hidden">Opponent</span>
            </button>
            <button
              onClick={() => setDvpProjectedTab('injuries')}
              className={`flex-1 px-3 sm:px-2 md:px-3 py-2.5 sm:py-2 text-xs sm:text-xs md:text-sm font-medium rounded-lg transition-colors border ${
                dvpProjectedTab === 'injuries'
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-700'
              }`}
            >
              Injuries
            </button>
          </div>
          
          {/* Content based on selected tab - always render container, just show/hide content */}
          <div className="relative min-h-[250px] sm:min-h-[200px] w-full min-w-0">
            <div className={dvpProjectedTab === 'dvp' ? 'block' : 'hidden'}>
              <PositionDefenseCard isDark={isDark} opponentTeam={opponentTeam || ''} selectedPosition={selectedPosition} currentTeam={selectedTeam} />
            </div>
            <div className={dvpProjectedTab === 'opponent' ? 'block' : 'hidden'}>
              <OpponentAnalysisCard 
                isDark={isDark} 
                opponentTeam={opponentTeam || ''} 
                selectedTimeFilter={selectedTimeFilter}
                propsMode={propsMode}
                playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
                selectedStat={selectedStat}
              />
            </div>
            <div className={dvpProjectedTab === 'injuries' ? 'block' : 'hidden'}>
              <InjuryContainer
                selectedTeam={selectedTeam}
                opponentTeam={opponentTeam || ''}
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
          <h4 className="text-base md:text-lg lg:text-xl font-semibold text-gray-900 dark:text-white">Team Matchup</h4>
        </div>
        
        {/* Comparison Metric Selector */}
        <div className="mb-3 md:mb-4">
          <div className="grid grid-cols-2 gap-1 md:gap-2 lg:gap-3">
            <button
              onClick={() => setSelectedComparison('points')}
              className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                selectedComparison === 'points'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              POINTS
            </button>
            <button
              onClick={() => setSelectedComparison('rebounds')}
              className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                selectedComparison === 'rebounds'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              REBOUNDS
            </button>
            <button
              onClick={() => setSelectedComparison('assists')}
              className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
                selectedComparison === 'assists'
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              ASSISTS
            </button>
            <button
              onClick={() => setSelectedComparison('fg_pct')}
              className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors ${
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
                className={`px-2 md:px-3 lg:px-4 py-1.5 md:py-2 text-xs md:text-sm lg:text-base font-medium rounded-lg transition-colors w-[calc(50%-0.25rem)] ${
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
        <div className="mt-3 md:mt-4">
          {(() => {
            const currentTeam = propsMode === 'team' ? gamePropsTeam : selectedTeam;
            const currentOpponent = opponentTeam;
            
            if (!currentTeam || currentTeam === 'N/A') return null;
            
            if (teamMatchupLoading) {
              return (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <div className="relative w-48 h-48">
                    <div className="absolute inset-0 rounded-full border-8 border-gray-200 dark:border-gray-800 animate-pulse"></div>
                    <div className="absolute inset-4 rounded-full border-8 border-gray-300 dark:border-gray-700 animate-pulse" style={{ animationDelay: '0.1s' }}></div>
                    <div className="absolute inset-8 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <div className="space-y-2 w-full max-w-xs">
                    <div className="h-4 w-full rounded animate-pulse bg-gray-200 dark:bg-gray-800"></div>
                    <div className="h-4 w-3/4 mx-auto rounded animate-pulse bg-gray-200 dark:bg-gray-800" style={{ animationDelay: '0.1s' }}></div>
                  </div>
                </div>
              );
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
            
            return (
              <div className="flex flex-col items-center">
                {/* Mobile Pie Chart - Smaller and Simplified */}
                <div className="h-32 w-32 mb-2" style={{ minHeight: '128px', minWidth: '128px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieDrawData}
                        cx="50%"
                        cy="50%"
                        innerRadius={20}
                        outerRadius={60}
                        paddingAngle={2}
                        dataKey="value"
                        startAngle={90}
                        endAngle={-270}
                      >
                        {pieDrawData?.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry?.fill} />
                        )) || []}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Mobile Legend - Compact */}
                <div className="flex items-center justify-center gap-3 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: teamColor }}></div>
                    <span className="font-medium">{currentTeam} {teamDisplay}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: oppColor }}></div>
                    <span className="font-medium">{currentOpponent || 'TBD'} {oppDisplay}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        
        <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-2">
          {selectedComparison === 'points' && 'Total Points Per Game Comparison'}
          {selectedComparison === 'rebounds' && 'Total Rebounds Per Game Comparison'}
          {selectedComparison === 'assists' && 'Total Assists Per Game Comparison'}
          {selectedComparison === 'fg_pct' && 'Field Goal Shooting Percentage Comparison'}
          {selectedComparison === 'three_pct' && '3-Point Shooting Percentage Comparison'}
        </div>
      </div>
      )}
    </div>
  );
}

