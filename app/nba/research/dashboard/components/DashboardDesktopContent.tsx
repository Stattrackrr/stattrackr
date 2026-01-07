'use client';

import { Suspense, useMemo, lazy } from 'react';
import { OfficialOddsCard, BestOddsTableDesktop } from './odds';
import DepthChartContainer from './DepthChartContainer';
import PlayerBoxScore from './PlayerBoxScore';
import { NBAPlayer, BallDontLieStats, BookRow, DerivedOdds, MovementRow, MatchupInfo, OddsFormat } from '../types';
import { getEspnLogoUrl } from '../utils/teamUtils';
import { LINE_MOVEMENT_ENABLED } from '../constants';

// Lazy load heavy components
const TeamTrackingStatsTable = lazy(() => import('@/components/TeamTrackingStatsTable').then(mod => ({ default: mod.TeamTrackingStatsTable })));

interface DashboardDesktopContentProps {
  propsMode: 'player' | 'team';
  isDark: boolean;
  
  // Tracking Stats props
  selectedTeam: string;
  selectedPlayer: NBAPlayer | null;
  
  // Official Odds Card props
  derivedOdds: DerivedOdds;
  intradayMovementsFinal: MovementRow[];
  opponentTeam: string | null;
  selectedTeamLogoUrl: string;
  opponentTeamLogoUrl: string;
  matchupInfo: MatchupInfo;
  oddsFormat: OddsFormat;
  realOddsData: BookRow[];
  fmtOdds: (odds: string) => string;
  mergedLineMovementData: {
    openingLine: { line: number; bookmaker: string; timestamp: string } | null;
    currentLine: { line: number; bookmaker: string; timestamp: string } | null;
    impliedOdds: number | null;
    lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
  } | null;
  selectedStat: string;
  calculatedImpliedOdds: {
    overImpliedProb: number | null;
    underImpliedProb: number | null;
  } | null;
  selectedBookmakerName: string | null;
  selectedBookmakerLine: number | null;
  primaryMarketLine: number | null;
  bettingLine: number | null;
  
  // Best Odds Table Desktop props
  oddsLoading: boolean;
  oddsError: string | null;
  gamePropsTeam: string;
  resolvedPlayerId: string | null;
  
  // Depth Chart props
  depthChartTeam: string;
  setDepthChartTeam: (team: string) => void;
  teamInjuries: Record<string, any[]>;
  originalPlayerTeam: string;
  playerTeamRoster: any;
  opponentTeamRoster: any;
  rostersLoading: { player: boolean; opponent: boolean };
  allTeamRosters: Record<string, any>;
  rosterCacheLoading: boolean;
  
  // Player Box Score props
  playerStats: BallDontLieStats[];
}

export function DashboardDesktopContent({
  propsMode,
  isDark,
  selectedTeam,
  selectedPlayer,
  derivedOdds,
  intradayMovementsFinal,
  opponentTeam,
  selectedTeamLogoUrl,
  opponentTeamLogoUrl,
  matchupInfo,
  oddsFormat,
  realOddsData,
  fmtOdds,
  mergedLineMovementData,
  selectedStat,
  calculatedImpliedOdds,
  selectedBookmakerName,
  selectedBookmakerLine,
  primaryMarketLine,
  bettingLine,
  oddsLoading,
  oddsError,
  gamePropsTeam,
  resolvedPlayerId,
  depthChartTeam,
  setDepthChartTeam,
  teamInjuries,
  originalPlayerTeam,
  playerTeamRoster,
  opponentTeamRoster,
  rostersLoading,
  allTeamRosters,
  rosterCacheLoading,
  playerStats,
}: DashboardDesktopContentProps) {
  return (
    <>
      {/* Tracking Stats Container (Desktop) - Team Rankings */}
      {useMemo(() => {
        if (propsMode !== 'player' || !selectedTeam || selectedTeam === 'N/A') return null;
        
        const playerName = selectedPlayer?.full || 
          `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
        
        return (
          <div className="hidden lg:block">
            <Suspense fallback={<div className="h-32 flex items-center justify-center text-gray-500">Loading stats...</div>}>
              <TeamTrackingStatsTable
                teamAbbr={selectedTeam}
                selectedPlayerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
                selectedPlayerName={playerName || undefined}
                season={2025}
                isDark={isDark}
              />
            </Suspense>
          </div>
        );
      }, [propsMode, selectedTeam, selectedPlayer?.id, selectedPlayer?.full, selectedPlayer?.firstName, selectedPlayer?.lastName, isDark])}

      {/* Under-chart container (Desktop) - Always render with skeleton when loading */}
      {useMemo(() => {
        // Always render the container - show skeleton when player is loading or missing
        const showSkeleton = !selectedPlayer || !selectedTeam || selectedTeam === 'N/A' || !opponentTeam;
        
        return propsMode !== 'team' ? (
          <div className="hidden lg:block">
            {showSkeleton ? (
              <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-center py-8">
                  <div className="space-y-3 w-full max-w-md">
                    <div className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'} mx-auto`}></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.1s' }}></div>
                      <div className={`h-20 rounded-lg animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <OfficialOddsCard
                isDark={isDark}
                derivedOdds={derivedOdds}
                intradayMovements={intradayMovementsFinal}
                selectedTeam={selectedTeam}
                opponentTeam={opponentTeam || ''}
                selectedTeamLogoUrl={selectedTeam && selectedTeam !== 'N/A' ? (selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)) : ''}
                opponentTeamLogoUrl={opponentTeam && opponentTeam !== '' ? (opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)) : ''}
                matchupInfo={matchupInfo}
                oddsFormat={oddsFormat}
                books={realOddsData}
                fmtOdds={fmtOdds}
                lineMovementEnabled={LINE_MOVEMENT_ENABLED}
                lineMovementData={mergedLineMovementData}
                selectedStat={selectedStat}
                calculatedImpliedOdds={calculatedImpliedOdds}
                selectedBookmakerName={selectedBookmakerName}
                selectedBookmakerLine={selectedBookmakerLine}
                propsMode={propsMode}
                selectedPlayer={selectedPlayer}
                primaryMarketLine={primaryMarketLine}
                bettingLine={bettingLine ?? undefined}
              />
            )}
          </div>
        ) : null;
      }, [isDark, derivedOdds, intradayMovementsFinal, selectedTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat, calculatedImpliedOdds, selectedBookmakerName, selectedBookmakerLine, selectedPlayer, primaryMarketLine, bettingLine])}

      {/* BEST ODDS (Desktop) - Memoized to prevent re-renders from betting line changes */}
      <BestOddsTableDesktop
        isDark={isDark}
        oddsLoading={oddsLoading}
        oddsError={oddsError}
        realOddsData={realOddsData}
        selectedTeam={selectedTeam}
        gamePropsTeam={gamePropsTeam}
        propsMode={propsMode}
        opponentTeam={opponentTeam || ''}
        oddsFormat={oddsFormat}
        fmtOdds={fmtOdds}
        playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
        selectedStat={selectedStat}
      />

      {/* Unified Depth Chart (Desktop) - optimized for both modes - Always visible with skeleton when loading */}
      {useMemo(() => {
        // Determine which team to show based on mode
        // For Game Props mode, use depthChartTeam for switching, fallback to gamePropsTeam
        const currentTeam = propsMode === 'player' 
          ? depthChartTeam 
          : (depthChartTeam && depthChartTeam !== 'N/A' ? depthChartTeam : gamePropsTeam);
        
        // Determine roster data based on mode
        const currentTeamRoster = propsMode === 'player' 
          ? (currentTeam === depthChartTeam ? playerTeamRoster : opponentTeamRoster)
          : (allTeamRosters[currentTeam] || null);
        const currentOpponentRoster = propsMode === 'player' 
          ? (currentTeam === depthChartTeam ? opponentTeamRoster : playerTeamRoster)
          : (opponentTeam ? (allTeamRosters[opponentTeam] || null) : null);
        
        // Determine loading state based on mode
        const currentRostersLoading = propsMode === 'player' 
          ? rostersLoading 
          : { player: rosterCacheLoading, opponent: rosterCacheLoading };
        
        return (
          <div className="hidden lg:block">
            <DepthChartContainer
              selectedTeam={currentTeam}
              teamInjuries={teamInjuries}
              isDark={isDark}
              onPlayerSelect={propsMode === 'player' ? (playerName: string) => {
                // In depth chart, we only have player names, not full player objects
                // For now, just log the selection - full integration would require player lookup
                console.log(`Selected player from depth chart: ${playerName}`);
              } : () => {}}
              selectedPlayerName={propsMode === 'player' && selectedPlayer ? (
                (() => {
                  const fullName = selectedPlayer.full;
                  const constructedName = `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim();
                  return fullName || constructedName;
                })()
              ) : ''}
              opponentTeam={opponentTeam || ''}
              originalPlayerTeam={propsMode === 'player' ? originalPlayerTeam : gamePropsTeam}
              playerTeamRoster={currentTeamRoster}
              opponentTeamRoster={currentOpponentRoster}
              rostersLoading={currentRostersLoading}
              onTeamSwap={(team) => {
                console.log(`🔄 Depth chart view only team swap: ${team}`);
                // Only update the depth chart display team, not the main stats container
                if (propsMode === 'player') {
                  setDepthChartTeam(team);
                } else if (propsMode === 'team') {
                  // In Game Props mode, allow depth chart team switching for roster viewing
                  // but don't change the main gamePropsTeam or stats
                  // We need a separate state for depth chart display team in game props mode
                  setDepthChartTeam(team);
                }
              }}
            />
          </div>
        );
      }, [
        propsMode, 
        depthChartTeam, 
        gamePropsTeam, 
        teamInjuries, 
        isDark, 
        selectedPlayer?.full, 
        selectedPlayer?.firstName, 
        selectedPlayer?.lastName, 
        opponentTeam, 
        originalPlayerTeam, 
        playerTeamRoster, 
        opponentTeamRoster, 
        rostersLoading, 
        allTeamRosters, 
        rosterCacheLoading
      ])}

      {/* Player Box Score (Desktop) - conditionally rendered inside useMemo */}
      {useMemo(() => {
        if (propsMode !== 'player') return null;
        
        return (
          <div className="hidden lg:block">
            <PlayerBoxScore
              selectedPlayer={selectedPlayer}
              playerStats={playerStats}
              isDark={isDark}
            />
          </div>
        );
      }, [propsMode, selectedPlayer, playerStats, isDark])}
    </>
  );
}

