'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { TEAM_FULL_NAMES, getEspnLogoUrl, getEspnLogoCandidates } from '../utils/teamUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getOpponentTeam } from '../utils/teamAnalysisUtils';
import { HeaderInfo } from '../utils/headerInfoUtils';
import { BallDontLieGame } from '../types';
import { NBAPlayer } from '../types';
import { ImpliedOddsWheel } from './odds/ImpliedOddsWheel';

interface DashboardHeaderProps {
  // Props mode
  propsMode: 'player' | 'team';
  
  // Player/Team info
  playerInfo: HeaderInfo;
  selectedPlayer: NBAPlayer | null;
  gamePropsTeam: string | null;
  selectedTeam: string | null;
  opponentTeam: string | null;
  nextGameOpponent: string;
  nextGameTipoff: string | null;
  countdown: { hours: number; minutes: number; seconds: number } | null;
  isGameInProgress: boolean;
  
  // Handlers
  setGamePropsTeam: (team: string) => void;
  setSelectedStat: (stat: string) => void;
  setOpponentTeam: (team: string) => void;
  
  // Logo state
  selectedTeamLogoUrl: string | null;
  setSelectedTeamLogoUrl: (url: string | null) => void;
  selectedTeamLogoAttempt: number;
  setSelectedTeamLogoAttempt: (attempt: number) => void;
  opponentTeamLogoUrl: string | null;
  setOpponentTeamLogoUrl: (url: string | null) => void;
  opponentTeamLogoAttempt: number;
  setOpponentTeamLogoAttempt: (attempt: number) => void;
  
  // Theme
  isDark: boolean;
  
  // Premium/Pro
  isPro: boolean;
  hasPremium: boolean;
  
  // Journal
  setShowJournalModal: (show: boolean) => void;
  
  // Games data
  todaysGames: BallDontLieGame[];
  
  // Implied Odds
  calculatedImpliedOdds: {
    overImpliedProb?: number;
    underImpliedProb?: number;
  } | null;
  
  // Navigation callback
  onNavigateBackToProps?: () => void;
}

export function DashboardHeader({
  propsMode,
  playerInfo,
  selectedPlayer,
  gamePropsTeam,
  selectedTeam,
  opponentTeam,
  nextGameOpponent,
  nextGameTipoff,
  countdown,
  isGameInProgress,
  setGamePropsTeam,
  setSelectedStat,
  setOpponentTeam,
  selectedTeamLogoUrl,
  setSelectedTeamLogoUrl,
  selectedTeamLogoAttempt,
  setSelectedTeamLogoAttempt,
  opponentTeamLogoUrl,
  setOpponentTeamLogoUrl,
  opponentTeamLogoAttempt,
  setOpponentTeamLogoAttempt,
  isDark,
  isPro,
  hasPremium,
  setShowJournalModal,
  todaysGames,
  calculatedImpliedOdds,
  onNavigateBackToProps,
}: DashboardHeaderProps) {
  const router = useRouter();

  return (
    <div className="relative z-[60] bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 mr-1 sm:mr-2 md:mr-3 overflow-hidden">
      <div className="flex flex-col gap-2 lg:gap-3">
        {/* Desktop: Original layout - Player info, Search, Team vs Team all in one row */}
        <div className="hidden lg:flex items-center justify-between flex-1">
          <div className="flex-shrink-0">
            {propsMode === 'team' ? (
              // Game Props mode - show team or prompt
              gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <h1 className="text-lg font-bold text-gray-900 dark:text-white">{TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}</h1>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Team: {gamePropsTeam}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Game Props Mode
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <h1 className="text-lg font-bold text-gray-900 dark:text-white">Select a Team</h1>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Search for a team above
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Game Props Mode
                  </div>
                </div>
              )
            ) : (
              // Player Props mode - show player info
              <div>
                {/* Back button to player props page */}
                {selectedPlayer && (
                  <button
                    onClick={() => {
                      if (onNavigateBackToProps) onNavigateBackToProps();
                      try {
                        sessionStorage.removeItem('nba_dashboard_session_v1');
                        sessionStorage.removeItem('last_prop_click');
                        sessionStorage.removeItem('last_prop_url');
                      } catch {}
                      window.location.href = '/nba';
                    }}
                    className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  >
                    <svg 
                      className="w-4 h-4" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>Back to Player Props</span>
                  </button>
                )}
                <div className="flex items-baseline gap-3 mb-1">
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white">{playerInfo.name}</h1>
                  <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{playerInfo.jersey}</span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Height: {playerInfo.height || ""}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {playerInfo.teamName || ""}
                </div>
              </div>
            )}
          </div>

          {/* Team vs Team Display - Desktop only - Aligned with name - Now in the middle */}
          <div className="hidden lg:flex flex-shrink-0 items-end mx-4">
            {propsMode === 'player' ? (
              // Player Props Mode - Show player's team vs next opponent (show team immediately, opponent when games load)
              selectedTeam && selectedTeam !== 'N/A' ? (
                <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                  {/* Player Team */}
                  <div className="flex items-center gap-1.5">
                    <img 
                      src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                      alt={selectedTeam}
                      className="w-8 h-8 object-contain flex-shrink-0"
                      onError={(e) => {
                        const candidates = getEspnLogoCandidates(selectedTeam);
                        const next = selectedTeamLogoAttempt + 1;
                        if (next < candidates.length) {
                          setSelectedTeamLogoAttempt(next);
                          setSelectedTeamLogoUrl(candidates[next]);
                        } else {
                          e.currentTarget.onerror = null;
                        }
                      }}
                    />
                    <span className="font-bold text-gray-900 dark:text-white text-sm">{selectedTeam}</span>
                  </div>
                  
                  {/* Countdown to Tipoff - Centered between teams */}
                  {nextGameOpponent && countdown && !isGameInProgress ? (
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Tipoff in</div>
                      <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                      </div>
                    </div>
                  ) : nextGameOpponent && isGameInProgress ? (
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="text-sm font-semibold text-green-600 dark:text-green-400">LIVE</div>
                    </div>
                  ) : nextGameOpponent && nextGameTipoff ? (
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">Game time passed</div>
                    </div>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                  )}
                  
                  {/* Next Game Opponent (or placeholder until games load) */}
                  <div className="flex items-center gap-1.5">
                    {(nextGameOpponent || opponentTeam) && (nextGameOpponent || opponentTeam) !== '' && (nextGameOpponent || opponentTeam) !== 'N/A' ? (
                      <>
                        <img 
                          src={getEspnLogoUrl(nextGameOpponent || opponentTeam || '')}
                          alt={nextGameOpponent || opponentTeam || ''}
                          className="w-8 h-8 object-contain flex-shrink-0"
                          onError={(e) => {
                            const opp = nextGameOpponent || opponentTeam || '';
                            const candidates = getEspnLogoCandidates(opp);
                            const next = opponentTeamLogoAttempt + 1;
                            if (next < candidates.length) {
                              setOpponentTeamLogoAttempt(next);
                              e.currentTarget.src = candidates[next];
                            } else {
                              e.currentTarget.onerror = null;
                            }
                          }}
                        />
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{nextGameOpponent || opponentTeam}</span>
                      </>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 text-sm font-medium min-w-[60px]">—</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                  <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                </div>
              )
            ) : (
              // Game Props Mode - Show selected team vs opponent or prompt
              gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-3 py-2">
                  {/* Selected Team */}
                  <div className="flex items-center gap-1.5">
                    <img 
                      src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                      alt={gamePropsTeam}
                      className="w-8 h-8 object-contain flex-shrink-0"
                      onError={(e) => {
                        const candidates = getEspnLogoCandidates(gamePropsTeam);
                        const next = selectedTeamLogoAttempt + 1;
                        if (next < candidates.length) {
                          setSelectedTeamLogoAttempt(next);
                          setSelectedTeamLogoUrl(candidates[next]);
                        } else {
                          e.currentTarget.onerror = null;
                        }
                      }}
                    />
                    <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                  </div>
                  
                  {/* Countdown to Tipoff - Centered between teams */}
                  {countdown && !isGameInProgress ? (
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Tipoff in</div>
                      <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                      </div>
                    </div>
                  ) : isGameInProgress ? (
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="text-sm font-semibold text-green-600 dark:text-green-400">LIVE</div>
                    </div>
                  ) : nextGameTipoff ? (
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">Game time passed</div>
                    </div>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-400 font-medium text-xs">VS</span>
                  )}
                  
                  {/* Opponent Team */}
                  <div className="flex items-center gap-1.5">
                    <img 
                      src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                      alt={opponentTeam}
                      className="w-8 h-8 object-contain flex-shrink-0"
                      onError={(e) => {
                        const candidates = getEspnLogoCandidates(opponentTeam);
                        const next = opponentTeamLogoAttempt + 1;
                        if (next < candidates.length) {
                          setOpponentTeamLogoAttempt(next);
                          setOpponentTeamLogoUrl(candidates[next]);
                        } else {
                          e.currentTarget.onerror = null;
                        }
                      }}
                    />
                    <span className="font-bold text-gray-900 dark:text-white text-sm">{opponentTeam}</span>
                  </div>
                </div>
              ) : gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                  <img 
                    src={getEspnLogoUrl(gamePropsTeam)}
                    alt={gamePropsTeam}
                    className="w-8 h-8 object-contain"
                  />
                  <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                  <span className="text-gray-500 dark:text-gray-400 text-xs">No Game Today</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                  <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                </div>
              )
            )}
          </div>

          {/* Implied Odds Wheel - Desktop - Now on the right */}
          {propsMode === 'player' && calculatedImpliedOdds && (
            <div className="flex-shrink-0">
              <ImpliedOddsWheel
                isDark={isDark}
                calculatedImpliedOdds={calculatedImpliedOdds}
                size={100}
              />
            </div>
          )}
        </div>

        {/* Mobile: Two-row layout - First row: Player name and Search, Second row: Height and Team vs Team */}
        {/* First row: Player name / Team name and Search button */}
        <div className="lg:hidden flex items-center justify-between">
          <div className="flex-shrink-0">
            {propsMode === 'team' ? (
              // Game Props mode - show team or prompt
              gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <h1 className="text-lg font-bold text-gray-900 dark:text-white">{TEAM_FULL_NAMES[gamePropsTeam] || gamePropsTeam}</h1>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <h1 className="text-lg font-bold text-gray-900 dark:text-white">Select a Team</h1>
                  </div>
                </div>
              )
            ) : (
              // Player Props mode - show player name
              <div>
                {/* Back button to player props page */}
                {selectedPlayer && (
                  <button
                    onClick={() => {
                      if (onNavigateBackToProps) onNavigateBackToProps();
                      try {
                        sessionStorage.removeItem('nba_dashboard_session_v1');
                        sessionStorage.removeItem('last_prop_click');
                        sessionStorage.removeItem('last_prop_url');
                      } catch {}
                      window.location.href = '/nba';
                    }}
                    className="flex items-center gap-1.5 mb-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  >
                    <svg 
                      className="w-4 h-4" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>Back to Player Props</span>
                  </button>
                )}
                <div className="flex items-baseline gap-3">
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white">{playerInfo.name}</h1>
                  <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">{playerInfo.jersey}</span>
                </div>
              </div>
            )}
          </div>

          {/* Implied Odds Wheel - Mobile */}
          {propsMode === 'player' && calculatedImpliedOdds && (
            <div className="flex-shrink-0 ml-4">
              <ImpliedOddsWheel
                isDark={isDark}
                calculatedImpliedOdds={calculatedImpliedOdds}
                size={85}
              />
            </div>
          )}
        </div>

        {/* Second row: Player height / Team info and Team vs Team display - Mobile only */}
        <div className="lg:hidden flex items-center justify-between">
          <div className="flex-shrink-0">
            {propsMode === 'team' ? (
              // Game Props mode - show team info
              gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Team: {gamePropsTeam}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Game Props Mode
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Search for a team above
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    Game Props Mode
                  </div>
                </div>
              )
            ) : (
              // Player Props mode - show player height and team
              <div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Height: {playerInfo.height || ""}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {playerInfo.teamName || ""}
                </div>
              </div>
            )}
          </div>

          {/* Team vs Team Display - Mobile only - Aligned with height */}
          <div className="flex-shrink-0">
            {propsMode === 'player' ? (
              // Player Props Mode - Show player's team vs next opponent (show team immediately, opponent when games load)
              selectedTeam && selectedTeam !== 'N/A' ? (
                <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2 py-1 sm:px-4 sm:py-2 min-w-0">
                  {/* Team Logos */}
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    {/* Player Team */}
                    <div className="flex items-center gap-1 min-w-0">
                      <img 
                        src={selectedTeamLogoUrl || getEspnLogoUrl(selectedTeam)}
                        alt={selectedTeam}
                        className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(selectedTeam);
                          const next = selectedTeamLogoAttempt + 1;
                          if (next < candidates.length) {
                            setSelectedTeamLogoAttempt(next);
                            setSelectedTeamLogoUrl(candidates[next]);
                          } else {
                            e.currentTarget.onerror = null;
                          }
                        }}
                      />
                      <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{selectedTeam}</span>
                    </div>
                    
                    {/* VS */}
                    <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                    
                    {/* Next Game Opponent (or placeholder until games load) */}
                    <div className="flex items-center gap-1 min-w-0">
                      {(nextGameOpponent || opponentTeam) && (nextGameOpponent || opponentTeam) !== '' && (nextGameOpponent || opponentTeam) !== 'N/A' ? (
                        <>
                          <img 
                            src={getEspnLogoUrl(nextGameOpponent || opponentTeam || '')}
                            alt={nextGameOpponent || opponentTeam || ''}
                            className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                            onError={(e) => {
                              const opp = nextGameOpponent || opponentTeam || '';
                              const candidates = getEspnLogoCandidates(opp);
                              const next = opponentTeamLogoAttempt + 1;
                              if (next < candidates.length) {
                                setOpponentTeamLogoAttempt(next);
                                e.currentTarget.src = candidates[next];
                              } else {
                                e.currentTarget.onerror = null;
                              }
                            }}
                          />
                          <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{nextGameOpponent || opponentTeam}</span>
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm truncate">—</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Countdown to Tipoff - On the side */}
                  {countdown && !isGameInProgress ? (
                    <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                      <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Tipoff in</div>
                      <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                      </div>
                    </div>
                  ) : isGameInProgress ? (
                    <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                      <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">LIVE</div>
                    </div>
                  ) : nextGameTipoff ? (
                    <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                      <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Game time passed</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                  <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Player</span>
                </div>
              )
            ) : (
              // Game Props Mode - Show selected team vs opponent or prompt
              gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam ? (
                <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-2.5 py-1.5 sm:px-4 sm:py-2 min-w-0">
                  {/* Team Logos */}
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    {/* Selected Team */}
                    <div className="flex items-center gap-1 min-w-0">
                      <img 
                        src={selectedTeamLogoUrl || getEspnLogoUrl(gamePropsTeam)}
                        alt={gamePropsTeam}
                        className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(gamePropsTeam);
                          const next = selectedTeamLogoAttempt + 1;
                          if (next < candidates.length) {
                            setSelectedTeamLogoAttempt(next);
                            setSelectedTeamLogoUrl(candidates[next]);
                          } else {
                            e.currentTarget.onerror = null;
                          }
                        }}
                      />
                      <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{gamePropsTeam}</span>
                    </div>
                    
                    {/* VS */}
                    <span className="text-gray-500 dark:text-gray-400 font-medium text-[10px] sm:text-xs flex-shrink-0">VS</span>
                    
                    {/* Opponent Team */}
                    <div className="flex items-center gap-1 min-w-0">
                      <img 
                        src={opponentTeamLogoUrl || getEspnLogoUrl(opponentTeam)}
                        alt={opponentTeam}
                        className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(opponentTeam);
                          const next = opponentTeamLogoAttempt + 1;
                          if (next < candidates.length) {
                            setOpponentTeamLogoAttempt(next);
                            setOpponentTeamLogoUrl(candidates[next]);
                          } else {
                            e.currentTarget.onerror = null;
                          }
                        }}
                      />
                      <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{opponentTeam}</span>
                    </div>
                  </div>
                  
                  {/* Countdown to Tipoff - On the side */}
                  {countdown && !isGameInProgress ? (
                    <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                      <div className="text-[9px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap">Tipoff in</div>
                      <div className="text-xs font-mono font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                        {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
                      </div>
                    </div>
                  ) : isGameInProgress ? (
                    <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                      <div className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">LIVE</div>
                    </div>
                  ) : nextGameTipoff ? (
                    <div className="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 flex-shrink-0">
                      <div className="text-[9px] text-gray-500 dark:text-gray-400 whitespace-nowrap">Game time passed</div>
                    </div>
                  ) : null}
                </div>
              ) : gamePropsTeam && gamePropsTeam !== 'N/A' ? (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                  <img 
                    src={getEspnLogoUrl(gamePropsTeam)}
                    alt={gamePropsTeam}
                    className="w-8 h-8 object-contain"
                  />
                  <span className="font-bold text-gray-900 dark:text-white text-sm">{gamePropsTeam}</span>
                  <span className="text-gray-500 dark:text-gray-400 text-xs">No Game Today</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#0a1929] rounded-lg px-4 py-2">
                  <span className="text-gray-400 dark:text-gray-500 text-sm font-medium">Select Team</span>
                </div>
              )
            )}
          </div>
        </div>
        
        {/* Journal Button - Show for both Player Props and Game Props modes */}
        {((propsMode === 'player' && selectedPlayer && nextGameOpponent && nextGameOpponent !== '' && nextGameOpponent !== 'N/A') ||
          (propsMode === 'team' && gamePropsTeam && gamePropsTeam !== 'N/A' && opponentTeam && opponentTeam !== '')) && (
          <div className="flex gap-2 px-0">
            <button
              onClick={() => {
                if (!hasPremium) {
                  router.push('/subscription');
                  return;
                }
                if (!isGameInProgress) {
                  setShowJournalModal(true);
                }
              }}
              disabled={isGameInProgress || !hasPremium}
              className={`flex-1 px-2 py-1.5 text-white text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                isGameInProgress || !hasPremium
                  ? 'bg-gray-400 cursor-not-allowed opacity-50' 
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
              title={
                !hasPremium 
                  ? 'Journal is a Pro feature' 
                  : isGameInProgress 
                  ? 'Game in progress - journal disabled' 
                  : 'Add to journal'
              }
            >
              {!hasPremium ? (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
              Journal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

