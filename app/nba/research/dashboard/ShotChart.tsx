import React, { useState } from 'react';

interface ShotZone {
  name: string;
  fga: number;
  fgm: number;
  fgPct: number;
}

interface ShotChartProps {
  isDark: boolean;
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

const ShotChart: React.FC<ShotChartProps> = ({ isDark, shotData }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Process shot data into zones
  const zones: ShotZone[] = shotData ? [
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

  // Calculate 3-point percentage
  if (zones[4] && zones[4].fga > 0) {
    zones[4].fgPct = (zones[4].fgm / zones[4].fga) * 100;
  }

  // Calculate total FGA for distribution percentages
  const totalFga = zones.reduce((sum, zone) => sum + zone.fga, 0);
  
  // Calculate distribution percentages
  const distributions = zones.map(zone => (zone.fga / totalFga) * 100);

  const getColorForDistribution = (pct: number) => {
    if (pct >= 30) return '#10b981'; // teal/green ≥30%
    if (pct >= 25) return '#22c55e'; // green 25-29%
    if (pct >= 20) return '#f97316'; // orange 20-24%
    if (pct >= 10) return '#f97316'; // orange 10-19%
    return '#ef4444'; // red <10%
  };

  if (!shotData) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-white dark:bg-slate-800">
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
          No shot data available
        </div>
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
    <div className="w-full h-full flex flex-col items-center justify-center bg-white dark:bg-slate-800 p-4 gap-4">
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
              <strong>Shot Distribution</strong><br/>
              Percentages show where the player takes their shots from, not shooting accuracy.<br/><br/>
              Example: 10% means 10% of total shots are taken from that zone.
            </div>
          )}
        </div>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      
      {/* SVG Chart */}
      <svg viewBox="0 0 500 380" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
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
        
        {/* Paint zone (5-9ft shots) */}
        <rect
          x={paintLeft}
          y={freeThrowLine}
          width={paintWidth}
          height={baseline - freeThrowLine}
          fill={getColorForDistribution(distributions[1] || 0)}
          stroke="none"
        />
        
        {/* Restricted area zone - less than 5ft (77% paint shots) */}
        <path
          d={`M ${centerX - 60} ${baseline} 
              L ${centerX - 60} ${baseline - 60} 
              Q ${centerX} ${baseline - 90} ${centerX + 60} ${baseline - 60} 
              L ${centerX + 60} ${baseline} Z`}
          fill={getColorForDistribution(distributions[0] || 0)}
          stroke="#000"
          strokeWidth="3"
        />
        
        {/* Mid-range zone - Complete border around paint with rounded bottom corners */}
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
          fill={getColorForDistribution(distributions[2] || 0)}
          stroke="none"
        />
        
        {/* 3-point zone - entire area above mid-range with all rounded corners */}
        <path
          d={`M 15 0 
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
          fill={getColorForDistribution(distributions[4] || 0)}
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
        
        {/* Restricted area */}
        <path
          d={`M ${centerX - restrictedRadius} ${baseline} A ${restrictedRadius} ${restrictedRadius} 0 0 0 ${centerX + restrictedRadius} ${baseline}`}
          fill="none"
          stroke="#000"
          strokeWidth="3"
        />
        
        {/* Hoop */}
        <circle cx={centerX} cy={baseline - 5} r="9" fill="none" stroke="#000" strokeWidth="2.5" />
        
        {/* Free throw mark */}
        <circle cx={centerX} cy={freeThrowLine} r="3" fill="#000" />
        
        {/* ===== PERCENTAGES ===== */}
        
        {/* 3PT percentage */}
        <text x={centerX} y="60" textAnchor="middle" fill="#fff" fontSize="32" fontWeight="bold" stroke="#000" strokeWidth="0.5">
          {distributions[4]?.toFixed(0) || 0}%
        </text>
        
        {/* Mid-Range percentage - top */}
        <text x={centerX} y={freeThrowLine - 30} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
          {distributions[2]?.toFixed(0) || 0}%
        </text>
        
        {/* Paint percentage - in restricted area */}
        <text x={centerX} y={baseline - 25} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
          {distributions[0]?.toFixed(0) || 0}%
        </text>
        
        {/* 5-9ft percentage - in middle of paint */}
        <text x={centerX} y={freeThrowLine + (baseline - freeThrowLine) / 2} textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold" stroke="#000" strokeWidth="0.5">
          {distributions[1]?.toFixed(0) || 0}%
        </text>
        </g>
      </svg>
      
      {/* Color Legend */}
      <div className="flex items-center gap-4 text-sm font-medium">
        <span className="text-gray-700 dark:text-gray-300">Shot Distribution:</span>
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
    </div>
  );
};

export default ShotChart;
