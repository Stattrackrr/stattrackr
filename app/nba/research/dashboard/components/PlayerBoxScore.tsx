'use client';

import { memo, useState, useEffect } from 'react';
import { BallDontLieStats } from '../types';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getEspnLogoCandidates, TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '../utils/teamUtils';
import { currentNbaSeason, parseMinutes } from '../utils/playerUtils';


const PlayerBoxScore = memo(function PlayerBoxScore({
  selectedPlayer,
  playerStats,
  isDark
}: {
  selectedPlayer: any;
  playerStats: BallDontLieStats[];
  isDark: boolean;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [logoAttempts, setLogoAttempts] = useState<Record<string, number>>({});
  const gamesPerPage = 10;
  
  // Reset page when player changes
  useEffect(() => {
    setCurrentPage(0);
  }, [selectedPlayer]);
  
  // Always render the container - show skeleton when loading or no player selected
  if (!selectedPlayer) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Game Log</h3>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Select a player to view their recent game logs</div>
          </div>
        </div>
      </div>
    );
  }

  // Show skeleton when player is selected but stats are loading (empty array)
  if (!playerStats.length) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Game Log</h3>
        <div className="overflow-x-auto">
          <div className="min-w-full">
            {/* Skeleton table */}
            <div className="animate-pulse">
              <div className={`${isDark ? 'bg-[#0a1929]' : 'bg-slate-100'} h-10 mb-2 rounded`}></div>
              {[...Array(5)].map((_, idx) => (
                <div key={idx} className={`${isDark ? 'border-slate-700' : 'border-slate-200'} border-b h-12 mb-1`}>
                  <div className="flex gap-2 h-full items-center px-2">
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded flex-1`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Only show current season games - no fallback to previous seasons
  const currentSeason = currentNbaSeason();
  const bySeason = (seasonYear: number) => playerStats.filter(game => {
    if (!game.game?.date) return false;
    const d = new Date(game.game.date);
    const y = d.getFullYear();
    const m = d.getMonth();
    const gameSeasonYear = m >= 9 ? y : y - 1; // Oct-Dec belong to current season year
    return gameSeasonYear === seasonYear;
  });

  // Only show current season - wait for data to load before filtering
  // This prevents race condition where previous season shows if current season request is still loading
  let displayGames = bySeason(currentSeason);
  // Remove games with 0 minutes played
  displayGames = displayGames.filter(g => parseMinutes(g.min) > 0);
  // Limit to 50 most recent games (playerStats are already newest-first)
  displayGames = displayGames.slice(0, 50);
  
  // Pagination logic
  const totalGames = displayGames.length;
  const totalPages = Math.ceil(totalGames / gamesPerPage);
  const startIndex = currentPage * gamesPerPage;
  const endIndex = Math.min(startIndex + gamesPerPage, totalGames);
  const currentGames = displayGames.slice(startIndex, endIndex);
  
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;
  const rangeStart = totalGames ? startIndex + 1 : 0;
  const rangeEnd = totalGames ? endIndex : 0;

  return (
    <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Game Log</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Games {rangeStart}-{rangeEnd} of {totalGames}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={!canGoPrevious}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                !canGoPrevious ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={!canGoNext}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                !canGoNext ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className={isDark ? 'bg-[#0a1929]' : 'bg-slate-100'}>
              <th className="text-left py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">DATE</th>
              <th className="text-left py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">TM</th>
              <th className="text-left py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">OPP</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">MIN</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">PTS</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">REB</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">AST</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">STL</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">BLK</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FGM</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FGA</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FG%</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">3PM</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">3PA</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">3P%</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FTM</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">FTA</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">TO</th>
              <th className="text-center py-2 px-2 font-semibold text-gray-700 dark:text-gray-300">PF</th>
            </tr>
          </thead>
          <tbody>
            {currentGames.map((game, index) => {
              const playerTeamRaw = game.team?.abbreviation;
              const playerTeam = normalizeAbbr(playerTeamRaw || 'UNK');
              
              // Get team info from game data - support both nested objects and *_id fields
              const homeTeamId = game.game?.home_team?.id ?? (game.game as any)?.home_team_id;
              const visitorTeamId = game.game?.visitor_team?.id ?? (game.game as any)?.visitor_team_id;
              const homeTeamAbbr = game.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
              const visitorTeamAbbr = game.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
              
              // Determine opponent using team IDs/abbrs
              const playerTeamId = ABBR_TO_TEAM_ID[playerTeam];
              let opponent = 'UNK';
              let isHome = false;
              
              if (playerTeamId && homeTeamId && visitorTeamId) {
                if (playerTeamId === homeTeamId && visitorTeamAbbr) {
                  opponent = normalizeAbbr(visitorTeamAbbr);
                  isHome = true;
                } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
                  opponent = normalizeAbbr(homeTeamAbbr);
                  isHome = false;
                }
              }
              
              // Fallback: compare abbreviations directly if IDs missing
              if (opponent === 'UNK' && homeTeamAbbr && visitorTeamAbbr) {
                const homeNorm = normalizeAbbr(homeTeamAbbr);
                const awayNorm = normalizeAbbr(visitorTeamAbbr);
                if (playerTeam === homeNorm) {
                  opponent = awayNorm;
                  isHome = true;
                } else if (playerTeam === awayNorm) {
                  opponent = homeNorm;
                  isHome = false;
                }
              }
              
              const fgPct = game.fga > 0 ? ((game.fgm / game.fga) * 100).toFixed(0) : '0';
              const fg3Pct = game.fg3a > 0 ? ((game.fg3m / game.fg3a) * 100).toFixed(0) : '0';
              
              // Format game date with year
              const gameDate = game.game?.date ? new Date(game.game.date).toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: '2-digit'
              }) : '--';
              
              return (
                <tr key={startIndex + index} className={isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
                  <td className="py-2 px-2 text-gray-900 dark:text-white font-medium">
                    {gameDate}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <img 
                        src={(() => {
                          const candidates = getEspnLogoCandidates(playerTeam);
                          const attempt = logoAttempts[`player-${playerTeam}`] || 0;
                          return candidates[attempt] || candidates[0];
                        })()}
                        alt={playerTeam}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(playerTeam);
                          const currentAttempt = logoAttempts[`player-${playerTeam}`] || 0;
                          const nextAttempt = currentAttempt + 1;
                          if (nextAttempt < candidates.length) {
                            setLogoAttempts(prev => ({ ...prev, [`player-${playerTeam}`]: nextAttempt }));
                          } else {
                            e.currentTarget.style.display = 'none';
                          }
                        }}
                      />
                      <span className="font-medium text-gray-900 dark:text-white">{playerTeam}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-white">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 dark:text-gray-400 text-[10px]">{isHome ? 'vs' : '@'}</span>
                      <img 
                        src={(() => {
                          const candidates = getEspnLogoCandidates(opponent);
                          const attempt = logoAttempts[`opponent-${opponent}`] || 0;
                          return candidates[attempt] || candidates[0];
                        })()}
                        alt={opponent}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          const candidates = getEspnLogoCandidates(opponent);
                          const currentAttempt = logoAttempts[`opponent-${opponent}`] || 0;
                          const nextAttempt = currentAttempt + 1;
                          if (nextAttempt < candidates.length) {
                            setLogoAttempts(prev => ({ ...prev, [`opponent-${opponent}`]: nextAttempt }));
                          } else {
                            e.currentTarget.style.display = 'none';
                          }
                        }}
                      />
                      <span className="font-medium">{opponent}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.min == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.min || '0:00'
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white">
                    {game.pts == null ? (
                      <span className="text-gray-400 dark:text-gray-500 font-bold">N/A</span>
                    ) : (
                      <span className="font-bold">{game.pts || 0}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.reb == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.reb || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.ast == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.ast || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.stl == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.stl || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.blk == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.blk || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fgm == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fgm || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fga == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fga || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fga == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      fgPct
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fg3m == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fg3m || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fg3a == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fg3a || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fg3a == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      fg3Pct
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.ftm == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.ftm || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.fta == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.fta || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.turnover == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.turnover || 0
                    )}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">
                    {game.pf == null ? (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    ) : (
                      game.pf || 0
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
}, (prev, next) => (
  prev.selectedPlayer === next.selectedPlayer &&
  prev.playerStats === next.playerStats &&
  prev.isDark === next.isDark
));

export default PlayerBoxScore;

