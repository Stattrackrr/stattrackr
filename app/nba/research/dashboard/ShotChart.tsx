import React, { useState, useEffect } from 'react';
import { getNbaStatsId } from '@/lib/playerIdMapping';

interface ShotZone {
  name: string;
  fga: number;
  fgm: number;
  fgPct: number;
}

interface EnhancedZone {
  fgm: number;
  fga: number;
  fgPct: number;
  pts: number;
}

interface OpponentZoneDefense {
  fgPctAllowed: number;
  rank: number;
}

interface ZoneRanking {
  rank: number;
  fgPct: number;
  fga: number;
  fgm: number;
  totalTeams: number;
}

interface EnhancedShotData {
  shotZones: {
    restrictedArea: EnhancedZone;
    paint: EnhancedZone;
    midRange: EnhancedZone;
    leftCorner3: EnhancedZone;
    rightCorner3: EnhancedZone;
    aboveBreak3: EnhancedZone;
  };
  opponentDefense?: {
    restrictedArea: OpponentZoneDefense;
    paint: OpponentZoneDefense;
    midRange: OpponentZoneDefense;
    corner3: OpponentZoneDefense;
    aboveBreak3: OpponentZoneDefense;
  } | null;
  opponentRankings?: {
    restrictedArea: ZoneRanking;
    paint: ZoneRanking;
    midRange: ZoneRanking;
    leftCorner3: ZoneRanking;
    rightCorner3: ZoneRanking;
    aboveBreak3: ZoneRanking;
  } | null;
}

interface ShotChartProps {
  isDark: boolean;
  playerId?: string;
  opponentTeam?: string;
  shotData?: {
    '40+_ft._fga'?: number;
    '40+_ft._fgm'?: number;
    '5-9_ft._fga'?: number;
    '5-9_ft._fgm'?: number;
    '10-14_ft._fga'?: number;
    '10-14_ft._fgm'?: number;
    '15-19_ft._fga'?: number;
    '15-19_ft._fgm'?: number;
    '20-24_ft._fga'?: number;
    '20-24_ft._fgm'?: number;
    '25-29_ft._fga'?: number;
    '25-29_ft._fgm'?: number;
    '30-34_ft._fga'?: number;
    '30-34_ft._fgm'?: number;
    '35-39_ft._fga'?: number;
    '35-39_ft._fgm'?: number;
    '40+_ft._fg_pct'?: number;
    '5-9_ft._fg_pct'?: number;
    '10-14_ft._fg_pct'?: number;
    '15-19_ft._fg_pct'?: number;
    '20-24_ft._fg_pct'?: number;
    '25-29_ft._fg_pct'?: number;
    '30-34_ft._fg_pct'?: number;
    '35-39_ft._fg_pct'?: number;
    'less_than_5_ft._fga'?: number;
    'less_than_5_ft._fgm'?: number;
    'less_than_5_ft._fg_pct'?: number;
  };
}

const ShotChart: React.FC<ShotChartProps> = ({ isDark, playerId, opponentTeam, shotData }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [enhancedData, setEnhancedData] = useState<EnhancedShotData | null>(null);
  const [enhancedLoading, setEnhancedLoading] = useState(false);
  const [enhancedError, setEnhancedError] = useState<string | null>(null);
  const [allowFallback, setAllowFallback] = useState(false);
  const [showMakes, setShowMakes] = useState(false); // Toggle between attempts vs makes distribution
  const [showOppDef, setShowOppDef] = useState(false); // Show opponent defense
  const [showOppDefMakes, setShowOppDefMakes] = useState(false); // Show opponent defense makes (vs attempts)

  console.log('[Shot Chart] Component rendered with playerId:', playerId);

  // Set 20-second timeout before allowing fallback to BallDontLie
  useEffect(() => {
    setAllowFallback(false);
    const timeout = setTimeout(() => {
      console.log('[Shot Chart] 20 seconds passed, allowing BallDontLie fallback');
      setAllowFallback(true);
    }, 20000); // 20 seconds

    return () => clearTimeout(timeout);
  }, [playerId, opponentTeam]);

  // Fetch enhanced shot data from NBA Stats API
  useEffect(() => {
    console.log('[Shot Chart] useEffect triggered with playerId:', playerId, 'opponentTeam:', opponentTeam);
    const fetchEnhanced = async () => {
      if (!playerId) {
        setEnhancedData(null); // Clear data when no player
        return;
      }
      
      // Convert BallDontLie ID to NBA Stats ID
      const nbaPlayerId = getNbaStatsId(playerId);
      console.log('[Shot Chart] Player ID conversion:', { 
        bdlId: playerId, 
        nbaId: nbaPlayerId 
      });
      
      if (!nbaPlayerId) {
        console.warn('[Shot Chart] Could not convert player ID to NBA Stats format:', playerId);
        setEnhancedData(null); // Clear data on conversion failure
        return;
      }
      
      // Clear old data immediately when player changes
      setEnhancedData(null);
      setEnhancedLoading(true);
      
      try {
        console.log('[Shot Chart] Opponent team value:', {
          opponentTeam,
          willFetchDefense: opponentTeam && opponentTeam !== 'N/A'
        });
        
        const url = `/api/shot-chart-enhanced?playerId=${encodeURIComponent(nbaPlayerId)}&season=2025${opponentTeam && opponentTeam !== 'N/A' ? `&opponentTeam=${encodeURIComponent(opponentTeam)}` : ''}`;
        console.log('[Shot Chart] Fetching enhanced data:', {
          bdlPlayerId: playerId,
          nbaPlayerId: nbaPlayerId,
          opponentTeam,
          url: url
        });
        const response = await fetch(url);
        
        if (response.ok) {
          const data = await response.json();
          console.log('[Shot Chart] Enhanced data loaded for player:', nbaPlayerId, 'Data:', data);
          setEnhancedData(data);
          setEnhancedError(null); // Clear any previous errors
        } else {
          // Try to get error message from response
          let errorMessage = `Failed to load shot chart data (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
            console.error('[Shot Chart] API returned error:', response.status, errorData);
          } catch {
            const errorText = await response.text().catch(() => '');
            console.error('[Shot Chart] API returned error:', response.status, errorText);
            if (errorText) {
              errorMessage = errorText.substring(0, 200);
            }
          }
          setEnhancedData(null);
          setEnhancedError(errorMessage);
        }
      } catch (err: any) {
        console.error('[Shot Chart] Error fetching enhanced data:', err);
        setEnhancedData(null);
        setEnhancedError(err.message || 'Failed to fetch shot chart data. Please try again.');
      } finally {
        setEnhancedLoading(false);
      }
    };

    fetchEnhanced();
  }, [playerId, opponentTeam]);
  
  // Process shot data into zones
  // Use enhanced NBA Stats API data if available (has corner 3s), otherwise fallback to BallDontLie after 20s
  const zones: ShotZone[] = enhancedData?.shotZones ? [
    {
      name: 'Restricted',
      fga: enhancedData.shotZones.restrictedArea.fga,
      fgm: enhancedData.shotZones.restrictedArea.fgm,
      fgPct: enhancedData.shotZones.restrictedArea.fgPct,
    },
    {
      name: 'Paint',
      fga: enhancedData.shotZones.paint.fga,
      fgm: enhancedData.shotZones.paint.fgm,
      fgPct: enhancedData.shotZones.paint.fgPct,
    },
    {
      name: 'Mid-Range',
      fga: enhancedData.shotZones.midRange.fga,
      fgm: enhancedData.shotZones.midRange.fgm,
      fgPct: enhancedData.shotZones.midRange.fgPct,
    },
    {
      name: 'Left Corner 3',
      fga: enhancedData.shotZones.leftCorner3.fga,
      fgm: enhancedData.shotZones.leftCorner3.fgm,
      fgPct: enhancedData.shotZones.leftCorner3.fgPct,
    },
    {
      name: 'Right Corner 3',
      fga: enhancedData.shotZones.rightCorner3.fga,
      fgm: enhancedData.shotZones.rightCorner3.fgm,
      fgPct: enhancedData.shotZones.rightCorner3.fgPct,
    },
    {
      name: 'Above Break 3',
      fga: enhancedData.shotZones.aboveBreak3.fga,
      fgm: enhancedData.shotZones.aboveBreak3.fgm,
      fgPct: enhancedData.shotZones.aboveBreak3.fgPct,
    },
  ] : (allowFallback && shotData) ? [
    {
      name: 'Paint',
      fga: shotData['less_than_5_ft._fga'] || 0,
      fgm: shotData['less_than_5_ft._fgm'] || 0,
      fgPct: (shotData['less_than_5_ft._fg_pct'] || 0) * 100,
    },
    {
      name: 'Short Mid',
      fga: shotData['5-9_ft._fga'] || 0,
      fgm: shotData['5-9_ft._fgm'] || 0,
      fgPct: (shotData['5-9_ft._fg_pct'] || 0) * 100,
    },
    {
      name: 'Mid-Range',
      fga: (shotData['10-14_ft._fga'] || 0) + (shotData['15-19_ft._fga'] || 0),
      fgm: (shotData['10-14_ft._fgm'] || 0) + (shotData['15-19_ft._fgm'] || 0),
      fgPct: ((shotData['10-14_ft._fg_pct'] || 0) + (shotData['15-19_ft._fg_pct'] || 0)) * 50,
    },
    {
      name: 'Long Mid',
      fga: shotData['20-24_ft._fga'] || 0,
      fgm: shotData['20-24_ft._fgm'] || 0,
      fgPct: (shotData['20-24_ft._fg_pct'] || 0) * 100,
    },
    {
      name: '3-Point',
      fga: (shotData['25-29_ft._fga'] || 0) + (shotData['30-34_ft._fga'] || 0) + (shotData['35-39_ft._fga'] || 0) + (shotData['40+_ft._fga'] || 0),
      fgm: (shotData['25-29_ft._fgm'] || 0) + (shotData['30-34_ft._fgm'] || 0) + (shotData['35-39_ft._fgm'] || 0) + (shotData['40+_ft._fgm'] || 0),
      fgPct: 0,
    },
  ] : [];

  // Calculate 3-point percentage for BallDontLie fallback
  if (!enhancedData && zones[4] && zones[4].fga > 0) {
    zones[4].fgPct = (zones[4].fgm / zones[4].fga) * 100;
  }

  // Calculate total FGA for distribution percentages
  const totalFga = zones.reduce((sum, zone) => sum + zone.fga, 0);
  const totalFgm = zones.reduce((sum, zone) => sum + zone.fgm, 0);
  
  // Calculate distributions based on toggle: attempts or makes
  const distributions = showMakes 
    ? zones.map(zone => (zone.fgm / totalFgm) * 100)  // % of total makes
    : zones.map(zone => (zone.fga / totalFga) * 100); // % of total attempts

  const getColorForDistribution = (pct: number) => {
    if (pct >= 30) return '#10b981'; // teal/green ≥30%
    if (pct >= 25) return '#22c55e'; // green 25-29%
    if (pct >= 20) return '#f97316'; // orange 20-24%
    if (pct >= 10) return '#f97316'; // orange 10-19%
    return '#ef4444'; // red <10%
  };

  // Get color based on defensive ranking (rank 1 = best = red, rank 30 = worst = green)
  // If rank is 0, use fgPct to estimate (lower fgPct = better defense = redder)
  const getColorForRank = (rank: number, fgPct?: number) => {
    if (rank > 0) {
      // Use actual rank
      if (rank <= 5) return '#ef4444'; // Red for ranks 1-5 (elite defense)
      if (rank <= 11) return '#f97316'; // Orange for ranks 6-11 (good defense)
      if (rank <= 21) return '#fbbf24'; // Yellow for ranks 12-21 (average defense)
      return '#10b981'; // Green for ranks 22-30 (weak defense - good for offense!)
    } else if (fgPct !== undefined) {
      // No rank available, use fgPct to estimate (lower = better defense)
      // Typical NBA fgPct ranges: ~50-70% for restricted area, ~35-50% for 3s
      if (fgPct < 50) return '#ef4444'; // Very good defense (red)
      if (fgPct < 55) return '#f97316'; // Good defense (orange)
      if (fgPct < 60) return '#fbbf24'; // Average defense (yellow)
      return '#10b981'; // Weak defense (green)
    }
    return '#6b7280'; // Gray if no data
  };

  if (!enhancedData && (!allowFallback || !shotData)) {
    return (
      <div className="w-full h-full flex items-center justify-center p-6" style={{ minHeight: '200px' }}>
        {enhancedError ? (
          <div className="text-center max-w-md">
            <div className="text-red-500 dark:text-red-400 font-semibold mb-2 text-sm">⚠️ Error Loading Shot Chart</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{enhancedError}</div>
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
            {enhancedLoading ? 'Loading NBA Stats data...' : 'No shot data available'}
          </div>
        )}
      </div>
    );
  }

  // NBA court dimensions (in feet, scaled to fit viewBox)
  // Court is 50ft wide × 47ft half-court
  // Scale: 10px = 1ft
  const scale = 10;
  const courtWidth = 50 * scale; // 500px
  const courtHeight = 38 * scale; // 380px (reduced to minimize top space)
  const paintWidth = 16 * scale; // 160px
  const threePointRadius = 23.75 * scale; // 237.5px from hoop
  const threePointCorner = 14 * scale; // 140px from baseline (NBA: 14ft corners)
  const freeThrowRadius = 6 * scale; // 60px
  const restrictedRadius = 4 * scale; // 40px
  
  const centerX = courtWidth / 2; // 250
  const baseline = courtHeight; // 470
  const paintLeft = centerX - paintWidth / 2; // 170
  const paintRight = centerX + paintWidth / 2; // 330
  const freeThrowLine = baseline - 21 * scale; // 210 (moved higher up)
  const midRangeWidth = 80; // Width of mid-range zone

  return (
    <div className="w-full flex flex-col items-center justify-center bg-white dark:bg-slate-800 rounded-lg shadow-sm p-4 gap-4 border border-gray-200 dark:border-gray-700" style={{ minHeight: '400px' }}>
      {/* Title with Info Button and Season Label */}
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 relative">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
          <button
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
          >
            ?
          </button>
          {showTooltip && (
            <div className="absolute z-50 left-0 top-8 w-64 px-3 py-2 text-xs leading-relaxed rounded border shadow-lg bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
              <strong>Shot Chart Views</strong><br/>
              <span className="text-blue-600 dark:text-blue-400">Attempts</span> - Player's shot distribution<br/>
              <span className="text-green-600 dark:text-green-400">Makes</span> - Player's make distribution<br/>
              <span className="text-purple-600 dark:text-purple-400">Opp Def Rank</span> - Team defense rankings by zone (lower % = better rank)
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowMakes(false);
              setShowOppDef(false);
            }}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
              !showMakes && !showOppDef
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Attempts
          </button>
          <button
            onClick={() => {
              setShowMakes(true);
              setShowOppDef(false);
            }}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
              showMakes && !showOppDef
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Makes
          </button>
          {enhancedData?.opponentRankings && opponentTeam && opponentTeam !== 'N/A' && (
            <>
              <button
                onClick={() => {
                  setShowOppDef(true);
                  setShowOppDefMakes(false);
                }}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                  showOppDef && !showOppDefMakes
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Opp Def Rank
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* SVG Chart */}
      <svg viewBox="0 0 500 380" className="w-full" style={{ height: '380px', maxWidth: '500px' }} preserveAspectRatio="xMidYMid meet">
        {/* Define clip path for rounded corners */}
        <defs>
          <clipPath id="roundedCourt">
            <rect x="0" y="0" width="500" height="380" rx="15" ry="15" />
          </clipPath>
        </defs>
        
        {/* Court background with rounded corners */}
        <rect x="0" y="0" width="500" height="380" rx="15" ry="15" fill={isDark ? '#1e293b' : '#d4a574'} />
        
        {/* Group with clip path for all zones */}
        <g clipPath="url(#roundedCourt)">
        {/* ===== ZONE FILLS (drawn first, behind lines) ===== */}
        
        {/* Left Corner 3 - drawn first so it's underneath other zones, with rounded bottom-left corner */}
        {enhancedData && (
          <path
            d={`M 0 270 
                L 150 270 
                L 150 ${baseline} 
                L 15 ${baseline} 
                Q 0 ${baseline} 0 ${baseline - 15} Z`}
            fill={showOppDef && enhancedData?.opponentRankings?.leftCorner3 
              ? getColorForRank(enhancedData.opponentRankings.leftCorner3.rank, enhancedData.opponentRankings.leftCorner3.fgPct) 
              : getColorForDistribution(distributions[3] || 0)}
            stroke="none"
          />
        )}
        
        {/* Right Corner 3 - drawn first so it's underneath other zones, with rounded bottom-right corner */}
        {enhancedData && (
          <path
            d={`M ${courtWidth - 150} 270 
                L ${courtWidth} 270 
                L ${courtWidth} ${baseline - 15} 
                Q ${courtWidth} ${baseline} ${courtWidth - 15} ${baseline} 
                L ${courtWidth - 150} ${baseline} Z`}
            fill={showOppDef && enhancedData?.opponentRankings?.rightCorner3 
              ? getColorForRank(enhancedData.opponentRankings.rightCorner3.rank, enhancedData.opponentRankings.rightCorner3.fgPct) 
              : getColorForDistribution(distributions[4] || 0)}
            stroke="none"
          />
        )}
        
        {/* Paint zone (5-9ft shots) */}
        <rect
          x={paintLeft}
          y={freeThrowLine}
          width={paintWidth}
          height={baseline - freeThrowLine}
          fill={showOppDef && enhancedData?.opponentRankings?.paint 
            ? getColorForRank(enhancedData.opponentRankings.paint.rank, enhancedData.opponentRankings.paint.fgPct) 
            : getColorForDistribution(distributions[1] || 0)}
          stroke="none"
        />
        
        {/* Restricted area zone - less than 5ft (77% paint shots) */}
        <path
          d={`M ${centerX - 60} ${baseline} 
              L ${centerX - 60} ${baseline - 60} 
              Q ${centerX} ${baseline - 90} ${centerX + 60} ${baseline - 60} 
              L ${centerX + 60} ${baseline} Z`}
          fill={showOppDef && enhancedData?.opponentRankings?.restrictedArea 
            ? getColorForRank(enhancedData.opponentRankings.restrictedArea.rank, enhancedData.opponentRankings.restrictedArea.fgPct) 
            : getColorForDistribution(distributions[0] || 0)}
          stroke="#000"
          strokeWidth="3"
        />
        
        {/* 3-point zone - area above mid-range, excluding corners when using NBA data (drawn BEFORE mid-range so mid-range goes on top) */}
        <path
          d={enhancedData 
            ? `M 15 0 
                L ${courtWidth - 15} 0 
                Q ${courtWidth} 0 ${courtWidth} 15 
                L ${courtWidth} 270 
                L ${courtWidth - 150} 270 
                L ${courtWidth - 150} ${freeThrowLine - 50} 
                L ${paintRight + midRangeWidth} ${freeThrowLine - 50} 
                Q ${centerX} ${freeThrowLine - 120} ${paintLeft - midRangeWidth} ${freeThrowLine - 50} 
                L 150 ${freeThrowLine - 50} 
                L 150 270 
                L 0 270 
                L 0 15 
                Q 0 0 15 0 Z`
            : `M 15 0 
                L ${courtWidth - 15} 0 
                Q ${courtWidth} 0 ${courtWidth} 15 
                L ${courtWidth} ${baseline - 15} 
                Q ${courtWidth} ${baseline} ${courtWidth - 15} ${baseline} 
                L ${paintRight + midRangeWidth} ${baseline} 
                L ${paintRight + midRangeWidth} ${freeThrowLine - 50} 
                Q ${centerX} ${freeThrowLine - 120} ${paintLeft - midRangeWidth} ${freeThrowLine - 50} 
                L ${paintLeft - midRangeWidth} ${baseline} 
                L 15 ${baseline} 
                Q 0 ${baseline} 0 ${baseline - 15} 
                L 0 15 
                Q 0 0 15 0 Z`}
          fill={showOppDef && enhancedData?.opponentRankings?.aboveBreak3 
            ? getColorForRank(enhancedData.opponentRankings.aboveBreak3.rank, enhancedData.opponentRankings.aboveBreak3.fgPct) 
            : getColorForDistribution(distributions[enhancedData ? 5 : 4] || 0)}
        />
        
        {/* Mid-range zone - Complete border around paint with rounded bottom corners (drawn AFTER 3-point so it goes on top) */}
        <path
          d={`M ${paintLeft - midRangeWidth} ${baseline - 15} 
              Q ${paintLeft - midRangeWidth} ${baseline} ${paintLeft - midRangeWidth + 15} ${baseline} 
              L 15 ${baseline} 
              Q 0 ${baseline} 0 ${baseline - 15} 
              L 0 ${baseline - 15} 
              Q 0 ${baseline} 15 ${baseline} 
              L ${paintLeft} ${baseline} 
              L ${paintLeft} ${freeThrowLine} 
              L ${paintRight} ${freeThrowLine} 
              L ${paintRight} ${baseline} 
              L ${courtWidth - 15} ${baseline} 
              Q ${courtWidth} ${baseline} ${courtWidth} ${baseline - 15} 
              L ${courtWidth} ${baseline - 15} 
              Q ${courtWidth} ${baseline} ${courtWidth - 15} ${baseline} 
              L ${paintRight + midRangeWidth - 15} ${baseline} 
              Q ${paintRight + midRangeWidth} ${baseline} ${paintRight + midRangeWidth} ${baseline - 15} 
              L ${paintRight + midRangeWidth} ${freeThrowLine - 50} 
              Q ${centerX} ${freeThrowLine - 120} ${paintLeft - midRangeWidth} ${freeThrowLine - 50} Z`}
          fill={showOppDef && enhancedData?.opponentRankings?.midRange 
            ? getColorForRank(enhancedData.opponentRankings.midRange.rank, enhancedData.opponentRankings.midRange.fgPct) 
            : getColorForDistribution(distributions[2] || 0)}
          stroke="none"
        />
        
        {/* ===== COURT LINES ===== */}
        
        {/* Court boundary with rounded corners */}
        <rect x="0" y="0" width={courtWidth} height={courtHeight} rx="15" ry="15" fill="none" stroke="#000" strokeWidth="3" />
        
        {/* Paint */}
        <rect
          x={paintLeft}
          y={freeThrowLine}
          width={paintWidth}
          height={baseline - freeThrowLine}
          fill="none"
          stroke="#000"
          strokeWidth="3"
        />
        
        {/* Mid-range outer border */}
        <path
          d={`M ${paintLeft - midRangeWidth} ${baseline} 
              L ${paintLeft - midRangeWidth} ${freeThrowLine - 50} 
              Q ${centerX} ${freeThrowLine - 120} ${paintRight + midRangeWidth} ${freeThrowLine - 50} 
              L ${paintRight + midRangeWidth} ${baseline}`}
          fill="none"
          stroke="#000"
          strokeWidth="3"
        />
        
        {/* Free throw mark */}
        <circle cx={centerX} cy={freeThrowLine} r="3" fill="#000" />
        
        {/* Corner 3 separator lines - horizontal lines on left and right */}
        <line
          x1="0"
          y1="270"
          x2="90"
          y2="270"
          stroke="#000"
          strokeWidth="3"
        />
        <line
          x1="410"
          y1="270"
          x2="500"
          y2="270"
          stroke="#000"
          strokeWidth="3"
        />
        
        {/* ===== PERCENTAGES OR DEFENSE RANKINGS (toggle between them) ===== */}
        
        {showOppDef && enhancedData?.opponentRankings ? (
          /* OPPONENT DEFENSE RANKINGS MODE - Show rankings (rank 1 = best defense = red) */
          (() => {
            const rankings = enhancedData.opponentRankings;
            if (!rankings) return null;
            
            return (
              <>
                {/* Above-the-break 3 */}
                <text x={centerX} y="60" textAnchor="middle" fill="#ffffff" fontSize="32" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                  {rankings.aboveBreak3?.rank && rankings.aboveBreak3.rank > 0 ? `#${rankings.aboveBreak3.rank}` : '-'}
                </text>
                {/* Mid-Range */}
                <text x={centerX} y={freeThrowLine - 30} textAnchor="middle" fill="#ffffff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                  {rankings.midRange?.rank && rankings.midRange.rank > 0 ? `#${rankings.midRange.rank}` : '-'}
                </text>
                {/* Restricted Area */}
                <text x={centerX} y={baseline - 25} textAnchor="middle" fill="#ffffff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                  {rankings.restrictedArea?.rank && rankings.restrictedArea.rank > 0 ? `#${rankings.restrictedArea.rank}` : '-'}
                </text>
                {/* Paint */}
                <text x={centerX} y={freeThrowLine + (baseline - freeThrowLine) / 2} textAnchor="middle" fill="#ffffff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                  {rankings.paint?.rank && rankings.paint.rank > 0 ? `#${rankings.paint.rank}` : '-'}
                </text>
                {/* Left Corner 3 - show individual rank */}
                {enhancedData && (
                  <>
                    <text x="45" y="330" textAnchor="middle" fill="#ffffff" fontSize="24" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                      {rankings.leftCorner3?.rank && rankings.leftCorner3.rank > 0 ? `#${rankings.leftCorner3.rank}` : '-'}
                    </text>
                    <text x="455" y="330" textAnchor="middle" fill="#ffffff" fontSize="24" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                      {rankings.rightCorner3?.rank && rankings.rightCorner3.rank > 0 ? `#${rankings.rightCorner3.rank}` : '-'}
                    </text>
                  </>
                )}
              </>
            );
          })()
        ) : (
          /* PLAYER STATS MODE (attempts/makes distribution) */
          <>
            {/* Above-the-break 3PT percentage (or all 3s if using BallDontLie) */}
            <text x={centerX} y="60" textAnchor="middle" fill="#fff" fontSize="32" fontWeight="bold" stroke="#000" strokeWidth="0.5">
              {(enhancedData ? distributions[5] : distributions[4])?.toFixed(0) || 0}%
            </text>
            
            {/* Mid-Range percentage - top */}
            <text x={centerX} y={freeThrowLine - 30} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
              {distributions[2]?.toFixed(0) || 0}%
            </text>
            
            {/* Restricted area percentage */}
            <text x={centerX} y={baseline - 25} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
              {distributions[0]?.toFixed(0) || 0}%
            </text>
            
            {/* Paint percentage - in middle of paint */}
            <text x={centerX} y={freeThrowLine + (baseline - freeThrowLine) / 2} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
              {distributions[1]?.toFixed(0) || 0}%
            </text>
            
            {/* Left Corner 3 percentage - only show if using enhanced data */}
            {enhancedData && (
              <text x="45" y="330" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                {distributions[3]?.toFixed(0) || 0}%
              </text>
            )}
            
            {/* Right Corner 3 percentage - only show if using enhanced data */}
            {enhancedData && (
              <text x="455" y="330" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="bold" stroke="#000" strokeWidth="0.5">
                {distributions[4]?.toFixed(0) || 0}%
              </text>
            )}
          </>
        )}
        </g>
      </svg>
      
      {/* Color Legend */}
      {showOppDef && enhancedData?.opponentRankings ? (
        <div className="flex items-center gap-4 text-sm font-medium flex-wrap">
          <span className="text-gray-700 dark:text-gray-300">Defense Ranking:</span>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#ef4444' }}></div>
            <span className="text-gray-600 dark:text-gray-400">#1-5 (Elite)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#f97316' }}></div>
            <span className="text-gray-600 dark:text-gray-400">#6-11 (Good)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#fbbf24' }}></div>
            <span className="text-gray-600 dark:text-gray-400">#12-21 (Avg)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#10b981' }}></div>
            <span className="text-gray-600 dark:text-gray-400">#22-30 (Weak)</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="text-gray-700 dark:text-gray-300">{showMakes ? 'Make Distribution:' : 'Shot Distribution:'}</span>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#10b981' }}></div>
            <span className="text-gray-600 dark:text-gray-400">≥30%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#22c55e' }}></div>
            <span className="text-gray-600 dark:text-gray-400">25-29%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#f97316' }}></div>
            <span className="text-gray-600 dark:text-gray-400">10-24%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded" style={{ backgroundColor: '#ef4444' }}></div>
            <span className="text-gray-600 dark:text-gray-400">&lt;10%</span>
          </div>
        </div>
      )}

    </div>
  );
};

export default ShotChart;
