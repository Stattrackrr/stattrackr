'use client';

import { useState, useEffect, useMemo } from 'react';

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

interface InjuryContainerProps {
  selectedTeam: string;
  opponentTeam: string;
  isDark: boolean;
}

export default function InjuryContainer({
  selectedTeam,
  opponentTeam,
  isDark
}: InjuryContainerProps) {
  const [injuries, setInjuries] = useState<InjuryData[]>([]);
  const [injuriesByTeam, setInjuriesByTeam] = useState<Record<string, InjuryData[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<string>(''); // Which team's injuries to show

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

  // Set initial active team when selectedTeam changes
  useEffect(() => {
    if (selectedTeam && selectedTeam !== 'N/A') {
      setActiveTeam(selectedTeam);
    }
  }, [selectedTeam]);

  // Fetch injuries for both teams
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
        // Build teams array - always include selectedTeam
        const teams = [selectedTeam];
        if (opponentTeam && opponentTeam !== 'N/A' && opponentTeam !== selectedTeam) {
          teams.push(opponentTeam);
        }

        const response = await fetch(`/api/injuries?teams=${teams.join(',')}`);
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
  }, [selectedTeam, opponentTeam]);

  // Get injuries for the currently active team
  const activeTeamInjuries = useMemo(() => {
    return injuriesByTeam[activeTeam] || [];
  }, [injuriesByTeam, activeTeam]);

  // Available teams for swapping
  const availableTeams = useMemo(() => {
    const teams = [];
    if (selectedTeam && selectedTeam !== 'N/A') {
      teams.push(selectedTeam);
    }
    if (opponentTeam && opponentTeam !== 'N/A' && opponentTeam !== selectedTeam) {
      teams.push(opponentTeam);
    }
    return teams;
  }, [selectedTeam, opponentTeam]);

  // Status color helper
  const getStatusColor = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('out')) return 'text-red-600 dark:text-red-400';
    if (lowerStatus.includes('doubtful')) return 'text-red-500 dark:text-red-400';
    if (lowerStatus.includes('questionable')) return 'text-orange-500 dark:text-orange-400';
    if (lowerStatus.includes('probable')) return 'text-yellow-500 dark:text-yellow-400';
    if (lowerStatus.includes('day-to-day') || lowerStatus.includes('day to day')) return 'text-orange-600 dark:text-orange-400';
    return 'text-gray-500 dark:text-gray-400';
  };

  // Status background color helper
  const getStatusBgColor = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('out')) return 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-600';
    if (lowerStatus.includes('doubtful')) return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700';
    if (lowerStatus.includes('questionable')) return 'bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-700';
    if (lowerStatus.includes('probable')) return 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700';
    if (lowerStatus.includes('day-to-day') || lowerStatus.includes('day to day')) return 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-600';
    return 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  };

  // Format return date
  const formatReturnDate = (returnDate: string | null): string => {
    if (!returnDate) return 'Unknown';
    try {
      // Handle different date formats from the API
      let parsedDate: Date;
      
      if (returnDate.includes(' ')) {
        // Format like "Oct 17" - assume current/next year
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth();
        
        // Try parsing with current year first
        parsedDate = new Date(`${returnDate}, ${currentYear}`);
        
        // If the parsed date is in the past, use next year
        if (parsedDate < new Date()) {
          parsedDate = new Date(`${returnDate}, ${currentYear + 1}`);
        }
        
        // If still invalid, try various formats
        if (isNaN(parsedDate.getTime())) {
          // Try with current year anyway
          parsedDate = new Date(returnDate + `, ${currentYear}`);
          if (isNaN(parsedDate.getTime())) {
            return returnDate; // Return as-is if can't parse
          }
        }
      } else {
        // Standard date format
        parsedDate = new Date(returnDate);
      }
      
      // Ensure valid date
      if (isNaN(parsedDate.getTime())) {
        return returnDate;
      }
      
      return parsedDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return returnDate;
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Injury Report
        </h3>
        
        {/* Team Swapper */}
        {availableTeams.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">Team:</span>
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
              {availableTeams.map((team) => (
                <button
                  key={team}
                  onClick={() => setActiveTeam(team)}
                  className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                    activeTeam === team
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {team}
                </button>
              ))}
            </div>
          </div>
        )}
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
        <div className="space-y-2">
            {activeTeamInjuries.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-sm text-green-600 dark:text-green-400 mb-1">
                  ✅ No Current Injuries
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {activeTeam} has a clean bill of health
                </div>
              </div>
            ) : (
              <>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {activeTeamInjuries.length} player{activeTeamInjuries.length !== 1 ? 's' : ''} injured
                </div>
                
              {activeTeamInjuries.map((injury) => (
                <div
                  key={`${injury.player.id}-${activeTeam}`}
                  className={`rounded-lg border p-3 ${getStatusBgColor(injury.status)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                          {decodeHtmlEntities(injury.player.first_name)} {decodeHtmlEntities(injury.player.last_name)}
                        </h4>
                        {injury.player.jersey_number && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            #{injury.player.jersey_number}
                          </span>
                        )}
                        {injury.player.position && (
                          <span className="text-xs bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded">
                            {injury.player.position}
                          </span>
                        )}
                      </div>
                      
                      <div className="text-xs text-gray-600 dark:text-gray-300 mb-2 leading-relaxed break-words">
                        {injury.description ? decodeHtmlEntities(injury.description) : 'Injury details not available'}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <span className={`font-medium ${getStatusColor(injury.status)}`}>
                          {injury.status}
                        </span>
                        {injury.return_date && (
                          <span className="text-gray-500 dark:text-gray-400">
                            Return: {formatReturnDate(injury.return_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              </>
            )}
        </div>
      )}
    </div>
  );
}