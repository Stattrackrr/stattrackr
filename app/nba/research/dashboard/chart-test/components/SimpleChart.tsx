'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LabelList,
} from 'recharts';

interface SimpleChartProps {
  data: Array<{ game: string; value: number; opponent: string }>;
  bettingLine: number;
  isDark: boolean;
  selectedStat: string;
}

export default function SimpleChart({
  data,
  bettingLine,
  isDark,
  selectedStat,
}: SimpleChartProps) {
  // Calculate over/under percentages for background glow
  const { overPercent, underPercent } = useMemo(() => {
    const total = data.length;
    const overCount = data.filter(d => d.value > bettingLine).length;
    const underCount = data.filter(d => d.value < bettingLine).length;
    return {
      overPercent: total > 0 ? (overCount / total) * 100 : 0,
      underPercent: total > 0 ? (underCount / total) * 100 : 0,
    };
  }, [data, bettingLine]);

  // Determine background gradient glow based on over/under percentages (matching original dashboard)
  const backgroundGradient = useMemo(() => {
    if (overPercent > 60) {
      return isDark 
        ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.28) 0%, rgba(34, 197, 94, 0.20) 15%, rgba(34, 197, 94, 0.12) 30%, rgba(34, 197, 94, 0.06) 45%, rgba(34, 197, 94, 0.02) 60%, rgba(34, 197, 94, 0.008) 75%, rgba(34, 197, 94, 0.003) 85%, rgba(34, 197, 94, 0.001) 92%, rgba(34, 197, 94, 0.0002) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.20) 0%, rgba(34, 197, 94, 0.14) 15%, rgba(34, 197, 94, 0.09) 30%, rgba(34, 197, 94, 0.045) 45%, rgba(34, 197, 94, 0.015) 60%, rgba(34, 197, 94, 0.006) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)';
    } else if (underPercent > 60) {
      return isDark
        ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.20) 15%, rgba(239, 68, 68, 0.12) 30%, rgba(239, 68, 68, 0.06) 45%, rgba(239, 68, 68, 0.02) 60%, rgba(239, 68, 68, 0.008) 75%, rgba(239, 68, 68, 0.003) 85%, rgba(239, 68, 68, 0.001) 92%, rgba(239, 68, 68, 0.0002) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.20) 0%, rgba(239, 68, 68, 0.14) 15%, rgba(239, 68, 68, 0.09) 30%, rgba(239, 68, 68, 0.045) 45%, rgba(239, 68, 68, 0.015) 60%, rgba(239, 68, 68, 0.006) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)';
    } else if (overPercent > underPercent && overPercent > 40) {
      return isDark
        ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.16) 0%, rgba(34, 197, 94, 0.11) 15%, rgba(34, 197, 94, 0.06) 30%, rgba(34, 197, 94, 0.03) 45%, rgba(34, 197, 94, 0.012) 60%, rgba(34, 197, 94, 0.005) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.085) 15%, rgba(34, 197, 94, 0.055) 30%, rgba(34, 197, 94, 0.024) 45%, rgba(34, 197, 94, 0.008) 60%, rgba(34, 197, 94, 0.003) 75%, rgba(34, 197, 94, 0.001) 85%, rgba(34, 197, 94, 0.0003) 92%, rgba(34, 197, 94, 0.00005) 97%, transparent 100%)';
    } else if (underPercent > overPercent && underPercent > 40) {
      return isDark
        ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.16) 0%, rgba(239, 68, 68, 0.11) 15%, rgba(239, 68, 68, 0.06) 30%, rgba(239, 68, 68, 0.03) 45%, rgba(239, 68, 68, 0.012) 60%, rgba(239, 68, 68, 0.005) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.085) 15%, rgba(239, 68, 68, 0.055) 30%, rgba(239, 68, 68, 0.024) 45%, rgba(239, 68, 68, 0.008) 60%, rgba(239, 68, 68, 0.003) 75%, rgba(239, 68, 68, 0.001) 85%, rgba(239, 68, 68, 0.0003) 92%, rgba(239, 68, 68, 0.00005) 97%, transparent 100%)';
    }
    return '';
  }, [overPercent, underPercent, isDark]);

  // Determine bar color based on value vs betting line
  const getBarColor = (value: number) => {
    if (value > bettingLine) return '#10b981'; // green
    if (value < bettingLine) return '#ef4444'; // red
    return '#6b7280'; // gray for equal
  };

  // Format label value
  const formatLabel = (value: any) => {
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    return numValue.toString();
  };

  return (
    <div className="w-full h-full relative">
      {/* Background glow gradient - matching original dashboard */}
      {backgroundGradient && (
        <div 
          className="absolute pointer-events-none"
          style={{
            top: '-5%',
            left: '-30%',
            right: '-30%',
            bottom: '-30%',
            background: backgroundGradient,
            zIndex: 0,
            transition: 'background 0.1s ease-out'
          }}
        />
      )}
      
      <div className="relative z-10 w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 22, right: 14, left: 0, bottom: 29 }}
            barCategoryGap="5%"
          >
            <XAxis
              dataKey="game"
              tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }}
              height={30}
            />
            <YAxis
              tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }}
              width={32}
            />

            {/* Bar chart - render first so reference line appears on top */}
            <Bar
              dataKey="value"
              radius={[10, 10, 10, 10]}
            >
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={getBarColor(entry.value)}
                />
              ))}
            
            {/* Labels on top of bars */}
            <LabelList
              dataKey="value"
              position="top"
              fill={isDark ? '#ffffff' : '#000000'}
              fontSize={12}
              fontWeight="bold"
              formatter={formatLabel}
            />
          </Bar>
          
          {/* Reference line for betting line - render after bars so it appears on top */}
          <ReferenceLine
            y={bettingLine}
            stroke="#ffffff"
            strokeWidth={2}
            label={{
              value: `Line: ${bettingLine}`,
              position: 'right',
              fill: '#ffffff',
              fontSize: 12,
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

