'use client';

import { memo } from 'react';

export default memo(function OverRatePill({ 
  overCount, 
  total, 
  isDark 
}: { 
  overCount: number; 
  total: number; 
  isDark: boolean 
}) {
  const pct = total > 0 ? (overCount / total) * 100 : 0;
  const cls = pct >= 60
    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    : pct >= 40
    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return (
    <span className={`px-1 sm:px-2 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-bold ${cls} whitespace-nowrap`} data-over-rate>
      {overCount}/{total} ({pct.toFixed(1)}%)
    </span>
  );
});





