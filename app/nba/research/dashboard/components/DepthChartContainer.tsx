'use client';

import { useState, useEffect, memo } from 'react';
import { getTeamLogoUrl } from '@/lib/nbaLogos';

interface DepthChartData {
  PG: any[];
  SG: any[];
  SF: any[];
  PF: any[];
  C: any[];
}

interface DepthChartContainerProps {
  selectedTeam: string;
  teamInjuries: Record<string, any[]>;
  isDark: boolean;
  onPlayerSelect?: (playerName: string) => void;
  selectedPlayerName?: string;
  opponentTeam?: string;
  originalPlayerTeam?: string;
  onTeamSwap?: (team: string) => void;
  // Preloaded roster data for instant swapping
  playerTeamRoster?: DepthChartData | null;
  opponentTeamRoster?: DepthChartData | null;
  rostersLoading?: {player: boolean, opponent: boolean};
}

const DepthChartContainer = memo(function DepthChartContainer({
  selectedTeam,
  teamInjuries,
  isDark,
  onPlayerSelect,
  selectedPlayerName,
  opponentTeam,
  originalPlayerTeam,
  onTeamSwap,
  playerTeamRoster,
  opponentTeamRoster,
  rostersLoading
}: DepthChartContainerProps) {
  const [depthChart, setDepthChart] = useState<DepthChartData | null>(null);
  const [depthLoading, setDepthLoading] = useState<boolean>(false);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [showLineups, setShowLineups] = useState<boolean>(false);
  const [startingLineup, setStartingLineup] = useState<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }> | null>(null);
  const [opponentLineup, setOpponentLineup] = useState<Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }> | null>(null);
  const [lineupLoading, setLineupLoading] = useState<boolean>(false);
  const [lineupAvailable, setLineupAvailable] = useState<boolean>(false); // Track if lineup is available in cache (server-side check)

  // Helper to decode HTML entities in text
  const decodeHtmlEntities = (text: string): string => {
    if (!text) return text;
    
    // Handle common HTML entities manually
    return text
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x2F;/g, '/')
      .replace(/&#x5C;/g, '\\')
      .replace(/&#x60;/g, '`')
      .replace(/&#x3D;/g, '=');
  };

  // Create depth chart layout - use real data if available, properly mapped
  const createDepthChart = (realDepthChartData: DepthChartData | null) => {
    // If we have real scraped depth chart data, use it
    if (realDepthChartData) {
      // Removed console.log to prevent spam during re-renders
      // The API already returns properly ordered arrays - use them exactly as-is
      const mappedDepthChart: Record<string, any[]> = {
        PG: [],
        SG: [],
        SF: [],
        PF: [],
        C: []
      };
      
      // Process each position, preserving exact API order
      const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
      positions.forEach(position => {
        const positionPlayers = realDepthChartData[position as keyof DepthChartData];
        if (positionPlayers && Array.isArray(positionPlayers)) {
          // Use the exact order from the API - do not reorder or modify
          mappedDepthChart[position] = positionPlayers.map((depthPlayer: any, index: number) => ({
            name: depthPlayer.name,
            depth: index + 1, // Depth based on API order
            jersey: depthPlayer.jersey || 'N/A',
            headshot: depthPlayer.headshot || null,
            // Include all original data
            ...depthPlayer
          }));
        }
      });
      
      return mappedDepthChart;
    }
    
    // No real depth chart available
    // Removed console.log to prevent spam during re-renders
    return null;
  };

  // Removed hasGameToday check - we now rely on cache availability check instead
  
  // Clear all state when team changes (new player selected)
  useEffect(() => {
    // Reset all lineup-related state
    setShowLineups(false);
    setStartingLineup(null);
    setOpponentLineup(null);
    setLineupLoading(false);
    setLineupAvailable(false);
    
    // Reset depth chart state
    setDepthChart(null);
    setDepthLoading(false);
    setDepthError(null);
  }, [selectedTeam]);
  
  // Check if lineup is available in cache (server-side check) - runs on team change
  // Also check if team has a game today/tomorrow to show button even if cache is empty
  useEffect(() => {
    if (!selectedTeam || selectedTeam === 'N/A') {
      setLineupAvailable(false);
      setStartingLineup(null);
      return;
    }
    
    // Check cache availability server-side
    const checkLineupAvailability = async () => {
      try {
        const response = await fetch(`/api/dvp/get-todays-lineup?team=${selectedTeam}`);
        const data = await response.json();
        
        // Only set available if we have a valid lineup (5 players)
        if (data.lineup && Array.isArray(data.lineup) && data.lineup.length === 5) {
          setLineupAvailable(true);
          // Pre-load the lineup so it's ready when user clicks "Show Lineups"
          setStartingLineup(data.lineup);
        } else {
          // No cache - check if team has a game today/tomorrow
          // If so, show button and it will trigger a one-time server-side fetch when clicked
          const now = new Date();
          const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const todayStr = `${easternTime.getFullYear()}-${String(easternTime.getMonth() + 1).padStart(2, '0')}-${String(easternTime.getDate()).padStart(2, '0')}`;
          
          const tomorrow = new Date(easternTime);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
          
          // Check if team has a game today or tomorrow
          const gamesResponse = await fetch(`/api/bdl/games?start_date=${todayStr}&end_date=${tomorrowStr}&per_page=100`);
          const gamesData = await gamesResponse.json();
          
          // BDL API returns 'data' array, not 'games'
          const gamesArray = gamesData.data || gamesData.games || [];
          
          if (Array.isArray(gamesArray) && gamesArray.length > 0) {
            const teamUpper = selectedTeam.toUpperCase();
            const hasGame = gamesArray.some((game: any) => {
              const homeTeam = game.home_team?.abbreviation?.toUpperCase();
              const awayTeam = game.visitor_team?.abbreviation?.toUpperCase();
              const matches = homeTeam === teamUpper || awayTeam === teamUpper;
              if (matches) {
                console.log(`[DepthChart] ✅ Found game for ${selectedTeam}: ${awayTeam} @ ${homeTeam} on ${game.date}`);
              }
              return matches;
            });
            
            console.log(`[DepthChart] Team ${selectedTeam} has game today/tomorrow: ${hasGame}`);
            // Show button if team has a game (even if cache is empty)
            setLineupAvailable(hasGame);
            
            // Pre-fetch lineup in background if game exists but cache is empty
            if (hasGame) {
              // Trigger background fetch immediately (don't wait for button click)
              fetch(`/api/dvp/get-todays-lineup?team=${selectedTeam}&fetchIfMissing=true`).catch(err => {
                console.error('[DepthChart] Background fetch error:', err);
              });
            }
          } else {
            console.log(`[DepthChart] No games data returned for ${selectedTeam}`);
            setLineupAvailable(false);
          }
          setStartingLineup(null);
        }
      } catch (error: any) {
        // Silently fail - don't show errors to users
        console.error('[DepthChart] Failed to check lineup availability:', error);
        setLineupAvailable(false);
        setStartingLineup(null);
      }
    };
    
    checkLineupAvailability();
  }, [selectedTeam]);
  
  // Fetch starting lineups from cache when showLineups is enabled
  useEffect(() => {
    // Only fetch if button is clicked and lineup should be available
    if (!showLineups || !selectedTeam || selectedTeam === 'N/A' || !lineupAvailable) {
      return;
    }
    
    // Get opponent team
    const playerTeam = originalPlayerTeam || 'N/A';
    const oppTeam = opponentTeam || 'N/A';
    const hasOpponent = oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam;
    
    // Fetch both lineups
    const fetchLineups = async () => {
      setLineupLoading(true);
      
      try {
        // Fetch selected team lineup
        let selectedTeamLineup = null;
        if (startingLineup && startingLineup.length === 5) {
          selectedTeamLineup = startingLineup;
        } else {
          try {
            const response = await fetch(`/api/dvp/get-todays-lineup?team=${selectedTeam}`);
            const data = await response.json();
            if (data.lineup && Array.isArray(data.lineup) && data.lineup.length === 5) {
              selectedTeamLineup = data.lineup;
              setStartingLineup(data.lineup);
            }
          } catch (error) {
            console.error(`[DepthChart] Failed to fetch ${selectedTeam} lineup:`, error);
          }
        }
        
        // Fetch opponent team lineup if available
        if (hasOpponent) {
          try {
            const oppResponse = await fetch(`/api/dvp/get-todays-lineup?team=${oppTeam}`);
            const oppData = await oppResponse.json();
            if (oppData.lineup && Array.isArray(oppData.lineup) && oppData.lineup.length === 5) {
              setOpponentLineup(oppData.lineup);
            } else {
              setOpponentLineup(null);
            }
          } catch (error) {
            console.error(`[DepthChart] Failed to fetch ${oppTeam} lineup:`, error);
            setOpponentLineup(null);
          }
        } else {
          setOpponentLineup(null);
        }
        
        // If selected team lineup not in cache, poll for it
        if (!selectedTeamLineup) {
          let attempts = 0;
          const maxAttempts = 10;
          
          while (attempts < maxAttempts) {
            try {
              const pollResponse = await fetch(`/api/dvp/get-todays-lineup?team=${selectedTeam}`);
              const pollData = await pollResponse.json();
              
              if (pollData.lineup && Array.isArray(pollData.lineup) && pollData.lineup.length === 5) {
                setStartingLineup(pollData.lineup);
                break;
              }
            } catch (error) {
              console.error(`[DepthChart] Polling attempt ${attempts + 1} failed:`, error);
            }
            
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          if (attempts >= maxAttempts) {
            setStartingLineup(null);
          }
        }
      } catch (error: any) {
        console.error('[DepthChart] Failed to fetch lineups:', error);
        setStartingLineup(null);
        setOpponentLineup(null);
      } finally {
        setLineupLoading(false);
      }
    };
    
    fetchLineups();
  }, [showLineups, selectedTeam, lineupAvailable, opponentTeam, originalPlayerTeam, startingLineup]);
  
  // Use preloaded data for instant switching - fallback to fetch if not available
  useEffect(() => {
    const playerTeam = originalPlayerTeam || 'N/A';
    const isShowingPlayerTeam = selectedTeam === playerTeam;
    
    setDepthError(null);
    
    if (!selectedTeam || selectedTeam === 'N/A') {
      setDepthChart(null);
      setDepthLoading(false);
      return;
    }
    
    // Show loading state immediately when team changes (refreshing action)
    setDepthLoading(true);
    
    // Use preloaded roster data for instant switching
    const preloadedRoster = isShowingPlayerTeam ? playerTeamRoster : opponentTeamRoster;
    const isLoading = isShowingPlayerTeam ? (rostersLoading?.player || false) : (rostersLoading?.opponent || false);
    
    if (preloadedRoster) {
      // Use preloaded data
      setDepthChart(preloadedRoster);
      setDepthLoading(false);
    } else if (!isLoading) {
      // No preloaded data and not currently loading - fetch it
      const fetchDepthChart = async () => {
        try {
          const response = await fetch(`/api/depth-chart?team=${selectedTeam}`);
          const data = await response.json();
          if (data.success && data.depthChart) {
            setDepthChart(data.depthChart);
          } else {
            setDepthError(data.error || 'Failed to load depth chart');
            setDepthChart(null);
          }
        } catch (error: any) {
          setDepthError(error.message || 'Failed to fetch depth chart');
          setDepthChart(null);
        } finally {
          setDepthLoading(false);
        }
      };
      fetchDepthChart();
    } else {
      // Currently loading preloaded data
      setDepthLoading(true);
      setDepthChart(null);
    }
  }, [selectedTeam, originalPlayerTeam, playerTeamRoster, opponentTeamRoster, rostersLoading]);

  const mappedDepthChart = createDepthChart(depthChart);
  
  if (!selectedTeam || selectedTeam === 'N/A') {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="text-sm text-gray-900 dark:text-white font-semibold mb-3">Depth Chart</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Select a player/team to load depth chart.</div>
      </div>
    );
  }

  if (depthLoading) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-900 dark:text-white font-semibold">Depth Chart</div>
          {lineupAvailable && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLineups(!showLineups)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  showLineups
                    ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                {showLineups ? 'Hide' : 'Show'} Lineups
              </button>
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading depth chart…</div>
      </div>
    );
  }

  if (depthError) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-900 dark:text-white font-semibold">Depth Chart</div>
          {lineupAvailable && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLineups(!showLineups)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  showLineups
                    ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                {showLineups ? 'Hide' : 'Show'} Lineups
              </button>
            </div>
          )}
        </div>
        <div className="text-xs text-red-500">{depthError}</div>
      </div>
    );
  }

  if (!mappedDepthChart) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-900 dark:text-white font-semibold">Depth Chart</div>
          {lineupAvailable && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLineups(!showLineups)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  showLineups
                    ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600'
                }`}
              >
                {showLineups ? 'Hide' : 'Show'} Lineups
              </button>
            </div>
          )}
        </div>
        <div className="text-center py-6 text-gray-500 dark:text-gray-400">
          <div className="text-sm font-bold mb-2">No Live Roster Available</div>
          <div className="text-xs">Unable to load current depth chart data from ESPN</div>
        </div>
      </div>
    );
  }

  const maxDepth = Math.max(
    mappedDepthChart.PG.length,
    mappedDepthChart.SG.length,
    mappedDepthChart.SF.length,
    mappedDepthChart.PF.length,
    mappedDepthChart.C.length
  );
  
  const positions = [
    { key: 'PG', label: 'POINT GUARD' },
    { key: 'SG', label: 'SHOOTING GUARD' },
    { key: 'SF', label: 'SMALL FORWARD' },
    { key: 'PF', label: 'POWER FORWARD' },
    { key: 'C', label: 'CENTER' }
  ];
  
  // Helper to check if a player is in the starting lineup
  const isInStartingLineup = (playerName: string, position: string): boolean => {
    if (!startingLineup || !showLineups) return false;
    
    const normalizeName = (name: string) => 
      name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
    
    const playerNorm = normalizeName(playerName);
    
    return startingLineup.some(starter => {
      const starterNorm = normalizeName(starter.name);
      return starterNorm === playerNorm && starter.position === position;
    });
  };
  
  // Determine if lineup is confirmed (all players verified) or predicted (any player projected)
  const isLineupConfirmed = startingLineup && startingLineup.length === 5
    ? startingLineup.every(player => player.isVerified)
    : false;
  
  return (
    <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-900 dark:text-white font-semibold">Depth Chart</div>
        
        {/* Lineups Button - Only show if lineup is available */}
        {lineupAvailable && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowLineups(!showLineups);
              }}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                showLineups
                  ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600'
              }`}
            >
              {showLineups ? 'Hide' : 'Show'} Lineups
            </button>
          </div>
        )}
      </div>
      
      {/* VS Table Lineups Display */}
      {showLineups && (
        <>
          {lineupLoading && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 text-center">Loading lineups...</div>
          )}
          
          {!lineupLoading && startingLineup && startingLineup.length === 5 && (() => {
            // Determine opponent lineup status
            const isOpponentLineupConfirmed = opponentLineup && opponentLineup.length === 5
              ? opponentLineup.every(player => player.isVerified)
              : false;
            
            return (
              <div className="mb-4">
                {/* VS Table */}
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full" style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 text-left border-r border-gray-200 dark:border-gray-700" style={{ width: '20%' }}>
                          Position
                        </th>
                        <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 text-left border-r border-gray-200 dark:border-gray-700" style={{ width: '40%' }}>
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center justify-center">
                              {getTeamLogoUrl(selectedTeam) ? (
                                <img 
                                  src={getTeamLogoUrl(selectedTeam)!} 
                                  alt={selectedTeam}
                                  className="w-10 h-10 object-contain"
                                  onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    img.style.display = 'none';
                                    const fallback = document.createElement('span');
                                    fallback.className = 'text-xs font-semibold';
                                    fallback.textContent = selectedTeam.toUpperCase();
                                    if (img.parentElement) {
                                      img.parentElement.appendChild(fallback);
                                    }
                                  }}
                                />
                              ) : (
                                <span className="text-xs font-semibold">{selectedTeam.toUpperCase()}</span>
                              )}
                            </div>
                            <div className={`text-[10px] ${isLineupConfirmed ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                              {isLineupConfirmed ? '✅ Confirmed' : '📋 Predicted'}
                            </div>
                          </div>
                        </th>
                        <th className="px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 text-left" style={{ width: '40%' }}>
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center justify-center">
                              {opponentTeam && opponentTeam !== 'N/A' && getTeamLogoUrl(opponentTeam) ? (
                                <img 
                                  src={getTeamLogoUrl(opponentTeam)!} 
                                  alt={opponentTeam}
                                  className="w-10 h-10 object-contain"
                                  onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    img.style.display = 'none';
                                    const fallback = document.createElement('span');
                                    fallback.className = 'text-xs font-semibold';
                                    fallback.textContent = opponentTeam.toUpperCase();
                                    if (img.parentElement) {
                                      img.parentElement.appendChild(fallback);
                                    }
                                  }}
                                />
                              ) : (
                                <span className="text-xs font-semibold">{opponentTeam && opponentTeam !== 'N/A' ? opponentTeam.toUpperCase() : 'OPPONENT'}</span>
                              )}
                            </div>
                            {opponentLineup && opponentLineup.length === 5 && (
                              <div className={`text-[10px] ${isOpponentLineupConfirmed ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                {isOpponentLineupConfirmed ? '✅ Confirmed' : '📋 Predicted'}
                              </div>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {['PG', 'SG', 'SF', 'PF', 'C'].map((position) => {
                        const selectedPlayer = startingLineup.find(p => p.position === position);
                        const opponentPlayer = opponentLineup?.find(p => p.position === position);
                        
                        return (
                          <tr key={position} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                            <td className="px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700" style={{ width: '20%' }}>
                              {position}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-900 dark:text-white border-r border-gray-200 dark:border-gray-700" style={{ width: '40%' }}>
                              {selectedPlayer ? (
                                <div className="flex items-center gap-1.5">
                                  <span>{selectedPlayer.name}</span>
                                  {selectedPlayer.isVerified && (
                                    <span className="text-green-600 dark:text-green-400" title="Verified">✓</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-900 dark:text-white" style={{ width: '40%' }}>
                              {opponentPlayer ? (
                                <div className="flex items-center gap-1.5">
                                  <span>{opponentPlayer.name}</span>
                                  {opponentPlayer.isVerified && (
                                    <span className="text-green-600 dark:text-green-400" title="Verified">✓</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          
          {!lineupLoading && (!startingLineup || startingLineup.length !== 5) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 text-center">
              Lineup data not available
            </div>
          )}
        </>
      )}
      
      {/* Team Swapper - Only show when lineups are hidden */}
      {!showLineups && selectedTeam && selectedTeam !== 'N/A' && (
        <div className="flex items-center justify-center gap-2 mb-3">
          {(() => {
            // Get the original player's team and opponent team
            const playerTeam = originalPlayerTeam || 'N/A';
            const oppTeam = opponentTeam || 'N/A';
            const hasOpponent = oppTeam && oppTeam !== 'N/A' && oppTeam !== playerTeam;
            
            if (!hasOpponent) {
              // Only one team available - show it as selected
              return (
                <button
                  className="px-3 py-1 rounded text-xs font-bold transition-colors bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600"
                >
                  {playerTeam.toUpperCase()}
                </button>
              );
            }
            
            // Team A (Player's Team) always on left, Team B (Opponent) always on right
            const teamA = playerTeam;
            const teamB = oppTeam;
            
            return (
              <>
                {/* Team A - Always on Left (Player's Team) */}
                <button
                  onClick={() => onTeamSwap?.(teamA)}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    selectedTeam === teamA
                      ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600 hover:opacity-80'
                  }`}
                >
                  {teamA.toUpperCase()}
                </button>
                
                <span className="text-slate-400 dark:text-slate-500 text-xs">vs</span>
                
                {/* Team B - Always on Right (Opponent Team) */}
                <button
                  onClick={() => onTeamSwap?.(teamB)}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    selectedTeam === teamB
                      ? 'bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-600'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600 hover:opacity-80'
                  }`}
                >
                  {teamB.toUpperCase()}
                </button>
              </>
            );
          })()} 
        </div>
      )}
      
      {/* Show depth chart only when lineups are hidden */}
      {!showLineups && (
        <div className="overflow-x-auto">
          <div className="min-w-full">
            {/* Depth Headers (top row) */}
          <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `120px repeat(${maxDepth}, minmax(100px, 1fr))` }}>
            <div></div> {/* Empty corner cell */}
            {Array.from({ length: maxDepth }, (_, index) => (
              <div key={index} className="text-center font-bold py-1 px-2 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                {index === 0 ? 'STARTER' : index === 1 ? '2ND' : index === 2 ? '3RD' : index === 3 ? '4TH' : `${index + 1}TH`}
              </div>
            ))}
          </div>
          
          {/* Position Rows */}
          {positions.map((position) => (
            <div key={position.key} className="grid gap-2 mb-2" style={{ gridTemplateColumns: `120px repeat(${maxDepth}, minmax(100px, 1fr))` }}>
              {/* Position Label */}
              <div className="flex items-center justify-center font-bold py-2 px-2 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                {position.key}
              </div>
              
              {/* Players for this position across depth */}
              {Array.from({ length: maxDepth }, (_, depthIndex) => {
                const player = mappedDepthChart[position.key][depthIndex];
                return (
                  <div key={depthIndex} className="flex justify-center">
                    {player ? (() => {
                      // Check if player is injured (robust name/jersey matching)
                      const playerInjuries = teamInjuries[selectedTeam] || [];

                      const normalizeName = (s: string) => {
                        return s
                          .toLowerCase()
                          .normalize('NFD')
                          .replace(/\p{Diacritic}/gu, '')
                          .replace(/[^a-z0-9\s]/g, '')
                          .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
                          .replace(/\s+/g, ' ')
                          .trim();
                      };

                      const playerNameNorm = normalizeName(player.name || '');
                      const playerLastNameNorm = playerNameNorm.split(' ').slice(-1)[0] || '';
                      const playerFirstInitial = playerNameNorm[0] || '';
                      const playerJersey = String(player.jersey || '').replace(/[^0-9]/g, '');

                      const injury = playerInjuries.find(inj => {
                        const injFull = `${inj.player?.first_name || ''} ${inj.player?.last_name || ''}`.trim();
                        const injNorm = normalizeName(injFull);
                        const injLast = normalizeName(inj.player?.last_name || '');
                        const injFirst = normalizeName(inj.player?.first_name || '');
                        const injFirstInitial = injFirst[0] || '';
                        const injJersey = String(inj.player?.jersey_number || '').replace(/[^0-9]/g, '');

                        // Exact normalized match
                        if (injNorm && injNorm === playerNameNorm) return true;
                        // First initial + last name match (e.g., "S Curry" vs "Stephen Curry")
                        if (injLast && playerLastNameNorm === injLast && playerFirstInitial && injFirstInitial && playerFirstInitial === injFirstInitial) return true;
                        // Last name + jersey match as fallback
                        if (injLast && playerLastNameNorm === injLast && playerJersey && injJersey && playerJersey === injJersey) return true;
                        return false;
                      });
                      
                      const getInjuryBadge = (status: string) => {
                        const lowerStatus = status.toLowerCase();
                        if (lowerStatus.includes('day-to-day') || lowerStatus.includes('day to day')) {
                          return { text: 'D2D', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' };
                        }
                        if (lowerStatus.includes('out')) {
                          return { text: 'OUT', color: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' };
                        }
                        if (lowerStatus.includes('doubtful')) {
                          return { text: 'DBT', color: 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400' };
                        }
                        if (lowerStatus.includes('questionable')) {
                          return { text: 'Q', color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-500 dark:text-orange-400' };
                        }
                        if (lowerStatus.includes('probable')) {
                          return { text: 'P', color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-500' };
                        }
                        return null;
                      };
                      
                      const injuryBadge = injury ? getInjuryBadge(injury.status) : null;
                      
                      // Check if this player is the selected player
                      const decodedPlayerName = decodeHtmlEntities(player.name);
                      const isSelected = selectedPlayerName && (
                        player.name.toLowerCase().includes(selectedPlayerName.toLowerCase()) ||
                        selectedPlayerName.toLowerCase().includes(player.name.toLowerCase()) ||
                        decodedPlayerName.toLowerCase().includes(selectedPlayerName.toLowerCase()) ||
                        selectedPlayerName.toLowerCase().includes(decodedPlayerName.toLowerCase())
                      );
                      
                      
                      const isStarter = isInStartingLineup(player.name, position.key);
                      
                      // Determine styling based on selection and starter status
                      let cardClasses = 'w-full p-2 text-center rounded border text-xs relative ';
                      if (isSelected) {
                        cardClasses += 'bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100 border-purple-300 dark:border-purple-600 ring-2 ring-purple-500 dark:ring-purple-400';
                      } else if (isStarter && showLineups) {
                        if (isLineupConfirmed) {
                          cardClasses += 'bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-300 border-green-300 dark:border-green-600 ring-1 ring-green-400';
                        } else {
                          cardClasses += 'bg-orange-50 dark:bg-orange-900/20 text-orange-900 dark:text-orange-300 border-orange-300 dark:border-orange-600 ring-1 ring-orange-400';
                        }
                      } else {
                        cardClasses += 'bg-white dark:bg-[#0a1929] text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600';
                      }
                      
                      return (
                        <div className={cardClasses}>
                          {/* Injury Badge - top right corner */}
                          {injuryBadge && (
                            <div className="absolute top-0.5 right-0.5">
                              <span className={`inline-block px-1 py-0.5 rounded text-[8px] font-bold ${injuryBadge.color}`}>
                                {injuryBadge.text}
                              </span>
                            </div>
                          )}
                          
                          <div className="font-semibold mb-1 text-xs leading-tight">
                            {decodeHtmlEntities(player.name)}
                          </div>
                          <div className="text-xs flex items-center justify-center gap-1 opacity-70">
                            {player.jersey && player.jersey !== 'N/A' && (
                              <span className="font-mono">#{player.jersey}</span>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="w-full p-2 rounded border-2 border-dashed border-gray-300 dark:border-gray-600"></div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
});

export default DepthChartContainer;