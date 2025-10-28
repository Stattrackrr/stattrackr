'use client';

import { useState, useEffect, memo } from 'react';

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
      console.log(`📊 Using real depth chart data`);
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
    console.log('❌ No real depth chart data available');
    return null;
  };

  // Use preloaded data for instant switching - no fetching needed
  useEffect(() => {
    const playerTeam = originalPlayerTeam || 'N/A';
    const isShowingPlayerTeam = selectedTeam === playerTeam;
    
    setDepthError(null);
    
    if (!selectedTeam || selectedTeam === 'N/A') {
      setDepthChart(null);
      setDepthLoading(false);
      return;
    }
    
    // Use preloaded roster data for instant switching
    if (isShowingPlayerTeam) {
      // Show player team roster
      setDepthChart(playerTeamRoster || null);
      setDepthLoading(rostersLoading?.player || false);
    } else {
      // Show opponent team roster
      setDepthChart(opponentTeamRoster || null);
      setDepthLoading(rostersLoading?.opponent || false);
    }
  }, [selectedTeam, originalPlayerTeam, playerTeamRoster, opponentTeamRoster, rostersLoading]);

  const mappedDepthChart = createDepthChart(depthChart);
  
  if (!selectedTeam || selectedTeam === 'N/A') {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="text-sm text-gray-900 dark:text-white font-semibold mb-3">Depth Chart</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Select a player/team to load depth chart.</div>
      </div>
    );
  }

  if (depthLoading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="text-sm text-gray-900 dark:text-white font-semibold mb-3">Depth Chart</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Loading depth chart…</div>
      </div>
    );
  }

  if (depthError) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="text-sm text-gray-900 dark:text-white font-semibold mb-3">Depth Chart</div>
        <div className="text-xs text-red-500">{depthError}</div>
      </div>
    );
  }

  if (!mappedDepthChart) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
        <div className="text-sm text-gray-900 dark:text-white font-semibold mb-3">Depth Chart</div>
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
  
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm px-6 py-5 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
      <div className="text-sm text-gray-900 dark:text-white font-semibold mb-3">Depth Chart</div>
      
      {/* Team Swapper */}
      {selectedTeam && selectedTeam !== 'N/A' && (
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
                      
                      
                      return (
                        <div className={`w-full p-2 text-center rounded border text-xs relative ${
                          isSelected 
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100 border-purple-300 dark:border-purple-600 ring-2 ring-purple-500 dark:ring-purple-400'
                            : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                        }`}>
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
    </div>
  );
});

export default DepthChartContainer;