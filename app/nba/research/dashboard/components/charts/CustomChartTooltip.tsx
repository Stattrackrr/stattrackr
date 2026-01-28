'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { parseMinutes } from '../../utils/playerUtils';
import { PLAYER_STAT_OPTIONS, TEAM_STAT_OPTIONS } from '../../constants';

interface CustomChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: any;
  coordinate?: { x: number; y: number };
  propsMode: 'player' | 'team';
  selectedStat: string;
  isDark: boolean;
  gamePropsTeam?: string;
  selectedTeam?: string;
}

// Format minutes with apostrophe (e.g., "40'" instead of "40:00")
function formatMinutes(minStr: string): string {
  if (!minStr) return "0'";
  const match = minStr.match(/(\d+):(\d+)/);
  if (match) {
    const mins = parseInt(match[1], 10);
    return `${mins}'`;
  }
  return minStr;
}

export function CustomChartTooltip({
  active,
  payload,
  label,
  coordinate,
  propsMode,
  selectedStat,
  isDark,
  gamePropsTeam,
  selectedTeam,
}: CustomChartTooltipProps) {
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    };
    checkMobile();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  // Track mouse position for cursor-following tooltip
  useEffect(() => {
    if (!active) {
      setMousePosition(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    // For touch events on mobile, use touch coordinates
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0) {
        const touch = e.touches[0];
        setMousePosition({ x: touch.clientX, y: touch.clientY });
      }
    };

    // Use coordinate from Recharts if available (for touch events)
    if (coordinate && coordinate.x !== undefined && coordinate.y !== undefined) {
      setMousePosition({ x: coordinate.x, y: coordinate.y });
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchstart', handleTouchStart);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, [active, coordinate]);

  if (!active || !payload || !payload.length) {
    return null;
  }

  const data = payload[0].payload;
  
  // Use the currently selected stat for label and formatting
  const currentStatOptions = propsMode === 'player' ? PLAYER_STAT_OPTIONS : TEAM_STAT_OPTIONS;
  const statMeta = currentStatOptions.find(s => s.key === selectedStat);
  const statLabel = statMeta ? statMeta.label : selectedStat.toUpperCase();
  const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
  const numValue = typeof data.value === 'number' ? data.value : parseFloat(data.value) || 0;
  
  // Special handling for fg3m (3PM/A) - show made/attempted format
  let formattedValue: string;
  if (selectedStat === 'fg3m' && propsMode === 'player' && data.stats) {
    const makes = data.stats.fg3m || 0;
    const attempts = data.stats.fg3a || 0;
    formattedValue = `${makes}/${attempts}`;
  } else if (isPercentageStat) {
    formattedValue = `${numValue.toFixed(1)}%`;
  } else {
    formattedValue = `${numValue}`;
  }
  
  // Handle both player and team mode data
  let correctDate = "Unknown Date";
  let dateShort = "Unknown";
  let gameDetails = null;
  let opponentTeam = '';
  let playerTeam = '';
  
  if (propsMode === 'team' && data.gameData) {
    // Team mode: use game data
    const gameData = data.gameData;
    const gameISO = gameData.date;
    if (gameISO) {
      const date = new Date(gameISO);
      correctDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const year = String(date.getFullYear()).slice(-2);
      dateShort = `${month}/${day}/${year}`;
    }
    // For quarter stats, show quarter-specific scores instead of full game
    const isQuarterStat = ['q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline', 'q1_total', 'q2_total', 'q3_total', 'q4_total'].includes(selectedStat);
    let homeScore, visitorScore;
    
    if (isQuarterStat) {
      // Extract quarter number from stat name (e.g., 'q1_moneyline' -> 1)
      const quarter = selectedStat.charAt(1); // Gets '1', '2', '3', or '4'
      homeScore = gameData[`home_q${quarter}`] || 0;
      visitorScore = gameData[`visitor_q${quarter}`] || 0;
    } else {
      homeScore = gameData.home_team_score || 0;
      visitorScore = gameData.visitor_team_score || 0;
    }
    
    playerTeam = gamePropsTeam || selectedTeam || '';
    opponentTeam = gameData.home_team?.abbreviation === playerTeam 
      ? gameData.visitor_team?.abbreviation || ''
      : gameData.home_team?.abbreviation || '';
    
    gameDetails = {
      homeScore,
      visitorScore,
      homeTeam: gameData.home_team?.abbreviation || '',
      visitorTeam: gameData.visitor_team?.abbreviation || '',
      isQuarterStat,
      quarter: isQuarterStat ? selectedStat.charAt(1) : null
    };
  } else if (propsMode === 'player' && data.stats) {
    // Player mode: use player stats
    const gameStats = data.stats;
    playerTeam = gameStats?.team?.abbreviation || '';
    
    if ((gameStats as any)?.game) {
      const game = (gameStats as any).game;
      const gameISO = game.date;
      if (gameISO) {
        const date = new Date(gameISO);
        correctDate = date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        dateShort = `${month}/${day}/${year}`;
      }
      
      // Get opponent team
      const homeTeam = game.home_team?.abbreviation || '';
      const visitorTeam = game.visitor_team?.abbreviation || '';
      opponentTeam = homeTeam === playerTeam ? visitorTeam : homeTeam;
    }
  }
  
  // Calculate game result (won/lost by X)
  let gameResult: string | null = null;
  
  if (propsMode === 'team' && gameDetails) {
    const teamScore = gameDetails.homeTeam === (gamePropsTeam || selectedTeam) 
      ? gameDetails.homeScore 
      : gameDetails.visitorScore;
    const opponentScore = gameDetails.homeTeam === (gamePropsTeam || selectedTeam)
      ? gameDetails.visitorScore
      : gameDetails.homeScore;
    const margin = Math.abs(teamScore - opponentScore);
    if (teamScore > opponentScore) {
      gameResult = `Won by ${margin}`;
    } else if (teamScore < opponentScore) {
      gameResult = `Lost by ${margin}`;
    }
  } else if (propsMode === 'player' && data.stats && (data.stats as any)?.game) {
    const game = (data.stats as any).game;
    const homeScore = game.home_team_score || 0;
    const visitorScore = game.visitor_team_score || 0;
    const homeTeam = game.home_team?.abbreviation || '';
    const isHome = homeTeam === playerTeam;
    const teamScore = isHome ? homeScore : visitorScore;
    const oppScore = isHome ? visitorScore : homeScore;
    const margin = Math.abs(teamScore - oppScore);
    if (teamScore > oppScore) {
      gameResult = `Won by ${margin}`;
    } else if (teamScore < oppScore) {
      gameResult = `Lost by ${margin}`;
    }
  }
  
  // Professional tooltip styling
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipText = isDark ? '#ffffff' : '#000000';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const labelColor = isDark ? '#9ca3af' : '#6b7280';
  const winColor = isDark ? '#10b981' : '#059669'; // Green for wins
  const lossColor = isDark ? '#ef4444' : '#dc2626'; // Red for losses
  
  // Position tooltip at cursor location with offset to prevent overlap
  // Use very high z-index to ensure it appears above betting line (z-index 25) and chart (z-index 20)
  // On mobile, center the tooltip horizontally and position it in the middle of the screen
  const getTooltipPosition = () => {
    if (!mousePosition) return { left: undefined, top: undefined };
    
    if (isMobile) {
      // On mobile: center horizontally, position in middle-upper area of screen
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
      const tooltipWidth = 280; // Approximate tooltip width
      const tooltipHeight = 200; // Approximate tooltip height
      
      // Center horizontally
      const left = Math.max(10, (viewportWidth - tooltipWidth) / 2);
      
      // Position in upper-middle area (above the chart area)
      const top = Math.max(10, Math.min(viewportHeight * 0.3, viewportHeight - tooltipHeight - 20));
      
      return { left: `${left}px`, top: `${top}px` };
    } else {
      // Desktop: follow cursor with offset
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
      const tooltipWidth = 280;
      const offsetX = 15;
      const offsetY = -10;
      
      // Ensure tooltip doesn't go off right edge
      let left = mousePosition.x + offsetX;
      if (left + tooltipWidth > viewportWidth - 10) {
        left = viewportWidth - tooltipWidth - 10;
      }
      
      return {
        left: `${left}px`,
        top: `${mousePosition.y + offsetY}px`
      };
    }
  };

  const position = getTooltipPosition();
  
  const tooltipStyle: React.CSSProperties = {
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
    borderRadius: '8px',
    padding: '12px',
    minWidth: isMobile ? '280px' : '200px',
    maxWidth: isMobile ? '90vw' : 'none',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    zIndex: 999999, // Very high z-index to appear above everything
    pointerEvents: 'none',
    position: 'fixed',
    left: position.left,
    top: position.top,
    transform: 'none',
  };

  // Build tooltip content
  const tooltipContent = (
    <div style={tooltipStyle}>
      {/* Header: Date, Opponent, and Game Result */}
      <div style={{ 
        marginBottom: '12px', 
        paddingBottom: '8px', 
        borderBottom: `1px solid ${tooltipBorder}`,
        fontSize: '13px',
        fontWeight: '600',
        color: tooltipText,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>{dateShort} {opponentTeam && `vs ${opponentTeam}`}</span>
        {gameResult && (
          <span style={{
            color: gameResult.startsWith('Won') ? winColor : lossColor,
            fontWeight: '600',
            fontSize: '12px'
          }}>
            {gameResult}
          </span>
        )}
      </div>
      
      {/* Main stat line - highlighted */}
      <div style={{
        marginBottom: '10px',
        padding: '8px',
        backgroundColor: isDark ? '#374151' : '#f3f4f6',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: '600',
        color: tooltipText
      }}>
        {statLabel}: {formattedValue}
      </div>
      
      {/* Player mode: Stat-based detailed stats */}
      {propsMode === 'player' && data.stats && (() => {
        const stats = data.stats;
        const statRows: Array<{ label: string; value: string }> = [];
        
        // Always show minutes first
        statRows.push({
          label: 'Minutes',
          value: formatMinutes(stats.min || "0:00")
        });
        
        // Stat-specific stats based on selectedStat
        if (selectedStat === 'pts' || selectedStat === 'fg3m' || selectedStat === 'fgm') {
          // Points, 3PT Made, FG Made: Show shooting stats
          statRows.push({
            label: 'Points',
            value: String(Number(stats.pts || 0))
          });
          
          if (stats.ftm !== undefined && stats.fta !== undefined) {
            statRows.push({
              label: 'FT Made',
              value: `${stats.ftm}/${stats.fta}${stats.fta > 0 ? ` (${Math.round((stats.ftm / stats.fta) * 100)}%)` : ''}`
            });
          }
          
          if (stats.fg3m !== undefined && stats.fg3a !== undefined) {
            statRows.push({
              label: '3PT Made',
              value: `${stats.fg3m}/${stats.fg3a}${stats.fg3a > 0 ? ` (${Math.round((stats.fg3m / stats.fg3a) * 100)}%)` : ''}`
            });
          }
          
          if (stats.fgm !== undefined && stats.fga !== undefined) {
            statRows.push({
              label: 'FG Made',
              value: `${stats.fgm}/${stats.fga}${stats.fga > 0 ? ` (${Math.round((stats.fgm / stats.fga) * 100)}%)` : ''}`
            });
          }
        } else if (selectedStat === 'ast') {
          // Assists: Show assist-related stats
          statRows.push({
            label: 'Assists',
            value: String(Number(stats.ast || 0))
          });
          
          // TODO: Add Potential AST and Passes Made when tracking stats are available
          // These would come from tracking stats API
          // statRows.push({ label: 'Potential AST', value: String(trackingStats?.potentialAst || 0) });
          // statRows.push({ label: 'Passes Made', value: String(trackingStats?.passesMade || 0) });
        } else if (selectedStat === 'reb') {
          // Rebounds: Show rebounding stats
          // TODO: Add Rebound Chances when tracking stats are available
          // statRows.push({ label: 'Rebound Chances', value: String(trackingStats?.rebChances || 0) });
          
          statRows.push({
            label: 'OREB',
            value: String(Number(stats.oreb || 0))
          });
          
          statRows.push({
            label: 'DREB',
            value: String(Number(stats.dreb || 0))
          });
        } else {
          // Default: Show common stats
          statRows.push({
            label: 'Points',
            value: String(Number(stats.pts || 0))
          });
          
          statRows.push({
            label: 'Rebounds',
            value: String(Number(stats.reb || 0))
          });
          
          statRows.push({
            label: 'Assists',
            value: String(Number(stats.ast || 0))
          });
        }
        
        // Add fouls if available
        if (stats.pf !== undefined) {
          statRows.push({
            label: 'Fouls',
            value: String(stats.pf)
          });
        }
        
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
            {statRows.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: labelColor }}>{row.label}:</span>
                <span style={{ color: tooltipText, fontWeight: '500' }}>{row.value}</span>
              </div>
            ))}
          </div>
        );
      })()}
      
      {/* Team mode: Game score */}
      {propsMode === 'team' && gameDetails && (
        <div style={{ fontSize: '13px', color: tooltipText, marginTop: '8px' }}>
          <div style={{ marginBottom: '4px' }}>
            {gameDetails.isQuarterStat && `Q${gameDetails.quarter}: `}
            {gameDetails.homeTeam} {gameDetails.homeScore} - {gameDetails.visitorScore} {gameDetails.visitorTeam}
          </div>
        </div>
      )}
    </div>
  );

  // Render tooltip in a portal to document body to escape stacking context
  // On mobile, we can render even without mousePosition since we center it
  const shouldRender = typeof window !== 'undefined' && active && (mousePosition || (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }

  return null;
}









