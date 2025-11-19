'use client';

import { memo, useState, useEffect } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID, getEspnLogoCandidates } from '../../constants';
import type { BallDontLieStats } from '../../types';
import { currentNbaSeason, parseMinutes } from '../../utils';

export default memo(function PlayerBoxScore({
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
  
  useEffect(() => {
    setCurrentPage(0);
  }, [selectedPlayer]);
  
  if (!selectedPlayer) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Games</h3>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">Select a player to view their recent game logs</div>
          </div>
        </div>
      </div>
    );
  }

  if (!playerStats.length) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Games</h3>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-gray-500 dark:text-gray-400">No game data available for {selectedPlayer.full}</div>
          </div>
        </div>
      </div>
    );
  }

  const currentSeason = currentNbaSeason();
  const bySeason = (seasonYear: number) => playerStats.filter(game => {
    if (!game.game?.date) return false;
    const d = new Date(game.game.date);
    const y = d.getFullYear();
    const m = d.getMonth();
    const gameSeasonYear = m >= 9 ? y : y - 1;
    return gameSeasonYear === seasonYear;
  });

  let displayGames = bySeason(currentSeason);
  if (displayGames.length === 0) {
    displayGames = bySeason(currentSeason - 1);
  }
  if (displayGames.length === 0) {
    displayGames = playerStats;
  }
  displayGames = displayGames.filter(g => parseMinutes(g.min) > 0);
  displayGames = displayGames.slice(0, 50);
  
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
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
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
            <tr className={isDark ? 'bg-slate-900' : 'bg-slate-100'}>
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
              
              const homeTeamId = game.game?.home_team?.id ?? (game.game as any)?.home_team_id;
              const visitorTeamId = game.game?.visitor_team?.id ?? (game.game as any)?.visitor_team_id;
              const homeTeamAbbr = game.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
              const visitorTeamAbbr = game.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
              
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
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.min || '0:00'}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-bold">{game.pts || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.reb || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.ast || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.stl || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.blk || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fgm || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fga || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{fgPct}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fg3m || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fg3a || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{fg3Pct}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.ftm || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.fta || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.turnover || 0}</td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-white font-medium">{game.pf || 0}</td>
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




