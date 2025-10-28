import React from 'react';

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

  return (
    <div className="w-full h-full flex items-center justify-center bg-white dark:bg-slate-800">
      <svg viewBox="0 0 500 470" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Background */}
        <rect x="0" y="0" width="500" height="470" fill={isDark ? '#1e293b' : '#2d3748'} />
        
        {/* Outer boundary - court edge */}
        <rect x="85" y="0" width="330" height="470" fill="none" stroke="#000" strokeWidth="3" />
        
        {/* 3-Point Zone - Above the arc */}
        <path 
          d="M 85 0 L 85 300 A 200 200 0 0 0 415 300 L 415 0 Z" 
          fill={getColorForDistribution(distributions[4] || 0)}
        />
        
        {/* Corner 3s - Left */}
        <rect 
          x="85" 
          y="300" 
          width="70" 
          height="170" 
          fill={getColorForDistribution(distributions[4] || 0)}
        />
        
        {/* Corner 3s - Right */}
        <rect 
          x="345" 
          y="300" 
          width="70" 
          height="170" 
          fill={getColorForDistribution(distributions[4] || 0)}
        />
        
        {/* Mid-Range Arc - Between 3pt line and free throw area */}
        <path 
          d="M 155 300 A 200 200 0 0 0 345 300 A 90 90 0 0 1 155 300 Z" 
          fill={getColorForDistribution(distributions[2] || 0)}
        />
        
        {/* Short Mid - Free throw circle area */}
        <path 
          d="M 155 300 A 90 90 0 0 0 345 300 L 345 380 A 95 95 0 0 1 155 380 Z" 
          fill={getColorForDistribution(distributions[1] || 0)}
        />
        
        {/* Paint - The key */}
        <rect 
          x="190" 
          y="380" 
          width="120" 
          height="90" 
          fill={getColorForDistribution(distributions[1] || 0)}
        />
        
        {/* Restricted Area - Inside paint */}
        <path 
          d="M 210 470 L 210 430 A 40 40 0 0 1 290 430 L 290 470 Z" 
          fill={getColorForDistribution(distributions[0] || 0)}
        />
        
        {/* 3-Point Arc */}
        <path 
          d="M 85 300 A 200 200 0 0 0 415 300" 
          fill="none" 
          stroke="#000" 
          strokeWidth="3"
        />
        
        {/* Free Throw Circle - Top half */}
        <path 
          d="M 155 380 A 95 95 0 0 0 345 380" 
          fill="none" 
          stroke="#000" 
          strokeWidth="2"
        />
        
        {/* Free Throw Circle - Bottom half (dashed effect with small circle) */}
        <circle cx="250" cy="380" r="95" fill="none" stroke="#000" strokeWidth="2" />
        
        {/* Paint box outline */}
        <rect 
          x="190" 
          y="380" 
          width="120" 
          height="90" 
          fill="none" 
          stroke="#000" 
          strokeWidth="2"
        />
        
        {/* Baseline */}
        <line x1="85" y1="470" x2="415" y2="470" stroke="#000" strokeWidth="3" />
        
        {/* Restricted area arc */}
        <path 
          d="M 210 430 A 40 40 0 0 1 290 430" 
          fill="none" 
          stroke="#000" 
          strokeWidth="2"
        />
        
        {/* Percentages on zones */}
        {/* 3-Point percentage (top) */}
        <text x="250" y="120" textAnchor="middle" fill="#fff" fontSize="28" fontWeight="bold">
          {distributions[4]?.toFixed(0) || 0}%
        </text>
        
        {/* Mid-Range percentage */}
        <text x="250" y="250" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="bold">
          {distributions[2]?.toFixed(0) || 0}%
        </text>
        
        {/* Short Mid percentage */}
        <text x="250" y="340" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="bold">
          {distributions[1]?.toFixed(0) || 0}%
        </text>
        
        {/* Paint percentage */}
        <text x="250" y="440" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="bold">
          {distributions[0]?.toFixed(0) || 0}%
        </text>
        
        {/* Corner 3s - Left */}
        <text x="120" y="390" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">
          {(distributions[4] / 4)?.toFixed(0) || 0}%
        </text>
        
        {/* Corner 3s - Right */}
        <text x="380" y="390" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="bold">
          {(distributions[4] / 4)?.toFixed(0) || 0}%
        </text>
      </svg>
    </div>
  );
};

export default ShotChart;
