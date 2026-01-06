'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { TEAM_FULL_NAMES, getEspnLogoUrl, getEspnLogoCandidates } from '../utils/teamUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getOpponentTeam } from '../utils/teamAnalysisUtils';
import { HeaderInfo } from '../utils/headerInfoUtils';
import { BdlSearchResult } from '../types';
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
}: DashboardHeaderProps) {
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative z-[60] bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 h-auto sm:h-36 md:h-40 w-full min-w-0 flex-shrink-0 mr-1 sm:mr-2 md:mr-3 overflow-visible">
      <div className="flex flex-col h-full gap-2 lg:gap-3">
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
                      // Clear dashboard session storage before navigating
                      try {
                        sessionStorage.removeItem('nba_dashboard_session_v1');
                        sessionStorage.removeItem('last_prop_click');
                        sessionStorage.removeItem('last_prop_url');
                      } catch (e) {
                        // Ignore errors
                      }
                      
                      // Use native browser back for instant navigation (same as browser back button)
                      window.history.back();
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

          {/* Dynamic Search - Player or Team based on props mode */}
          <div className="flex-1 mx-2 sm:mx-6 md:mx-8 min-w-0">
            <div className="relative z-[70]" ref={searchRef}>
              {/* Desktop/Tablet input */}
              <div className="hidden sm:block">
                <input
                  type="text"
                  placeholder={
                    propsMode === 'player' 
                      ? (isPro ? (searchBusy ? "Searching..." : "Search for a player...") : "Upgrade to Pro to search players")
                      : "Search for a team..."
                  }
                  value={searchQuery}
                  onChange={(e) => {
                    // Block player search for non-Pro users
                    if (propsMode === 'player' && !isPro) {
                      e.target.blur();
                      return;
                    }
                    setSearchQuery(e.target.value);
                    if (propsMode === 'player') {
                      setShowDropdown(true);
                    }
                  }}
                  onFocus={(e) => {
                    // Block player search for non-Pro users
                    if (propsMode === 'player' && !isPro) {
                      e.target.blur();
                      if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                        router.push('/subscription');
                      }
                      return;
                    }
                    if (propsMode === 'player') setShowDropdown(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && propsMode === 'team') {
                      const query = searchQuery.toLowerCase();
                      if (query.length >= 2) {
                        let foundTeam = '';
                        if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) {
                          foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                        }
                        if (!foundTeam) {
                          const matchingEntry = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => fullName.toLowerCase().includes(query));
                          if (matchingEntry) foundTeam = matchingEntry[0];
                        }
                        const nicknames: Record<string, string> = { 'lakers': 'LAL','warriors':'GSW','celtics':'BOS','heat':'MIA','bulls':'CHI','knicks':'NYK','nets':'BKN','sixers':'PHI','76ers':'PHI','mavs':'DAL','spurs':'SAS','rockets':'HOU' };
                        if (!foundTeam && nicknames[query]) foundTeam = nicknames[query];
                        if (foundTeam) {
                          setGamePropsTeam(foundTeam);
                          setSelectedStat('total_pts');
                          const opponent = getOpponentTeam(foundTeam, todaysGames);
                          setOpponentTeam(normalizeAbbr(opponent));
                          setSearchQuery('');
                        }
                      }
                    }
                  }}
                  className="w-full px-4 py-2 bg-gray-50 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              {/* Mobile icon button */}
              <div className="sm:hidden flex justify-end">
                <button onClick={() => {
                  if (propsMode === 'player' && !isPro) {
                    if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                      router.push('/subscription');
                    }
                    return;
                  }
                  setIsMobileSearchOpen(true);
                }} className="p-2 rounded-lg bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z"/></svg>
                </button>
              </div>
              {/* Mobile search overlay */}
              {isMobileSearchOpen && (
                <>
                  {/* Backdrop */}
                  <div 
                    className="sm:hidden fixed inset-0 bg-black/20 z-[99]" 
                    onClick={() => setIsMobileSearchOpen(false)}
                  />
                  {/* Search panel */}
                  <div className="sm:hidden fixed left-0 right-0 top-0 bg-white dark:bg-[#0a1929] border-t border-gray-300 dark:border-gray-600 shadow-2xl z-[100] max-h-[78vh] overflow-y-auto pl-3 pr-5 rounded-b-lg">
                  <div className="pt-16">
                  <div className="flex items-end gap-2 pt-4 pb-4 border-b border-gray-300 dark:border-gray-700">
                    <input
                      autoFocus={propsMode !== 'player' || isPro}
                      type="text"
                      placeholder={propsMode === 'player' ? (isPro ? 'Search for a player...' : 'Upgrade to Pro') : 'Search for a team...'}
                      value={searchQuery}
                      onChange={(e) => {
                        if (propsMode === 'player' && !isPro) {
                          return;
                        }
                        setSearchQuery(e.target.value);
                        if (propsMode === 'player') setShowDropdown(true);
                      }}
                      onFocus={(e) => {
                        if (propsMode === 'player' && !isPro) {
                          e.target.blur();
                          setIsMobileSearchOpen(false);
                          if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                            router.push('/subscription');
                          }
                          return;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && propsMode === 'team') {
                          const query = searchQuery.toLowerCase();
                          if (query.length >= 2) {
                            let foundTeam = '';
                            if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                            if (!foundTeam) {
                              const m = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => fullName.toLowerCase().includes(query));
                              if (m) foundTeam = m[0];
                            }
                            const nick: Record<string,string> = { 'lakers':'LAL','warriors':'GSW','celtics':'BOS','heat':'MIA','bulls':'CHI','knicks':'NYK','nets':'BKN','sixers':'PHI','76ers':'PHI','mavs':'DAL','spurs':'SAS','rockets':'HOU' };
                            if (!foundTeam && nick[query]) foundTeam = nick[query];
                            if (foundTeam) {
                              setGamePropsTeam(foundTeam);
                              setSelectedStat('total_pts');
                              const opponent = getOpponentTeam(foundTeam, todaysGames);
                              setOpponentTeam(normalizeAbbr(opponent));
                              setSearchQuery('');
                              setIsMobileSearchOpen(false);
                            }
                          }
                        }
                      }}
                      className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <button onClick={() => setIsMobileSearchOpen(false)} className="p-1.5 rounded bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  </div>
                  
                  {/* Search results */}
                  <div className="pb-4">
                    {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                      const query = searchQuery.toLowerCase();
                      const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                      
                      Object.entries(TEAM_FULL_NAMES).forEach(([abbr, fullName]) => {
                        if (abbr.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                          matchingTeams.push({ abbr, fullName });
                        }
                      });
                      
                      const nicknames: Record<string, string> = {
                        'lakers': 'LAL', 'warriors': 'GSW', 'celtics': 'BOS', 'heat': 'MIA',
                        'bulls': 'CHI', 'knicks': 'NYK', 'nets': 'BKN', 'sixers': 'PHI',
                        '76ers': 'PHI', 'mavs': 'DAL', 'spurs': 'SAS', 'rockets': 'HOU'
                      };
                      
                      if (nicknames[query] && !matchingTeams.find(t => t.abbr === nicknames[query])) {
                        const abbr = nicknames[query];
                        matchingTeams.push({ abbr, fullName: TEAM_FULL_NAMES[abbr] || abbr });
                      }
                      
                      return matchingTeams.length > 0 ? (
                        <>
                          {matchingTeams.slice(0, 10).map((team) => (
                            <button
                              key={team.abbr}
                              onClick={() => {
                                setGamePropsTeam(team.abbr);
                                setSelectedStat('total_pts');
                                const opponent = getOpponentTeam(team.abbr, todaysGames);
                                setOpponentTeam(normalizeAbbr(opponent));
                                setSearchQuery('');
                                setIsMobileSearchOpen(false);
                              }}
                              className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                            >
                              <div className="font-medium text-gray-900 dark:text-white">{team.fullName}</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">{team.abbr}</div>
                            </button>
                          ))}
                        </>
                      ) : null;
                    })()}
                    
                    {propsMode === 'player' && isPro && searchQuery && (
                      <>
                        {searchResults.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                          </div>
                        ) : searchResults.map((r) => (
                          <button
                            key={`${r.id}-${r.full}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log('🔍 Mobile search result clicked (first):', r, 'isPro:', isPro);
                              if (!isPro) {
                                if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                                  router.push('/subscription');
                                }
                                return;
                              }
                              console.log('✅ Calling handlePlayerSelectFromSearch for:', r.full);
                              handlePlayerSelectFromSearch(r).catch(err => {
                                console.error('Error in handlePlayerSelectFromSearch:', err);
                              });
                              setSearchQuery('');
                              setIsMobileSearchOpen(false);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {r.headshotUrl && (
                                <div className="w-10 h-10 rounded-full object-cover flex-shrink-0 overflow-hidden relative">
                                  <Image 
                                    src={r.headshotUrl} 
                                    alt={r.full}
                                    width={40}
                                    height={40}
                                    className="object-cover"
                                    loading="lazy"
                                    unoptimized={false}
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                  {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  </div>
                </>
              )}
              {/* Player search dropdown - only show in player mode and for Pro users (Desktop only) */}
              {propsMode === 'player' && isPro && showDropdown && searchQuery && (
                <div className="hidden sm:block absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[80] max-h-72 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                    </div>
                  ) : searchResults.map((r) => (
                    <button
                      key={`${r.id}-${r.full}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('🔍 Desktop search result clicked:', r, 'isPro:', isPro);
                        // Extra check: ensure Pro access before player selection
                        if (!isPro) {
                          if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                            router.push('/subscription');
                          }
                          return;
                        }
                        console.log('✅ Calling handlePlayerSelectFromSearch for:', r.full);
                        handlePlayerSelectFromSearch(r).catch(err => {
                          console.error('Error in handlePlayerSelectFromSearch:', err);
                        });
                        setSearchQuery('');
                        setShowDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {r.headshotUrl && (
                            <img 
                              src={r.headshotUrl} 
                              alt={r.full}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
                            </div>
                          </div>
                        </div>
                        {/* ID hidden intentionally */}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Team search dropdown - only show in game props mode (Desktop only) */}
              {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                const query = searchQuery.toLowerCase();
                const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                
                // Find matching teams (memo-optimized)
                Object.entries(TEAM_FULL_NAMES).forEach(([abbr, fullName]) => {
                  if (abbr.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                    matchingTeams.push({ abbr, fullName });
                  }
                });
                
                // Check nicknames
                const nicknames: Record<string, string> = {
                  'lakers': 'LAL', 'warriors': 'GSW', 'celtics': 'BOS', 'heat': 'MIA',
                  'bulls': 'CHI', 'knicks': 'NYK', 'nets': 'BKN', 'sixers': 'PHI',
                  '76ers': 'PHI', 'mavs': 'DAL', 'spurs': 'SAS', 'rockets': 'HOU'
                };
                
                // Add nickname match if not already present
                const nicknameMatch = nicknames[query];
                if (nicknameMatch && !matchingTeams.some(t => t.abbr === nicknameMatch)) {
                  matchingTeams.unshift({ abbr: nicknameMatch, fullName: TEAM_FULL_NAMES[nicknameMatch] || nicknameMatch });
                }
                
                return matchingTeams.length > 0 ? (
                  <div className="hidden sm:block absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[100] max-h-72 overflow-y-auto">
                    {matchingTeams.slice(0, 10).map((team) => ( // Limit to 10 results
                      <button
                        key={team.abbr}
                        onClick={() => {
                          console.log(`%c🏀 === TEAM SELECTION HANDLER ===%c`, 'color: #9b59b6; font-weight: bold; font-size: 14px', '');
                          console.log(`%cSelected Team: %c${team.abbr}`, 'color: #555', 'color: #e74c3c; font-weight: bold; font-size: 14px');
                          console.log(`%cTeam Full Name: %c${team.fullName}`, 'color: #555', 'color: #3498db; font-weight: bold');
                          console.log(`%cGames available: %c${todaysGames.length}`, 'color: #555', 'color: #f39c12; font-weight: bold');
                          
                          setGamePropsTeam(team.abbr);
                          setSelectedStat('total_pts');
                          
                          const opponent = getOpponentTeam(team.abbr, todaysGames);
                          console.log(`%cOpponent Detection Result: %c"${opponent}"`, 'color: #555', 'color: #27ae60; font-weight: bold; font-size: 14px');
                          
                          const normalized = normalizeAbbr(opponent);
                          console.log(`%cNormalized opponent: %c"${normalized}"`, 'color: #555', 'color: #27ae60; font-weight: bold; font-size: 14px');
                          
                          setOpponentTeam(normalized);
                          console.log(`%c✅ State Updated%c - gamePropsTeam: ${team.abbr}, opponentTeam: ${normalized}`, 'color: #27ae60; font-weight: bold', 'color: #000');
                          console.log(`%c🏀 === HANDLER END ===%c\n`, 'color: #9b59b6; font-weight: bold; font-size: 14px', '');
                          
                          setSearchQuery('');
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">{team.fullName}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{team.abbr}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
          </div>

          {/* Team vs Team Display - Desktop only - Aligned with name */}
          <div className="hidden lg:flex flex-shrink-0 items-end">
            {propsMode === 'player' ? (
              // Player Props Mode - Show player's team vs NEXT GAME opponent (not chart filter)
              selectedTeam && nextGameOpponent && selectedTeam !== 'N/A' && nextGameOpponent !== '' ? (
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
                  
                  {/* Next Game Opponent */}
                  <div className="flex items-center gap-1.5">
                    <img 
                      src={getEspnLogoUrl(nextGameOpponent)}
                      alt={nextGameOpponent}
                      className="w-8 h-8 object-contain flex-shrink-0"
                      onError={(e) => {
                        const candidates = getEspnLogoCandidates(nextGameOpponent);
                        const next = opponentTeamLogoAttempt + 1;
                        if (next < candidates.length) {
                          setOpponentTeamLogoAttempt(next);
                          e.currentTarget.src = candidates[next];
                        } else {
                          e.currentTarget.onerror = null;
                        }
                      }}
                    />
                    <span className="font-bold text-gray-900 dark:text-white text-sm">{nextGameOpponent}</span>
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
                      // Clear dashboard session storage before navigating
                      try {
                        sessionStorage.removeItem('nba_dashboard_session_v1');
                        sessionStorage.removeItem('last_prop_click');
                        sessionStorage.removeItem('last_prop_url');
                      } catch (e) {
                        // Ignore errors
                      }
                      
                      // Use native browser back for instant navigation (same as browser back button)
                      window.history.back();
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

          {/* Dynamic Search - Player or Team based on props mode - Aligned with name */}
          <div className="flex-shrink-0 ml-4">
            <div className="relative z-[70]" ref={searchRef}>
              {/* Mobile icon button */}
              <div className="flex justify-end">
                <button onClick={() => {
                  if (propsMode === 'player' && !isPro) {
                    if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                      router.push('/subscription');
                    }
                    return;
                  }
                  setIsMobileSearchOpen(true);
                }} className="p-2 rounded-lg bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z"/></svg>
                </button>
              </div>
              {/* Mobile search overlay - same as before */}
              {isMobileSearchOpen && (
                <>
                  {/* Backdrop */}
                  <div 
                    className="fixed inset-0 bg-black/20 z-[99]" 
                    onClick={() => setIsMobileSearchOpen(false)}
                  />
                  {/* Search panel */}
                  <div className="fixed left-0 right-0 top-0 bg-white dark:bg-[#0a1929] border-t border-gray-300 dark:border-gray-600 shadow-2xl z-[100] max-h-[78vh] overflow-y-auto pl-3 pr-5 rounded-b-lg">
                  <div className="pt-16">
                  <div className="flex items-end gap-2 pt-4 pb-4 border-b border-gray-300 dark:border-gray-700">
                    <input
                      autoFocus={propsMode !== 'player' || isPro}
                      type="text"
                      placeholder={propsMode === 'player' ? (isPro ? 'Search player...' : 'Upgrade to Pro') : 'Search team...'}
                      value={searchQuery}
                      onChange={(e) => {
                        if (propsMode === 'player' && !isPro) {
                          return;
                        }
                        setSearchQuery(e.target.value);
                        if (propsMode === 'player') setShowDropdown(true);
                      }}
                      onFocus={(e) => {
                        if (propsMode === 'player' && !isPro) {
                          e.target.blur();
                          setIsMobileSearchOpen(false);
                          if (window.confirm('Player Props search is a Pro feature. Would you like to upgrade?')) {
                            router.push('/subscription');
                          }
                          return;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && propsMode === 'team') {
                          const query = searchQuery.toLowerCase();
                          if (query.length >= 2) {
                            let foundTeam = '';
                            if (Object.keys(TEAM_FULL_NAMES).some(abbr => abbr.toLowerCase().includes(query))) foundTeam = Object.keys(TEAM_FULL_NAMES).find(abbr => abbr.toLowerCase().includes(query)) || '';
                            if (!foundTeam) {
                              const m = Object.entries(TEAM_FULL_NAMES).find(([abbr, fullName]) => fullName.toLowerCase().includes(query));
                              if (m) foundTeam = m[0];
                            }
                            const nick: Record<string,string> = { 'lakers':'LAL','warriors':'GSW','celtics':'BOS','heat':'MIA','bulls':'CHI','knicks':'NYK','nets':'BKN','sixers':'PHI','76ers':'PHI','mavs':'DAL','spurs':'SAS','rockets':'HOU' };
                            if (!foundTeam && nick[query]) foundTeam = nick[query];
                            if (foundTeam) {
                              setGamePropsTeam(foundTeam);
                              setSelectedStat('total_pts');
                              const opponent = getOpponentTeam(foundTeam, todaysGames);
                              setOpponentTeam(normalizeAbbr(opponent));
                              setSearchQuery('');
                              setIsMobileSearchOpen(false);
                            }
                          }
                        }
                      }}
                      className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                    <button onClick={() => setIsMobileSearchOpen(false)} className="p-1.5 rounded bg-gray-100 dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  
                  {/* Search results - same as before */}
                  <div className="pb-4">
                    {propsMode === 'team' && searchQuery && searchQuery.length >= 2 && (() => {
                      const query = searchQuery.toLowerCase();
                      const matchingTeams: Array<{ abbr: string; fullName: string }> = [];
                      
                      Object.entries(TEAM_FULL_NAMES).forEach(([abbr, fullName]) => {
                        if (abbr.toLowerCase().includes(query) || fullName.toLowerCase().includes(query)) {
                          matchingTeams.push({ abbr, fullName });
                        }
                      });
                      
                      const nicknames: Record<string, string> = {
                        'lakers': 'LAL', 'warriors': 'GSW', 'celtics': 'BOS', 'heat': 'MIA',
                        'bulls': 'CHI', 'knicks': 'NYK', 'nets': 'BKN', 'sixers': 'PHI',
                        '76ers': 'PHI', 'mavs': 'DAL', 'spurs': 'SAS', 'rockets': 'HOU'
                      };
                      
                      if (nicknames[query] && !matchingTeams.find(t => t.abbr === nicknames[query])) {
                        const abbr = nicknames[query];
                        matchingTeams.push({ abbr, fullName: TEAM_FULL_NAMES[abbr] || abbr });
                      }
                      
                      return matchingTeams.length > 0 ? (
                        <>
                          {matchingTeams.slice(0, 10).map((team) => (
                            <button
                              key={team.abbr}
                              onClick={() => {
                                setGamePropsTeam(team.abbr);
                                setSelectedStat('total_pts');
                                const opponent = getOpponentTeam(team.abbr, todaysGames);
                                setOpponentTeam(normalizeAbbr(opponent));
                                setSearchQuery('');
                                setIsMobileSearchOpen(false);
                              }}
                              className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                            >
                              <div className="font-medium text-gray-900 dark:text-white">{team.fullName}</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">{team.abbr}</div>
                            </button>
                          ))}
                        </>
                      ) : null;
                    })()}
                    
                    {propsMode === 'player' && isPro && searchQuery && (
                      <>
                        {searchResults.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {searchBusy ? "Searching..." : (searchError ? `Search error: ${searchError}` : `No players found for "${searchQuery}"`)}
                          </div>
                        ) : searchResults.map((r) => (
                          <button
                            key={`${r.id}-${r.full}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log('🔍 Mobile search result clicked (second):', r, 'isPro:', isPro);
                              if (!isPro) {
                                if (window.confirm('Player Props is a Pro feature. Would you like to upgrade?')) {
                                  router.push('/subscription');
                                }
                                return;
                              }
                              console.log('✅ Calling handlePlayerSelectFromSearch for:', r.full);
                              handlePlayerSelectFromSearch(r).catch(err => {
                                console.error('Error in handlePlayerSelectFromSearch:', err);
                              });
                              setSearchQuery('');
                              setIsMobileSearchOpen(false);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-600 last:border-b-0 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {r.headshotUrl && (
                                <img 
                                  src={r.headshotUrl} 
                                  alt={r.full}
                                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-white">{r.full}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                  {r.team || '—'} {r.pos ? `• ${r.pos}` : ''}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  </div>
                  </div>
                </>
              )}
            </div>
          </div>
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
              // Player Props Mode - Show player's team vs NEXT GAME opponent (not chart filter)
              selectedTeam && nextGameOpponent && selectedTeam !== 'N/A' && nextGameOpponent !== '' ? (
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
                    
                    {/* Next Game Opponent */}
                    <div className="flex items-center gap-1 min-w-0">
                      <img 
                        src={getEspnLogoUrl(nextGameOpponent)}
                        alt={nextGameOpponent}
                        className="w-6 h-6 sm:w-8 sm:h-8 object-contain flex-shrink-0"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(nextGameOpponent);
                          const next = opponentTeamLogoAttempt + 1;
                          if (next < candidates.length) {
                            setOpponentTeamLogoAttempt(next);
                            e.currentTarget.src = candidates[next];
                          } else {
                            e.currentTarget.onerror = null;
                          }
                        }}
                      />
                      <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm truncate">{nextGameOpponent}</span>
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

