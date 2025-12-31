'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { currentNbaSeason } from '@/lib/nbaConstants';

interface InjuryData {
  player: {
    id: number;
    first_name: string;
    last_name: string;
    position: string;
    height: string;
    weight: string;
    jersey_number: string;
    college: string;
    country: string;
    draft_year: number;
    draft_round: number;
    draft_number: number;
    team_id: number;
  };
  return_date: string | null;
  description: string;
  status: string;
}

interface InjuryResponse {
  success: boolean;
  total: number;
  injuries: InjuryData[];
  injuriesByTeam: Record<string, InjuryData[]>;
  requestedTeams: string[];
  error?: string;
}

interface StatisticalImpact {
  plusMinus: number | null;
  rebounds: number | null;
  points: number | null;
  assists: number | null;
  fg3m: number | null; // 3-pointers made
  hasSignificantChange: boolean;
  noGamesTogether?: boolean; // Flag to indicate no games played together
}

interface InjuryContainerProps {
  selectedTeam: string;
  opponentTeam: string;
  isDark: boolean;
  selectedPlayer?: any;
  playerStats?: any[];
  // Teammate filter props
  teammateFilterId?: number | null;
  setTeammateFilterId?: (id: number | null) => void;
  setTeammateFilterName?: (name: string | null) => void;
  withWithoutMode?: 'with' | 'without';
  setWithWithoutMode?: (mode: 'with' | 'without') => void;
  clearTeammateFilter?: () => void;
}

export default function InjuryContainer({
  selectedTeam,
  opponentTeam,
  isDark,
  selectedPlayer,
  playerStats = [],
  teammateFilterId,
  setTeammateFilterId,
  setTeammateFilterName,
  withWithoutMode,
  setWithWithoutMode,
  clearTeammateFilter
}: InjuryContainerProps) {
  const [injuries, setInjuries] = useState<InjuryData[]>([]);
  const [injuriesByTeam, setInjuriesByTeam] = useState<Record<string, InjuryData[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impactData, setImpactData] = useState<Record<number, StatisticalImpact>>({});
  const [loadingImpacts, setLoadingImpacts] = useState<Set<number>>(new Set());
  const [averageData, setAverageData] = useState<Record<number, { rebounds: number; points: number; assists: number; plusMinus: number; fg3m: number }>>({});
  const calculatingRef = useRef(false);

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

  // Fetch injuries for selected team
  useEffect(() => {
    const fetchInjuries = async () => {
      if (!selectedTeam || selectedTeam === 'N/A') {
        setInjuries([]);
        setInjuriesByTeam({});
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/injuries?teams=${selectedTeam}`);
        const data: InjuryResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch injuries');
        }

        setInjuries(data.injuries);
        setInjuriesByTeam(data.injuriesByTeam);

      } catch (err: any) {
        setError(err.message || 'Failed to load injury data');
        setInjuries([]);
        setInjuriesByTeam({});
      } finally {
        setIsLoading(false);
      }
    };

    fetchInjuries();
  }, [selectedTeam]);

  // Get injuries for selected team (unsorted)
  const teamInjuriesRaw = useMemo(() => {
    return injuriesByTeam[selectedTeam] || [];
  }, [injuriesByTeam, selectedTeam]);

  // Sort injuries: most impactful at top, no games together at bottom
  const teamInjuries = useMemo(() => {
    if (teamInjuriesRaw.length === 0) return [];
    
    return [...teamInjuriesRaw].sort((a, b) => {
      const impactA = impactData[a.player.id];
      const impactB = impactData[b.player.id];
      
      // If one has no games together and the other doesn't, put no games together at bottom
      if (impactA?.noGamesTogether && !impactB?.noGamesTogether) return 1;
      if (!impactA?.noGamesTogether && impactB?.noGamesTogether) return -1;
      if (impactA?.noGamesTogether && impactB?.noGamesTogether) return 0; // Both have no games, keep original order
      
      // If one has impact and the other doesn't, prioritize the one with impact
      if (!impactA && impactB) return 1;
      if (impactA && !impactB) return -1;
      if (!impactA && !impactB) return 0; // Both loading, keep original order
      
      // Calculate total impact magnitude for sorting
      const getTotalImpact = (impact: StatisticalImpact | undefined): number => {
        if (!impact) return 0;
        return Math.abs(impact.points || 0) + 
               Math.abs(impact.assists || 0) + 
               Math.abs(impact.rebounds || 0) + 
               Math.abs(impact.fg3m || 0);
      };
      
      const impactAValue = getTotalImpact(impactA);
      const impactBValue = getTotalImpact(impactB);
      
      // Sort by total impact (descending - most impactful first)
      return impactBValue - impactAValue;
    });
  }, [teamInjuriesRaw, impactData]);

  // Calculate statistical impact for each injured player
  useEffect(() => {
    // Prevent concurrent calculations
    if (calculatingRef.current) {
      console.log(`[Injury Impact] Calculation already in progress, skipping`);
      return;
    }

    if (!selectedPlayer || !playerStats || playerStats.length === 0 || teamInjuriesRaw.length === 0) {
      console.log(`[Injury Impact] Skipping calculation:`, {
        hasSelectedPlayer: !!selectedPlayer,
        playerStatsLength: playerStats?.length || 0,
        teamInjuriesLength: teamInjuriesRaw.length
      });
      // Only clear data if it's not already empty to prevent infinite loops
      setImpactData(prev => {
        const isEmpty = Object.keys(prev).length === 0;
        return isEmpty ? prev : {};
      });
      setAverageData(prev => {
        const isEmpty = Object.keys(prev).length === 0;
        return isEmpty ? prev : {};
      });
      return;
    }

    console.log(`[Injury Impact] Processing ${teamInjuriesRaw.length} injured players:`, 
      teamInjuriesRaw.map(i => `${i.player.first_name} ${i.player.last_name} (ID: ${i.player.id})`).join(', '));

    calculatingRef.current = true;

    const calculateImpacts = async () => {
      const newImpacts: Record<number, StatisticalImpact> = {};
      const newAverages: Record<number, { rebounds: number; points: number; assists: number; plusMinus: number; fg3m: number }> = {};
      const loadingSet = new Set<number>();

      console.log(`[Injury Impact] Starting calculation for ${teamInjuriesRaw.length} injured players`);

      for (const injury of teamInjuriesRaw) {
        const injuredPlayerId = injury.player.id;
        loadingSet.add(injuredPlayerId);

        try {
          // Use current NBA season (automatically updates when season changes)
          const season = currentNbaSeason();

          // Find games where the injured player was out (didn't play)
          // Fetch stats from the current season
          const response = await fetch(`/api/stats?player_id=${injuredPlayerId}&per_page=100&max_pages=5&season=${season}`);
          const injuredPlayerData = await response.json();
          const injuredPlayerStats = injuredPlayerData?.data || [];

          console.log(`[Injury Impact] Fetching stats for current season (${season}), got ${injuredPlayerStats.length} games`);

          console.log(`[Injury Impact] Calculating for ${injury.player.first_name} ${injury.player.last_name}:`, {
            injuredPlayerId,
            injuredPlayerStatsCount: injuredPlayerStats.length,
            selectedPlayerStatsCount: playerStats.length
          });

          // If injured player has no stats, they never played, so no games together
          if (injuredPlayerStats.length === 0) {
            console.log(`[Injury Impact] ${injury.player.first_name} ${injury.player.last_name} has no stats, no games together`);
            newImpacts[injuredPlayerId] = {
              plusMinus: null,
              rebounds: null,
              points: null,
              assists: null,
              fg3m: null,
              hasSignificantChange: false,
              noGamesTogether: true
            };
            continue;
          }

          // Create a set of game dates where injured player played (match by date since game IDs differ)
          // Also create a set of game IDs as fallback
          const gamesWithInjuredPlayerByDate = new Set(
            injuredPlayerStats
              .filter((s: any) => {
                const min = s.min;
                if (typeof min === 'string') {
                  const match = min.match(/(\d+):(\d+)/);
                  if (match) {
                    return parseInt(match[1], 10) + parseInt(match[2], 10) / 60 > 0;
                  }
                }
                return (parseFloat(min) || 0) > 0;
              })
              .map((s: any) => {
                const gameDate = s.game?.date;
                // Normalize date to YYYY-MM-DD format for comparison
                if (gameDate) {
                  const date = new Date(gameDate);
                  return date.toISOString().split('T')[0]; // Get YYYY-MM-DD
                }
                return null;
              })
              .filter((date: any) => date != null)
          );

          // Also create game ID set as fallback
          const gamesWithInjuredPlayerById = new Set(
            injuredPlayerStats
              .filter((s: any) => {
                const min = s.min;
                if (typeof min === 'string') {
                  const match = min.match(/(\d+):(\d+)/);
                  if (match) {
                    return parseInt(match[1], 10) + parseInt(match[2], 10) / 60 > 0;
                  }
                }
                return (parseFloat(min) || 0) > 0;
              })
              .map((s: any) => {
                const gameId = s.game?.id;
                return gameId != null ? String(gameId) : null;
              })
              .filter((id: any) => id != null)
          );

          console.log(`[Injury Impact] Games where injured player played: ${gamesWithInjuredPlayerByDate.size} (by date), ${gamesWithInjuredPlayerById.size} (by ID)`);
          console.log(`[Injury Impact] Sample game dates from injured player:`, Array.from(gamesWithInjuredPlayerByDate).slice(0, 5));

          // Filter selected player's stats: games WITHOUT injured player (match by date first, then ID)
          const gamesWithoutInjured = playerStats.filter((stat: any) => {
            const gameDate = stat.game?.date;
            const gameId = stat.game?.id;
            
            if (gameDate) {
              const normalizedDate = new Date(gameDate).toISOString().split('T')[0];
              if (gamesWithInjuredPlayerByDate.has(normalizedDate)) {
                return false; // They played together on this date
              }
            }
            
            // Fallback to ID matching
            const normalizedGameId = gameId != null ? String(gameId) : null;
            if (normalizedGameId && gamesWithInjuredPlayerById.has(normalizedGameId)) {
              return false; // They played together (matched by ID)
            }
            
            return true; // No match, injured player was out
          });

          // Filter selected player's stats: games WITH injured player
          const gamesWithInjured = playerStats.filter((stat: any) => {
            const gameDate = stat.game?.date;
            const gameId = stat.game?.id;
            
            if (gameDate) {
              const normalizedDate = new Date(gameDate).toISOString().split('T')[0];
              if (gamesWithInjuredPlayerByDate.has(normalizedDate)) {
                return true; // They played together on this date
              }
            }
            
            // Fallback to ID matching
            const normalizedGameId = gameId != null ? String(gameId) : null;
            return normalizedGameId && gamesWithInjuredPlayerById.has(normalizedGameId);
          });

          console.log(`[Injury Impact] Sample game dates from selected player:`, playerStats.slice(0, 5).map((s: any) => {
            const date = s.game?.date;
            return date ? new Date(date).toISOString().split('T')[0] : null;
          }).filter(Boolean));
          
          // Check if there's any overlap at all (by date)
          const selectedPlayerGameDates = new Set(playerStats.map((s: any) => {
            const date = s.game?.date;
            return date ? new Date(date).toISOString().split('T')[0] : null;
          }).filter(Boolean));
          const overlap = Array.from(gamesWithInjuredPlayerByDate).filter(date => selectedPlayerGameDates.has(date));
          console.log(`[Injury Impact] Game date overlap: ${overlap.length} games in common`);

          // If no games in common (by date), they haven't played together
          if (overlap.length === 0 && gamesWithInjured.length === 0) {
            console.log(`[Injury Impact] No games played together between ${injury.player.first_name} ${injury.player.last_name} and selected player`);
            newImpacts[injuredPlayerId] = {
              plusMinus: null,
              rebounds: null,
              points: null,
              assists: null,
              fg3m: null,
              hasSignificantChange: false,
              noGamesTogether: true
            };
            continue;
          }

          console.log(`[Injury Impact] Selected player games - Without: ${gamesWithoutInjured.length}, With: ${gamesWithInjured.length}`);

          if (gamesWithoutInjured.length === 0) {
            console.log(`[Injury Impact] No games without injured player found`);
            newImpacts[injuredPlayerId] = {
              plusMinus: null,
              rebounds: null,
              points: null,
              assists: null,
              fg3m: null,
              hasSignificantChange: false
            };
            continue;
          }

          // Calculate averages
          const getAverage = (stats: any[], key: string): number => {
            const values = stats
              .map((s: any) => {
                const val = s[key];
                return typeof val === 'number' ? val : parseFloat(val) || 0;
              })
              .filter((v: number) => !isNaN(v));
            return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          };

          // Get the injured player's team from their stats
          const injuredPlayerTeam = injuredPlayerStats.length > 0 
            ? injuredPlayerStats[0]?.team?.abbreviation 
            : null;

          // Get selected player's team from their stats
          const selectedPlayerTeam = playerStats.length > 0
            ? playerStats[0]?.team?.abbreviation
            : selectedTeam;

          console.log(`[Injury Impact] Teams - Injured: ${injuredPlayerTeam}, Selected: ${selectedPlayerTeam}`);

          // Only compare if they're on the same team
          if (injuredPlayerTeam && selectedPlayerTeam && injuredPlayerTeam !== selectedPlayerTeam) {
            console.log(`[Injury Impact] Players are on different teams, skipping`);
            newImpacts[injuredPlayerId] = {
              plusMinus: null,
              rebounds: null,
              points: null,
              assists: null,
              fg3m: null,
              hasSignificantChange: false
            };
            continue;
          }

          // Filter selected player's stats to only games where they were on the same team as injured player
          const gamesWithoutInjuredSameTeam = gamesWithoutInjured.filter((stat: any) => {
            const statTeam = stat.team?.abbreviation;
            return statTeam === injuredPlayerTeam || statTeam === selectedPlayerTeam;
          });
          
          const gamesWithInjuredSameTeam = gamesWithInjured.filter((stat: any) => {
            const statTeam = stat.team?.abbreviation;
            return statTeam === injuredPlayerTeam || statTeam === selectedPlayerTeam;
          });

          console.log(`[Injury Impact] After team filter - Without: ${gamesWithoutInjuredSameTeam.length}, With: ${gamesWithInjuredSameTeam.length}`);

          if (gamesWithoutInjuredSameTeam.length === 0) {
            console.log(`[Injury Impact] No games without injured player on same team`);
            newImpacts[injuredPlayerId] = {
              plusMinus: null,
              rebounds: null,
              points: null,
              assists: null,
              fg3m: null,
              hasSignificantChange: false
            };
            continue;
          }

          const avgWithout = {
            plusMinus: getAverage(gamesWithoutInjuredSameTeam, 'plus_minus'),
            rebounds: getAverage(gamesWithoutInjuredSameTeam, 'reb'),
            points: getAverage(gamesWithoutInjuredSameTeam, 'pts'),
            assists: getAverage(gamesWithoutInjuredSameTeam, 'ast'),
            fg3m: getAverage(gamesWithoutInjuredSameTeam, 'fg3m')
          };

          const avgWith = gamesWithInjuredSameTeam.length > 0 ? {
            plusMinus: getAverage(gamesWithInjuredSameTeam, 'plus_minus'),
            rebounds: getAverage(gamesWithInjuredSameTeam, 'reb'),
            points: getAverage(gamesWithInjuredSameTeam, 'pts'),
            assists: getAverage(gamesWithInjuredSameTeam, 'ast'),
            fg3m: getAverage(gamesWithInjuredSameTeam, 'fg3m')
          } : {
            plusMinus: 0,
            rebounds: 0,
            points: 0,
            assists: 0,
            fg3m: 0
          };

          // Store averages for display (when injured player is OUT) - batch update at end
          newAverages[injuredPlayerId] = {
            rebounds: avgWithout.rebounds,
            points: avgWithout.points,
            assists: avgWithout.assists,
            plusMinus: avgWithout.plusMinus,
            fg3m: avgWithout.fg3m
          };

          // Calculate differences
          const diff = {
            plusMinus: avgWithout.plusMinus - avgWith.plusMinus,
            rebounds: avgWithout.rebounds - avgWith.rebounds,
            points: avgWithout.points - avgWith.points,
            assists: avgWithout.assists - avgWith.assists,
            fg3m: avgWithout.fg3m - avgWith.fg3m
          };

          // Determine if there's significant change (threshold: 0.5 for any stat)
          const hasSignificantChange = 
            Math.abs(diff.plusMinus) >= 0.5 ||
            Math.abs(diff.rebounds) >= 0.5 ||
            Math.abs(diff.points) >= 0.5 ||
            Math.abs(diff.assists) >= 0.5 ||
            Math.abs(diff.fg3m) >= 0.5;

          console.log(`[Injury Impact] Results for ${injury.player.first_name} ${injury.player.last_name}:`, {
            avgWithout,
            avgWith,
            diff,
            hasSignificantChange
          });

          newImpacts[injuredPlayerId] = {
            plusMinus: diff.plusMinus,
            rebounds: diff.rebounds,
            points: diff.points,
            assists: diff.assists,
            fg3m: diff.fg3m,
            hasSignificantChange
          };
        } catch (err) {
          console.error(`[Injury Impact] Failed to calculate impact for ${injury.player.first_name} ${injury.player.last_name} (ID: ${injuredPlayerId}):`, err);
          newImpacts[injuredPlayerId] = {
            plusMinus: null,
            rebounds: null,
            points: null,
            assists: null,
            fg3m: null,
            hasSignificantChange: false
          };
        }
      }

      console.log(`[Injury Impact] Completed calculation for ${Object.keys(newImpacts).length} players`);
      setImpactData(newImpacts);
      setAverageData(newAverages);
      setLoadingImpacts(new Set());
      calculatingRef.current = false;
    };

    setLoadingImpacts(new Set(teamInjuriesRaw.map(i => i.player.id)));
    calculateImpacts().catch((err) => {
      console.error(`[Injury Impact] Error in calculateImpacts:`, err);
      calculatingRef.current = false;
      setLoadingImpacts(new Set());
    });
  }, [selectedPlayer, playerStats, teamInjuriesRaw]);

  // Status dot color helper
  const getStatusDotColor = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('out')) return 'bg-red-500';
    if (lowerStatus.includes('doubtful')) return 'bg-red-400';
    if (lowerStatus.includes('questionable') || lowerStatus.includes('day-to-day') || lowerStatus.includes('day to day')) return 'bg-orange-500';
    if (lowerStatus.includes('probable')) return 'bg-green-500';
    return 'bg-gray-500';
  };

  // Get status text helper
  const getStatusText = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('out')) return 'Out';
    if (lowerStatus.includes('doubtful')) return 'Doubtful';
    if (lowerStatus.includes('questionable') || lowerStatus.includes('day-to-day') || lowerStatus.includes('day to day')) return 'Day to Day';
    if (lowerStatus.includes('probable')) return 'Probable';
    return status;
  };

  // Get status text color helper
  const getStatusTextColor = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('out') || lowerStatus.includes('doubtful')) return 'text-red-500 dark:text-red-400';
    if (lowerStatus.includes('questionable') || lowerStatus.includes('day-to-day') || lowerStatus.includes('day to day')) return 'text-orange-500 dark:text-orange-400';
    if (lowerStatus.includes('probable')) return 'text-green-500 dark:text-green-400';
    return 'text-gray-500 dark:text-gray-400';
  };

  // Format impact text - show averages when player is out, not differences
  const formatImpactText = (injury: InjuryData): React.ReactNode => {
    const impact = impactData[injury.player.id];
    const averages = averageData[injury.player.id];
    
    if (!impact) {
      return <span>No games played with/without each other this season</span>;
    }

    // Check if they haven't played together
    if (impact.noGamesTogether) {
      return <span>No games played with/without each other this season</span>;
    }

    if (!averages) {
      return <span>No games played with/without each other this season</span>;
    }

    // If no significant change, still show the stats (just don't filter by significance)
    if (!impact.hasSignificantChange) {
      // Show stats anyway, even if change is small
    }

    // Show all stats: points, assists, rebounds, 3pm
    const statList = [
      { key: 'points', diff: impact.points || 0, label: 'points' },
      { key: 'assists', diff: impact.assists || 0, label: 'assists' },
      { key: 'rebounds', diff: impact.rebounds || 0, label: 'rebounds' },
      { key: 'fg3m', diff: impact.fg3m || 0, label: '3pm' }
    ];

    return (
      <div className="space-y-1">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          Without {injury.player.first_name} {injury.player.last_name}, {selectedPlayer?.full || 'this player'} averages:
        </div>
        {statList.map((stat) => {
          const diff = stat.diff;
          const absDiff = Math.abs(diff);
          const isPositive = diff > 0;
          const arrowColor = isPositive ? 'text-green-500' : 'text-red-500';
          
          if (absDiff < 0.1) {
            // Don't show stats with negligible difference
            return null;
          }
          
          return (
            <div key={stat.key} className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
              <svg 
                className={`w-3.5 h-3.5 ${arrowColor}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
                strokeWidth={2.5}
              >
                {isPositive ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                )}
              </svg>
              <span>
                {absDiff.toFixed(1)} {isPositive ? 'more' : 'less'} {stat.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // Get team abbreviation from team_id
  const getTeamAbbr = (teamId: number): string => {
    const teamMap: Record<number, string> = {
      1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN', 9: 'DET',
      10: 'GSW', 11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM', 16: 'MIA', 17: 'MIL',
      18: 'MIN', 19: 'NOP', 20: 'NYK', 21: 'OKC', 22: 'ORL', 23: 'PHI', 24: 'PHX', 25: 'POR',
      26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA', 30: 'WAS'
    };
    return teamMap[teamId] || '';
  };

  return (
    <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full min-w-0">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Roster Activity
        </h3>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
            Loading injury data...
          </span>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="text-center py-8">
          <div className="text-sm text-red-500 dark:text-red-400 mb-2">
            {error}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Unable to load injury information
          </div>
        </div>
      )}

      {/* Injuries List */}
      {!isLoading && !error && (
        <div className="space-y-3">
          {teamInjuries.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-sm text-green-600 dark:text-green-400 mb-1">
                  ✅ No Current Injuries
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                {selectedTeam} has a clean bill of health
              </div>
              </div>
            ) : (
            teamInjuries.map((injury) => {
              const impact = impactData[injury.player.id];
              const isLoadingImpact = loadingImpacts.has(injury.player.id);
              const playerName = `${decodeHtmlEntities(injury.player.first_name)} ${decodeHtmlEntities(injury.player.last_name)}`;
              
              return (
                <div
                  key={`${injury.player.id}-${selectedTeam}`}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-3 md:p-4 bg-gray-50 dark:bg-[#0f1e2e] w-full min-w-0"
                >
                  <div className="flex items-start gap-3">
                    {/* Status Dot */}
                    <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${getStatusDotColor(injury.status)}`} />
                    
                    <div className="flex-1 min-w-0">
                      {/* Player Name and Info */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-900 dark:text-white text-sm">
                          {playerName}
                        </span>
                        {injury.player.position && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {injury.player.position}
                          </span>
                        )}
                        <span className={`text-xs font-medium ${getStatusTextColor(injury.status)}`}>
                          {getStatusText(injury.status)}
                        </span>
                      </div>
                      
                      {/* Impact Text */}
                      {selectedPlayer && playerStats.length > 0 ? (
                        isLoadingImpact ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            Calculating impact...
                          </div>
                        ) : (
                          <div className="text-xs text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">
                            {formatImpactText(injury)}
                      </div>
                        )
                      ) : null}
                      
                      {/* With/Without Buttons */}
                      {selectedPlayer && playerStats.length > 0 && !impact?.noGamesTogether && (
                        <div className="flex items-center gap-2 mt-3 justify-end">
                          {teammateFilterId === injury.player.id && withWithoutMode === 'with' ? (
                            <button
                              onClick={() => {
                                if (clearTeammateFilter) {
                                  clearTeammateFilter();
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-purple-600 dark:bg-purple-500 text-white hover:bg-purple-700 dark:hover:bg-purple-600"
                            >
                              ✕
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (setTeammateFilterId && setTeammateFilterName && setWithWithoutMode) {
                                  setTeammateFilterId(injury.player.id);
                                  setTeammateFilterName(`${injury.player.first_name} ${injury.player.last_name}`);
                                  setWithWithoutMode('with');
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              With
                            </button>
                          )}
                          {teammateFilterId === injury.player.id && withWithoutMode === 'without' ? (
                            <button
                              onClick={() => {
                                if (clearTeammateFilter) {
                                  clearTeammateFilter();
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-purple-600 dark:bg-purple-500 text-white hover:bg-purple-700 dark:hover:bg-purple-600"
                            >
                              ✕
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (setTeammateFilterId && setTeammateFilterName && setWithWithoutMode) {
                                  setTeammateFilterId(injury.player.id);
                                  setTeammateFilterName(`${injury.player.first_name} ${injury.player.last_name}`);
                                  setWithWithoutMode('without');
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              Without
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
            )}
        </div>
      )}
    </div>
  );
}
