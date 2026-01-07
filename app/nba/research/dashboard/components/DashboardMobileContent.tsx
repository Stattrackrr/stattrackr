'use client';

import { Suspense, useMemo, lazy } from 'react';
import { OfficialOddsCard, BestOddsTable } from './odds';
import DepthChartContainer from './DepthChartContainer';
import PlayerBoxScore from './PlayerBoxScore';
import { NBAPlayer, BallDontLieStats, BookRow, DerivedOdds, MovementRow, MatchupInfo, OddsFormat } from '../types';
import { currentNbaSeason } from '../utils/playerUtils';
import { getEspnLogoUrl } from '../utils/teamUtils';
import { LINE_MOVEMENT_ENABLED } from '../constants';

// Lazy load heavy components
const ShotChart = lazy(() => import('../ShotChart').then(mod => ({ default: mod.default })));
const PlayTypeAnalysis = lazy(() => import('@/components/PlayTypeAnalysis').then(mod => ({ default: mod.PlayTypeAnalysis })));
const TeamTrackingStatsTable = lazy(() => import('@/components/TeamTrackingStatsTable').then(mod => ({ default: mod.TeamTrackingStatsTable })));

interface DashboardMobileContentProps {
  propsMode: 'player' | 'team';
  isDark: boolean;
  
  // Shot Chart props
  selectedPlayer: NBAPlayer | null;
  shotDistanceData: any | null;
  opponentTeam: string | null;
  
  // Tracking Stats props
  selectedTeam: string;
  
  // Official Odds Card props
  derivedOdds: DerivedOdds;
  intradayMovementsFinal: MovementRow[];
  gamePropsTeam: string;
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
  
  // Best Odds Table props
  oddsLoading: boolean;
  oddsError: string | null;
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

export function DashboardMobileContent({
  propsMode,
  isDark,
  selectedPlayer,
  shotDistanceData,
  opponentTeam,
  selectedTeam,
  derivedOdds,
  intradayMovementsFinal,
  gamePropsTeam,
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
}: DashboardMobileContentProps) {
  return (
    <>
      {/* 4.5 Shot Chart Container (Mobile) - Player Props mode only - Always visible with skeleton when loading */}
      {propsMode === 'player' && (
        <div className="lg:hidden w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-0 sm:p-4 gap-4 border border-gray-200 dark:border-gray-700">
          <ShotChart 
            isDark={isDark} 
            shotData={shotDistanceData}
            playerId={selectedPlayer?.id ? String(selectedPlayer.id) : undefined}
            opponentTeam={opponentTeam}
          />
          {/* Play Type Analysis */}
          <PlayTypeAnalysis
            playerId={selectedPlayer?.id ? String(selectedPlayer.id) : ''}
            opponentTeam={opponentTeam}
            season={currentNbaSeason()}
            isDark={isDark}
          />
        </div>
      )}

      {/* 5.5. Tracking Stats Container (Mobile) - Team Rankings */}
      {useMemo(() => {
        if (propsMode !== 'player' || !selectedTeam || selectedTeam === 'N/A') return null;
        
        const playerName = selectedPlayer?.full || 
          `${selectedPlayer?.firstName || ''} ${selectedPlayer?.lastName || ''}`.trim();
        
        return (
          <div className="lg:hidden">
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

      {/* 6. Official Odds Card Container (Mobile) - Always render with skeleton when loading */}
      {useMemo(() => {
        // Always render the container - show skeleton when player is loading or missing
        const currentTeamForCheck = propsMode === 'team' ? gamePropsTeam : selectedTeam;
        const showSkeleton = propsMode === 'player' && (!selectedPlayer || !currentTeamForCheck || currentTeamForCheck === 'N/A' || !opponentTeam);
        
        return (
          <div className="lg:hidden">
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
                selectedTeam={propsMode === 'team' ? gamePropsTeam : selectedTeam}
                opponentTeam={opponentTeam}
                selectedTeamLogoUrl={(propsMode === 'team' ? gamePropsTeam : selectedTeam) && (propsMode === 'team' ? gamePropsTeam : selectedTeam) !== 'N/A' ? (selectedTeamLogoUrl || getEspnLogoUrl(propsMode === 'team' ? gamePropsTeam : selectedTeam)) : ''}
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
                bettingLine={bettingLine}
              />
            )}
          </div>
        );
      }, [isDark, derivedOdds, intradayMovementsFinal, selectedTeam, gamePropsTeam, propsMode, opponentTeam, selectedTeamLogoUrl, opponentTeamLogoUrl, matchupInfo, oddsFormat, realOddsData, fmtOdds, mergedLineMovementData, selectedStat, calculatedImpliedOdds, selectedBookmakerName, selectedBookmakerLine, selectedPlayer, primaryMarketLine, bettingLine])}

      {/* 7. Best Odds Container (Mobile) - Matchup Odds */}
      <BestOddsTable
        isDark={isDark}
        oddsLoading={oddsLoading}
        oddsError={oddsError}
        realOddsData={realOddsData}
        selectedTeam={selectedTeam}
        gamePropsTeam={gamePropsTeam}
        propsMode={propsMode}
        opponentTeam={opponentTeam}
        oddsFormat={oddsFormat}
        fmtOdds={fmtOdds}
        playerId={resolvedPlayerId || (selectedPlayer?.id ? String(selectedPlayer.id) : null)}
        selectedStat={selectedStat}
      />

      {/* 8. Depth Chart Container (Mobile) - Always visible with skeleton when loading */}
      {useMemo(() => {
        // Determine which team to show based on mode
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
          <div className="lg:hidden">
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
              opponentTeam={opponentTeam}
              originalPlayerTeam={propsMode === 'player' ? originalPlayerTeam : gamePropsTeam}
              playerTeamRoster={currentTeamRoster}
              opponentTeamRoster={currentOpponentRoster}
              rostersLoading={currentRostersLoading}
              onTeamSwap={(team) => {
                console.log(`🔄 Mobile depth chart team swap: ${team}`);
                if (propsMode === 'player') {
                  setDepthChartTeam(team);
                } else if (propsMode === 'team') {
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

      {/* 10. Player Box Score Container (Mobile) */}
      {useMemo(() => {
        if (propsMode !== 'player') return null;
        
        return (
          <div className="lg:hidden">
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

