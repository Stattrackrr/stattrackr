'use client';

import { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import SimpleChart from './components/SimpleChart';

export default function ChartTestPage() {
  const { isDark } = useTheme();
  const [selectedStat, setSelectedStat] = useState('pts');
  const [bettingLine, setBettingLine] = useState(10.5);

  // Sample data for testing
  const chartData = [
    { game: 'Game 1', value: 12, opponent: 'LAL' },
    { game: 'Game 2', value: 8, opponent: 'GSW' },
    { game: 'Game 3', value: 15, opponent: 'BOS' },
    { game: 'Game 4', value: 10, opponent: 'MIA' },
    { game: 'Game 5', value: 18, opponent: 'PHX' },
    { game: 'Game 6', value: 9, opponent: 'MIL' },
    { game: 'Game 7', value: 14, opponent: 'DEN' },
    { game: 'Game 8', value: 11, opponent: 'DAL' },
    { game: 'Game 9', value: 16, opponent: 'PHI' },
    { game: 'Game 10', value: 13, opponent: 'LAC' },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a1929] p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
          Chart Test Page
        </h1>
        
        <div className="mb-4 flex gap-4 items-center">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Stat
            </label>
            <select
              value={selectedStat}
              onChange={(e) => setSelectedStat(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#0a1929] text-gray-900 dark:text-white"
            >
              <option value="pts">Points</option>
              <option value="reb">Rebounds</option>
              <option value="ast">Assists</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Betting Line
            </label>
            <input
              type="number"
              value={bettingLine}
              onChange={(e) => setBettingLine(parseFloat(e.target.value) || 0)}
              step="0.5"
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#0a1929] text-gray-900 dark:text-white w-24"
            />
          </div>
        </div>

        <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <SimpleChart
            data={chartData}
            bettingLine={bettingLine}
            isDark={isDark}
            selectedStat={selectedStat}
          />
        </div>
      </div>
    </div>
  );
}


