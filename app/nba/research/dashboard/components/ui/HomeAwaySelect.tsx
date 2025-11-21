'use client';

import { memo } from 'react';

export default memo(function HomeAwaySelect({ 
  value, 
  onChange, 
  isDark 
}: { 
  value: 'ALL' | 'HOME' | 'AWAY'; 
  onChange: (v: 'ALL' | 'HOME' | 'AWAY') => void; 
  isDark: boolean 
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">H/A</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as 'ALL' | 'HOME' | 'AWAY')}
        className="w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 rounded-xl bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm sm:text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
      >
        <option value="ALL">ALL</option>
        <option value="HOME">HOME</option>
        <option value="AWAY">AWAY</option>
      </select>
    </div>
  );
});





